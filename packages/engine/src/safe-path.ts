import { existsSync, lstatSync } from 'node:fs';
import { resolve, dirname, sep } from 'node:path';

/**
 * One rule set for every place that accepts a model- or user-proposed file path
 * (server, VS Code extension, CLI validation). Keep it here so the checks cannot drift apart.
 *
 * Rules:
 * - relative POSIX paths only: no absolute paths, backslashes, NUL, empty, "." or ".." segments;
 * - no segment may start with "." — this blocks .git, .vscode (tasks run on folder open), .github
 *   (CI workflows), .husky (git hooks), .env*, .npmrc, .yarnrc*, .ssh and every other tool config;
 * - no node_modules segment;
 * - no segment ending in "." or " " (Windows silently strips them, e.g. "evil." === "evil").
 *
 * Comparisons are case-insensitive and Unicode-normalised because macOS and Windows file systems
 * are: ".Git/hooks" is the same directory as ".git/hooks" there.
 */
export const MAX_PROPOSAL_PATH_LENGTH = 400;

export function proposalPathProblem(path: unknown): string | undefined {
  if (typeof path !== 'string' || !path) return 'path must be a non-empty string';
  if (path.length > MAX_PROPOSAL_PATH_LENGTH) return 'path is too long';
  if (path.includes('\0')) return 'path contains NUL';
  if (path.includes('\\')) return 'use forward slashes';
  if (path.startsWith('/') || /^[a-zA-Z]:/.test(path)) return 'path must be relative';
  for (const raw of path.split('/')) {
    const segment = raw.normalize('NFC').toLowerCase();
    if (!segment || segment === '.' || segment === '..') return 'empty, "." or ".." segment';
    if (segment.startsWith('.')) return `hidden/config path segment "${raw}" is not allowed`;
    if (segment === 'node_modules') return 'node_modules is not allowed';
    if (/[. ]$/.test(segment)) return `segment "${raw}" ends with "." or space`;
  }
  return undefined;
}

export function assertSafeProposalPath(path: unknown): asserts path is string {
  const problem = proposalPathProblem(path);
  if (problem) throw new Error(`Unsafe proposal path ${JSON.stringify(path)}: ${problem}`);
}

/**
 * Resolves a proposal path inside `root` (which must already be a realpath) and refuses symlinked
 * parents or targets, so a write can never be redirected outside the repository.
 */
export function resolveProposalTarget(root: string, path: unknown): string {
  assertSafeProposalPath(path);
  const target = resolve(root, path);
  if (!target.startsWith(root + sep)) throw new Error(`Proposal path escapes the repository: ${path}`);
  let parent = dirname(target);
  while (parent.startsWith(root + sep)) {
    if (existsSync(parent) && lstatSync(parent).isSymbolicLink()) throw new Error(`Symlinked directory not allowed: ${path}`);
    parent = dirname(parent);
  }
  // lstat (not exists) so dangling symlinks are caught too.
  try { if (lstatSync(target).isSymbolicLink()) throw new Error(`Symlink target not allowed: ${path}`); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return target;
}

/** Case-insensitive duplicate key, so "src/A.ts" and "src/a.ts" cannot both be proposed. */
export function proposalPathKey(path: string): string {
  return path.normalize('NFC').toLowerCase();
}
