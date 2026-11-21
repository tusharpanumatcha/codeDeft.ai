/**
 * Grounding checks for AI-written code: does every file, package and symbol the code refers to really
 * exist in this repository? These are the most common ways a model "hallucinates" in a codebase:
 * importing a file that does not exist, a helper that was never exported, or a package that is not
 * installed, and re-implementing something the repository already has.
 *
 * The checks are static (TypeScript AST + the repository index): they prove references exist, not that
 * the code behaves correctly. Run tests for that (validation.ts).
 */
import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import ts from 'typescript';
import { type RepositoryIndex } from './index.js';
import { loadResolverConfig, resolveImport, type ResolverConfig } from './resolve.js';
import { evaluateProposal } from './evaluation.js';

export type ImportRef = { spec: string; line: number; default?: string; namespace?: string; named: string[]; typeOnly: boolean; kind: 'import' | 're-export' | 'dynamic' | 'require' };
export type ModuleExports = { named: Set<string>; hasDefault: boolean; hasStar: boolean; exportAssignment: boolean };
export type Finding = { severity: 'error' | 'warning' | 'info'; code: string; message: string; line?: number; suggestions?: string[] };
export type VerificationReport = {
  path: string;
  ok: boolean;
  errors: number;
  warnings: number;
  findings: Finding[];
  imports: { spec: string; line: number; resolvedTo?: string; kind: 'repository' | 'package' | 'builtin' | 'unknown' }[];
  duplication?: { score: number; similarTo?: string };
  summary: string;
};

const BUILTINS = new Set([...builtinModules, ...builtinModules.map(m => `node:${m}`)]);
const scriptKind = (file: string) => /\.(t|j)sx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
/** Script blocks of a file (all <script> blocks for .vue, the whole file otherwise), with their line offsets. */
function scriptBlocks(file: string, content: string): { code: string; lineOffset: number; setup: boolean }[] {
  if (!file.endsWith('.vue')) return [{ code: content, lineOffset: 0, setup: false }];
  return [...content.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map(m => ({
    code: m[2]!, setup: /\bsetup\b/.test(m[1]!), lineOffset: content.slice(0, m.index! + m[0].indexOf('>') + 1).split('\n').length - 1
  }));
}

/** Every module reference in a file, with the names it imports. */
export function extractImports(file: string, content: string): ImportRef[] {
  const refs: ImportRef[] = [];
  for (const block of scriptBlocks(file, content)) {
    const sf = ts.createSourceFile(file, block.code, ts.ScriptTarget.Latest, true, scriptKind(file));
    const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1 + block.lineOffset;
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const clause = node.importClause;
        const ref: ImportRef = { spec: node.moduleSpecifier.text, line: lineOf(node), named: [], typeOnly: !!clause?.isTypeOnly, kind: 'import' };
        if (clause?.name) ref.default = clause.name.text;
        const bindings = clause?.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) ref.namespace = bindings.name.text;
        if (bindings && ts.isNamedImports(bindings)) ref.named = bindings.elements.map(e => (e.propertyName ?? e.name).text);
        refs.push(ref);
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const named = node.exportClause && ts.isNamedExports(node.exportClause) ? node.exportClause.elements.map(e => (e.propertyName ?? e.name).text) : [];
        refs.push({ spec: node.moduleSpecifier.text, line: lineOf(node), named, typeOnly: node.isTypeOnly, kind: 're-export' });
      } else if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0]!)) {
        const isDynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword;
        const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
        if (isDynamic || isRequire) refs.push({ spec: (node.arguments[0] as ts.StringLiteral).text, line: lineOf(node), named: [], typeOnly: false, kind: isDynamic ? 'dynamic' : 'require' });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return refs;
}

