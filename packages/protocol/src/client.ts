import { API_VERSION, negotiate, parseHealth, missingCapabilityMessage, type Compatibility } from './compat.js';
import type { Capability, ErrorBody, Stats, SearchHit, Edge, ReuseUnit, ReuseDecision, GeneratedProposal, StoredProposal, FigmaReadResponse, Proposal, FeatureSummary, FeatureDetail, FeatureStatus, ReuseChoice } from './types.js';

export type ClientErrorCode = NonNullable<ErrorBody['code']> | 'network' | 'bad_response' | 'incompatible' | 'unsupported' | 'aborted';

/** The only error type the client throws, so callers can always show `message` and branch on `code`. */
export class ApiError extends Error {
  constructor(readonly code: ClientErrorCode, message: string, readonly status = 0, readonly endpoint = '') { super(message); this.name = 'ApiError'; }
}

export type ClientOptions = {
  /** e.g. http://127.0.0.1:4317 — omit in the dashboard to use the page origin. */
  baseUrl?: string;
  token?: string | (() => string | undefined);
  /** Identifies the caller in the x-codedeft-client header, e.g. "vscode-extension/0.10.0". */
  client: string;
  fetch?: typeof fetch;
  /** Default timeout for ordinary requests (ms). Long operations pass their own. */
  timeoutMs?: number;
};
export type CallOptions = { signal?: AbortSignal; timeoutMs?: number };

const statusCodes: Record<number, ClientErrorCode> = { 400: 'bad_request', 401: 'unauthorized', 403: 'forbidden', 404: 'not_found', 410: 'expired', 413: 'payload_too_large', 502: 'upstream_error', 504: 'timeout' };

export function createApiClient(options: ClientOptions) {
  const fetchImpl = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const defaultTimeout = options.timeoutMs ?? 30_000;
  let compatPromise: Promise<Compatibility> | undefined;

  const url = (path: string) => options.baseUrl ? new URL(path, options.baseUrl).toString() : path;
  const tokenValue = () => typeof options.token === 'function' ? options.token() : options.token;

  /** One HTTP request with timeout, cancellation and defensive parsing. Never throws anything but ApiError. */
  async function raw<T = unknown>(method: 'GET' | 'POST', path: string, body?: unknown, call: CallOptions = {}): Promise<T> {
    const controller = new AbortController();
    const timeoutMs = call.timeoutMs ?? defaultTimeout;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    const onAbort = () => controller.abort();
    if (call.signal?.aborted) controller.abort(); else call.signal?.addEventListener('abort', onAbort, { once: true });
    const token = tokenValue();
    try {
      let response: Response;
      try {
        response = await fetchImpl(url(path), {
          method, signal: controller.signal,
          headers: { 'content-type': 'application/json', 'x-codedeft-client': `${options.client}; api=${API_VERSION}`, ...(token ? { 'x-codedeft-token': token } : {}) },
          body: body === undefined ? undefined : JSON.stringify(body)
        });
      } catch (error) {
        if (timedOut) throw new ApiError('timeout', `codeDeft did not respond within ${Math.round(timeoutMs / 1000)} s`, 0, path);
        if (call.signal?.aborted) throw new ApiError('aborted', 'Request cancelled', 0, path);
        throw new ApiError('network', `Cannot reach the codeDeft server${options.baseUrl ? ` at ${options.baseUrl}` : ''}. Is it running?`, 0, path);
      }
      let text = '';
      try { text = await response.text(); }
      catch { throw new ApiError(timedOut ? 'timeout' : call.signal?.aborted ? 'aborted' : 'network', 'The response was interrupted', response.status, path); }
      let data: unknown;
      try { data = text ? JSON.parse(text) : {}; } catch { data = undefined; }
      if (!response.ok) {
        const errorBody = (data && typeof data === 'object' ? data : {}) as Partial<ErrorBody>;
        const message = typeof errorBody.error === 'string' ? errorBody.error : `HTTP ${response.status}`;
        // API-1 servers have no codes; their unknown-route answer is a 404 with this exact text.
        const code: ClientErrorCode = errorBody.code ?? (response.status === 404 && message === 'Unknown API endpoint' ? 'unsupported_endpoint' : statusCodes[response.status] ?? (response.status >= 500 ? 'internal' : 'bad_request'));
        throw new ApiError(code, message, response.status, path);
      }
      if (data === undefined || data === null || typeof data !== 'object') throw new ApiError('bad_response', 'The codeDeft server sent a response this client cannot read', response.status, path);
      return data as T;
    } finally {
      clearTimeout(timer);
      call.signal?.removeEventListener('abort', onAbort);
    }
  }

  /** Version/capability negotiation, cached. A failed probe is not cached, so a server started later is picked up. */
  function compat(force = false): Promise<Compatibility> {
    if (!compatPromise || force) {
      const attempt = raw('GET', '/api/health', undefined, { timeoutMs: 5000 }).then(parseHealth, () => undefined).then(h => negotiate(h));
      compatPromise = attempt;
      attempt.then(c => { if (c.serverApi === 0 && compatPromise === attempt) compatPromise = undefined; });
    }
    return compatPromise;
  }

  /** Calls an endpoint only if the server advertises the capability; otherwise fails with a clear message. */
  async function call<T>(capability: Capability, method: 'GET' | 'POST', path: string, body?: unknown, opts?: CallOptions): Promise<T> {
    const c = await compat();
    if (!c.compatible) throw new ApiError('incompatible', c.message ?? 'Incompatible codeDeft server', 0, path);
    if (!c.capabilities.has(capability)) throw new ApiError('unsupported', missingCapabilityMessage(c, capability), 0, path);
    try { return await raw<T>(method, path, body, opts); }
    catch (error) {
      // The server was replaced by an older one since negotiation: renegotiate next time and explain.
      if (error instanceof ApiError && error.code === 'unsupported_endpoint') { compatPromise = undefined; throw new ApiError('unsupported', missingCapabilityMessage(c, capability), error.status, path); }
      throw error;
    }
  }

  return { raw, compat, call, invalidate: () => { compatPromise = undefined; } };
}
export type ApiClient = ReturnType<typeof createApiClient>;

