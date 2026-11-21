# Changelog

## 0.10.0 — unified web dashboard, production hardening

**Web dashboard** (Reuse Intelligence, Figma-to-Code and Chat, ported onto 0.9 with every 0.9 fix intact)
- Split into one component per view with a shared workspace context; views stay mounted after first visit, so inputs and running work survive tab switches.
- Each panel has an error boundary; requests run through a "latest wins" task hook (cancellable, stale responses can never overwrite newer ones).
- Chat uses a deterministic, tested intent router: a Figma link anywhere in a message is extracted exactly; "existing", "extract" and similar words no longer hijack searches; errors are shown in the conversation.
- Figma designs are referenced by `designId`; JSON views do no work until opened, load lazily, and truncate very large values with a download.
- Proposals are shown file by file (path, size, lines, code, copy) with an **Open in VS Code** handoff, and are cleared whenever the requirement, candidate or decision changes.
- Every input has an associated label; navigation uses `aria-current`; status and errors are announced; focus is visible; motion respects reduced-motion settings.
- Token handling text matches behaviour (cleared after success, kept after failure, never stored or logged).

**Compatibility between server, extension and dashboard**
- New shared `packages/protocol`: wire types, API version and capability negotiation, a resilient HTTP client (timeouts, cancellation, typed `ApiError` codes, response normalisation) and the chat router, used by both clients.
- `/api/health` reports `api.version`, `api.minClient` and `capabilities`; errors carry a stable `code`. API-1 (0.7–0.9) servers and clients keep working: missing features are switched off with an explanation instead of failing.

**Server**
- `POST /api/figma/read`, `GET /api/figma/designs/:id`, `GET /api/proposals/:id`; plan/generate accept `designId` or an inline `design`.
- Bounded LRU stores (entries, bytes, sliding TTL; content-addressed design ids, random proposal ids) keep memory use predictable.
- Figma API errors map to `upstream_error`/`timeout` without ever including the token; `CODEDEFT_FIGMA_API_BASE` for proxies and tests; favicon requests no longer 404.

**VS Code extension**
- Uses the shared client and router; shows "update the server/extension" messages instead of failing on version mismatches, and an **Open Settings** shortcut when the server is unreachable.
- `vscode://codedeft-local.codedeft-vscode/proposal?id=…` handler and **codeDeft: Open Proposal by ID**, with a warning when the proposal was generated for another folder.
- Cross-platform esbuild bundle script embeds the extension version.

**Tooling**
- `npm start` pre-flight: refuses to start with missing builds, warns about builds older than their source.
- Tests: 96 across protocol, server (API-2 end-to-end with fake Figma and model servers), stores, engine, Figma reader, extension and dashboard (vitest + jsdom), plus a manual headless-Chrome pass.

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
