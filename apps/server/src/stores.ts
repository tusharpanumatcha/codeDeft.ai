import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { LruCache } from './lru.js';
import type { StoredProposal, GeneratedProposal } from '../../../packages/protocol/dist/index.js';
import type { DesignDocument } from '../../../packages/figma-reader/dist/index.js';

const MB = 1024 * 1024;
const DAY = 24 * 3600_000;
const envNumber = (name: string, fallback: number) => { const n = Number(process.env[name]); return Number.isFinite(n) && n > 0 ? n : fallback; };

/** Ids are opaque to clients; validating the shape keeps arbitrary strings out of lookups and logs. */
export const DESIGN_ID = /^d_[a-f0-9]{32}$/;
export const PROPOSAL_ID = /^p_[a-f0-9-]{36}$/;

/**
 * Normalised Figma designs, referenced by a short `designId` instead of round-tripping multi-megabyte
 * JSON. Content-addressed (same frame → same id). A bounded in-memory LRU sits in front of SQLite, so
 * designs survive server restarts and stay available to the feature chats that use them.
 */
export class DesignStore {
  private readonly cache: LruCache<DesignDocument>;
  readonly retentionMs = envNumber('CODEDEFT_DESIGN_RETENTION_DAYS', 30) * DAY;
  constructor(private readonly db?: DatabaseSync) {
    this.cache = new LruCache({ maxEntries: 64, maxBytes: envNumber('CODEDEFT_DESIGN_CACHE_MB', 96) * MB, ttlMs: envNumber('CODEDEFT_DESIGN_TTL_MS', 2 * 3600_000) });
  }
  private expiry(lastUsed: number) { return new Date(lastUsed + (this.db ? this.retentionMs : envNumber('CODEDEFT_DESIGN_TTL_MS', 2 * 3600_000))).toISOString(); }
  put(design: DesignDocument): { id: string; expiresAt: string } {
    const { fetchedAt: _ignored, ...stable } = design;
    const json = JSON.stringify(stable);
    const id = 'd_' + crypto.createHash('sha256').update(json).digest('hex').slice(0, 32);
    if (!this.cache.set(id, design, Buffer.byteLength(json))) throw new Error('Design is larger than the server design cache; select a single frame');
    const now = new Date().toISOString();
    if (this.db) {
      this.db.prepare('INSERT INTO designs(id, json, created_at, last_used_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET last_used_at = excluded.last_used_at').run(id, JSON.stringify(design), now, now);
      this.db.prepare('DELETE FROM designs WHERE last_used_at < ?').run(new Date(Date.now() - this.retentionMs).toISOString());
    }
    return { id, expiresAt: this.expiry(Date.now()) };
  }
  get(id: string): DesignDocument | undefined {
    if (!DESIGN_ID.test(id)) return undefined;
    const hit = this.cache.get(id);
    if (hit || !this.db) { if (hit) this.touch(id); return hit; }
    const row = this.db.prepare('SELECT json FROM designs WHERE id = ? AND last_used_at >= ?').get(id, new Date(Date.now() - this.retentionMs).toISOString()) as { json: string } | undefined;
    if (!row) return undefined;
    const design = JSON.parse(row.json) as DesignDocument;
    this.cache.set(id, design, Buffer.byteLength(row.json));
    this.touch(id);
    return design;
  }
  private touch(id: string) { this.db?.prepare('UPDATE designs SET last_used_at = ? WHERE id = ?').run(new Date().toISOString(), id); }
}

/** Generated proposals, fetched by id (dashboard → VS Code handoff, feature history). Random ids, never guessable. */
export class ProposalStore {
  private readonly cache: LruCache<StoredProposal>;
  readonly retentionMs: number;
  constructor(private readonly db?: DatabaseSync) {
    this.retentionMs = db ? envNumber('CODEDEFT_PROPOSAL_RETENTION_DAYS', 365) * DAY : envNumber('CODEDEFT_PROPOSAL_TTL_MS', DAY);
    this.cache = new LruCache({ maxEntries: 500, maxBytes: envNumber('CODEDEFT_PROPOSAL_CACHE_MB', 64) * MB, ttlMs: Math.min(this.retentionMs, DAY) });
  }
  put(input: { repository: string; source: StoredProposal['source'] | 'feature.generate'; task: string; result: GeneratedProposal }): StoredProposal {
    const id = 'p_' + crypto.randomUUID();
    const now = Date.now();
    const stored = { id, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + this.retentionMs).toISOString(), repository: input.repository, source: input.source, task: input.task.slice(0, 4000), result: { ...input.result, proposalId: id } } as StoredProposal;
    const json = JSON.stringify(stored);
    if (!this.cache.set(id, stored, Buffer.byteLength(json))) throw new Error('Proposal too large to store');
    if (this.db) {
      this.db.prepare('INSERT INTO proposals(id, repository, json, created_at) VALUES(?,?,?,?)').run(id, input.repository, json, stored.createdAt);
      this.db.prepare('DELETE FROM proposals WHERE created_at < ?').run(new Date(now - this.retentionMs).toISOString());
    }
    return stored;
  }
  get(id: string): StoredProposal | undefined {
    if (!PROPOSAL_ID.test(id)) return undefined;
    const hit = this.cache.get(id);
    if (hit || !this.db) return hit;
    const row = this.db.prepare('SELECT json FROM proposals WHERE id = ?').get(id) as { json: string } | undefined;
    if (!row) return undefined;
    const stored = JSON.parse(row.json) as StoredProposal;
    if (new Date(stored.expiresAt).getTime() < Date.now()) return undefined;
    this.cache.set(id, stored, Buffer.byteLength(row.json));
    return stored;
  }
}