// ---- Response normalisers: tolerate missing or malformed fields from other server versions. ----
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, d = '') => typeof v === 'string' ? v : d;
const num = (v: unknown, d = 0) => typeof v === 'number' && Number.isFinite(v) ? v : d;
const strs = (v: unknown) => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
const list = <T>(v: unknown, map: (x: Record<string, unknown>) => T | undefined): T[] => Array.isArray(v) ? v.flatMap(x => { const r = isObj(x) ? map(x) : undefined; return r === undefined ? [] : [r]; }) : [];

export const normalize = {
  stats: (v: unknown): Stats | undefined => isObj(v) ? { files: num(v.files), symbols: num(v.symbols), dependencies: num(v.dependencies), conventions: num(v.conventions), indexedAt: typeof v.indexedAt === 'string' ? v.indexedAt : undefined } : undefined,
  hits: (v: unknown): SearchHit[] => list(v, h => typeof h.file === 'string' ? { file: h.file, score: num(h.score), reasons: strs(h.reasons), excerpt: typeof h.excerpt === 'string' ? h.excerpt : undefined, symbols: list(h.symbols, s => ({ name: str(s.name), line: num(s.line, 1) })) } : undefined),
  edges: (v: unknown): Edge[] => list(v, e => typeof e.from === 'string' && typeof e.to === 'string' ? { from: e.from, to: e.to } : undefined),
  units: (v: unknown): ReuseUnit[] => list(v, u => typeof u.file === 'string' && typeof u.name === 'string' ? {
    id: str(u.id, `${u.file}:${num(u.startLine, 1)}:${u.name}`), file: u.file, name: u.name, kind: str(u.kind, 'code'),
    startLine: num(u.startLine, 1), endLine: num(u.endLine, num(u.startLine, 1)), excerpt: str(u.excerpt), imports: strs(u.imports), usedBy: strs(u.usedBy),
    exported: typeof u.exported === 'boolean' ? u.exported : undefined, score: num(u.score), reasons: strs(u.reasons),
    effort: isObj(u.effort) && ['low', 'medium', 'high'].includes(str(u.effort.level)) ? { level: u.effort.level as 'low' | 'medium' | 'high', reasons: strs(u.effort.reasons) } : { level: 'medium', reasons: [] }
  } : undefined),
  proposal: (v: unknown): Proposal | undefined => {
    if (!isObj(v)) return undefined;
    const changes = list(v.changes, c => typeof c.path === 'string' && typeof c.content === 'string' ? { path: c.path, content: c.content } : undefined);
    return changes.length ? { changes, rationale: str(v.rationale) } : undefined;
  },
  featureSummary: (v: unknown): FeatureSummary | undefined => {
    if (!isObj(v) || typeof v.id !== 'string') return undefined;
    const statuses: FeatureStatus[] = ['exploring', 'deciding', 'generating', 'proposal_ready', 'done', 'failed'];
    return { id: v.id, repository: str(v.repository), name: str(v.name, 'Untitled feature'), status: statuses.includes(v.status as FeatureStatus) ? v.status as FeatureStatus : 'exploring', archived: v.archived === true, createdAt: str(v.createdAt), updatedAt: str(v.updatedAt), lastMessage: typeof v.lastMessage === 'string' ? v.lastMessage : undefined };
  },
  featureList: (v: unknown): FeatureSummary[] => list(v, x => normalize.featureSummary(x)),
  featureDetail: (v: unknown): FeatureDetail => {
    const f = isObj(v) && isObj(v.feature) ? v.feature : undefined;
    const summary = normalize.featureSummary(f);
    if (!f || !summary) throw new ApiError('bad_response', 'The server returned an invalid feature');
    const kinds = ['text', 'search', 'reuse', 'design', 'design_request', 'graph', 'generating', 'proposal', 'error'];
    const messages = list((v as Record<string, unknown>).messages, m => typeof m.id === 'string' ? {
      id: m.id, featureId: str(m.featureId, summary.id), role: m.role === 'user' ? 'user' as const : 'assistant' as const,
      kind: (kinds.includes(str(m.kind)) ? m.kind : 'text') as FeatureDetail['messages'][number]['kind'], text: str(m.text),
      payload: isObj(m.payload) ? m.payload : undefined, createdAt: str(m.createdAt), updatedAt: str(m.updatedAt)
    } : undefined);
    return { feature: { ...summary, requirement: str(f.requirement), context: isObj(f.context) ? f.context as FeatureDetail['feature']['context'] : {}, stale: f.stale === true }, messages };
  },
  generated: (v: unknown): GeneratedProposal => {
    const proposal = isObj(v) ? normalize.proposal(v.proposal) : undefined;
    if (!isObj(v) || v.decision !== 'independent' || v.approvalRequired !== true || !proposal) throw new ApiError('bad_response', 'The server returned an invalid proposal');
    return { ...v, decision: 'independent', approvalRequired: true, proposal, proposalId: typeof v.proposalId === 'string' ? v.proposalId : undefined };
  }
};

