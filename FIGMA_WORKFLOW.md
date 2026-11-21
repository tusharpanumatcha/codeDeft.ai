# codeDeft Figma-to-Code (v0.9 preview)

## Setup

```bash
npm --prefix packages/engine install
npm --prefix apps/server install
npm --prefix apps/vscode-extension install
npm --prefix apps/web-dashboard install
npm run build:engine
npm run build:apps
npm start
```

In VS Code, open `apps/vscode-extension` and press F5 to launch the Extension Development Host. Run **codeDeft: Chat (Figma or Repository)** and type `figma`, `connect to figma`, or paste a Figma URL directly. Alternatively run **codeDeft: Read Figma Design**. codeDeft asks for the **Figma frame URL first**; if no PAT is stored, it then prompts to connect and securely enter one. Subsequent reads reuse the saved PAT. The token is kept in VS Code `SecretStorage` and is sent directly from the extension to Figma; it is **never sent to the codeDeft server**.

Use a Figma token with read access to the file. The Figma API may return 403 if permissions/scopes are insufficient.

### Analysis and generation

After reading a design, choose **Analyze** to retrieve repository evidence without calling a model. Choose **Generate Proposal** to use an OpenAI-compatible model endpoint configured on the local server:

```bash
export CODEDEFT_ENDPOINT='https://your-model-provider.example/v1/chat/completions'
export CODEDEFT_MODEL='your-model-name'
export CODEDEFT_API_KEY='your-model-api-key'
npm start
```

The model sees the normalized Figma design summary and bounded repository excerpts. **Inspect the excerpts for secrets before using external models.** Generation produces a JSON proposal, never modifies repository files. Optional validation runs in an isolated temporary copy without installing dependencies, so checks may be skipped. Run full tests yourself on a trusted project.

### API

- `POST /api/figma/plan` with `{repository,design}` → design summary and retrieved repository evidence
- `POST /api/figma/generate` with `{repository,design}` → proposed file changes, reuse/duplication report, and explicit unknown visual/functional relevance
- `POST /api/figma/validate` with `{repository,proposal}` → isolated validation report (no install)

All endpoints use existing loopback-only API host/origin checks and optional `CODEDEFT_TOKEN`. Do not expose this local API on the public internet.

### Not yet implemented

- Full persistent chat sidebar (a command-palette chat entry point with `figma` intent is implemented), OAuth, rendered preview, screenshot diff, automatic repair, visual relevance percentage, native VS Code diff UI, or applying changes.
- The existing reusability score measures fingerprint duplication, **not** design fidelity or semantic component compatibility.

No Figma PAT is stored in the codeDeft database or repo. Disconnect with **codeDeft: Disconnect Figma**.