/** What a module exports, read from its source. */
export function moduleExports(file: string, content: string): ModuleExports {
  const out: ModuleExports = { named: new Set(), hasDefault: file.endsWith('.vue'), hasStar: false, exportAssignment: false };
  const exported = (n: ts.Node) => (ts.canHaveModifiers(n) ? ts.getModifiers(n) : undefined)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
  const isDefault = (n: ts.Node) => (ts.canHaveModifiers(n) ? ts.getModifiers(n) : undefined)?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
  for (const block of scriptBlocks(file, content)) {
    const sf = ts.createSourceFile(file, block.code, ts.ScriptTarget.Latest, true, scriptKind(file));
    for (const st of sf.statements) {
      if (ts.isExportAssignment(st)) { if (st.isExportEquals) out.exportAssignment = true; else out.hasDefault = true; continue; }
      if (ts.isExportDeclaration(st)) {
        if (!st.exportClause) { out.hasStar = true; continue; }
        if (ts.isNamespaceExport(st.exportClause)) { out.named.add(st.exportClause.name.text); continue; }
        for (const e of st.exportClause.elements) { if (e.name.text === 'default') out.hasDefault = true; else out.named.add(e.name.text); }
        continue;
      }
      if (!exported(st)) continue;
      if (isDefault(st)) { out.hasDefault = true; continue; }
      if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) {
          if (ts.isIdentifier(d.name)) out.named.add(d.name.text);
          else for (const el of (d.name as ts.BindingPattern).elements) if (ts.isBindingElement(el) && ts.isIdentifier(el.name)) out.named.add(el.name.text);
        }
      } else if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isEnumDeclaration(st) || ts.isModuleDeclaration(st)) && st.name && ts.isIdentifier(st.name)) {
        out.named.add(st.name.text);
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------------------------- suggestions */

/** Optimal string alignment distance (Levenshtein + adjacent transpositions), case-insensitive. */
export function editDistance(a: string, b: string): number {
  a = a.toLowerCase(); b = b.toLowerCase();
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    const cost = a[i - 1] === b[j - 1] ? 0 : 1;
    d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
  }
  return d[a.length]![b.length]!;
}
const words = (s: string) => new Set(s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1));

/**
 * Ranks real names that the model probably meant. Score blends normalised edit distance with overlap of
 * camelCase words, so "formatCurrency" finds "formatPrice" (shared "format") as well as "formatCurency" (typo).
 */
export function suggestNames(name: string, candidates: Iterable<string>, limit = 3): string[] {
  const target = words(name);
  const scored: [string, number][] = [];
  for (const c of new Set(candidates)) {
    if (c === name) continue;
    const distance = editDistance(name, c) / Math.max(name.length, c.length);
    const cw = words(c); const shared = [...target].filter(w => cw.has(w)).length;
    const overlap = shared / Math.max(1, Math.max(target.size, cw.size));
    const score = (1 - distance) * 0.6 + overlap * 0.4;
    if (distance <= 0.4 || shared > 0) scored.push([c, score]);
  }
  return scored.sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).slice(0, limit).map(([c]) => c);
}

/* -------------------------------------------------------------------------------------------- lookup */

export type SymbolDefinition = { name: string; kind: string; file: string; line: number; exported: boolean; signature: string };
/** Finds where a symbol is defined. When nothing matches exactly, returns the closest real names. */
export function lookupSymbol(index: RepositoryIndex, name: string, limit = 10): { query: string; definitions: SymbolDefinition[]; suggestions: string[] } {
  const all = index.files.flatMap(f => f.symbols.map(s => ({ s, f })));
  let hits = all.filter(({ s }) => s.name === name);
  if (!hits.length) hits = all.filter(({ s }) => s.name.toLowerCase() === name.toLowerCase());
  const definitions = hits.slice(0, limit).map(({ s, f }) => ({
    name: s.name, kind: s.kind, file: f.path, line: s.line, exported: s.exported,
    signature: (f.content.split('\n')[s.line - 1] ?? '').trim().slice(0, 200)
  }));
  return { query: name, definitions, suggestions: definitions.length ? [] : suggestNames(name, all.filter(({ s }) => s.exported).map(({ s }) => s.name), 5) };
}

