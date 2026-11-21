// codeDeft local API and dashboard host. Binds to 127.0.0.1 only.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { RepositoryStore } from '../../../packages/engine/dist/storage.js';
import { queryRepository, indexRepository, createAgentPlan, type RepositoryIndex } from '../../../packages/engine/dist/index.js';
import { type ModelConfig } from '../../../packages/engine/dist/agent.js';
import { generateVerified } from './grounded-generation.js';
import { findReusable, buildReuseDecision } from './reuse-intelligence.js';
import { independentInstruction, assertIndependentProposal, previewIndependentProposal } from './reuse-decision.js';
import { planFromDesign, proposeDesign, validateGenerated, designSummary } from './figma-workflow.js';
import { readFigma, FigmaReadError, figmaApiBase } from '../../../packages/figma-reader/dist/index.js';
import { API_VERSION, MIN_CLIENT_API, ALL_CAPABILITIES, type ErrorCode, type GeneratedProposal } from '../../../packages/protocol/dist/index.js';
import { DesignStore, ProposalStore } from './stores.js';
import { openAppDatabase } from './database.js';
import { FeatureStore, FEATURE_ID } from './feature-store.js';
import { FeatureService } from './feature-service.js';

// Paths are relative to this file (apps/server/dist/index.js), never to the current directory,
// so `npm start`, `npm --prefix apps/server start` and `node dist/index.js` all behave the same.
const serverDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(serverDir, '../../..');
const staticDir = path.join(root, 'apps/web-dashboard/dist');
const database = process.env.CODEDEFT_DB || path.join(root, 'data/codedeft.db');
const port = Number(process.env.CODEDEFT_PORT || 4317);
const host = '127.0.0.1';
const token = process.env.CODEDEFT_TOKEN || '';
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const version = (() => { try { return String(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version); } catch { return 'unknown'; } })();

// Only these Host/Origin values are accepted. Checking Host blocks DNS-rebinding attacks, where a
// website points its own domain at 127.0.0.1 so the browser treats this server as same-origin.
const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
const allowedOrigins = new Set([...allowedHosts].map(h => `http://${h}`));

const securityHeaders: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin'
};

class HttpError extends Error { constructor(readonly status: number, message: string, readonly code: ErrorCode = 'bad_request') { super(message); } }

// Feature chats, designs and proposals are stored in the same SQLite file as the repository index.
const appDb = openAppDatabase(database);
const designs = new DesignStore(appDb);
const proposals = new ProposalStore(appDb);
const featureStore = new FeatureStore(appDb);
const interrupted = featureStore.recoverInterrupted();
// Validate the Figma API override once at start-up, so a bad value fails loudly instead of per request.
const figmaBase = figmaApiBase(process.env.CODEDEFT_FIGMA_API_BASE);

/** Maps any thrown value to a status, a stable code and a message that is safe to show (never contains secrets). */
function errorResponse(error: unknown): { status: number; code: ErrorCode; message: string } {
  if (error instanceof HttpError) return { status: error.status, code: error.code, message: error.message };
  if (error instanceof FigmaReadError) return { status: error.kind === 'timeout' ? 504 : 502, code: error.kind === 'timeout' ? 'timeout' : 'upstream_error', message: error.message };
  const message = error instanceof Error ? error.message : String(error);
  if (/timed out/i.test(message)) return { status: 504, code: 'timeout', message };
  if (/^Model request failed/.test(message)) return { status: 502, code: 'upstream_error', message };
  return { status: 400, code: 'bad_request', message };
}

