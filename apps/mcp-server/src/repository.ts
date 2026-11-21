import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { indexRepository, analyzeRepository, type RepositoryIndex, type RepositoryProfile } from '../../../packages/engine/src/index.ts';

const SOURCE = new Set(['.ts', '.tsx', '.js', '.jsx', '.vue', '.mts', '.cts']);
const IGNORED = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.nuxt', '.output']);
const CONFIG = ['package.json', 'tsconfig.json', 'tsconfig.app.json', 'jsconfig.json', 'vite.config.ts', 'vite.config.js'];

/**
 * Fingerprint of everything the index depends on: source files (path, size, mtime) and config files.
 * Cheap (stat only), so it runs on every tool call and the index is rebuilt only when something changed:
 * the model never gets context from a stale index.
 */
export function repositorySignature(root: string): string {
  const hash = crypto.createHash('sha1');
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (e.isSymbolicLink() || (e.name.startsWith('.') && e.name !== '.github')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!IGNORED.has(e.name)) stack.push(full); continue; }
      if (!e.isFile() || !SOURCE.has(path.extname(e.name))) continue;
      const st = fs.statSync(full);
      hash.update(`${full}\0${st.size}\0${st.mtimeMs}\n`);
    }
  }
  for (const name of CONFIG) { try { const st = fs.statSync(path.join(root, name)); hash.update(`${name}\0${st.size}\0${st.mtimeMs}\n`); } catch { /* absent */ } }
  return hash.digest('hex');
}

export type Snapshot = { root: string; index: RepositoryIndex; profile: RepositoryProfile; indexedAt: string; reused: boolean };

/** Indexes repositories on demand and keeps one up-to-date snapshot per repository. */
export class RepositoryCache {
  private readonly entries = new Map<string, { signature: string; snapshot: Snapshot }>();
  constructor(private readonly maxRepositories = 4) {}

  get(repository: string): Snapshot {
    const root = fs.realpathSync(repository);
    if (!fs.statSync(root).isDirectory()) throw new Error(`Not a directory: ${repository}`);
    const signature = repositorySignature(root);
    const hit = this.entries.get(root);
    if (hit && hit.signature === signature) return { ...hit.snapshot, reused: true };
    const index = indexRepository(root);
    const snapshot: Snapshot = { root, index, profile: analyzeRepository(index), indexedAt: new Date().toISOString(), reused: false };
    this.entries.delete(root); this.entries.set(root, { signature, snapshot });
    if (this.entries.size > this.maxRepositories) this.entries.delete(this.entries.keys().next().value!);
    return snapshot;
  }
}

/**
 * Which repository a call is about. Order: the tool's `repository` argument, CODEDEFT_REPOSITORY,
 * the client's workspace roots (MCP roots), then the working directory the client started us in.
 */
export function chooseRepository(explicit: string | undefined, roots: string[]): string {
  if (explicit && explicit.trim()) {
    // An explicit path must exist: silently analysing a different folder would give the model wrong context.
    try { if (fs.statSync(explicit).isDirectory()) return explicit; } catch { /* fall through */ }
    throw new Error(`Repository folder not found: ${explicit}`);
  }
  const candidates = [process.env.CODEDEFT_REPOSITORY, ...roots, process.cwd()].filter((c): c is string => !!c && c.trim() !== '');
  for (const c of candidates) { try { if (fs.statSync(c).isDirectory()) return c; } catch { /* try next */ } }
  throw new Error('No repository folder found. Open a folder in your editor, or set CODEDEFT_REPOSITORY.');
}
