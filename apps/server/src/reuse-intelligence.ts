// Universal, evidence-first reuse discovery. Heuristic extraction; never edits files.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.vue', '.java', '.py', '.go', '.cs', '.kt', '.rs']);
const excluded = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.venv', 'vendor', 'target']);
const stop = new Set(['a', 'an', 'the', 'for', 'with', 'and', 'or', 'to', 'in', 'on', 'of', 'is', 'new', 'create', 'build', 'make', 'implement', 'feature', 'code', 'function', 'component', 'use', 'using', 'that', 'this', 'from', 'into', 'our', 'my', 'please']);
const MAX_FILES = 2500;
const MAX_FILE_BYTES = 300_000;
const tokens = (s: string) => [...new Set((s.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().match(/[a-z][a-z0-9]{2,}/g) || []).filter(x => !stop.has(x)))];

export type CodeUnit = { id: string; file: string; startLine: number; endLine: number; name: string; kind: string; excerpt: string; imports: string[]; exported: boolean; usedBy: string[] };
export type Effort = { level: 'low' | 'medium' | 'high'; reasons: string[] };
export type ReuseOption = 'reuse' | 'extract' | 'extend' | 'independent';
const decisions: ReuseOption[] = ['reuse', 'extract', 'extend', 'independent'];

type FileEntry = { full: string; file: string; size: number; mtimeMs: number };

function walk(root: string): FileEntry[] {
  const files: FileEntry[] = [];
  const visit = (dir: string) => {
    if (files.length >= MAX_FILES) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (e.isSymbolicLink() || excluded.has(e.name) || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) visit(full);
      else if (e.isFile() && extensions.has(path.extname(e.name))) {
        const st = fs.statSync(full);
        if (st.size < MAX_FILE_BYTES) files.push({ full, file: path.relative(root, full).split(path.sep).join('/'), size: st.size, mtimeMs: st.mtimeMs });
      }
      if (files.length >= MAX_FILES) return;
    }
  };
  visit(root);
  return files;
}

