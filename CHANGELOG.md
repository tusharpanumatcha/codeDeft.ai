# Changelog

## 1.0.0 — first stable release

Version 1.0.0 of every package (engine, protocol, figma-reader, server, MCP server, web dashboard, VS Code extension). The local API stays at API version 2, so 0.10–0.13 clients and servers keep working with 1.0.0. Includes everything below.

- **Logo and icon**: code brackets around a check mark ("code, verified"), forest green. Files in `docs/brand/` (SVG with outlined text, PNG 16–1024 px, light/dark/tagline wordmarks, mono and white marks; regenerate with `python3 scripts/logo.py`). Used as the VS Code extension icon, the dashboard favicon and sidebar mark, and the README header.

## 0.13.0 — feature chats (one conversation per feature, stored)

- **Feature chats** replace the separate Reuse, Figma-to-code and Chat pages: each feature is its own conversation with its own context (requirement, Figma frame, reuse decisions, files and dependencies, proposals). Layout matches the approved mockup: features in the sidebar, conversation in the middle, **Feature context** panel (Summary · Design · Reuse · Files · Proposal) on the right; on 1024–1279 px the panel opens as an overlay.
- **Stored on the server** in SQLite (the same `CODEDEFT_DB` file): features, every message, read designs (30 days, `CODEDEFT_DESIGN_RETENTION_DAYS`) and proposals (365 days, `CODEDEFT_PROPOSAL_RETENTION_DAYS`). Conversations survive reloads, restarts and switching browsers; the last open feature per repository is reopened. Search features by name or file; rename, mark done, archive with undo.
- The server routes messages (`/reuse`, `/figma`, `/graph`, `/generate`, a Figma link anywhere in a sentence, or plain questions) and runs generation **in the background**: you can leave a feature while it generates. Generation uses the feature's reuse decisions (reuse = import, never copy) and the verified generate → check → repair loop. A generation interrupted by a restart is marked clearly; a feature analysed before the repository was re-indexed offers "Re-run matching".
- Verifier: files created together in one proposal (or one `verify_code` call) may import each other; their exports are still checked.
- Composer with a keyboard slash menu (combobox/listbox, ↑ ↓ Enter Esc), quick-action chips, `Ctrl K`/`⌘ K`; context tabs with arrow keys. axe-core in Chrome: 0 violations across the flow in all three themes.
- Docs: every guide now opens with an illustration (`docs/images/*.svg`, regenerated with `python3 scripts/illustrations.py`); the README shows the dashboard.
- New API (capability `features`): `GET/POST /api/features`, `GET/POST /api/features/:id`, `POST /api/features/:id/messages|design|reuse|generate|refresh`. Older servers keep working: the dashboard explains that feature chats need an update and the repository pages still work.

## 0.12.0 — AI assistant integration (MCP) and verified generation

- **MCP server** (`apps/mcp-server`, bundled to one file): read-only tools `get_task_context`, `search_code`, `lookup_symbol`, `find_reusable_code`, `get_dependencies`, `get_conventions` and `verify_code`; server instructions telling assistants to fetch context first and verify before finishing; an `implement_with_context` prompt. Works with GitHub Copilot agent mode, Claude, Cursor, Copilot CLI and other MCP clients. The index is kept in memory and refreshed automatically when files change; workspace folders come from MCP roots.
- **Code verifier** (`packages/engine/src/verify.ts`): checks AI-written files for imports of missing files, named or default imports that the module does not export, undeclared packages, and code copied from an existing file; suggests the real names (edit distance + camelCase word overlap). Symbol lookup with "did you mean" suggestions.
- **Context packs** pick the most relevant excerpt of each file (densest window of task terms) within a character budget, and list declared packages, aliases, conventions, relationships and reuse candidates.
- **VS Code**: registers the bundled MCP server with Copilot automatically (VS Code 1.101+, feature-detected; older versions keep working). New command **codeDeft: Connect AI Assistants**: Copilot status, a marked section in `.github/copilot-instructions.md`, `.vscode/mcp.json`, or a portable config for other assistants. Setting `codedeft.nodePath`.
- **codeDeft's own generation** (dashboard and extension) now runs generate → verify → repair: the prompt includes declared packages and grounding rules, every file is verified, remaining problems are sent back to the model once, and the proposal shows the check result. VS Code's approval dialog warns when problems remain.
- Chat participants were not used: VS Code now recommends tools and MCP servers for extending Copilot.

## 0.11.1 — forest green colour scheme

- Light theme is now **Paper · forest green** (warm off-white, deep forest-green accent) and is the default for new users.
- Dark theme is its **forest** partner (deep green-grey, soft green accent); High contrast is unchanged.
- All three themes still pass the WCAG AA contrast test (102 checks) and axe-core in Chrome with 0 violations.

## 0.11.0 — dashboard redesign (Workspace layout), themes, accessibility

- New desktop layout: header with repository switcher (recent repositories, index status), left navigation, always-available chat panel; breakpoints at 1024, 1280 and 1600 px, icon rail and overlay chat on compact screens; no mobile layout (minimum 1024 px).
- Theme stylesheet (`src/styles/tokens.css`, `base.css`, `layout.css`) with Dark, Light and High contrast themes, System mode following OS colour-scheme and contrast settings, and a Text size setting; all sizes in rem.
- Every theme's colour pairs are verified against WCAG 2.2 AA by a test (102 checks); axe-core runs on every page in unit tests and, with colour contrast, in Chrome for all three themes: 0 violations.
- Guided flows: step indicators for Reuse and Figma to code; Figma matches the repository automatically after reading; clear "Next" actions; a Get started checklist; empty states that say what to do.
- Figma token can be kept for the current tab (memory only) instead of being pasted for every read; it is dropped automatically when Figma rejects it.
- Keyboard: skip link, focus moves to the page heading on navigation, `Ctrl K`/`⌘ K` jumps to chat, `Esc` closes menus and the chat overlay with focus returned to the trigger.

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