/* -------------------------------------------------------------------------------------------- verify */

type PackageInfo = { deps: Set<string>; manifest: string };
function declaredPackages(root: string, file: string): PackageInfo[] {
  // Nearest package.json files from the file's folder up to the repository root (monorepo workspaces).
  const found: PackageInfo[] = [];
  let dir = path.dirname(path.join(root, file));
  while (dir.startsWith(root)) {
    const manifest = path.join(dir, 'package.json');
    if (fs.existsSync(manifest)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8')) as Record<string, unknown>;
        const deps = new Set<string>(['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].flatMap(k => Object.keys((pkg[k] as Record<string, string>) ?? {})));
        if (typeof pkg.name === 'string') deps.add(pkg.name); // self-reference
        found.push({ deps, manifest: path.relative(root, manifest) || 'package.json' });
      } catch { /* unreadable manifest: ignore */ }
    }
    if (dir === root) break;
    dir = path.dirname(dir);
  }
  return found;
}
const packageName = (spec: string) => spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]!;

export type VerifyOptions = {
  resolver?: ResolverConfig; checkDuplication?: boolean;
  /** Other files created in the same change set: imports between them are valid even though they are not in the repository yet. */
  siblings?: { path: string; content: string }[];
};

/** Checks one proposed file against the repository. `path` is repository-relative; the file need not exist yet. */
export function verifyCode(index: RepositoryIndex, filePath: string, content: string, options: VerifyOptions = {}): VerificationReport {
  const file = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
  const resolver = options.resolver ?? index.resolver ?? loadResolverConfig(index.root);
  const siblings = (options.siblings ?? []).map(f => ({ path: f.path.replace(/\\/g, '/').replace(/^\.\//, ''), content: f.content })).filter(f => f.path !== file);
  const available = new Set([...index.files.map(f => f.path), ...siblings.map(f => f.path)]);
  const byPath = new Map<string, { content: string }>([...index.files.map(f => [f.path, f] as const), ...siblings.map(f => [f.path, f] as const)]);
  const exportCache = new Map<string, ModuleExports>();
  const exportsOf = (p: string) => { let e = exportCache.get(p); if (!e) { e = moduleExports(p, byPath.get(p)!.content); exportCache.set(p, e); } return e; };
  const packages = declaredPackages(index.root, file);
  const declared = new Set(packages.flatMap(p => [...p.deps]));
  const aliasPrefixes = resolver.aliases.map(a => a.pattern.replace(/\*.*$/, '')).filter(Boolean);
  const findings: Finding[] = [];
  const imports: VerificationReport['imports'] = [];

  let refs: ImportRef[] = [];
  try { refs = extractImports(file, content); }
  catch (e) { findings.push({ severity: 'error', code: 'parse_error', message: `Could not parse the file: ${e instanceof Error ? e.message : String(e)}` }); }

  for (const ref of refs) {
    const spec = ref.spec.split('?')[0]!;
    const resolved = resolveImport(file, spec, available, resolver);
    const looksLocal = spec.startsWith('.') || spec.startsWith('/') || aliasPrefixes.some(p => spec === p.replace(/\/$/, '') || spec.startsWith(p));
    if (resolved) {
      imports.push({ spec: ref.spec, line: ref.line, resolvedTo: resolved, kind: 'repository' });
      const exp = exportsOf(resolved);
      if (ref.default && !exp.hasDefault && !exp.exportAssignment && !exp.hasStar) {
        findings.push({ severity: 'error', code: 'missing_default_export', line: ref.line, message: `${resolved} has no default export, but the code imports \`${ref.default}\` as one.`, suggestions: [...exp.named].slice(0, 5).map(n => `import { ${n} } from '${ref.spec}'`) });
      }
      for (const name of ref.named) {
        if (name === 'default' || exp.named.has(name)) continue;
        if (exp.hasStar || exp.exportAssignment) { findings.push({ severity: 'info', code: 'unverifiable_export', line: ref.line, message: `\`${name}\` may come from an \`export *\` in ${resolved}; not checked.` }); continue; }
        const suggestions = suggestNames(name, exp.named);
        findings.push({ severity: 'error', code: 'missing_export', line: ref.line, message: `\`${name}\` is not exported by ${resolved}.${suggestions.length ? ` Did you mean ${suggestions.map(s => `\`${s}\``).join(', ')}?` : ''}`, suggestions });
      }
    } else if (BUILTINS.has(spec) || BUILTINS.has(spec.split('/')[0]!)) {
      imports.push({ spec: ref.spec, line: ref.line, kind: 'builtin' });
    } else if (looksLocal) {
      const near = suggestNames(path.posix.basename(spec).replace(/\.\w+$/, ''), index.files.map(f => path.posix.basename(f.path).replace(/\.\w+$/, '')), 3);
      const nearPaths = near.flatMap(n => index.files.filter(f => path.posix.basename(f.path).replace(/\.\w+$/, '') === n).map(f => f.path)).slice(0, 3);
      imports.push({ spec: ref.spec, line: ref.line, kind: 'unknown' });
      findings.push({ severity: 'error', code: 'missing_file', line: ref.line, message: `\`${ref.spec}\` does not resolve to any file in the repository.${nearPaths.length ? ` Similar files: ${nearPaths.join(', ')}.` : ''}`, suggestions: nearPaths });
    } else if (/^[a-z]+:/i.test(spec) || spec.startsWith('~') || spec.startsWith('#')) {
      imports.push({ spec: ref.spec, line: ref.line, kind: 'unknown' });
      findings.push({ severity: 'info', code: 'virtual_module', line: ref.line, message: `\`${ref.spec}\` looks like a bundler virtual module or import map entry; not checked.` });
    } else {
      const name = packageName(spec);
      imports.push({ spec: ref.spec, line: ref.line, kind: 'package' });
      const typesOk = ref.typeOnly && declared.has(`@types/${name.replace(/^@([^/]+)\//, '$1__')}`);
      if (!declared.has(name) && !typesOk) {
        findings.push({ severity: 'error', code: 'undeclared_package', line: ref.line, message: packages.length ? `Package \`${name}\` is not declared in ${packages.map(p => p.manifest).join(' or ')}. Use an existing dependency or add it deliberately.` : `Package \`${name}\` is imported, but the repository has no package.json to confirm it is installed.`, suggestions: suggestNames(name, declared, 3) });
      }
    }
  }

  let duplication: VerificationReport['duplication'];
  if (options.checkDuplication !== false && /\.(ts|tsx|js|jsx|vue|mts|cts)$/.test(file)) {
    try {
      const report = evaluateProposal(index, { changes: [{ path: file, content }] }).files[0];
      const top = report?.matches.find(m => !m.imported);
      duplication = { score: report?.duplication ?? 0, similarTo: top?.file };
      if (report && top && report.duplication >= 0.5) findings.push({ severity: 'warning', code: 'duplicates_existing', message: `About ${Math.round(report.duplication * 100)}% of this file repeats ${top.file}. Import or extend it instead of copying it.`, suggestions: [top.file] });
    } catch { /* duplication is advisory */ }
  }

  const errors = findings.filter(f => f.severity === 'error').length;
  const warnings = findings.filter(f => f.severity === 'warning').length;
  const summary = errors ? `${errors} reference${errors === 1 ? '' : 's'} in ${file} do not exist in this repository${warnings ? `, plus ${warnings} warning${warnings === 1 ? '' : 's'}` : ''}. Fix them before using this code.`
    : warnings ? `All references in ${file} exist; ${warnings} warning${warnings === 1 ? '' : 's'} to review.` : `All ${imports.length} import${imports.length === 1 ? '' : 's'} in ${file} exist in this repository.`;
  return { path: file, ok: errors === 0, errors, warnings, findings, imports, duplication, summary };
}
