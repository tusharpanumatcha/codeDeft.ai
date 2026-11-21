import ts from 'typescript';
import type { RepositoryIndex } from './index.js';
import { parseFile } from './index.js';
import { loadResolverConfig, resolveImport } from './resolve.js';

/*
 * codeDeft evaluation metrics.
 *
 *   CodeSim(C,R) = Σ_b ω_b [ α·S_lex^b + β·S_fp^b + γ·S_ast^b ]        b ∈ {template, script, style}
 *   S_lex  = 1 − d_tok(N(C),N(R)) / max(|N(C)|,|N(R)|)                  token-level Levenshtein
 *   S_fp   = |F(C) ∩ F(R)| / |F(C) ∪ F(R)|                              Jaccard over winnowing fingerprints
 *   S_ast  = Σ min(c_C, c_R) / Σ max(c_C, c_R)                           weighted Jaccard over structural features
 *   ω_b    = (|N(C_b)| + |N(R_b)|) / Σ_b' (|N(C_b')| + |N(R_b')|)
 *
 *   Cov(C|K) = |F(C) ∩ F(K)| / |F(C)|
 *   Dup(C)   = max_K Cov(C|K) · 1[K not imported by C]
 *   R        = 1 − Dup(C)
 *
 * S_ast is an approximation of normalized tree edit distance: it compares multisets of parent→child node-kind
 * pairs (script), element nesting pairs and directives (template), and property names (style). True tree edit
 * distance (Zhang–Shasha) is O(n²)–O(n³) and is left as a future option.
 */

export type BlockName = 'template' | 'script' | 'style';
export type Blocks = Partial<Record<BlockName, string>>;
export type SimilarityWeights = { alpha: number; beta: number; gamma: number };
export type BlockSimilarity = { weight: number; tokens: [number, number]; lexical: number; fingerprint: number; structural: number; score: number };
export type CodeSimResult = {
  score: number;
  weights: SimilarityWeights;
  abstractIdentifiers: boolean;
  blocks: Partial<Record<BlockName, BlockSimilarity>>;
  notes: string[];
};
export type DuplicateMatch = { file: string; coverage: number; imported: boolean };
export type DuplicationReport = {
  path: string;
  fingerprints: number;
  duplication: number;
  reusability: number;
  matches: DuplicateMatch[];
  notes: string[];
};
export type ProposalEvaluation = {
  repository: string;
  reusability: number;
  files: DuplicationReport[];
  method: string;
  limitations: string[];
};

export const DEFAULT_WEIGHTS: SimilarityWeights = { alpha: 0.2, beta: 0.3, gamma: 0.5 };
const K_GRAM = 6;          // tokens per fingerprinted k-gram
const WINDOW = 4;          // winnowing window size
const MAX_LEV_TOKENS = 4000;
const MIN_FINGERPRINTS = 8; // below this, a file is too small to judge duplication
const round = (n: number) => Math.round(n * 1000) / 1000;

/* ----------------------------------------------------------------------------------------------- blocks */

/** Splits a file into Vue SFC blocks. Non-Vue files are a single script block. */
export function splitBlocks(file: string, content: string): Blocks {
  if (!file.endsWith('.vue')) return { script: content };
  const withoutComments = content.replace(/<!--[\s\S]*?-->/g, '');
  const blocks: Blocks = {};
  // Greedy match: <template> may contain nested <template #slot> elements.
  const template = withoutComments.match(/<template\b[^>]*>([\s\S]*)<\/template>/i)?.[1];
  if (template?.trim()) blocks.template = template;
  const scripts = [...withoutComments.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]).join('\n');
  if (scripts.trim()) blocks.script = scripts;
  const styles = [...withoutComments.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join('\n');
  if (styles.trim()) blocks.style = styles;
  return blocks;
}

/* ------------------------------------------------------------------------------------- normalization N(x) */

