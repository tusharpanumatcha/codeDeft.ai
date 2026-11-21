// @ts-nocheck
// TypeScript migration of v0.7 local API; TODO: add strict request/response types.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RepositoryStore } from '../../../packages/engine/dist/storage.js';
import { queryRepository } from '../../../packages/engine/dist/index.js';
import { planFromDesign, proposeDesign, validateGenerated } from './figma-workflow.js';

const here = path.resolve(process.cwd(), 'apps/server');
const root = path.resolve(here, '../..');
const dashboardRoot = path.join(root, 'apps/web-dashboard');
const builtDashboard = path.join(dashboardRoot, 'dist');
const staticDir = fs.existsSync(path.join(builtDashboard, 'index.html')) ? builtDashboard : dashboardRoot;
const database = process.env.CODEDEFT_DB || path.join(root, 'data/codedeft.db');
const port = Number(process.env.CODEDEFT_PORT || 4317);
const host = '127.0.0.1';
const token = process.env.CODEDEFT_TOKEN || '';
const MAX_BODY = 4 * 1024 * 1024;

// Only these Host/Origin values are accepted. Checking Host blocks DNS-rebinding attacks, where a
// website points its own domain at 127.0.0.1 so the browser treats this server as same-origin.
const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
const allowedOrigins = new Set([...allowedHosts].map(h => `http://${h}`));

const securityHeaders = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin'
};
const json = (res, status, obj) => {
  res.writeHead(status, { ...securityHeaders, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
};
const body = async (req) => {
  let data = '';
  for await (const chunk of req) { data += chunk; if (data.length > MAX_BODY) throw new Error('Request too large'); }
  return data ? JSON.parse(data) : {};
};
function safeRoot(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Repository path required');
  const resolved = fs.realpathSync(value);
  if (!fs.statSync(resolved).isDirectory()) throw new Error('Not a directory');
  return resolved;
}
/** Returns an error message if the request must be refused, otherwise undefined. */
function rejectReason(req) {
  if (!allowedHosts.has(String(req.headers.host || '').toLowerCase())) return 'Host not allowed';
  const origin = req.headers.origin;
  if (origin !== undefined && !allowedOrigins.has(String(origin).toLowerCase())) return 'Origin not allowed';
  // Browsers can only send a cross-site POST without a CORS preflight when the body is a "simple" type
  // such as text/plain or form data. Requiring JSON forces the preflight, which other origins fail.
  if (req.method === 'POST' && !/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) return 'Content-Type must be application/json';
  return undefined;
}

let indexHtmlCache;
function indexHtml() {
  // When an API token is configured, hand it to the same-origin dashboard. Other sites cannot read this
  // page: the Host check above blocks DNS rebinding and there are no CORS headers.
  if (!indexHtmlCache) indexHtmlCache = fs.readFileSync(path.join(staticDir, 'index.html'), 'utf8');
  if (!token) return indexHtmlCache;
  const escaped = token.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
  return indexHtmlCache.replace('</head>', `<meta name="codedeft-token" content="${escaped}"></head>`);
}

const server = http.createServer(async (req, res) => {
  const refused = rejectReason(req);
  if (refused) return json(res, 403, { error: refused });
  const url = new URL(req.url || '/', `http://${host}:${port}`);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...securityHeaders, 'access-control-allow-origin': `http://127.0.0.1:${port}`, 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type, x-codedeft-token' });
    return res.end();
  }
  if (url.pathname.startsWith('/api/')) {
    if (token && req.headers['x-codedeft-token'] !== token) return json(res, 401, { error: 'Invalid local API token' });
    try {
      if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true, version: '0.8.0-migration' });
      if(req.method==='POST' && ['/api/figma/plan','/api/figma/generate','/api/figma/validate'].includes(url.pathname)) {
        const input=await body(req);const repo=safeRoot(input.repository);
        if(url.pathname==='/api/figma/validate')return json(res,200,validateGenerated(repo,input.proposal));
        if(url.pathname==='/api/figma/plan'){
          const {plan,summary}=planFromDesign(repo,input.design);
          return json(res,200,{design:summary,repositoryEvidence:plan.relevantFiles.map(f=>({path:f.path,score:f.score,reasons:f.reasons})),warnings:plan.warnings});
        }
        return json(res,200,await proposeDesign(repo,input.design,{apiKey:process.env.CODEDEFT_API_KEY,model:process.env.CODEDEFT_MODEL,endpoint:process.env.CODEDEFT_ENDPOINT}));
      }
      const store = new RepositoryStore(database);
      try {
        if (req.method === 'POST' && url.pathname === '/api/index') {
          const input = await body(req); return json(res, 200, store.index(safeRoot(input.repository)));
        }
        if (req.method === 'GET' && url.pathname === '/api/info') {
          const repo = safeRoot(url.searchParams.get('repository')); return json(res, 200, { stats: store.stats(repo), profile: store.profile(repo) });
        }
        if (req.method === 'POST' && url.pathname === '/api/search') {
          const input = await body(req); const repo = safeRoot(input.repository); const query = String(input.query || '').slice(0, 1000);
          if (!query.trim()) throw new Error('Question required');
          const index = store.load(repo); const hits = queryRepository(index, query, Math.min(30, Math.max(1, Number(input.limit) || 10)));
          return json(res, 200, { repository: repo, query, hits });
        }
        if (req.method === 'GET' && url.pathname === '/api/graph') {
          const repo = safeRoot(url.searchParams.get('repository')); const index = store.load(repo);
          const filter = String(url.searchParams.get('filter') || '').toLowerCase();
          const edges = index.edges.filter(e => !filter || e.from.toLowerCase().includes(filter) || e.to.toLowerCase().includes(filter)).slice(0, 200);
          return json(res, 200, { repository: repo, edges, limited: index.edges.length > 200 });
        }
      } finally { store.close(); }
      return json(res, 404, { error: 'Unknown API endpoint' });
    } catch (error) { return json(res, 400, { error: error instanceof Error ? error.message : String(error) }); }
  }
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
  const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  if (!['index.html', 'app.js', 'style.css'].includes(name) && !/^assets\/[a-zA-Z0-9_.-]+\.(js|css)$/.test(name)) return json(res, 404, { error: 'Not found' });
  const type = name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html';
  const headers = { ...securityHeaders, 'content-type': type + '; charset=utf-8', 'cache-control': 'no-store' };
  if (name === 'index.html') {
    headers['content-security-policy'] = "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'";
    res.writeHead(200, headers); return res.end(indexHtml());
  }
  res.writeHead(200, headers);
  fs.createReadStream(path.join(staticDir, name)).pipe(res);
});

server.listen(port, host, () => console.log(`codeDeft dashboard: http://${host}:${port}`));
