import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/** One path alias, e.g. "@/*" -> ["src/*"]. Targets are repository-relative POSIX paths. */
export type PathAlias = { pattern: string; targets: string[]; source: string };
export type ResolverConfig = { aliases: PathAlias[]; baseUrl?: string };

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.vue', '.mts', '.cts'];
const INDEX_FILES = SOURCE_EXTENSIONS.map(ext => `/index${ext}`);
const TS_CONFIGS = ['tsconfig.json', 'tsconfig.app.json', 'tsconfig.base.json', 'jsconfig.json'];
const VITE_CONFIGS = ['vite.config.ts', 'vite.config.mts', 'vite.config.js', 'vite.config.mjs', 'vitest.config.ts', 'nuxt.config.ts'];

const toPosix = (value: string) => value.split(path.sep).join('/');
function repoRelative(root: string, absolute: string): string | undefined {
  const rel = toPosix(path.relative(root, absolute));
  if (rel.startsWith('..') || path.isAbsolute(rel)) return undefined; // never resolve outside the repository
  return rel === '' ? '.' : rel;
}

/** Reads compilerOptions.paths/baseUrl (following "extends") from tsconfig/jsconfig files. */
function aliasesFromTsConfig(root: string): ResolverConfig {
  const aliases: PathAlias[] = [];
  let baseUrl: string | undefined;
  for (const name of TS_CONFIGS) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    const read = ts.readConfigFile(file, ts.sys.readFile);
    if (read.error || !read.config) continue;
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root, undefined, file);
    const options = parsed.options;
    // TypeScript resolves "paths" relative to baseUrl, or to the config that declared them.
    const base = options.baseUrl ?? (options as { pathsBasePath?: string }).pathsBasePath ?? root;
    if (options.baseUrl && !baseUrl) baseUrl = repoRelative(root, options.baseUrl);
    for (const [pattern, targets] of Object.entries(options.paths ?? {})) {
      const resolved = targets.map(t => repoRelative(root, path.resolve(base, t))).filter((t): t is string => !!t);
      if (resolved.length && !aliases.some(a => a.pattern === pattern)) aliases.push({ pattern, targets: resolved, source: name });
    }
  }
  return { aliases, baseUrl };
}

/**
 * Extracts simple string aliases from a Vite/Nuxt config without executing it. Supports the common forms:
 *   '@': fileURLToPath(new URL('./src', import.meta.url))
 *   '@': path.resolve(__dirname, 'src')   /   '@': resolve(__dirname, './src')
 *   '@': '/src'   /   { find: '@', replacement: path.resolve(__dirname, 'src') }
 */
function aliasesFromViteConfig(root: string): PathAlias[] {
  const aliases: PathAlias[] = [];
  const target = String.raw`(?:fileURLToPath\(\s*new\s+URL\(\s*|(?:path\.)?resolve\(\s*(?:__dirname|process\.cwd\(\))\s*,\s*)?['"\`]([^'"\`]+)['"\`]`;
  const objectForm = new RegExp(String.raw`['"\`]?([@~#$][\w/-]*|[A-Za-z][\w-]*)['"\`]?\s*:\s*` + target, 'g');
  const findForm = new RegExp(String.raw`find\s*:\s*['"\`]([^'"\`]+)['"\`]\s*,\s*replacement\s*:\s*` + target, 'g');
  for (const name of VITE_CONFIGS) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const aliasBlock = text.match(/alias\s*:\s*[[{]([\s\S]*?)[\]}]\s*[,}\n]/)?.[1];
    if (!aliasBlock) continue;
    for (const re of [findForm, objectForm]) {
      for (const m of aliasBlock.matchAll(re)) {
        const [, key, rawTarget] = m;
        if (!key || !rawTarget || ['find', 'replacement', 'import'].includes(key)) continue;
        const rel = repoRelative(root, path.resolve(root, rawTarget.replace(/^\/(?!\/)/, './')));
        if (!rel || aliases.some(a => a.pattern === `${key}/*`)) continue;
        aliases.push({ pattern: `${key}/*`, targets: [`${rel}/*`], source: name });
        aliases.push({ pattern: key, targets: [rel], source: name });
      }
    }
  }
  return aliases;
}

/** Builds the alias table for a repository. tsconfig paths win over Vite aliases with the same key. */
export function loadResolverConfig(root: string): ResolverConfig {
  const fromTs = aliasesFromTsConfig(root);
  const aliases = [...fromTs.aliases];
  for (const alias of aliasesFromViteConfig(root)) if (!aliases.some(a => a.pattern === alias.pattern)) aliases.push(alias);
  // Vue/Vite projects almost universally map "@/" to "src/". Use it only when nothing was declared.
  if (!aliases.length && fs.existsSync(path.join(root, 'src')) && fs.statSync(path.join(root, 'src')).isDirectory()) {
    aliases.push({ pattern: '@/*', targets: ['src/*'], source: 'default (@/ -> src/)' });
  }
  return { aliases, baseUrl: fromTs.baseUrl };
}

function firstExisting(base: string, files: Set<string>): string | undefined {
  const normalized = path.posix.normalize(base).replace(/^\.\//, '');
  const candidates = [normalized, ...SOURCE_EXTENSIONS.map(x => normalized + x), ...INDEX_FILES.map(x => normalized + x)];
  // "./foo.js" written in TypeScript ESM code usually refers to foo.ts.
  if (/\.(m|c)?js$/.test(normalized)) candidates.push(normalized.replace(/\.(m|c)?js$/, '.ts'), normalized.replace(/\.(m|c)?js$/, '.tsx'));
  return candidates.find(c => files.has(c));
}

/** Resolves an import specifier to a repository file, or undefined for packages and unresolvable paths. */
export function resolveImport(from: string, spec: string, files: Set<string>, config: ResolverConfig = { aliases: [] }): string | undefined {
  const clean = spec.split('?')[0]!; // Vite query suffixes such as "?raw"
  if (clean.startsWith('.')) return firstExisting(path.posix.join(path.posix.dirname(from), clean), files);
  // Longest pattern first, matching TypeScript's behaviour.
  const ordered = [...config.aliases].sort((a, b) => b.pattern.length - a.pattern.length);
  for (const alias of ordered) {
    const star = alias.pattern.indexOf('*');
    let captured: string | undefined;
    if (star < 0) { if (clean === alias.pattern) captured = ''; }
    else {
      const prefix = alias.pattern.slice(0, star), suffix = alias.pattern.slice(star + 1);
      if (clean.startsWith(prefix) && clean.endsWith(suffix) && clean.length >= prefix.length + suffix.length) captured = clean.slice(prefix.length, clean.length - suffix.length);
    }
    if (captured === undefined) continue;
    for (const target of alias.targets) {
      const hit = firstExisting(target.replace('*', captured), files);
      if (hit) return hit;
    }
  }
  if (config.baseUrl !== undefined) return firstExisting(path.posix.join(config.baseUrl, clean), files);
  return undefined;
}
