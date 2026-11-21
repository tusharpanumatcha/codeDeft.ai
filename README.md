
## 🏗️ codeDeft Architecture

**Understand First. Code Better.**

![codeDeft Hybrid Architecture](./assets/codedeft-architecture.png)

A local-first proof of concept combining the existing v0.5 TypeScript/SQLite repository intelligence engine with a web dashboard and a VS Code extension. The dashboard shows repository metrics, detected conventions, search evidence and import edges. The VS Code extension indexes the current folder, asks repository questions, and opens matching files.

## What's new in v0.7

- **Alias-aware dependency graph.** Imports such as `@/components/BaseInput.vue` now resolve. Aliases are read from `tsconfig.json`/`tsconfig.app.json`/`jsconfig.json` `paths` (following `extends`) and from `vite.config.*` (parsed, never executed). Projects with no alias config get the Vite default `@/ -> src/`. `index.vue` folders, `./file.js` → `file.ts`, and `?raw` suffixes are handled. The detected aliases appear in the repository profile as `importAliases`. **Reindex existing repositories** to rebuild their graphs.
- **Evaluation engine (`evaluation.ts`).** `codedeft compare` computes CodeSim between two files; `codedeft evaluate` computes duplication and the reusability score R for a proposal. See [Evaluation](#evaluation).
- **Local API hardening.** The server rejects requests whose `Host` is not `127.0.0.1:<port>`/`localhost:<port>` (DNS rebinding), rejects foreign `Origin`s, requires `application/json` for POSTs (blocks cross-site "simple" requests), and sends a Content-Security-Policy. The dashboard now works with `CODEDEFT_TOKEN`.
- **Validation no longer leaks secrets.** Repository scripts run with an allow-listed environment (PATH, HOME, temp, locale, proxy and Node toolchain variables), so `CODEDEFT_API_KEY` and other tokens are not visible to them. Proposals may not write `.env.*`, `.npmrc` or `.yarnrc*`.
- **One ranking function.** The CLI `context`/`db-context` commands now use the same retrieval as the server, VS Code extension and agent plans. Two-letter terms such as `db`, `ui` and `id` are searchable.

## Requirements

- Node.js 22.13+ (Node's `node:sqlite` is experimental on Node 22)
- npm
- VS Code 1.90+ (for the extension)

## Run the web dashboard

```bash
# from the extracted codedeft-hybrid folder
npm run build:engine
npm start
```

Open **http://127.0.0.1:4317** in your browser. Enter the absolute path of a repository and click **Index repository**. Then use **Code Intelligence** to search and **Dependency Graph** to inspect imports.

The database is saved in `data/codedeft.db` and ignored by Git.

## Run the VS Code extension

1. Open the `apps/vscode-extension` folder in VS Code.
2. Press **F5** to launch an Extension Development Host. If prompted to select a debugger, choose **Extension Development Host**. The folder includes `.vscode/launch.json`.
3. In the development host, open the repository you want to analyze.
4. Ensure the codeDeft server is running (`npm start` from the project root).
5. Open the Command Palette and run **codeDeft: Index Repository**, then **codeDeft: Ask Repository**.
6. Select a retrieved result to open it in the editor, or run **codeDeft: Open Dashboard**.

The extension uses `http://127.0.0.1:4317` by default; change `codedeft.serverUrl` if needed.

## API

- `GET /api/health`
- `POST /api/index` `{ "repository": "/absolute/path" }`
- `GET /api/info?repository=/absolute/path`
- `POST /api/search` `{ "repository": "/absolute/path", "query": "authentication" }`
- `GET /api/graph?repository=/absolute/path&filter=auth`

Example:

```bash
curl -s http://127.0.0.1:4317/api/health
```

## Evaluation

Build the engine first (`npm run build:engine`). The equations follow the codeDeft proposal:

```
CodeSim(C,R) = Σ_b ω_b [ α·S_lex + β·S_fp + γ·S_ast ]      b ∈ {template, script, style}, default α,β,γ = 0.2, 0.3, 0.5
Cov(C|K)     = |F(C) ∩ F(K)| / |F(C)|
Dup(C)       = max_K Cov(C|K) · 1[K not imported by C]
R            = 1 − Dup(C)
```

| Term | Implementation |
|---|---|
| N(x) | TypeScript scanner tokens (script), tag/attribute tokens (template), CSS tokens (style); comments and formatting removed; identifiers, strings and numbers abstracted to `ID`/`STR`/`NUM` unless `--concrete` |
| S_lex | 1 − token Levenshtein distance / max length (first 4,000 tokens per block) |
| S_fp | Jaccard similarity of winnowing fingerprints (k = 6 tokens, window 4) |
| S_ast | Weighted Jaccard of structural features: parent→child TypeScript AST node kinds, template element nesting and Vue directives, CSS property names. An approximation of normalized tree edit distance |
| ω_b | Block's share of the two files' combined tokens |
| F(·) for Dup | Fingerprints present in ≥ max(3, 20% of files) are treated as boilerplate and ignored; files with < 8 distinctive fingerprints are not judged |

Compare two files (for example, your login page and a generated one):

```bash
node packages/engine/dist/cli.js compare src/views/MyLogin.vue generated/Login.vue
node packages/engine/dist/cli.js compare a.vue b.vue --concrete --weights 0.3,0.3,0.4
```

Measure reusability of a proposal (same JSON format as `validate`):

```bash
node packages/engine/dist/cli.js evaluate /path/to/repo ./proposal.json
node packages/engine/dist/cli.js evaluate /path/to/repo ./proposal.json --db data/codedeft.db
```

Each file reports `duplication`, `reusability`, the closest repository files with their coverage, and whether each is imported. Copying `SharedDataTable.vue` into a new file (even with renamed variables) gives R ≈ 0; importing it gives no penalty.

Reference results on sample login pages: identical files 1.00, same logic with renamed variables and new text 0.90, a different implementation (Options API, reactive state) 0.26.

**Scope:** CodeSim and R measure textual and structural similarity, not behaviour. Functional correctness (F) still comes from `validate`. The weights are starting hypotheses to be calibrated against reviewer ratings. The full RAS score, architecture rules (A), pattern consistency (P) and the refinement loop are not implemented yet.

## Tests

```bash
npm run build:engine
npm run test:all     # root tests (retrieval, server security) + engine tests
```

## Scope and limitations

This is a **functional first vertical slice**, not the entire roadmap. The UI has repository indexing, basic lexical retrieval, evidence excerpts and a dependency list; the extension uses native VS Code commands rather than a chat sidebar. The engine is the original v0.5 source with a small stop-word/authentication normalization improvement. Semantic embeddings, FTS5, project boundary detection, graph canvas, LLM-powered edits, agent session history, auto-fix, the full RAS score and the refinement loop are **not implemented** yet. Search still re-reads stored file contents on every query, so very large repositories will be slow until FTS5 is added. The existing engine's CLI and validation modules remain available. For accurate results, index each application folder separately rather than a parent folder containing multiple projects.

### Security

The server binds to `127.0.0.1` only and does not run arbitrary commands or write source files. It can index any local directory path the user submits, so do not expose it to other users or networks. Requests with a foreign `Host` or `Origin`, and POSTs that are not `application/json`, are refused, which blocks websites in your browser from using the API. Optionally set `CODEDEFT_TOKEN` as defence in depth against other local programs; the dashboard receives it automatically and the VS Code extension needs the same value in `codedeft.apiToken`. Keep the server local. Do not commit database files, secrets or `.env` files.
