# Changelog

## 0.9.0 — review fixes

**Correctness and safety**
- Server: request bodies are decoded once as bytes, so multi-byte characters split across chunks are no longer corrupted; the 4 MB limit counts bytes and returns HTTP 413 (the body is drained so clients get the response instead of a reset).
- Server: paths are resolved from the server's own file, not the current directory, so it works however it is started. Unexpected errors answer 500 instead of crashing the process; an unbuilt dashboard returns 503 with instructions.
- One shared path rule (`packages/engine/src/safe-path.ts`) for the server, extension and CLI validation: no hidden/config segments (`.git`, `.vscode`, `.github`, `.husky`, `.env*`, `.npmrc`…), no `node_modules`, case-insensitive and Unicode-normalised comparison, symlinked parents and targets refused, case-insensitive duplicate detection.
- Extension: approved files are written with their contents (`WorkspaceEdit.createFile({contents})`) instead of empty files plus unsaved buffers.
- Figma validation: checks can now actually run, behind an explicit opt-in (`install: true`) with a warning. Validation is offered before approval (afterwards the files exist and independent mode refuses them).

**Performance**
- Reuse discovery: cross-file references are computed in one pass over each file's identifiers instead of one regex per unit per file, and scans are cached per repository until files change (1,500 files: 12.1 s → 0.3 s first scan, ~50 ms cached). `/api/reuse/decision` reuses the cache instead of rescanning.
- Generation endpoints use the stored SQLite index when available instead of re-indexing.

**Generation**
- Model replies wrapped in markdown fences or prose are accepted.
- `response_format: json_object` is requested (disable with `CODEDEFT_JSON_MODE=0`) and dropped automatically on HTTP 400.
- Model timeout defaults to 180 s on the server (`CODEDEFT_MODEL_TIMEOUT_MS`), with a clear timeout message.
- Figma plans pick repository files using the design's names and text rather than its JSON field names.

**Figma reader**
- Branch URLs read the branch; designs over 15,000 layers or the server's request limit fail early with a "select a single frame" message.

**Build, types, tests**
- Server and extension are type-checked in strict mode (no `@ts-nocheck`); engine and Figma reader emit `.d.ts` files.
- Extension is bundled with esbuild (no ESM-from-CommonJS `require`, nothing outside the extension folder at runtime, packageable with `vsce`). `activationEvents` removed — VS Code 1.74+ derives them from the contributed commands.
- `npm run build` builds everything; `npm run test:all` runs all suites, and the server tests now start the real server (`apps/server/dist/index.js`). New tests cover UTF-8 bodies, start-up from another directory, 413/invalid JSON, the shared path rule, fenced replies, retrieval queries, opt-in validation, reuse-scan speed and cache invalidation, Figma branch URLs and size limits, and the extension's approval flow (with a fake `vscode` module).
- Token comparison is constant-time. One version (0.9.0) across all packages; `/api/health` reports it from `package.json`. `npm start` hides the `node:sqlite` experimental notice.
- Removed legacy duplicates: `apps/server/index.mjs`, `apps/vscode-extension/extension.cjs`, `apps/web-dashboard/app.js` and `style.css`, and `MIGRATION.md` (superseded by the README).
