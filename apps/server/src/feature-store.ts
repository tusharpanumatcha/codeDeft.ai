// Feature chats: one stored conversation and context per feature, per repository (SQLite).
import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Feature, FeatureContext, FeatureMessage, FeatureMessageKind, FeatureStatus, FeatureSummary } from '../../../packages/protocol/dist/index.js';

export const FEATURE_ID = /^f_[a-f0-9-]{36}$/;
export const DEFAULT_NAME = 'Untitled feature';
const MAX_MESSAGES = 500;

type FeatureRow = { id: string; repository: string; name: string; status: string; requirement: string; archived: number; context_json: string; created_at: string; updated_at: string };
type MessageRow = { id: string; feature_id: string; seq: number; role: string; kind: string; text: string; payload_json: string | null; created_at: string; updated_at: string };

const toFeature = (r: FeatureRow): Omit<Feature, 'stale'> => ({
  id: r.id, repository: r.repository, name: r.name, status: r.status as FeatureStatus, requirement: r.requirement,
  archived: r.archived === 1, createdAt: r.created_at, updatedAt: r.updated_at, context: JSON.parse(r.context_json) as FeatureContext
});
const toMessage = (r: MessageRow): FeatureMessage => ({
  id: r.id, featureId: r.feature_id, role: r.role as FeatureMessage['role'], kind: r.kind as FeatureMessageKind, text: r.text,
  payload: r.payload_json ? JSON.parse(r.payload_json) as Record<string, unknown> : undefined, createdAt: r.created_at, updatedAt: r.updated_at
});

