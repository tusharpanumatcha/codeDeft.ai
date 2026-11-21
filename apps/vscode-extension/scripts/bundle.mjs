// Cross-platform bundle step (no shell variables), so it behaves the same on macOS, Linux and Windows.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const file = rel => fileURLToPath(new URL(rel, import.meta.url));
const { version } = JSON.parse(readFileSync(file('../package.json'), 'utf8'));
await build({
  entryPoints: [file('../src/extension.ts')], outfile: file('../dist/extension.js'),
  bundle: true, platform: 'node', format: 'cjs', target: 'node18', external: ['vscode'],
  define: { __EXTENSION_VERSION__: JSON.stringify(version) }, logLevel: 'info'
});
