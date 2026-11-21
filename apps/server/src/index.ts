// codeDeft local API and dashboard host. Binds to 127.0.0.1 only.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { RepositoryStore } from '../../../packages/engine/dist/storage.js';
import { queryRepository, indexRepository, createAgentPlan, type RepositoryIndex } from '../../../packages/engine/dist/index.js';
import { generateWithModel, type ModelConfig } from '../../../packages/engine/dist/agent.js';
import { findReusable, buildReuseDecision } from './reuse-intelligence.js';
import { independentInstruction, assertIndependentProposal, previewIndependentProposal } from './reuse-decision.js';
import { parseProposal, planFromDesign, proposeDesign, validateGenerated } from './figma-workflow.js';

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

class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }

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
  if (size > MAX_BODY_BYTES) throw new HttpError(413, `Request too large (limit ${MAX_BODY_BYTES / 1024 / 1024} MB). For Figma, select a single frame.`);
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

async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
  const { method } = req; const route = url.pathname;
  if (method === 'GET' && route === '/api/health') return json(res, 200, { ok: true, version });

  if (method === 'POST' && ['/api/figma/plan', '/api/figma/generate', '/api/figma/validate'].includes(route)) {
    const input = await body(req); const repo = safeRoot(input.repository);
    if (input.decision !== undefined && input.decision !== 'independent') throw new Error('Only independent mode is implemented');
    if (route === '/api/figma/validate') return json(res, 200, validateGenerated(repo, input.proposal, { install: input.install === true }));
    const index = loadIndex(repo);
    if (route === '/api/figma/plan') {
      const { plan, summary } = planFromDesign(repo, input.design, { index });
      return json(res, 200, { design: summary, repositoryEvidence: plan.relevantFiles.map(f => ({ path: f.path, score: f.score, reasons: f.reasons })), warnings: plan.warnings });
    }
    return json(res, 200, await proposeDesign(repo, input.design, modelConfig(), { index }));
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
    const plan = createAgentPlan(loadIndex(repo), task, { maxFiles: 8, maxCharsPerFile: 3500 });
    plan.systemPrompt += '\n' + independentInstruction() + '\nReturn JSON only: {"changes":[{"path":"...","content":"..."}],"rationale":"..."}. No markdown fences.';
    const response = await generateWithModel(plan, config as ModelConfig);
    const proposal = parseProposal(response.content);
    assertIndependentProposal(repo, proposal);
    return json(res, 200, { decision: 'independent', approvalRequired: true, proposal, preview: previewIndependentProposal(repo, proposal), repositoryEvidence: plan.relevantFiles.map(f => ({ path: f.path, score: f.score, reasons: f.reasons })), warning: 'Proposal only; no files were applied.' });
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
  return json(res, 404, { error: 'Unknown API endpoint' });
}

function handleStatic(req: http.IncomingMessage, res: http.ServerResponse, url: URL): void {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
  const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
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
    if (refused) return json(res, 403, { error: refused });
    const url = new URL(req.url || '/', `http://${host}:${port}`);
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...securityHeaders, 'access-control-allow-origin': `http://127.0.0.1:${port}`, 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type, x-codedeft-token' });
      return void res.end();
    }
    if (url.pathname.startsWith('/api/')) {
      if (token && !tokenMatches(req.headers['x-codedeft-token'])) return json(res, 401, { error: 'Invalid local API token' });
      try { return await handleApi(req, res, url); }
      catch (error) { return json(res, error instanceof HttpError ? error.status : 400, { error: error instanceof Error ? error.message : String(error) }); }
    }
    return handleStatic(req, res, url);
  } catch (error) {
    // Last-resort guard: an unexpected error must answer this request, not crash the server.
    console.error(error);
    if (!res.headersSent) json(res, 500, { error: 'Internal server error' }); else res.destroy();
  }
});

server.listen(port, host, () => console.log(`codeDeft dashboard: http://${host}:${port} (v${version})`));
