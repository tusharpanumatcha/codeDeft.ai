// codeDeft VS Code extension. Bundled with esbuild (see package.json), so the Figma reader and the
// shared path guard are compiled in and the extension works on any VS Code ≥ 1.90 and when packaged.
import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { readFigma, parseFigmaUrl, type DesignDocument } from '../../../packages/figma-reader/src/index';
import { resolveProposalTarget, proposalPathKey } from '../../../packages/engine/src/safe-path';
import { createApiClient, endpoints, routeChatMessage, ApiError, type GeneratedProposal, type SearchHit, type ReuseUnit } from '../../../packages/protocol/src/index';
import { registerMcpServer, registerAiCommands } from './ai';

type ProposedChange = { path: string; content: string };
type Verification = { errors?: number; warnings?: number; attempts?: number; files?: { path?: string; findings?: { severity?: string; message?: string; line?: number }[] }[] };
type IndependentResult = { decision?: string; approvalRequired?: boolean; proposal?: { changes?: ProposedChange[]; rationale?: string }; verification?: Verification };
declare const __EXTENSION_VERSION__: string;
const EXTENSION_VERSION = typeof __EXTENSION_VERSION__ === 'string' ? __EXTENSION_VERSION__ : 'dev';

const MAX_FILES = 30;
const MAX_FILE_CHARS = 500_000;
/** Server request limit is 4 MB; leave headroom for the rest of the JSON body. */
const MAX_DESIGN_UPLOAD_BYTES = 3_800_000;

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('codeDeft'); context.subscriptions.push(output);
  const root = (): string => { const folder = vscode.workspace.workspaceFolders?.[0]; if (!folder) throw new Error('Open a repository folder in VS Code first'); return folder.uri.fsPath; };
  // One API client per server URL. It negotiates the API version and capabilities with the server once,
  // so a newer or older server turns features off with a clear message instead of failing mid-command.
  const config = () => vscode.workspace.getConfiguration('codedeft');
  const makeApi = () => endpoints(createApiClient({ client: `vscode-extension/${EXTENSION_VERSION}`, baseUrl: config().get<string>('serverUrl', 'http://127.0.0.1:4317'), token: () => config().get<string>('apiToken', '') || undefined }));
  let api = makeApi();
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('codedeft')) api = makeApi(); }));
  const guard = async (fn: () => Promise<unknown>) => {
    try { await fn(); }
    catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (e instanceof ApiError && (e.code === 'network' || e.code === 'incompatible')) {
        const choice = await vscode.window.showErrorMessage(`codeDeft: ${message}`, 'Open Settings');
        if (choice === 'Open Settings') await vscode.commands.executeCommand('workbench.action.openSettings', 'codedeft');
      } else if (!(e instanceof ApiError && e.code === 'aborted')) vscode.window.showErrorMessage(`codeDeft: ${message}`);
    }
  };
  const register = (id: string, fn: () => Promise<unknown>) => context.subscriptions.push(vscode.commands.registerCommand(id, () => guard(fn)));

  // AI assistants: register the codeDeft MCP server for Copilot (when this VS Code supports it) and the setup commands.
  let mcpRegistered = false;
  try { mcpRegistered = registerMcpServer(context); } catch (e) { output.appendLine(`codeDeft: MCP registration skipped: ${e instanceof Error ? e.message : String(e)}`); }
  registerAiCommands(context, mcpRegistered, guard);

  register('codedeft.index', async () => {
    const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'codeDeft indexing repository' }, () => api.index(root()));
    vscode.window.showInformationMessage(`codeDeft indexed ${result?.files ?? 0} files and ${result?.symbols ?? 0} symbols`);
  });

  const askRepository = async (question: string) => {
    const hits: SearchHit[] = await api.search(root(), question);
    output.clear(); output.appendLine(`codeDeft · ${question}\n`);
    for (const hit of hits) { output.appendLine(`${hit.file} (score ${hit.score})`); output.appendLine(`  ${hit.reasons.join(', ')}\n`); }
    if (!hits.length) output.appendLine('No matching files.');
    output.show(true);
    if (!hits.length) return;
    const picked = await vscode.window.showQuickPick(hits.map(h => ({ label: h.file, description: `Score ${h.score}`, detail: h.reasons.join(', '), hit: h })), { placeHolder: 'Select a relevant file to open' });
    if (!picked) return;
    const editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(root(), picked.hit.file))));
    const line = Math.max(0, (picked.hit.symbols?.[0]?.line || 1) - 1);
    editor.revealRange(new vscode.Range(line, 0, line, 0));
  };
  register('codedeft.ask', async () => {
    const question = await vscode.window.showInputBox({ prompt: 'Ask codeDeft about this repository', placeHolder: 'How is authentication implemented?' });
    if (question) await askRepository(question);
  });

  /** Throws unless every change is a new file at a safe path; returns absolute targets. */
  const checkNewFiles = (folder: string, changes: ProposedChange[]): string[] => {
    const seen = new Set<string>();
    return changes.map(change => {
      if (typeof change?.content !== 'string' || !change.content || change.content.length > MAX_FILE_CHARS) throw new Error('Invalid proposed file content');
      const target = resolveProposalTarget(folder, change.path); // same rules as the server: no hidden/config paths, no symlinks
      const key = proposalPathKey(change.path);
      if (seen.has(key)) throw new Error(`Duplicate proposed path: ${change.path}`);
      seen.add(key);
      if (fs.existsSync(target)) throw new Error(`Independent mode refuses to overwrite ${change.path}`);
      return target;
    });
  };

  // Review-first independent workflow. No write occurs without explicit approval.
  const reviewIndependent = async (result: IndependentResult): Promise<boolean> => {
    const changes = result.proposal?.changes;
    if (result.decision !== 'independent' || result.approvalRequired !== true || !Array.isArray(changes)) throw new Error('Invalid independent proposal');
    if (!changes.length || changes.length > MAX_FILES) throw new Error('Invalid proposal size');
    const folder = fs.realpathSync(root());
    checkNewFiles(folder, changes);
    output.clear(); output.appendLine('codeDeft — INDEPENDENT IMPLEMENTATION\n'); output.appendLine('Existing files will remain unchanged.\n');
    output.appendLine(changes.map(c => `CREATE ${c.path} (${Buffer.byteLength(c.content, 'utf8')} bytes)`).join('\n'));
    output.appendLine('\n' + String(result.proposal?.rationale || ''));
    // codeDeft's check of the generated code against the repository (files, exports, packages, duplication).
    const v = result.verification;
    const problems = v && typeof v.errors === 'number' ? v.errors : 0;
    if (v) {
      output.appendLine(`\nRepository check: ${problems ? `${problems} reference${problems === 1 ? '' : 's'} do not exist` : 'all imported files, exports and packages exist'}${(v.attempts ?? 1) > 1 ? ` (after ${(v.attempts ?? 1) - 1} automatic fix round${(v.attempts ?? 1) > 2 ? 's' : ''})` : ''}`);
      for (const f of v.files ?? []) for (const x of f.findings ?? []) output.appendLine(`  ${String(x.severity).toUpperCase()} ${f.path}${x.line ? `:${x.line}` : ''}  ${x.message}`);
    }
    output.show(true);
    for (const change of changes) {
      const language = change.path.endsWith('.vue') ? 'vue' : change.path.endsWith('.tsx') ? 'typescriptreact' : change.path.endsWith('.ts') ? 'typescript' : change.path.endsWith('.js') ? 'javascript' : 'plaintext';
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ language, content: change.content }), { preview: true, preserveFocus: false });
    }
    const warning = problems ? `${problems} reference${problems === 1 ? '' : 's'} in this proposal do not exist in the repository (see the codeDeft output). ` : '';
    const approval = await vscode.window.showWarningMessage(`${warning}Create ${changes.length} new file(s)? Existing files will not be modified. Review codeDeft output and preview tabs first.`, { modal: true }, 'Approve and Create');
    if (approval !== 'Approve and Create') return false;
    // Recheck after approval: another process may have created a file or symlink while the user reviewed.
    const targets = checkNewFiles(folder, changes);
    // Contents are written by the edit itself, so the files on disk are complete without a manual save.
    const edit = new vscode.WorkspaceEdit();
    changes.forEach((change, i) => edit.createFile(vscode.Uri.file(targets[i]!), { overwrite: false, ignoreIfExists: false, contents: Buffer.from(change.content, 'utf8') }));
    if (!await vscode.workspace.applyEdit(edit)) throw new Error('VS Code could not create the proposed files');
    vscode.window.showInformationMessage(`codeDeft: Created ${changes.length} independent file(s). Existing files unchanged.`);
    return true;
  };

  const reuseDiscover = async (prefill?: string) => {
    const requirement = prefill || await vscode.window.showInputBox({ prompt: 'What functionality should codeDeft look for?', placeHolder: 'JWT validation, data table, date formatting, API retry, ...', ignoreFocusOut: true });
    if (!requirement) return;
    const found = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'codeDeft scanning reusable code' }, () => api.discover(root(), requirement, 15));
    if (!found.results.length) { vscode.window.showInformationMessage('codeDeft: No likely reusable code found.'); return; }
    const selected = await vscode.window.showQuickPick(found.results.map((u: ReuseUnit) => ({ label: `${u.name} · ${u.kind}`, description: `${u.file}:${u.startLine} · ${u.score}/100 heuristic`, detail: `Effort: ${u.effort.level} · ${u.reasons.slice(0, 2).join('; ')}`, unit: u })), { placeHolder: 'Select reusable code to inspect (file and line shown)', matchOnDescription: true, matchOnDetail: true });
    if (!selected) return;
    const u = selected.unit;
    const editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(root(), u.file))), { preview: false });
    const range = new vscode.Range(u.startLine - 1, 0, Math.max(u.startLine - 1, u.endLine - 1), 0);
    editor.selection = new vscode.Selection(range.start, range.start); editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    output.clear();
    output.appendLine(`Reusable code: ${u.name}\nLocation: ${u.file}:${u.startLine}-${u.endLine}\nScore: ${u.score}/100 (heuristic)\nDifficulty: ${u.effort.level}\nReasons: ${u.reasons.join('; ')}\nDifficulty factors: ${u.effort.reasons.join('; ')}\nUsed by: ${u.usedBy.join(', ') || 'No cross-file references detected'}\nImports:\n${u.imports.join('\n')}\n\nSOURCE PREVIEW:\n${u.excerpt}`);
    output.show(true);
    const decision = await vscode.window.showQuickPick([{ label: 'Reuse', value: 'reuse' }, { label: 'Extract shared logic', value: 'extract' }, { label: 'Extend', value: 'extend' }, { label: 'Keep independent', value: 'independent' }], { placeHolder: 'Choose an approach (no changes will be applied)' });
    if (!decision) return;
    const targetFile = await vscode.window.showInputBox({ prompt: 'Optional target file path for the new feature (relative to repository)' });
    const plan = await api.decision({ repository: root(), requirement, sourceFile: u.file, targetFile: targetFile || undefined, decision: decision.value as 'reuse' | 'extract' | 'extend' | 'independent' });
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ language: 'json', content: JSON.stringify(plan, null, 2) }), { preview: false });
    if (decision.value !== 'independent') { vscode.window.showInformationMessage('codeDeft: Decision plan ready. No files changed. Automated patches for this option are not implemented yet.'); return; }
    const generate = await vscode.window.showInformationMessage('Independent selected. Generate NEW files for this feature, with preview and explicit approval?', 'Generate proposal');
    if (generate !== 'Generate proposal') return;
    const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'codeDeft generating independent proposal' }, () => api.generateIndependent(root(), requirement));
    await reviewIndependent(result);
  };
  register('codedeft.reuseDiscover', () => reuseDiscover());

  register('codedeft.independent', async () => {
    const task = await vscode.window.showInputBox({ prompt: 'Describe the new feature to implement independently (no changes to existing files)', ignoreFocusOut: true });
    if (!task) return;
    const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'codeDeft generating independent proposal' }, () => api.generateIndependent(root(), task));
    await reviewIndependent(result);
  });

  // Dashboard → VS Code handoff: proposals generated in the browser are fetched by id and go through the
  // same review and approval flow. Also reachable via vscode://codedeft-local.codedeft-vscode/proposal?id=…
  const openProposal = async (id: string) => {
    const stored = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'codeDeft loading proposal' }, () => api.proposal(id.trim()));
    const workspace = fs.realpathSync(root());
    if (stored.repository !== workspace) {
      const go = await vscode.window.showWarningMessage(`This proposal was generated for ${stored.repository}, but the open folder is ${workspace}. Files would be created in the open folder.`, { modal: true }, 'Review Anyway');
      if (go !== 'Review Anyway') return;
    }
    await reviewIndependent(stored.result);
  };
  register('codedeft.openProposal', async () => {
    const id = await vscode.window.showInputBox({ prompt: 'Proposal ID from the codeDeft dashboard', placeHolder: 'p_…', ignoreFocusOut: true, validateInput: v => /^p_[a-f0-9-]{36}$/.test(v.trim()) ? undefined : 'Expected an ID like p_1234abcd-…' });
    if (id) await openProposal(id);
  });
  context.subscriptions.push(vscode.window.registerUriHandler({
    handleUri: uri => guard(async () => {
      if (uri.path !== '/proposal') throw new Error(`Unknown codeDeft link: ${uri.path}`);
      const id = new URLSearchParams(uri.query).get('id') ?? '';
      if (!/^p_[a-f0-9-]{36}$/.test(id)) throw new Error('The link does not contain a valid proposal ID');
      await openProposal(id);
    })
  }));

  register('codedeft.figmaConnect', async () => {
    const pat = await vscode.window.showInputBox({ prompt: 'Figma personal access token (stored securely in VS Code SecretStorage)', password: true, ignoreFocusOut: true });
    if (!pat) return;
    await context.secrets.store('codedeft.figmaPat', pat);
    vscode.window.showInformationMessage('codeDeft: Figma token saved securely. Use codeDeft: Read Figma Design.');
  });
  register('codedeft.figmaDisconnect', async () => { await context.secrets.delete('codedeft.figmaPat'); vscode.window.showInformationMessage('codeDeft: Figma token removed.'); });

  const offerValidation = async (proposal: unknown) => {
    // Without installing dependencies every check would be skipped, so validation is a single explicit opt-in.
    const choice = await vscode.window.showWarningMessage(
      'Validate in a temporary copy of the repository? This installs dependencies (with --ignore-scripts) and runs the repository\'s own typecheck, lint, test and build scripts, which can execute arbitrary code. Only continue for repositories you trust. Your working copy is not modified.',
      { modal: true }, 'Install and Run Checks');
    if (choice !== 'Install and Run Checks') return;
    const validation = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'codeDeft validating in a temporary copy' }, () => api.figmaValidate({ repository: root(), proposal: proposal as GeneratedProposal['proposal'], install: true }));
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ language: 'json', content: JSON.stringify(validation, null, 2) }));
  };

  // URL-first workflow: request credentials only after we know which design to read.
  const readFigmaWorkflow = async (initialUrl?: string) => {
    const url = (initialUrl || await vscode.window.showInputBox({ prompt: 'Paste your Figma file or selected frame URL', placeHolder: 'https://www.figma.com/design/FILE_KEY/Example?node-id=12-45', ignoreFocusOut: true }))?.trim();
    if (!url) return;
    parseFigmaUrl(url); // validate before prompting for credentials
    let pat = await context.secrets.get('codedeft.figmaPat');
    if (!pat) {
      const choice = await vscode.window.showInformationMessage('codeDeft needs a Figma personal access token to read this design. Your token is stored in VS Code SecretStorage.', 'Connect to Figma');
      if (choice !== 'Connect to Figma') return;
      await vscode.commands.executeCommand('codedeft.figmaConnect');
      pat = await context.secrets.get('codedeft.figmaPat');
      if (!pat) return;
    }
    const token = pat;
    const design: DesignDocument = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'codeDeft retrieving Figma design' }, () => readFigma(url, token));
    const serialized = JSON.stringify(design, null, 2);
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ language: 'json', content: serialized }));
    if (Buffer.byteLength(JSON.stringify(design)) > MAX_DESIGN_UPLOAD_BYTES) throw new Error('This design is too large to send to the codeDeft server. Select a single frame in Figma and use "Copy link to selection" so the URL includes node-id.');
    const action = await vscode.window.showInformationMessage(`Extracted ${design.nodeCount} Figma design nodes. Send to codeDeft engine?`, 'Analyze', 'Generate Proposal');
    if (!action) return;
    // The design is sent inline (the PAT never leaves VS Code), which every server version accepts.
    const result: IndependentResult = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'codeDeft analyzing design' }, () => action === 'Analyze' ? api.figmaPlan({ repository: root(), design }) : api.figmaGenerate({ repository: root(), design }));
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ language: 'json', content: JSON.stringify(result, null, 2) }));
    if (action === 'Generate Proposal' && result.proposal) {
      // Validate before approval: once the files exist, independent mode (correctly) refuses the same proposal.
      await offerValidation(result.proposal);
      await reviewIndependent(result);
    }
  };
  register('codedeft.figmaRead', () => readFigmaWorkflow());

  // Lightweight chat entry point until the full chat sidebar is available.
  register('codedeft.chat', async () => {
    const message = await vscode.window.showInputBox({ prompt: 'Ask codeDeft, ask for reusable code, or paste a Figma link', placeHolder: 'figma | Figma frame URL | find reusable … | repository question' });
    if (!message) return;
    // Same router as the web dashboard, so both clients interpret a message identically.
    const route = routeChatMessage(message);
    if (route.intent === 'empty') return;
    if (route.intent === 'figma') return readFigmaWorkflow(route.figmaUrl);
    if (route.intent === 'reuse') return reuseDiscover(route.query);
    await askRepository(route.query);
  });

  register('codedeft.dashboard', async () => {
    const base = vscode.workspace.getConfiguration('codedeft').get<string>('serverUrl', 'http://127.0.0.1:4317');
    await vscode.env.openExternal(vscode.Uri.parse(base));
  });
}

export function deactivate(): void {}
export { mergeInstructions, mergeWorkspaceMcp, COPILOT_INSTRUCTIONS } from './ai';