function scriptTokens(code: string, abstract: boolean, jsx: boolean): string[] {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, jsx ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard, code);
  const out: string[] = [];
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    if (kind === ts.SyntaxKind.Identifier || kind === ts.SyntaxKind.PrivateIdentifier) out.push(abstract ? 'ID' : scanner.getTokenText());
    else if (kind === ts.SyntaxKind.StringLiteral || kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral || (kind >= ts.SyntaxKind.TemplateHead && kind <= ts.SyntaxKind.TemplateTail)) out.push(abstract ? 'STR' : scanner.getTokenText());
    else if (kind === ts.SyntaxKind.NumericLiteral || kind === ts.SyntaxKind.BigIntLiteral) out.push(abstract ? 'NUM' : scanner.getTokenText());
    else out.push(scanner.getTokenText());
  }
  return out;
}

function templateTokens(markup: string, abstract: boolean): string[] {
  const raw = markup.match(/<\/?[A-Za-z][\w.:-]*|\/?>|\{\{|\}\}|"[^"]*"|'[^']*'|[:@#]?[A-Za-z_$][\w.:$-]*|\d+(?:\.\d+)?|\S/g) ?? [];
  const out: string[] = [];
  let inTag = false, inInterpolation = false;
  for (const t of raw) {
    if (t.startsWith('<')) { inTag = true; out.push(t); continue; }
    if (t === '>' || t === '/>') { inTag = false; out.push(t); continue; }
    if (t === '{{' || t === '}}') { inInterpolation = t === '{{'; out.push(t); continue; }
    if (!abstract) { out.push(t); continue; }
    if (/^["']/.test(t)) out.push('STR');
    else if (/^\d/.test(t)) out.push('NUM');
    else if (inInterpolation) out.push(/^[A-Za-z_$]/.test(t) ? 'ID' : t);
    else if (inTag) out.push(t); // attribute and directive names are structure (v-for, @click, :items)
    else out.push(/^[A-Za-z_$]/.test(t) ? 'TXT' : t); // visible text
  }
  return out;
}

function styleTokens(css: string, abstract: boolean): string[] {
  const raw = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/#[0-9a-fA-F]{3,8}\b|-?\d*\.?\d+[a-z%]*|[\w-]+|[{}:;,>+~()]|\S/g) ?? [];
  return abstract ? raw.map(t => (/^#[0-9a-fA-F]{3,8}$/.test(t) || /^-?\d*\.?\d+[a-z%]*$/.test(t) ? 'NUM' : t)) : raw;
}

/** N(x): normalized token sequence for one block. Comments and formatting are discarded. */
export function normalizeTokens(block: BlockName, code: string, options: { abstractIdentifiers?: boolean; jsx?: boolean } = {}): string[] {
  const abstract = options.abstractIdentifiers ?? true;
  if (block === 'template') return templateTokens(code, abstract);
  if (block === 'style') return styleTokens(code, abstract);
  return scriptTokens(code, abstract, options.jsx ?? false);
}

/* -------------------------------------------------------------------------------------------- S_lex */

/** Token-level Levenshtein distance (two-row dynamic programming, O(n·m) time, O(m) memory). */
export function tokenEditDistance(a: string[], b: string[]): number {
  const ids = new Map<string, number>();
  const id = (t: string) => { let v = ids.get(t); if (v === undefined) { v = ids.size; ids.set(t, v); } return v; };
  const x = Int32Array.from(a, id), y = Int32Array.from(b, id);
  let prev = new Int32Array(y.length + 1), curr = new Int32Array(y.length + 1);
  for (let j = 0; j <= y.length; j++) prev[j] = j;
  for (let i = 1; i <= x.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[y.length]!;
}

export function lexicalSimilarity(a: string[], b: string[]): number {
  if (!a.length && !b.length) return 1;
  const x = a.slice(0, MAX_LEV_TOKENS), y = b.slice(0, MAX_LEV_TOKENS);
  return 1 - tokenEditDistance(x, y) / Math.max(x.length, y.length);
}

/* --------------------------------------------------------------------------------------------- S_fp */

function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/**
 * Winnowing (Schleimer, Wilkerson & Aiken, 2003): hash every k-gram, then keep the minimum hash of each window of
 * w consecutive hashes. Any shared run of at least w+k−1 tokens is guaranteed to share a fingerprint.
 */
export function winnow(tokens: string[], k = K_GRAM, w = WINDOW, salt = ''): Set<number> {
  const out = new Set<number>();
  if (!tokens.length) return out;
  if (tokens.length < k) { out.add(fnv1a(salt + tokens.join('\u0001'))); return out; }
  const hashes: number[] = [];
  for (let i = 0; i + k <= tokens.length; i++) hashes.push(fnv1a(salt + tokens.slice(i, i + k).join('\u0001')));
  if (hashes.length <= w) { out.add(Math.min(...hashes)); return out; }
  for (let i = 0; i + w <= hashes.length; i++) {
    let min = hashes[i]!;
    for (let j = i + 1; j < i + w; j++) if (hashes[j]! <= min) min = hashes[j]!; // rightmost minimum
    out.add(min);
  }
  return out;
}

export function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (!a.size && !b.size) return 1;
  let shared = 0;
  for (const v of a) if (b.has(v)) shared++;
  return shared / (a.size + b.size - shared);
}

/** Cov(A|B): share of A's fingerprints that also appear in B. Asymmetric by design. */
export function containment<T>(a: Set<T>, b: Set<T>): number {
  if (!a.size) return 0;
  let shared = 0;
  for (const v of a) if (b.has(v)) shared++;
  return shared / a.size;
}

/* -------------------------------------------------------------------------------------------- S_ast */

type Bag = Map<string, number>;
const bump = (bag: Bag, key: string) => bag.set(key, (bag.get(key) ?? 0) + 1);

function scriptStructure(code: string, jsx: boolean): Bag {
  const bag: Bag = new Map();
  const ast = ts.createSourceFile('block.ts', code, ts.ScriptTarget.Latest, false, jsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (node: ts.Node, parent: string) => {
    const kind = ts.SyntaxKind[node.kind]!;
    bump(bag, kind);
    bump(bag, `${parent}>${kind}`);
    ts.forEachChild(node, child => visit(child, kind));
  };
  ts.forEachChild(ast, child => visit(child, 'Root'));
  return bag;
}

const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
function templateStructure(markup: string): Bag {
  const bag: Bag = new Map();
  const stack: string[] = ['root'];
  for (const m of markup.matchAll(/<(\/?)([A-Za-z][\w.:-]*)([^>]*?)(\/?)>/g)) {
    const [, closing, rawTag, attrs = '', selfClosing] = m;
    const tag = rawTag!.toLowerCase();
    if (closing) { const at = stack.lastIndexOf(tag); if (at > 0) stack.length = at; continue; }
    bump(bag, tag);
    bump(bag, `${stack[stack.length - 1]}>${tag}`);
    for (const a of attrs.matchAll(/(?:^|\s)((?:v-[\w-]+|[:@#][\w.-]+|[\w-]+))(?==|\s|$)/g)) {
      const name = a[1]!;
      if (/^(v-|[:@#])/.test(name)) bump(bag, `${tag}[${name.replace(/^:/, 'v-bind:').replace(/^@/, 'v-on:').replace(/^#/, 'v-slot:')}]`);
    }
    if (!selfClosing && !VOID_ELEMENTS.has(tag)) stack.push(tag);
  }
  return bag;
}

function styleStructure(css: string): Bag {
  const bag: Bag = new Map();
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([\w-]+)\s*:(?!:)[^;{}]*[;}]/g)) bump(bag, `prop:${m[1]}`);
  for (const m of css.matchAll(/@([\w-]+)/g)) bump(bag, `at:${m[1]}`);
  return bag;
}

/** Weighted Jaccard: Σ min / Σ max over the union of keys. */
export function weightedJaccard(a: Bag, b: Bag): number {
  if (!a.size && !b.size) return 1;
  let min = 0, max = 0;
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(key) ?? 0, y = b.get(key) ?? 0;
    min += Math.min(x, y); max += Math.max(x, y);
  }
  return max ? min / max : 1;
}

export function structuralSimilarity(block: BlockName, a: string, b: string, jsx = false): number {
  if (block === 'template') return weightedJaccard(templateStructure(a), templateStructure(b));
  if (block === 'style') return weightedJaccard(styleStructure(a), styleStructure(b));
  return weightedJaccard(scriptStructure(a, jsx), scriptStructure(b, jsx));
}

/* ------------------------------------------------------------------------------------------ CodeSim */

/** CodeSim(C,R): block-weighted similarity of two source files (Vue SFC, TS or JS). Symmetric, in [0,1]. */
export function codeSim(
  candidate: { path: string; content: string },
  reference: { path: string; content: string },
  options: { weights?: SimilarityWeights; abstractIdentifiers?: boolean } = {}
): CodeSimResult {
  const weights = options.weights ?? DEFAULT_WEIGHTS;
  const sum = weights.alpha + weights.beta + weights.gamma;
  if (Math.abs(sum - 1) > 1e-6 || [weights.alpha, weights.beta, weights.gamma].some(w => w < 0)) throw new Error('Weights α, β, γ must be non-negative and sum to 1');
  const abstractIdentifiers = options.abstractIdentifiers ?? true;
  const jsx = /\.(tsx|jsx)$/.test(candidate.path) || /\.(tsx|jsx)$/.test(reference.path);
  const c = splitBlocks(candidate.path, candidate.content), r = splitBlocks(reference.path, reference.content);
  const notes: string[] = [];
  const partial: { name: BlockName; size: number; result: Omit<BlockSimilarity, 'weight'> }[] = [];
  for (const name of ['template', 'script', 'style'] as const) {
    const a = c[name], b = r[name];
    if (a === undefined && b === undefined) continue;
    const ta = a === undefined ? [] : normalizeTokens(name, a, { abstractIdentifiers, jsx });
    const tb = b === undefined ? [] : normalizeTokens(name, b, { abstractIdentifiers, jsx });
    if (ta.length > MAX_LEV_TOKENS || tb.length > MAX_LEV_TOKENS) notes.push(`${name}: lexical layer compared the first ${MAX_LEV_TOKENS} tokens only`);
    let lexical = 0, fingerprint = 0, structural = 0;
    if (a !== undefined && b !== undefined) {
      lexical = lexicalSimilarity(ta, tb);
      fingerprint = jaccard(winnow(ta), winnow(tb));
      structural = structuralSimilarity(name, a, b, jsx);
    } else notes.push(`${name}: present in only one file, scored 0`);
    const score = weights.alpha * lexical + weights.beta * fingerprint + weights.gamma * structural;
    partial.push({ name, size: ta.length + tb.length, result: { tokens: [ta.length, tb.length], lexical: round(lexical), fingerprint: round(fingerprint), structural: round(structural), score: round(score) } });
  }
  const total = partial.reduce((n, p) => n + p.size, 0);
  const blocks: CodeSimResult['blocks'] = {};
  let score = total ? 0 : 1;
  for (const p of partial) {
    const weight = total ? p.size / total : 0;
    blocks[p.name] = { weight: round(weight), ...p.result };
    score += weight * p.result.score;
  }
  return { score: round(score), weights, abstractIdentifiers, blocks, notes };
}

/* ------------------------------------------------------------------------------------- Dup(C) and R */

type RepoFingerprints = { perFile: Map<string, Set<number>>; documentFrequency: Map<number, number>; boilerplateThreshold: number };
const fingerprintCache = new WeakMap<RepositoryIndex, RepoFingerprints>();

/** Fingerprints of a file, salted by block so a template run never matches a script run. */
export function fileFingerprints(file: string, content: string): Set<number> {
  const out = new Set<number>();
  const jsx = /\.(tsx|jsx)$/.test(file);
  for (const [name, code] of Object.entries(splitBlocks(file, content)) as [BlockName, string][]) {
    for (const h of winnow(normalizeTokens(name, code, { abstractIdentifiers: true, jsx }), K_GRAM, WINDOW, name)) out.add(h);
  }
  return out;
}

function repositoryFingerprints(index: RepositoryIndex): RepoFingerprints {
  const cached = fingerprintCache.get(index);
  if (cached) return cached;
  const perFile = new Map<string, Set<number>>();
  const documentFrequency = new Map<number, number>();
  for (const f of index.files) {
    const fp = fileFingerprints(f.path, f.content);
    perFile.set(f.path, fp);
    for (const h of fp) documentFrequency.set(h, (documentFrequency.get(h) ?? 0) + 1);
  }
  // Fingerprints shared by many files are boilerplate (<script setup lang="ts">, defineProps, common imports),
  // not evidence of copying. This mirrors MOSS ignoring "base code" supplied to every student.
  const boilerplateThreshold = Math.max(3, Math.ceil(index.files.length * 0.2));
  const result = { perFile, documentFrequency, boilerplateThreshold };
  fingerprintCache.set(index, result);
  return result;
}

/** Dup(C) and R = 1 − Dup(C) for one proposed file, measured against the indexed repository. */
export function duplicationReport(index: RepositoryIndex, change: { path: string; content: string }, options: { topMatches?: number } = {}): DuplicationReport {
  const repo = repositoryFingerprints(index);
  const notes: string[] = [];
  const all = fileFingerprints(change.path, change.content);
  const fp = new Set([...all].filter(h => (repo.documentFrequency.get(h) ?? 0) < repo.boilerplateThreshold));
  if (all.size !== fp.size) notes.push(`${all.size - fp.size} boilerplate fingerprints ignored (present in ≥ ${repo.boilerplateThreshold} files)`);
  if (fp.size < MIN_FINGERPRINTS) {
    notes.push(`Too little distinctive code to judge duplication (${fp.size} fingerprints, need ${MIN_FINGERPRINTS})`);
    return { path: change.path, fingerprints: fp.size, duplication: 0, reusability: 1, matches: [], notes };
  }
  const resolver = index.resolver ?? loadResolverConfig(index.root);
  const available = new Set(index.files.map(f => f.path));
  available.add(change.path);
  const imported = new Set(parseFile(change.path, change.content).imports.map(spec => resolveImport(change.path, spec, available, resolver)).filter((x): x is string => !!x));
  const matches: DuplicateMatch[] = [];
  for (const [file, other] of repo.perFile) {
    if (file === change.path) continue; // an edited file is not a duplicate of its own previous version
    const coverage = containment(fp, other);
    if (coverage > 0) matches.push({ file, coverage: round(coverage), imported: imported.has(file) });
  }
  matches.sort((a, b) => b.coverage - a.coverage || a.file.localeCompare(b.file));
  const duplication = matches.filter(m => !m.imported).reduce((max, m) => Math.max(max, m.coverage), 0);
  return { path: change.path, fingerprints: fp.size, duplication: round(duplication), reusability: round(1 - duplication), matches: matches.slice(0, options.topMatches ?? 5), notes };
}

/** Repository-level R for a proposal: fingerprint-weighted mean of per-file reusability. */
export function evaluateProposal(index: RepositoryIndex, proposal: { changes: { path: string; content: string }[] }): ProposalEvaluation {
  if (!proposal || !Array.isArray(proposal.changes) || !proposal.changes.length) throw new Error('Proposal must contain at least one change');
  const files = proposal.changes.map(change => {
    if (!change || typeof change.path !== 'string' || typeof change.content !== 'string') throw new Error('Invalid proposal change');
    return duplicationReport(index, change);
  });
  const weight = files.reduce((n, f) => n + (f.notes.some(x => x.startsWith('Too little')) ? 0 : f.fingerprints), 0);
  const reusability = weight ? files.reduce((n, f) => n + (f.notes.some(x => x.startsWith('Too little')) ? 0 : f.fingerprints * f.reusability), 0) / weight : 1;
  return {
    repository: index.root,
    reusability: round(reusability),
    files,
    method: `R = 1 − max_K Cov(C|K)·1[K not imported]; winnowing k=${K_GRAM}, w=${WINDOW} over identifier-abstracted tokens; boilerplate filtered by document frequency`,
    limitations: [
      'Detects copied or lightly edited code (type 1–3 clones), not functionally equivalent rewrites.',
      'An import is credited only if it resolves to an indexed file (relative paths and tsconfig/Vite aliases).',
      'Vue blocks are split with regular expressions, not @vue/compiler-sfc.'
    ]
  };
}
