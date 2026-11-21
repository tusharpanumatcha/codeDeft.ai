import crypto from 'node:crypto';
import { LruCache } from './lru.js';
import type { StoredProposal, GeneratedProposal } from '../../../packages/protocol/dist/index.js';
import type { DesignDocument } from '../../../packages/figma-reader/dist/index.js';

const MB = 1024 * 1024;
const envNumber = (name: string, fallback: number) => { const n = Number(process.env[name]); return Number.isFinite(n) && n > 0 ? n : fallback; };

/** Ids are opaque to clients; validating the shape keeps arbitrary strings out of lookups and logs. */
export const DESIGN_ID = /^d_[a-f0-9]{32}$/;
export const PROPOSAL_ID = /^p_[a-f0-9-]{36}$/;

/**
 * Normalised Figma designs, kept on the server so the dashboard sends a short `designId` instead of
 * round-tripping multi-megabyte JSON. Content-addressed: reading the same frame twice reuses one entry.
 */
export class DesignStore {
  private readonly cache: LruCache<DesignDocument>;
  constructor(readonly ttlMs = envNumber('CODEDEFT_DESIGN_TTL_MS', 2 * 3600_000)) {
    this.cache = new LruCache({ maxEntries: 64, maxBytes: envNumber('CODEDEFT_DESIGN_CACHE_MB', 96) * MB, ttlMs });
  }
  put(design: DesignDocument): { id: string; expiresAt: string } {
    const { fetchedAt: _ignored, ...stable } = design;
    const json = JSON.stringify(stable);
    const id = 'd_' + crypto.createHash('sha256').update(json).digest('hex').slice(0, 32);
    if (!this.cache.set(id, design, Buffer.byteLength(json))) throw new Error('Design is larger than the server design cache; select a single frame');
    return { id, expiresAt: new Date(this.cache.expiresAt(id)!).toISOString() };
  }
  get(id: string): DesignDocument | undefined { return DESIGN_ID.test(id) ? this.cache.get(id) : undefined; }
}

/** Generated proposals, fetched by id for the dashboard → VS Code handoff. Random ids, never guessable. */
export class ProposalStore {
  private readonly cache: LruCache<StoredProposal>;
  constructor(readonly ttlMs = envNumber('CODEDEFT_PROPOSAL_TTL_MS', 24 * 3600_000)) {
    this.cache = new LruCache({ maxEntries: 500, maxBytes: envNumber('CODEDEFT_PROPOSAL_CACHE_MB', 64) * MB, ttlMs });
  }
  put(input: { repository: string; source: StoredProposal['source']; task: string; result: GeneratedProposal }): StoredProposal {
    const id = 'p_' + crypto.randomUUID();
    const now = Date.now();
    const stored: StoredProposal = { id, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + this.ttlMs).toISOString(), repository: input.repository, source: input.source, task: input.task.slice(0, 4000), result: { ...input.result, proposalId: id } };
    if (!this.cache.set(id, stored, Buffer.byteLength(JSON.stringify(stored)))) throw new Error('Proposal too large to store');
    return stored;
  }
  get(id: string): StoredProposal | undefined {
    if (!PROPOSAL_ID.test(id)) return undefined;
    const stored = this.cache.get(id);
    return stored && { ...stored, expiresAt: new Date(this.cache.expiresAt(id)!).toISOString() };
  }
}
