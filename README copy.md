# codeDeft Engine v0.2.0

Standalone Node.js + TypeScript repository intelligence prototype. No UI, model API keys, or network calls.

## Install

Requires Node.js 22+ and npm.

```bash
npm install
npm test
```

## CLI

```bash
npm run build
node dist/cli.js analyze /absolute/path/to/repository
node dist/cli.js analyze /absolute/path/to/repository ./profile.json
node dist/cli.js context /absolute/path/to/repository "implement customer pagination"
```

## Programmatic usage

```ts
import { indexRepository, analyzeRepository, createContextBundle } from '@codedeft/engine';
const index = indexRepository('/absolute/path/to/repo');
const profile = analyzeRepository(index);
const bundle = createContextBundle(index, 'implement customer pagination');
```

## Implemented

- Local JS/TS/JSX/TSX/Vue source scanning with ignored build folders and symlink avoidance.
- TypeScript compiler AST symbol and import extraction; relative file import graph.
- Heuristic detection of Vue, React, NestJS, TypeScript and JavaScript.
- Evidence-linked conventions for Vue script setup, Pinia, React hooks, NestJS decorators and test files.
- Deterministic lexical context retrieval, related file discovery and a JSON context bundle.
- JSON profile export and CLI; two automated tests.

## Limitations

- Heuristic detection is not semantic understanding; confidence values are illustrative, not calibrated.
- Vue scripts are parsed with a basic regex, not the Vue SFC compiler. No template AST analysis.
- No persistent search index, SQLite, vector embeddings, remote GitHub ingestion or agent execution yet.
- Code content in output may include secrets: do not publish or send context bundles externally without review.
- Treat repository text as untrusted evidence, not instructions.

## Roadmap

1. Add Vue compiler SFC parsing and TypeScript project-aware symbol resolution.
2. Persist index in SQLite and support incremental updates.
3. Add hybrid graph + keyword + embedding retrieval.
4. Evaluate context quality against repository-specific coding tasks.

## v0.3 — Repository-aware AI agent (experimental)

Prepare an evidence-linked agent plan **offline**:

```bash
npm run build
node dist/cli.js agent /absolute/path/to/vue-repository "Add customer pagination following existing conventions"
```

To **opt in** to sending selected source excerpts to an OpenAI-compatible model endpoint:

```bash
export CODEDEFT_ENDPOINT="https://YOUR-PROVIDER/v1/chat/completions"
export CODEDEFT_MODEL="YOUR-MODEL"
export CODEDEFT_API_KEY="YOUR-API-KEY"
node dist/cli.js generate /absolute/path/to/vue-repository "Add customer pagination"
```

The endpoint must support the OpenAI chat completions JSON format. Local `http://localhost` endpoints are allowed. The engine does not write generated changes, run tests on generated code, or automatically fix failed generations. **Inspect source excerpts before using `generate`, especially when working with private repositories.** Do not commit API keys. The CLI currently returns the model's proposed solution as JSON.

### Agent API

```ts
import { indexRepository, createAgentPlan, generateWithModel } from '@codedeft/engine';
const index = indexRepository('/path/to/repo');
const plan = createAgentPlan(index, 'Implement customer pagination');
// Optional explicit external request:
// const proposal = await generateWithModel(plan, { endpoint, model, apiKey });
```

### Next engineering milestones

- Real Vue SFC parsing, symbol resolution, and persistent indexing.
- Retrieval evaluation and full-file inspection before edits.
- Structured patch proposals, sandbox validation, and human-approved application.
- Agent orchestration and iterative test/fix loops.

## Validate a proposed change (v0.4 preview)

The `validate` command accepts a JSON proposal with **complete file contents** (not a patch):

```json
{
  "changes": [
    { "path": "src/example.ts", "content": "export const answer = 42;\n" }
  ]
}
```

Save it as `proposal.json`, then run:

```bash
node dist/cli.js validate /absolute/path/to/vue-repo ./proposal.json --install
```

The command copies the repository to a temporary workspace, applies the proposed files there, installs dependencies using npm with lifecycle scripts disabled, and runs available `typecheck`, `lint`, `test`, and `build` package scripts. It returns a JSON report with `passed`, `failed`, or `skipped` for each check. Without `--install`, execution checks are skipped; with `--keep-workspace`, the temporary copy is retained for inspection. **The original repository is not edited.**

**Security:** This is *not* an OS-level sandbox. `npm run` scripts can execute arbitrary commands and access your machine and network. Only use this command on trusted repositories and proposals. The current implementation supports npm-based projects, does not automatically translate LLM free-text responses into proposals, and does not guarantee functional correctness. Human review is required.

## SQLite persistent repository intelligence (v0.5)

Requires Node.js 22.13+; Node 22's built-in `node:sqlite` may print an experimental warning. Node 24 LTS is recommended.

```bash
npm install
npm test
npm run build

# Index and persist a local repository (creates data/codedeft.db)
node dist/cli.js db-index "/Users/tushar/Documents/code-deft-source"

# See stored counts and repository profile
node dist/cli.js db-info "/Users/tushar/Documents/code-deft-source"

# Retrieve context from SQLite, without rescanning the source files
node dist/cli.js db-context "/Users/tushar/Documents/code-deft-source" "How does authentication work?"

# Create an agent plan using persisted repository knowledge
node dist/cli.js db-agent "/Users/tushar/Documents/code-deft-source" "Create a customer management page"

# Optional custom database location; append to any db-* command
node dist/cli.js db-index "/path/to/repo" --db "/path/to/my-codedeft.db"

# Inspect directly
sqlite3 data/codedeft.db '.tables'
sqlite3 data/codedeft.db 'SELECT path FROM files LIMIT 10;'
```

**Important:** The database stores complete indexed source-file contents. Keep it local, protect it as sensitive source material, and do not commit it to Git. Add `data/` and `*.db*` to `.gitignore`. Reindex with `db-index` after source changes; this version replaces the repository snapshot transactionally rather than doing incremental indexing. Database-backed context and agent commands read the stored snapshot, so they can be stale until reindexed. The `analyze`, `context`, `agent`, and `generate` commands retain their previous in-memory behavior. SQLite persistence does not yet include semantic vector search or automated fix loops.
