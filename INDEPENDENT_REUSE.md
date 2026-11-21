# Independent component decision (codeDeft)

Use **codeDeft: Generate Independent Feature (Review First)** from the VS Code Command Palette.

The engine retrieves existing repository context for conventions, but instructs the model to create **new files only**, without importing or extracting existing application form/component implementations. The server rejects generated proposals that target existing files or unsafe paths: anything outside the repository, `node_modules`, or any hidden/config segment starting with `.` (`.git`, `.vscode`, `.github`, `.husky`, `.env*`, `.npmrc`…). Paths are compared case-insensitively, matching macOS and Windows file systems; the server and extension share this rule (`packages/engine/src/safe-path.ts`). The VS Code extension shows all proposed paths in the codeDeft Output panel, opens each proposed file in an unsaved preview, and asks for explicit **Approve and Create** confirmation. Cancelling makes no changes. Before applying, the extension rechecks that no proposed file already exists. VS Code WorkspaceEdit creates the files with their full contents and overwrite disabled, so they are complete on disk without a manual save, and the creation can be undone with Undo.

This mode is also used by the Figma Generate Proposal workflow. No existing file may be edited in independent mode. Integration into an existing router or parent component is deliberately not automatic; the developer must review that integration separately.

Set `CODEDEFT_API_KEY`, `CODEDEFT_MODEL`, and `CODEDEFT_ENDPOINT` for AI generation. The local server must be running. The server returns proposals only and has no apply endpoint.

**Limitations:** Reuse avoidance in generated source is an LLM instruction, not a full static proof. Review imports in previews. The VS Code extension's approval action is the only supported apply path. WorkspaceEdit may fail if directories cannot be created or the workspace is read-only.