function json(res: http.ServerResponse, status: number, obj: unknown): void {
  res.writeHead(status, { ...securityHeaders, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

/** Reads a JSON body. Chunks are joined as bytes and decoded once, so multi-byte characters split across chunks stay intact. */
async function body(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buffer.length;
    // Over the limit: keep reading (and discarding) so the client receives the 413 instead of a reset
    // connection, but give up on clients that keep sending far beyond it.
    if (size > MAX_BODY_BYTES * 8) { req.destroy(); break; }
    if (size <= MAX_BODY_BYTES) chunks.push(buffer);
  }
  if (size > MAX_BODY_BYTES) throw new HttpError(413, `Request too large (limit ${MAX_BODY_BYTES / 1024 / 1024} MB). For Figma, select a single frame.`, 'payload_too_large');
  if (!size) return {};
  let data: unknown;
  try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'Request body is not valid JSON'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HttpError(400, 'Request body must be a JSON object');
  return data as Record<string, unknown>;
}

function safeRoot(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Repository path required');
  const resolved = fs.realpathSync(value);
  if (!fs.statSync(resolved).isDirectory()) throw new Error('Not a directory');
  return resolved;
}

/** Constant-time comparison so response timing does not reveal how much of a guessed token was right. */
function tokenMatches(supplied: string | string[] | undefined): boolean {
  if (typeof supplied !== 'string') return false;
  const a = crypto.createHash('sha256').update(supplied).digest();
  const b = crypto.createHash('sha256').update(token).digest();
  return crypto.timingSafeEqual(a, b);
}

/** Returns an error message if the request must be refused, otherwise undefined. */
function rejectReason(req: http.IncomingMessage): string | undefined {
  if (!allowedHosts.has(String(req.headers.host || '').toLowerCase())) return 'Host not allowed';
  const origin = req.headers.origin;
  if (origin !== undefined && !allowedOrigins.has(String(origin).toLowerCase())) return 'Origin not allowed';
  // Browsers can only send a cross-site POST without a CORS preflight when the body is a "simple" type
  // such as text/plain or form data. Requiring JSON forces the preflight, which other origins fail.
  if (req.method === 'POST' && !/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) return 'Content-Type must be application/json';
  return undefined;
}

function modelConfig(): Partial<ModelConfig> {
  return {
    apiKey: process.env.CODEDEFT_API_KEY, model: process.env.CODEDEFT_MODEL, endpoint: process.env.CODEDEFT_ENDPOINT,
    timeoutMs: Number(process.env.CODEDEFT_MODEL_TIMEOUT_MS) || 180_000,
    jsonMode: process.env.CODEDEFT_JSON_MODE !== '0'
  };
}

function repositoryIndexedAt(repo: string): string | undefined {
  const store = new RepositoryStore(database);
  try { return store.stats(repo).indexedAt; } catch { return undefined; } finally { store.close(); }
}
let features: FeatureService;

/** Uses the stored SQLite index when the repository has been indexed; otherwise indexes it in memory. */
function loadIndex(repo: string): RepositoryIndex {
  const store = new RepositoryStore(database);
  try { return store.load(repo); }
  catch (error) { if (error instanceof Error && error.message.startsWith('Repository not indexed')) return indexRepository(repo); throw error; }
  finally { store.close(); }
}

let indexHtmlCache: string | undefined;
function indexHtml(): string | undefined {
  const file = path.join(staticDir, 'index.html');
  if (!indexHtmlCache) { if (!fs.existsSync(file)) return undefined; indexHtmlCache = fs.readFileSync(file, 'utf8'); }
  if (!token) return indexHtmlCache;
  // Hand the token to the same-origin dashboard. Other sites cannot read this page: the Host check
  // blocks DNS rebinding and there are no CORS headers.
  const escaped = token.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
  return indexHtmlCache.replace('</head>', `<meta name="codedeft-token" content="${escaped}"></head>`);
}

async function handleFeatures(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
  const { method } = req; const route = url.pathname;
  if (route === '/api/features') {
    if (method === 'GET') {
      const repo = safeRoot(url.searchParams.get('repository'));
      json(res, 200, { features: featureStore.list(repo, { q: url.searchParams.get('q') ?? undefined, archived: url.searchParams.get('archived') === '1' }) }); return true;
    }
    if (method === 'POST') { const input = await body(req); const repo = safeRoot(input.repository); json(res, 200, features.detail(featureStore.create(repo, typeof input.name === 'string' ? input.name : undefined).id)); return true; }
  }
  const m = route.match(/^\/api\/features\/([^/]+)(?:\/(messages|design|reuse|generate|refresh))?$/);
  if (!m) return false;
  const id = decodeURIComponent(m[1]!);
  if (!FEATURE_ID.test(id) || !featureStore.get(id)) throw new HttpError(404, 'Feature not found', 'not_found');
  const action = m[2];
  if (method === 'GET' && !action) { json(res, 200, features.detail(id)); return true; }
  if (method !== 'POST') return false;
  const input = await body(req);
  if (!action) {
    const patch: Parameters<FeatureStore['update']>[1] = {};
    if (typeof input.name === 'string' && input.name.trim()) patch.name = input.name.trim();
    if (input.status === 'done' || input.status === 'exploring') patch.status = input.status;
    if (typeof input.archived === 'boolean') patch.archived = input.archived;
    featureStore.update(id, patch); json(res, 200, features.detail(id)); return true;
  }
  if (action === 'messages') { json(res, 200, await features.send(id, String(input.text ?? ''))); return true; }
  if (action === 'design') {
    if (typeof input.url !== 'string' || !input.url.trim()) throw new HttpError(400, 'Figma URL required');
    if (typeof input.token !== 'string' || !input.token.trim()) throw new HttpError(400, 'Figma personal access token required');
    json(res, 200, await features.readDesign(id, input.url.trim(), input.token)); return true;
  }
  if (action === 'reuse') { json(res, 200, features.setReuse(id, (input.choices && typeof input.choices === 'object' ? input.choices : {}) as Record<string, 'reuse' | 'reference' | 'ignore'>)); return true; }
  if (action === 'generate') { features.generate(id, typeof input.instructions === 'string' ? input.instructions.slice(0, 4000) : undefined); json(res, 200, features.detail(id)); return true; }
  if (action === 'refresh') { json(res, 200, features.refresh(id)); return true; }
  return false;
}

async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
  const { method } = req; const route = url.pathname;
  if (route.startsWith('/api/features') && await handleFeatures(req, res, url)) return;
  if (method === 'GET' && route === '/api/health') return json(res, 200, { ok: true, version, api: { version: API_VERSION, minClient: MIN_CLIENT_API }, capabilities: ALL_CAPABILITIES });

  // Server-side Figma read for the web dashboard. The token is used for this one upstream request only:
  // it is not stored, logged or included in any response or error message.
  if (method === 'POST' && route === '/api/figma/read') {
    const input = await body(req);
    if (typeof input.url !== 'string' || !input.url.trim()) throw new HttpError(400, 'Figma URL required');
    if (typeof input.token !== 'string' || !input.token.trim()) throw new HttpError(400, 'Figma personal access token required');
    const design = await readFigma(input.url.trim(), input.token, { apiBase: figmaBase });
    const stored = designs.put(design);
    return json(res, 200, { designId: stored.id, expiresAt: stored.expiresAt, summary: designSummary(design), warnings: design.warnings });
  }
  const designMatch = route.match(/^\/api\/figma\/designs\/([^/]+)$/);
  if (method === 'GET' && designMatch) {
    const design = designs.get(decodeURIComponent(designMatch[1]!));
    if (!design) throw new HttpError(404, 'Design not found or expired (designs are kept in server memory for a limited time and cleared on restart). Read it again.', 'not_found');
    return json(res, 200, design);
  }
  const proposalMatch = route.match(/^\/api\/proposals\/([^/]+)$/);
  if (method === 'GET' && proposalMatch) {
    const stored = proposals.get(decodeURIComponent(proposalMatch[1]!));
    if (!stored) throw new HttpError(404, 'Proposal not found or expired (proposals are kept in server memory and cleared on restart). Generate it again.', 'not_found');
    return json(res, 200, stored);
  }

  if (method === 'POST' && ['/api/figma/plan', '/api/figma/generate', '/api/figma/validate'].includes(route)) {
    const input = await body(req); const repo = safeRoot(input.repository);
    if (input.decision !== undefined && input.decision !== 'independent') throw new Error('Only independent mode is implemented');
    if (route === '/api/figma/validate') return json(res, 200, validateGenerated(repo, input.proposal, { install: input.install === true }));
    // Designs arrive either by reference (dashboard, API 2) or inline (VS Code extension, older clients).
    let design: unknown = input.design;
    if (typeof input.designId === 'string') {
      design = designs.get(input.designId);
      if (!design) throw new HttpError(404, 'Design not found or expired. Read the Figma design again.', 'not_found');
    }
    if (design === undefined) throw new HttpError(400, 'Provide designId or design');
    const index = loadIndex(repo);
    if (route === '/api/figma/plan') {
      const { plan, summary } = planFromDesign(repo, design, { index });
      return json(res, 200, { design: summary, repositoryEvidence: plan.relevantFiles.map(f => ({ path: f.path, score: f.score, reasons: f.reasons })), warnings: plan.warnings });
    }
    const result = await proposeDesign(repo, design, modelConfig(), { index });
    const stored = proposals.put({ repository: repo, source: 'figma.generate', task: `Figma design ${result.design.name}`, result: result as unknown as GeneratedProposal });
    return json(res, 200, stored.result);
  }
  if (method === 'POST' && route === '/api/reuse/discover') {
    const input = await body(req); const repo = safeRoot(input.repository);
    return json(res, 200, findReusable(repo, String(input.requirement || '').slice(0, 2000), Number(input.limit) || 10));
  }
  if (method === 'POST' && route === '/api/reuse/decision') {
    const input = await body(req); const repo = safeRoot(input.repository);
    return json(res, 200, buildReuseDecision(repo, { decision: input.decision, requirement: String(input.requirement || ''), sourceFile: input.sourceFile, targetFile: input.targetFile }));
  }
  if (method === 'POST' && route === '/api/reuse/independent/generate') {
    const input = await body(req); const repo = safeRoot(input.repository);
    const task = String(input.task || '').trim().slice(0, 4000);
    if (!task) throw new Error('Task is required');
    const config = modelConfig();
    if (!config.apiKey || !config.model || !config.endpoint) throw new Error('Configure CODEDEFT_API_KEY, CODEDEFT_MODEL, CODEDEFT_ENDPOINT');
    const index = loadIndex(repo);
    const plan = createAgentPlan(index, task, { maxFiles: 8, maxCharsPerFile: 3500 });
    plan.systemPrompt += '\n' + independentInstruction() + '\nReturn JSON only: {"changes":[{"path":"...","content":"..."}],"rationale":"..."}. No markdown fences.';
    const { proposal, verification } = await generateVerified(plan, index, config as ModelConfig);
    assertIndependentProposal(repo, proposal);
    const result = { decision: 'independent' as const, approvalRequired: true as const, proposal, preview: previewIndependentProposal(repo, proposal), verification, repositoryEvidence: plan.relevantFiles.map(f => ({ path: f.path, score: f.score, reasons: f.reasons })), warning: 'Proposal only; no files were applied.' };
    return json(res, 200, proposals.put({ repository: repo, source: 'reuse.generate', task, result }).result);
  }

  const store = new RepositoryStore(database);
  try {
    if (method === 'POST' && route === '/api/index') {
      const input = await body(req); return json(res, 200, store.index(safeRoot(input.repository)));
    }
    if (method === 'GET' && route === '/api/info') {
      const repo = safeRoot(url.searchParams.get('repository')); return json(res, 200, { stats: store.stats(repo), profile: store.profile(repo) });
    }
    if (method === 'POST' && route === '/api/search') {
      const input = await body(req); const repo = safeRoot(input.repository); const query = String(input.query || '').slice(0, 1000);
      if (!query.trim()) throw new Error('Question required');
      const hits = queryRepository(store.load(repo), query, Math.min(30, Math.max(1, Number(input.limit) || 10)));
      return json(res, 200, { repository: repo, query, hits });
    }
    if (method === 'GET' && route === '/api/graph') {
      const repo = safeRoot(url.searchParams.get('repository')); const index = store.load(repo);
      const filter = String(url.searchParams.get('filter') || '').toLowerCase();
      const edges = index.edges.filter(e => !filter || e.from.toLowerCase().includes(filter) || e.to.toLowerCase().includes(filter)).slice(0, 200);
      return json(res, 200, { repository: repo, edges, limited: index.edges.length > 200 });
    }
  } finally { store.close(); }
  // Exact text kept for API-1 clients, which recognise unsupported endpoints by it.
  return json(res, 404, { error: 'Unknown API endpoint', code: 'unsupported_endpoint' });
}

/** Icon files the dashboard build copies from public/ (an allowlist, not a directory listing). */
const STATIC_ICONS: Record<string, string> = { 'favicon.svg': 'image/svg+xml', 'favicon-32.png': 'image/png', 'apple-touch-icon.png': 'image/png' };

function handleStatic(req: http.IncomingMessage, res: http.ServerResponse, url: URL): void {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
  if (url.pathname === '/favicon.ico') { res.writeHead(204, securityHeaders); res.end(); return; }
  const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const icon = STATIC_ICONS[name];
  if (icon) {
    const file = path.join(staticDir, name);
    if (!fs.existsSync(file)) return json(res, 404, { error: 'Not found' });
    // An SVG gets its own locked-down policy so it can never run script when opened directly.
    res.writeHead(200, { ...securityHeaders, 'content-type': icon, 'cache-control': 'public, max-age=86400', ...(icon.startsWith('image/svg') ? { 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" } : {}) });
    res.end(fs.readFileSync(file)); return;
  }
  if (name !== 'index.html' && !/^assets\/[a-zA-Z0-9_.-]+\.(js|css)$/.test(name)) return json(res, 404, { error: 'Not found' });
  const type = name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html';
  const headers: Record<string, string> = { ...securityHeaders, 'content-type': type + '; charset=utf-8', 'cache-control': 'no-store' };
  if (name === 'index.html') {
    const html = indexHtml();
    if (!html) { res.writeHead(503, { ...securityHeaders, 'content-type': 'text/plain; charset=utf-8' }); res.end('codeDeft dashboard is not built. Run: npm run build:dashboard (the API under /api/ works without it).'); return; }
    headers['content-security-policy'] = "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'";
    res.writeHead(200, headers); res.end(html); return;
  }
  const file = path.join(staticDir, name);
  if (!fs.existsSync(file)) return json(res, 404, { error: 'Not found' });
  res.writeHead(200, headers);
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const refused = rejectReason(req);
    if (refused) return json(res, 403, { error: refused, code: 'forbidden' });
    const url = new URL(req.url || '/', `http://${host}:${port}`);
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...securityHeaders, 'access-control-allow-origin': `http://127.0.0.1:${port}`, 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type, x-codedeft-token, x-codedeft-client' });
      return void res.end();
    }
    if (url.pathname.startsWith('/api/')) {
      if (token && !tokenMatches(req.headers['x-codedeft-token'])) return json(res, 401, { error: 'Invalid local API token', code: 'unauthorized' });
      try { return await handleApi(req, res, url); }
      catch (error) { const e = errorResponse(error); return json(res, e.status, { error: e.message, code: e.code }); }
    }
    return handleStatic(req, res, url);
  } catch (error) {
    // Last-resort guard: an unexpected error must answer this request, not crash the server.
    console.error(error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ""}` : "Non-error thrown"); // message + stack only; request data is never logged
    if (!res.headersSent) json(res, 500, { error: 'Internal server error', code: 'internal' }); else res.destroy();
  }
});

features = new FeatureService({ store: featureStore, designs, proposals, loadIndex, indexedAt: repositoryIndexedAt, modelConfig, figmaBase });
if (interrupted) console.warn(`codeDeft: ${interrupted} generation job(s) were interrupted by the last shutdown and marked as failed.`);
server.listen(port, host, () => console.log(`codeDeft dashboard: http://${host}:${port} (v${version})`));
