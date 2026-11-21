// codeDeft MCP server. Gives AI assistants (GitHub Copilot agent mode, Claude, Cursor, …) grounded context
// from the repository and a way to check their code against it. Read-only: it never writes files.
// stdout carries the MCP protocol; diagnostics go to stderr only.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { RootsListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import * as z from 'zod';
import { queryRepository, verifyCode, lookupSymbol } from '../../../packages/engine/src/index.ts';
import { findReusable } from '../../server/src/reuse-intelligence.ts';
import { RepositoryCache, chooseRepository } from './repository.ts';
import { buildContextPack, renderContextPack, GROUND_RULES } from './context.ts';

declare const __CODEDEFT_VERSION__: string;
const VERSION = typeof __CODEDEFT_VERSION__ === 'string' ? __CODEDEFT_VERSION__ : 'dev';

export const SERVER_INSTRUCTIONS = [
  'codeDeft knows this repository. Use it so your code matches what really exists here.',
  '1. Before writing or changing code, call get_task_context with the task in plain words. Base your work on the files, exports, conventions and reuse candidates it returns.',
  '2. Never guess an import path, export name or package. If you need something not in the context, call search_code or lookup_symbol first.',
  '3. Prefer reusing what find_reusable_code or the context lists over writing a new version.',
  '4. Before you finish, call verify_code with every file you created or changed and fix every error it reports.',
  'All codeDeft tools are read-only.'
].join('\n');

