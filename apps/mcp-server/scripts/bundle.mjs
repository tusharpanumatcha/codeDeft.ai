// Bundles the MCP server, the engine and their dependencies into one file that runs with plain `node`,
// so it can be shipped inside the VS Code extension or run from any folder.
import { build } from 'esbuild';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const file = rel => fileURLToPath(new URL(rel, import.meta.url));
const { version } = JSON.parse(readFileSync(file('../package.json'), 'utf8'));
mkdirSync(file('../dist'), { recursive: true });
await build({
  entryPoints: [file('../src/main.ts')], outfile: file('../dist/codedeft-mcp.mjs'),
  bundle: true, platform: 'node', format: 'esm', target: 'node22',
  // TypeScript (used for parsing) is CommonJS and calls require() for Node built-ins.
  banner: { js: "#!/usr/bin/env node\nimport { createRequire as __cdRequire } from 'node:module'; import { fileURLToPath as __cdPath } from 'node:url'; import { dirname as __cdDir } from 'node:path';\nconst require = __cdRequire(import.meta.url); const __filename = __cdPath(import.meta.url); const __dirname = __cdDir(__filename);" },
  define: { __CODEDEFT_VERSION__: JSON.stringify(version) },
  // The MCP server indexes in memory and never opens the SQLite store; stubbing node:sqlite keeps the
  // bundle free of the experimental-feature warning and runnable on Node versions without node:sqlite.
  plugins: [{ name: 'no-sqlite', setup(b) {
    b.onResolve({ filter: /^node:sqlite$/ }, () => ({ path: 'node:sqlite', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export class DatabaseSync { constructor() { throw new Error("SQLite storage is not available in the codeDeft MCP server"); } }', loader: 'js' }));
  } }],
  legalComments: 'none', logLevel: 'info'
});
