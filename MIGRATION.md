# codeDeft v0.8 — TypeScript/React migration (first pass)

## Included
- Existing v0.7 engine, tests, CLI, storage and retrieval preserved unchanged.
- Local API ported to `apps/server/src/index.ts`; existing endpoints and security checks retained.
- VS Code extension commands ported to `apps/vscode-extension/src/extension.ts`.
- React + TypeScript dashboard with Overview, Code Intelligence and Dependency Explorer.
- Original JavaScript files remain as reference/fallback during migration.

## Requirements
Node.js 22.13+ and npm.

## Setup
```bash
npm run build:engine
npm --prefix apps/server install
npm --prefix apps/vscode-extension install
npm --prefix apps/web-dashboard install
npm run build:apps
npm start
```
Open http://127.0.0.1:4317. In VS Code, open `apps/vscode-extension` and press F5 with an Extension Development Host launch configuration, or package with vsce.

## Status and known limitations
This is a **migration foundation**, not a fully completed v0.8 AI agent. Server and extension ports use `// @ts-nocheck` to preserve behavior; strict typing and route/command decomposition are follow-up tasks. The dashboard is React/TSX, but graph visualization remains a dependency list. No new FTS5, embeddings, agent edit workflow, or validation UI is included.

The API serves the built React dashboard if `apps/web-dashboard/dist/index.html` exists, otherwise it falls back to the legacy dashboard.