const patterns: { kind: string; re: RegExp }[] = [
  { kind: 'function', re: /\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/ },
  { kind: 'class', re: /\b(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/ },
  { kind: 'method', re: /^\s*(?:public\s+|private\s+|protected\s+|static\s+|async\s+)*(\w+)\s*\([^)]*\)\s*(?::[^={]+)?\s*\{/ },
  { kind: 'variable', re: /\b(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/ },
  { kind: 'python', re: /^\s*(?:async\s+)?def\s+(\w+)\s*\(/ },
  { kind: 'java', re: /^\s*(?:public|private|protected)\s+(?:static\s+)?(?:[\w<>?,\[\]]+\s+)+(\w+)\s*\(/ }
];
const keywords = new Set(['if', 'for', 'while', 'switch', 'catch', 'constructor', 'return', 'function']);

function unitsForFile(file: string, source: string): CodeUnit[] {
  const units: CodeUnit[] = [];
  const lines = source.split(/\r?\n/);
  const imports = lines.filter(l => /^\s*(import\s|from\s+\w+\s+import|require\(|use\s+|using\s+)/.test(l)).slice(0, 25).map(l => l.trim().slice(0, 200));
  const add = (name: string, kind: string, i: number, end: number, exported: boolean) => {
    const last = Math.min(lines.length, end);
    units.push({ id: `${file}:${i + 1}:${name}`, file, startLine: i + 1, endLine: last, name, kind, excerpt: lines.slice(i, last).join('\n').slice(0, 7000), imports, exported, usedBy: [] });
  };
  if (path.extname(file) === '.vue') add(path.basename(file, '.vue'), 'vue-component', 0, Math.min(lines.length, 140), true);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const p of patterns) {
      const match = line.match(p.re);
      if (!match?.[1] || keywords.has(match[1])) continue;
      // Source ranges follow brace depth and are capped to bound previews.
      let end = Math.min(lines.length, i + 70); let depth = 0, opened = false;
      for (let j = i; j < Math.min(lines.length, i + 200); j++) {
        for (const c of lines[j]!) { if (c === '{') { depth++; opened = true; } else if (c === '}') depth--; }
        if (opened && depth <= 0) { end = j + 1; break; }
      }
      add(match[1], p.kind, i, end, /\bexport\b|\bpublic\b/.test(line));
      break;
    }
  }
  return units;
}

// Scans are cached per repository and reused while no source file has been added, removed or changed.
const cache = new Map<string, { signature: string; units: CodeUnit[] }>();
const MAX_CACHED_REPOSITORIES = 8;

export function scanCodeUnits(root: string): CodeUnit[] {
  const base = fs.realpathSync(root);
  const files = walk(base);
  const signature = crypto.createHash('sha1').update(files.map(f => `${f.file}\0${f.size}\0${f.mtimeMs}`).join('\n')).digest('hex');
  const cached = cache.get(base);
  if (cached?.signature === signature) return cached.units;

  const units: CodeUnit[] = [];
  const identifiersByFile = new Map<string, Set<string>>();
  for (const f of files) {
    const source = fs.readFileSync(f.full, 'utf8');
    units.push(...unitsForFile(f.file, source));
    identifiersByFile.set(f.file, new Set(source.match(/[A-Za-z_$][\w$]*/g) || []));
  }
  // Cross-file references in one pass over each file's identifiers (approximate usage, not a call graph).
  const names = new Set(units.map(u => u.name));
  const referencedIn = new Map<string, string[]>();
  for (const [file, identifiers] of identifiersByFile) {
    for (const id of identifiers) if (names.has(id)) { const list = referencedIn.get(id); if (list) list.push(file); else referencedIn.set(id, [file]); }
  }
  for (const u of units) u.usedBy = (referencedIn.get(u.name) || []).filter(file => file !== u.file).slice(0, 20);

  cache.delete(base); cache.set(base, { signature, units });
  if (cache.size > MAX_CACHED_REPOSITORIES) cache.delete(cache.keys().next().value!);
  return units;
}

function estimateEffort(u: CodeUnit): Effort {
  const issues: string[] = [];
  if (u.imports.length > 8) issues.push('Many imports');
  if (u.endLine - u.startLine > 100) issues.push('Large code section');
  if (!u.exported) issues.push('Not exported; extraction may be needed');
  if (u.usedBy.length > 5) issues.push('Many existing callers');
  return { level: issues.length >= 2 ? 'high' : issues.length === 1 ? 'medium' : 'low', reasons: issues.length ? issues : ['Limited visible coupling; verify actual behavior'] };
}

export function findReusable(root: string, requirement: string, limit = 10) {
  const query = tokens(requirement);
  if (!query.length) throw new Error('Please describe functionality to search for');
  const units = scanCodeUnits(root);
  const scored = units.map(u => {
    const name = tokens(u.name + ' ' + u.file); const content = tokens(u.excerpt.slice(0, 4500));
    const nameHits = query.filter(t => name.some(n => n === t || n.includes(t) || t.includes(n)));
    const bodyHits = query.filter(t => content.includes(t));
    const score = Math.min(100, Math.round((nameHits.length * 5 + bodyHits.length * 1.3) / Math.max(1, query.length) * 17));
    const reasons = [...nameHits.map(t => `Name/path matches: ${t}`), ...bodyHits.slice(0, 5).map(t => `Source mentions: ${t}`)];
    return { ...u, score, reasons, effort: estimateEffort(u), options: decisions };
  }).filter(u => u.score > 0).sort((a, b) => b.score - a.score || b.usedBy.length - a.usedBy.length).slice(0, Math.min(20, Math.max(1, limit)));
  return { requirement, scannedUnits: units.length, results: scored, disclaimer: 'Lexical heuristic relevance, not verified semantic equivalence. Inspect code, dependencies and tests before reuse.' };
}

export function buildReuseDecision(root: string, input: { decision: unknown; sourceFile?: unknown; targetFile?: unknown; requirement: string }) {
  if (!decisions.includes(input.decision as ReuseOption)) throw new Error('Invalid reuse decision');
  const decision = input.decision as ReuseOption;
  const sourceFile = typeof input.sourceFile === 'string' && input.sourceFile ? input.sourceFile : null;
  const targetFile = typeof input.targetFile === 'string' && input.targetFile ? input.targetFile : null;
  const existing = sourceFile ? scanCodeUnits(root).filter(u => u.file === sourceFile) : [];
  const action = decision === 'independent' ? 'Create separate files; existing code is reference only' : decision === 'extract' ? 'Extract shared logic and update existing callers' : decision === 'extend' ? 'Extend existing implementation with regression checks' : 'Import/call existing implementation when API is compatible';
  return {
    decision, requirement: input.requirement, sourceFile, targetFile, approvalRequired: true, action, sourceEvidence: existing.slice(0, 5),
    constraints: decision === 'independent' ? ['Do not edit existing files', 'Do not import the identified existing implementation', 'Require explicit approval before creating new files'] : ['Show proposed diff', 'Validate affected callers', 'Require explicit approval before applying'],
    note: 'Decision plan only. No files modified.'
  };
}
