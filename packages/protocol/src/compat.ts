import type { Capability, HealthResponse } from './types.js';

/**
 * API version spoken by this build. Bump only for breaking changes; additive changes are announced
 * through capabilities instead, so old and new clients and servers keep working together.
 *
 *   1 — v0.7–v0.9 servers (no `api` field in /api/health)
 *   2 — capabilities, error codes, server-side design and proposal stores
 */
export const API_VERSION = 2;
/** Oldest client API this build's server still serves. */
export const MIN_CLIENT_API = 1;

export const ALL_CAPABILITIES: readonly Capability[] = [
  'index', 'search', 'graph', 'info',
  'reuse.discover', 'reuse.decision', 'reuse.generate',
  'figma.plan', 'figma.generate', 'figma.validate',
  'figma.read', 'figma.designs', 'proposals'
];

/** What an API-1 server (no capability list) is known to provide. */
export const LEGACY_CAPABILITIES: readonly Capability[] = [
  'index', 'search', 'graph', 'info',
  'reuse.discover', 'reuse.decision', 'reuse.generate',
  'figma.plan', 'figma.generate', 'figma.validate'
];

export const CAPABILITY_LABELS: Record<Capability, string> = {
  index: 'repository indexing', search: 'code search', graph: 'dependency graph', info: 'repository statistics',
  'reuse.discover': 'reuse discovery', 'reuse.decision': 'reuse decision plans', 'reuse.generate': 'independent generation',
  'figma.plan': 'Figma analysis', 'figma.generate': 'Figma generation', 'figma.validate': 'proposal validation',
  'figma.read': 'reading Figma designs through the server', 'figma.designs': 'server-side design storage',
  proposals: 'proposal handoff to VS Code'
};

export type Compatibility = {
  /** False only when the two sides cannot talk at all; the client must then refuse to call the API. */
  compatible: boolean;
  serverVersion: string;
  serverApi: number;
  capabilities: Set<Capability>;
  /** Short, user-facing explanation when not compatible or when features are missing. */
  message?: string;
};

/** Parses /api/health defensively: unknown or malformed fields never throw. */
export function parseHealth(value: unknown): HealthResponse | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  if (v.ok !== true) return undefined;
  const health: HealthResponse = { ok: true, version: typeof v.version === 'string' ? v.version : 'unknown' };
  const api = v.api as Record<string, unknown> | undefined;
  if (api && typeof api === 'object' && Number.isInteger(api.version) && Number.isInteger(api.minClient)) {
    health.api = { version: api.version as number, minClient: api.minClient as number };
  }
  if (Array.isArray(v.capabilities)) health.capabilities = v.capabilities.filter((c): c is Capability => typeof c === 'string') as Capability[];
  return health;
}

/**
 * Decides how a client of API `clientApi` (accepting servers from `clientMinServerApi` up) should treat a server.
 *
 * - Older server, still supported: compatible; capabilities come from its list or the legacy set, so the
 *   client simply hides features the server lacks.
 * - Newer server that still serves this client (its `minClient` ≤ `clientApi`): compatible. New capabilities
 *   the client does not know are ignored.
 * - Otherwise: incompatible, with a message saying which side to update.
 */
export function negotiate(health: HealthResponse | undefined, clientApi = API_VERSION, clientMinServerApi = 1): Compatibility {
  if (!health) return { compatible: false, serverVersion: 'unknown', serverApi: 0, capabilities: new Set(), message: 'The codeDeft server did not answer /api/health. Is it running?' };
  const serverApi = health.api?.version ?? 1;
  const known = new Set<string>(ALL_CAPABILITIES);
  const capabilities = new Set<Capability>((health.capabilities ?? (health.api ? [] : LEGACY_CAPABILITIES)).filter(c => known.has(c)));
  const base = { serverVersion: health.version, serverApi, capabilities };
  if (health.api && health.api.minClient > clientApi) return { ...base, compatible: false, message: `This client is too old for codeDeft server ${health.version} (needs API ${health.api.minClient}+, client speaks ${clientApi}). Update the extension or reload the dashboard.` };
  if (serverApi < clientMinServerApi) return { ...base, compatible: false, message: `codeDeft server ${health.version} is too old (API ${serverApi}). Update and restart the server.` };
  return { ...base, compatible: true };
}

export function missingCapabilityMessage(compat: Compatibility, capability: Capability): string {
  return `codeDeft server ${compat.serverVersion} does not support ${CAPABILITY_LABELS[capability]}. Update and restart the server to use it.`;
}