/** Short, readable name from the first message, e.g. "Build the checkout page from this frame: …" → "Checkout page". */
export function nameFromMessage(text: string): string {
  const cleaned = text.replace(/https?:\/\/\S+/g, ' ').replace(/^\/\w+\s*/, '').replace(/[^\p{L}\p{N}\s'-]/gu, ' ').replace(/\s+/g, ' ').trim();
  const filler = /^(please|can you|could you|i want to|i need to|let's|lets|build|create|make|add|implement|find|write|generate|show me|from this frame|the|a|an)\s+/i;
  let s = cleaned; for (let i = 0; i < 6 && filler.test(s); i++) s = s.replace(filler, '');
  s = s.replace(/\s+(from|using|with|based on|for)\s+(this|the|a)\s+(frame|design|figma).*$/i, '');
  const words = s.split(' ').filter(Boolean).slice(0, 6).join(' ');
  return words ? words[0]!.toUpperCase() + words.slice(1) : DEFAULT_NAME;
}

export class FeatureStore {
  constructor(private readonly db: DatabaseSync) {}

  create(repository: string, name?: string): Omit<Feature, 'stale'> {
    const id = 'f_' + crypto.randomUUID(); const now = new Date().toISOString();
    this.db.prepare('INSERT INTO features(id, repository, name, status, requirement, archived, context_json, created_at, updated_at) VALUES(?,?,?,?,?,0,?,?,?)')
      .run(id, repository, (name?.trim() || DEFAULT_NAME).slice(0, 120), 'exploring', '', '{}', now, now);
    return this.get(id)!;
  }

  get(id: string): Omit<Feature, 'stale'> | undefined {
    if (!FEATURE_ID.test(id)) return undefined;
    const row = this.db.prepare('SELECT * FROM features WHERE id = ?').get(id) as FeatureRow | undefined;
    return row && toFeature(row);
  }

  list(repository: string, opts: { q?: string; archived?: boolean } = {}): FeatureSummary[] {
    const rows = this.db.prepare(`SELECT f.*, (SELECT text FROM feature_messages m WHERE m.feature_id = f.id ORDER BY seq DESC LIMIT 1) AS last
      FROM features f WHERE repository = ? AND archived = ? ORDER BY updated_at DESC LIMIT 300`).all(repository, opts.archived ? 1 : 0) as (FeatureRow & { last: string | null })[];
    const q = opts.q?.trim().toLowerCase();
    return rows
      .filter(r => !q || r.name.toLowerCase().includes(q) || r.requirement.toLowerCase().includes(q) || r.context_json.toLowerCase().includes(q))
      .map(r => { const { context: _c, requirement: _r, ...summary } = toFeature(r); return { ...summary, lastMessage: r.last?.slice(0, 160) ?? undefined }; });
  }

  update(id: string, patch: { name?: string; status?: FeatureStatus; archived?: boolean; requirement?: string; context?: FeatureContext }): Omit<Feature, 'stale'> {
    const cur = this.get(id); if (!cur) throw new Error('Feature not found');
    const next = { ...cur, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as Omit<Feature, 'stale'>;
    this.db.prepare('UPDATE features SET name = ?, status = ?, archived = ?, requirement = ?, context_json = ?, updated_at = ? WHERE id = ?')
      .run(next.name.slice(0, 120), next.status, next.archived ? 1 : 0, next.requirement.slice(0, 4000), JSON.stringify(next.context), new Date().toISOString(), id);
    return this.get(id)!;
  }

  /** Read-modify-write of the context in one transaction. */
  updateContext(id: string, change: (c: FeatureContext) => FeatureContext, patch: { status?: FeatureStatus } = {}): Omit<Feature, 'stale'> {
    this.db.exec('BEGIN IMMEDIATE');
    try { const cur = this.get(id); if (!cur) throw new Error('Feature not found'); const f = this.update(id, { ...patch, context: change(structuredClone(cur.context)) }); this.db.exec('COMMIT'); return f; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }

  messages(featureId: string): FeatureMessage[] {
    const rows = this.db.prepare('SELECT * FROM (SELECT * FROM feature_messages WHERE feature_id = ? ORDER BY seq DESC LIMIT ?) ORDER BY seq').all(featureId, MAX_MESSAGES) as MessageRow[];
    return rows.map(toMessage);
  }

  addMessage(featureId: string, m: { role: FeatureMessage['role']; kind: FeatureMessageKind; text: string; payload?: Record<string, unknown> }): FeatureMessage {
    const id = 'm_' + crypto.randomUUID(); const now = new Date().toISOString();
    const seq = Number((this.db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM feature_messages WHERE feature_id = ?').get(featureId) as { n: number }).n);
    this.db.prepare('INSERT INTO feature_messages(id, feature_id, seq, role, kind, text, payload_json, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(id, featureId, seq, m.role, m.kind, m.text.slice(0, 20_000), m.payload ? JSON.stringify(m.payload) : null, now, now);
    this.db.prepare('UPDATE features SET updated_at = ? WHERE id = ?').run(now, featureId);
    return toMessage(this.db.prepare('SELECT * FROM feature_messages WHERE id = ?').get(id) as MessageRow);
  }

  updateMessage(id: string, m: { kind: FeatureMessageKind; text: string; payload?: Record<string, unknown> }): void {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE feature_messages SET kind = ?, text = ?, payload_json = ?, updated_at = ? WHERE id = ?').run(m.kind, m.text.slice(0, 20_000), m.payload ? JSON.stringify(m.payload) : null, now, id);
    this.db.prepare('UPDATE features SET updated_at = ? WHERE id = (SELECT feature_id FROM feature_messages WHERE id = ?)').run(now, id);
  }

  /** After a restart, generation jobs that were running are gone: say so instead of spinning forever. */
  recoverInterrupted(): number {
    const stuck = this.db.prepare("SELECT id, feature_id FROM feature_messages WHERE kind = 'generating'").all() as { id: string; feature_id: string }[];
    for (const m of stuck) {
      this.updateMessage(m.id, { kind: 'error', text: 'Generation was interrupted because the codeDeft server restarted. Generate again.' });
      this.db.prepare("UPDATE features SET status = 'failed' WHERE id = ? AND status = 'generating'").run(m.feature_id);
    }
    return stuck.length;
  }
}
