// Cross-platform bundle step (no shell variables), so it behaves the same on macOS, Linux and Windows.
import { build } from 'esbuild';
import { readFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const file = rel => fileURLToPath(new URL(rel, import.meta.url));
const { version } = JSON.parse(readFileSync(file('../package.json'), 'utf8'));
await build({
  entryPoints: [file('../src/extension.ts')], outfile: file('../dist/extension.js'),
  bundle: true, platform: 'node', format: 'cjs', target: 'node18', external: ['vscode'],
  define: { __EXTENSION_VERSION__: JSON.stringify(version) }, logLevel: 'info'
});

// Ship the MCP server inside the extension so Copilot can start it without any other install.
const mcp = file('../../mcp-server/dist/codedeft-mcp.mjs');
if (!existsSync(mcp)) throw new Error('Build the MCP server first: npm --prefix apps/mcp-server run build');
mkdirSync(file('../dist/mcp'), { recursive: true });
copyFileSync(mcp, file('../dist/mcp/codedeft-mcp.mjs'));