export function createServer(cache = new RepositoryCache()) {
  const server = new McpServer({ name: 'codedeft', title: 'codeDeft', version: VERSION }, { instructions: SERVER_INSTRUCTIONS });

  // Workspace roots from the client (MCP roots), refreshed when the client says they changed.
  let roots: string[] = [];
  let rootsLoaded = false;
  const loadRoots = async () => {
    if (rootsLoaded || !server.server.getClientCapabilities()?.roots) return;
    try {
      const result = await server.server.listRoots();
      roots = result.roots.filter(r => r.uri.startsWith('file://')).map(r => fileURLToPath(r.uri));
    } catch { roots = []; }
    rootsLoaded = true;
  };
  server.server.oninitialized = () => {
    if (server.server.getClientCapabilities()?.roots?.listChanged) {
      server.server.setNotificationHandler(RootsListChangedNotificationSchema, async () => { rootsLoaded = false; });
    }
  };
  const snapshot = async (repository?: string) => { await loadRoots(); return cache.get(chooseRepository(repository, roots)); };

  const repositoryArg = z.string().optional().describe('Absolute path of the repository. Defaults to the open workspace folder.');
  const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
  const text = (t: string, structured?: Record<string, unknown>) => ({ content: [{ type: 'text' as const, text: t }], ...(structured ? { structuredContent: structured } : {}) });
  const fail = (e: unknown) => ({ isError: true, content: [{ type: 'text' as const, text: `codeDeft: ${e instanceof Error ? e.message : String(e)}` }] });

  server.registerTool('get_task_context', {
    title: 'Get repository context for a task',
    description: 'Call this FIRST for any coding task in this repository. Returns the relevant files with focused excerpts, their exports, the repository conventions, declared packages, import relationships and existing code to reuse, so the code you write uses real files and APIs.',
    inputSchema: { task: z.string().min(3).max(4000).describe('What you are about to build or change, in plain words.'), max_files: z.number().int().min(1).max(12).optional(), max_chars: z.number().int().min(4000).max(80000).optional(), repository: repositoryArg },
    annotations: { title: 'Get codeDeft context', ...readOnly }
  }, async ({ task, max_files, max_chars, repository }) => {
    try {
      const s = await snapshot(repository);
      const pack = buildContextPack(s.index, s.profile, task, { maxFiles: max_files, maxChars: max_chars });
      return text(renderContextPack(pack), pack as unknown as Record<string, unknown>);
    } catch (e) { return fail(e); }
  });

  server.registerTool('search_code', {
    title: 'Search the repository',
    description: 'Finds files related to a question or keywords (ranked by file name, symbol and content matches). Use it before referring to any file you have not seen.',
    inputSchema: { query: z.string().min(1).max(1000), limit: z.number().int().min(1).max(30).optional(), repository: repositoryArg },
    annotations: { title: 'Search code', ...readOnly }
  }, async ({ query, limit, repository }) => {
    try {
      const s = await snapshot(repository);
      const hits = queryRepository(s.index, query, limit ?? 10).map(h => ({ file: h.file, score: h.score, why: h.reasons, exports: h.symbols.filter(x => x.exported).map(x => x.name).slice(0, 15) }));
      const body = hits.length ? hits.map(h => `- ${h.file} (score ${h.score}) · ${h.why.join(', ')}${h.exports.length ? ` · exports: ${h.exports.join(', ')}` : ''}`).join('\n') : 'No matching files. Try other words.';
      return text(body, { query, hits });
    } catch (e) { return fail(e); }
  });

  server.registerTool('find_reusable_code', {
    title: 'Find code to reuse',
    description: 'Finds existing functions, classes and components that already do what you need, with file, line, export status and how widely each is used. Call it before writing a helper or component.',
    inputSchema: { requirement: z.string().min(3).max(2000), limit: z.number().int().min(1).max(20).optional(), repository: repositoryArg },
    annotations: { title: 'Find reusable code', ...readOnly }
  }, async ({ requirement, limit, repository }) => {
    try {
      const s = await snapshot(repository);
      const found = findReusable(s.root, requirement, limit ?? 8);
      const results = found.results.map(r => ({ name: r.name, kind: r.kind, file: r.file, startLine: r.startLine, endLine: r.endLine, exported: r.exported, usedBy: r.usedBy, score: r.score, effort: r.effort.level, excerpt: r.excerpt.slice(0, 1200) }));
      const body = results.length ? results.map(r => `### ${r.name} (${r.kind}) · ${r.file}:${r.startLine}–${r.endLine}\nscore ${r.score} · ${r.exported ? 'exported' : 'not exported'} · used by ${r.usedBy.length} file(s) · effort ${r.effort}\n\`\`\`\n${r.excerpt}\n\`\`\``).join('\n\n') : 'Nothing similar found. Writing new code is reasonable.';
      return text(`${body}\n\n_${found.disclaimer}_`, { requirement, scannedUnits: found.scannedUnits, results });
    } catch (e) { return fail(e); }
  });

  server.registerTool('get_dependencies', {
    title: 'Show a file\'s dependencies',
    description: 'Lists what a file imports and which files import it (resolved through import aliases), so you know what a change affects.',
    inputSchema: { file: z.string().min(1).max(400).describe('Repository-relative path, e.g. src/views/Cart.vue'), repository: repositoryArg },
    annotations: { title: 'Show dependencies', ...readOnly }
  }, async ({ file, repository }) => {
    try {
      const s = await snapshot(repository);
      const target = file.replace(/\\/g, '/').replace(/^\.\//, '');
      if (!s.index.files.some(f => f.path === target)) {
        const near = queryRepository(s.index, path.posix.basename(target).replace(/\.\w+$/, ''), 5).map(h => h.file);
        return text(`${target} is not in the repository index.${near.length ? ` Similar files: ${near.join(', ')}` : ''}`, { file: target, exists: false, similar: near });
      }
      const imports = s.index.edges.filter(e => e.from === target).map(e => e.to);
      const importedBy = s.index.edges.filter(e => e.to === target).map(e => e.from);
      const packages = s.index.files.find(f => f.path === target)!.imports.filter(i => !i.startsWith('.') && !s.index.edges.some(e => e.from === target && i.includes(path.posix.basename(e.to).replace(/\.\w+$/, ''))));
      return text(`## ${target}\nImports (repository): ${imports.join(', ') || 'none'}\nImports (packages/other): ${packages.join(', ') || 'none'}\nImported by: ${importedBy.join(', ') || 'no other file'}`, { file: target, exists: true, imports, importedBy, packages });
    } catch (e) { return fail(e); }
  });

  server.registerTool('lookup_symbol', {
    title: 'Look up a function, class, type or component',
    description: 'Confirms a symbol exists and shows where it is defined, whether it is exported and its declaration line. If it does not exist, suggests the real names you probably meant. Use it before calling or importing anything you have not seen.',
    inputSchema: { name: z.string().min(1).max(200), repository: repositoryArg },
    annotations: { title: 'Look up symbol', ...readOnly }
  }, async ({ name, repository }) => {
    try {
      const s = await snapshot(repository);
      const r = lookupSymbol(s.index, name);
      const body = r.definitions.length
        ? r.definitions.map(d => `- \`${d.name}\` (${d.kind}${d.exported ? ', exported' : ', not exported'}) at ${d.file}:${d.line}\n  \`${d.signature}\``).join('\n')
        : `\`${name}\` does not exist in this repository.${r.suggestions.length ? ` Did you mean: ${r.suggestions.map(x => `\`${x}\``).join(', ')}?` : ' Do not use it.'}`;
      return text(body, r as unknown as Record<string, unknown>);
    } catch (e) { return fail(e); }
  });

  server.registerTool('verify_code', {
    title: 'Verify code against the repository',
    description: 'Checks files you wrote BEFORE you present them: every imported file must exist, every named and default import must really be exported, every package must be declared, and code that copies an existing file is flagged. Returns errors with line numbers and suggested fixes. Call it with every file you created or changed.',
    inputSchema: {
      files: z.array(z.object({ path: z.string().min(1).max(400).describe('Repository-relative path of the file'), content: z.string().max(500_000).describe('Full file content') })).min(1).max(30),
      repository: repositoryArg
    },
    annotations: { title: 'Verify code', ...readOnly }
  }, async ({ files, repository }) => {
    try {
      const s = await snapshot(repository);
      const reports = files.map(f => verifyCode(s.index, f.path, f.content, { siblings: files })); // files in one call may import each other
      const errors = reports.reduce((n, r) => n + r.errors, 0);
      const lines = reports.map(r => [`### ${r.path}: ${r.ok ? (r.warnings ? 'OK with warnings' : 'OK') : 'FIX REQUIRED'}`, r.summary,
        ...r.findings.filter(f => f.severity !== 'info').map(f => `- ${f.severity.toUpperCase()}${f.line ? ` line ${f.line}` : ''}: ${f.message}`)].join('\n'));
      const head = errors ? `${errors} reference${errors === 1 ? '' : 's'} do not exist in this repository. Fix them, then call verify_code again.` : 'All references exist in this repository.';
      return text(`${head}\n\n${lines.join('\n\n')}`, { ok: errors === 0, errors, reports });
    } catch (e) { return fail(e); }
  });

  server.registerTool('get_conventions', {
    title: 'Repository conventions',
    description: 'Frameworks, package manager, import aliases, declared dependencies and detected conventions of the repository, with evidence files.',
    inputSchema: { repository: repositoryArg },
    annotations: { title: 'Get conventions', ...readOnly }
  }, async ({ repository }) => {
    try {
      const s = await snapshot(repository);
      const p = s.profile;
      const body = [`Frameworks: ${p.frameworks.join(', ') || 'not detected'}`, `Package manager: ${p.packageManager ?? 'unknown'}`, `Import aliases: ${p.importAliases.join(', ') || 'none'}`,
        `Declared dependencies: ${Object.keys(p.packages).sort().join(', ') || 'none'}`, `Indexed: ${p.files} files, ${p.symbols} symbols, ${p.dependencies} import edges`,
        ...p.conventions.map(c => `- ${c.description} (evidence: ${c.evidence.slice(0, 4).join(', ')})`)].join('\n');
      return text(body, p as unknown as Record<string, unknown>);
    } catch (e) { return fail(e); }
  });

  // Shows up as a slash command in VS Code chat (e.g. /mcp.codedeft.implement_with_context).
  server.registerPrompt('implement_with_context', {
    title: 'Implement with codeDeft context',
    description: 'Implement a task grounded in this repository: fetch context, reuse what exists, verify before finishing.',
    argsSchema: { task: z.string().describe('What to build or change') }
  }, ({ task }) => ({
    messages: [{ role: 'user', content: { type: 'text', text: [
      `Task: ${task}`, '',
      'Work in this order:',
      '1. Call the codeDeft tool get_task_context with this task.',
      '2. If you need a file, function or component that is not in the context, call search_code, lookup_symbol or find_reusable_code. Do not guess.',
      '3. Write the code, reusing the listed candidates and following the listed conventions.',
      '4. Call verify_code with every file you created or changed. Fix all errors and call it again until it reports none.',
      '5. In your answer, list the files you used as evidence and anything you could not confirm.', '',
      'Rules:', ...GROUND_RULES.map(r => `- ${r}`)
    ].join('\n') } }]
  }));

  return server;
}


// Run as a stdio server when executed directly (not when imported by tests).
// Compare real paths: npm `bin` links and `npx` start us through a symlink.
const invokedDirectly = (() => { try { return !!process.argv[1] && fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1]); } catch { return false; } })();
if (invokedDirectly || process.env.CODEDEFT_MCP_FORCE_START === '1') {
  const server = createServer();
  await server.connect(new StdioServerTransport());
  process.stderr.write(`codeDeft MCP server ${VERSION} ready (repository: ${process.env.CODEDEFT_REPOSITORY || process.cwd()})\n`);
}
