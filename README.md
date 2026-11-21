
## 🏗️ codeDeft Architecture

**Understand First. Code Better.**

![codeDeft Hybrid Architecture](./assets/codedeft-architecture.png)

### How It Works

1. **VS Code Extension** — Ask questions, generate code, review diffs, and apply changes.
2. **Web Dashboard** — Explore repositories, search code, and visualize dependencies.
3. **API Server** — Connects both interfaces to the codeDeft engine.
4. **codeDeft Engine** — Indexes repositories, retrieves relevant code, and powers AI-assisted development.
5. **SQLite** — Stores indexed files, symbols, and dependencies.
6. **Validation** — Runs type checks, linting, and tests before changes are approved.
