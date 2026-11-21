// codeDeft's own data (feature chats, designs, proposals) in the same SQLite file as the repository index.
// Schema changes are applied in order and recorded in PRAGMA user_version, so upgrades never lose data.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const MIGRATIONS: string[] = [
  // 1: feature chats, persistent designs and proposals
  `CREATE TABLE IF NOT EXISTS features (
     id TEXT PRIMARY KEY, repository TEXT NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL,
     requirement TEXT NOT NULL DEFAULT '', archived INTEGER NOT NULL DEFAULT 0,
     context_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS idx_features_repo ON features(repository, archived, updated_at);
   CREATE TABLE IF NOT EXISTS feature_messages (
     id TEXT PRIMARY KEY, feature_id TEXT NOT NULL REFERENCES features(id) ON DELETE CASCADE,
     seq INTEGER NOT NULL, role TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL,
     payload_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS idx_messages_feature ON feature_messages(feature_id, seq);
   CREATE TABLE IF NOT EXISTS designs (id TEXT PRIMARY KEY, json TEXT NOT NULL, created_at TEXT NOT NULL, last_used_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS proposals (id TEXT PRIMARY KEY, repository TEXT NOT NULL, json TEXT NOT NULL, created_at TEXT NOT NULL);`
];

export function openAppDatabase(file: string): DatabaseSync {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const current = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try { db.exec(MIGRATIONS[v]!); db.exec(`PRAGMA user_version = ${v + 1}`); db.exec('COMMIT'); }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  return db;
}