/** Typed endpoint helpers shared by the dashboard and the extension. */
export function endpoints(client: ApiClient) {
  const GENERATE_TIMEOUT = 300_000;
  const repoQuery = (repo: string) => encodeURIComponent(repo);
  return {
    index: (repository: string, o?: CallOptions) => client.call<unknown>('index', 'POST', '/api/index', { repository }, { timeoutMs: 300_000, ...o }).then(normalize.stats),
    info: (repository: string, o?: CallOptions) => client.call<{ stats?: unknown; profile?: unknown }>('info', 'GET', `/api/info?repository=${repoQuery(repository)}`, undefined, o).then(d => ({ stats: normalize.stats(d.stats), profile: d.profile })),
    search: (repository: string, query: string, limit = 10, o?: CallOptions) => client.call<{ hits?: unknown }>('search', 'POST', '/api/search', { repository, query, limit }, o).then(d => normalize.hits(d.hits)),
    graph: (repository: string, filter: string, o?: CallOptions) => client.call<{ edges?: unknown; limited?: unknown }>('graph', 'GET', `/api/graph?repository=${repoQuery(repository)}&filter=${encodeURIComponent(filter)}`, undefined, o).then(d => ({ edges: normalize.edges(d.edges), limited: d.limited === true })),
    discover: (repository: string, requirement: string, limit = 15, o?: CallOptions) => client.call<{ results?: unknown; scannedUnits?: unknown; disclaimer?: unknown }>('reuse.discover', 'POST', '/api/reuse/discover', { repository, requirement, limit }, { timeoutMs: 120_000, ...o }).then(d => ({ results: normalize.units(d.results), scannedUnits: num(d.scannedUnits), disclaimer: str(d.disclaimer) })),
    decision: (body: { repository: string; requirement: string; decision: ReuseDecision; sourceFile?: string; targetFile?: string }, o?: CallOptions) => client.call<Record<string, unknown>>('reuse.decision', 'POST', '/api/reuse/decision', body, o),
    generateIndependent: (repository: string, task: string, o?: CallOptions) => client.call<unknown>('reuse.generate', 'POST', '/api/reuse/independent/generate', { repository, task, decision: 'independent' }, { timeoutMs: GENERATE_TIMEOUT, ...o }).then(normalize.generated),
    figmaRead: (url: string, token: string, o?: CallOptions) => client.call<FigmaReadResponse>('figma.read', 'POST', '/api/figma/read', { url, token }, { timeoutMs: 60_000, ...o }),
    figmaDesign: (designId: string, o?: CallOptions) => client.call<Record<string, unknown>>('figma.designs', 'GET', `/api/figma/designs/${encodeURIComponent(designId)}`, undefined, o),
    figmaPlan: (body: { repository: string; designId?: string; design?: unknown }, o?: CallOptions) => client.call<Record<string, unknown>>('figma.plan', 'POST', '/api/figma/plan', { ...body, decision: 'independent' }, { timeoutMs: 120_000, ...o }),
    figmaGenerate: (body: { repository: string; designId?: string; design?: unknown }, o?: CallOptions) => client.call<unknown>('figma.generate', 'POST', '/api/figma/generate', { ...body, decision: 'independent' }, { timeoutMs: GENERATE_TIMEOUT, ...o }).then(normalize.generated),
    figmaValidate: (body: { repository: string; proposal: Proposal; install: boolean }, o?: CallOptions) => client.call<Record<string, unknown>>('figma.validate', 'POST', '/api/figma/validate', body, { timeoutMs: 900_000, ...o }),
    proposal: (id: string, o?: CallOptions) => client.call<StoredProposal>('proposals', 'GET', `/api/proposals/${encodeURIComponent(id)}`, undefined, o).then(p => ({ ...p, result: normalize.generated(p.result) })),
    features: {
      list: (repository: string, opts: { q?: string; archived?: boolean } = {}, o?: CallOptions) => client.call<{ features?: unknown }>('features', 'GET', `/api/features?repository=${repoQuery(repository)}${opts.q ? `&q=${encodeURIComponent(opts.q)}` : ''}${opts.archived ? '&archived=1' : ''}`, undefined, o).then(d => normalize.featureList(d.features)),
      create: (repository: string, name?: string, o?: CallOptions) => client.call<unknown>('features', 'POST', '/api/features', { repository, name }, o).then(normalize.featureDetail),
      get: (id: string, o?: CallOptions) => client.call<unknown>('features', 'GET', `/api/features/${encodeURIComponent(id)}`, undefined, o).then(normalize.featureDetail),
      update: (id: string, patch: { name?: string; status?: Extract<FeatureStatus, 'done' | 'exploring'>; archived?: boolean }, o?: CallOptions) => client.call<unknown>('features', 'POST', `/api/features/${encodeURIComponent(id)}`, patch, o).then(normalize.featureDetail),
      send: (id: string, text: string, o?: CallOptions) => client.call<unknown>('features', 'POST', `/api/features/${encodeURIComponent(id)}/messages`, { text }, { timeoutMs: 120_000, ...o }).then(normalize.featureDetail),
      readDesign: (id: string, url: string, token: string, o?: CallOptions) => client.call<unknown>('features', 'POST', `/api/features/${encodeURIComponent(id)}/design`, { url, token }, { timeoutMs: 120_000, ...o }).then(normalize.featureDetail),
      setReuse: (id: string, choices: Record<string, ReuseChoice>, o?: CallOptions) => client.call<unknown>('features', 'POST', `/api/features/${encodeURIComponent(id)}/reuse`, { choices }, o).then(normalize.featureDetail),
      generate: (id: string, instructions?: string, o?: CallOptions) => client.call<unknown>('features', 'POST', `/api/features/${encodeURIComponent(id)}/generate`, { instructions }, o).then(normalize.featureDetail),
      refresh: (id: string, o?: CallOptions) => client.call<unknown>('features', 'POST', `/api/features/${encodeURIComponent(id)}/refresh`, {}, { timeoutMs: 120_000, ...o }).then(normalize.featureDetail)
    }
  };
}
export type Endpoints = ReturnType<typeof endpoints>;
