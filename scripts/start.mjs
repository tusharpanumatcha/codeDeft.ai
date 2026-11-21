#!/usr/bin/env node
// Pre-flight for `npm start`: refuse to start with missing builds and warn about stale ones, so you never
// get a blank dashboard or an "Unknown API endpoint" from a server built before its source changed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const parts = [
  { name: 'engine', src: 'packages/engine/src', out: 'packages/engine/dist/index.js', required: true, build: 'npm run build:engine' },
  { name: 'protocol', src: 'packages/protocol/src', out: 'packages/protocol/dist/index.js', required: true, build: 'npm run build:protocol' },
  { name: 'Figma reader', src: 'packages/figma-reader/src', out: 'packages/figma-reader/dist/index.js', required: true, build: 'npm run build:figma' },
  { name: 'server', src: 'apps/server/src', out: 'apps/server/dist/index.js', required: true, build: 'npm run build:server' },
  { name: 'dashboard', src: 'apps/web-dashboard/src', out: 'apps/web-dashboard/dist/index.html', required: false, build: 'npm run build:dashboard' }
];

/** Newest modification time of any file under `dir` (iterative walk, no recursion limits). */
function newestMtime(dir) {
  let newest = 0; const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries; try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(current, e.name);
      if (e.isDirectory()) stack.push(full); else if (e.isFile()) newest = Math.max(newest, fs.statSync(full).mtimeMs);
    }
  }
  return newest;
}

const missing = [], stale = [];
for (const p of parts) {
  const out = path.join(root, p.out);
  if (!fs.existsSync(out)) { (p.required ? missing : stale).push(p); continue; }
  // 1 s tolerance: archives and checkouts can give sources and outputs the same timestamp.
  if (newestMtime(path.join(root, p.src)) > fs.statSync(out).mtimeMs + 1000) stale.push(p);
}
if (missing.length) {
  console.error(`codeDeft cannot start: not built yet: ${missing.map(p => p.name).join(', ')}.\nRun:  npm run build`);
  process.exit(1);
}
for (const p of stale) console.warn(fs.existsSync(path.join(root, p.out))
  ? `warning: the ${p.name} build is older than its source. Run "${p.build}" (or "npm run build") to pick up the changes.`
  : `warning: the ${p.name} is not built; the API works but the web page will ask you to build it. Run "${p.build}".`);

await import(pathToFileURL(path.join(root, 'apps/server/dist/index.js')).href);
