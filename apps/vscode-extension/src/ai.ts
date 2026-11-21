// Connects codeDeft to GitHub Copilot and other AI assistants through MCP. codeDeft supplies grounded
// repository context and verification tools; the assistant's own model writes the code.
import * as vscode from 'vscode';
import * as path from 'node:path';

export const MCP_PROVIDER_ID = 'codedeft.context';
const INSTRUCTIONS_START = '<!-- codedeft:start -->';
const INSTRUCTIONS_END = '<!-- codedeft:end -->';

export const COPILOT_INSTRUCTIONS = `${INSTRUCTIONS_START}
## Repository context: use codeDeft

This repository is indexed by codeDeft. Its tools return what really exists here, so use them instead of guessing.

- Before writing or changing code, call **get_task_context** with the task. Build on the files, exports, conventions and reuse candidates it returns.
- Never guess an import path, export name or package. Confirm anything new with **search_code** or **lookup_symbol**.
- Before writing a helper or component, call **find_reusable_code** and reuse what exists.
- Only import packages that are declared in package.json.
- Before finishing, call **verify_code** with every file you created or changed, and fix every error it reports.
${INSTRUCTIONS_END}`;

const serverPath = (context: vscode.ExtensionContext) => context.asAbsolutePath(path.join('dist', 'mcp', 'codedeft-mcp.mjs'));
const nodeCommand = () => vscode.workspace.getConfiguration('codedeft').get<string>('nodePath', 'node') || 'node';
const workspaceRoot = () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

/** True when this VS Code can register MCP servers for Copilot (API added in VS Code 1.101). */
export function canRegisterMcp(): boolean {
  const lm = (vscode as unknown as { lm?: { registerMcpServerDefinitionProvider?: unknown } }).lm;
  return typeof lm?.registerMcpServerDefinitionProvider === 'function' && typeof (vscode as unknown as { McpStdioServerDefinition?: unknown }).McpStdioServerDefinition === 'function';
}

/**
 * Registers the bundled codeDeft MCP server so Copilot agent mode lists its tools automatically, with no
 * configuration. On older VS Code versions this is skipped (no error); the setup command offers .vscode/mcp.json.
 */
export function registerMcpServer(context: vscode.ExtensionContext): boolean {
  if (!canRegisterMcp()) return false;
  const api = vscode as unknown as {
    lm: { registerMcpServerDefinitionProvider(id: string, provider: unknown): vscode.Disposable };
    McpStdioServerDefinition: new (label: string, command: string, args?: string[], env?: Record<string, string | number | null>, version?: string) => { cwd?: vscode.Uri };
  };
  const changed = new vscode.EventEmitter<void>();
  context.subscriptions.push(changed,
    vscode.workspace.onDidChangeWorkspaceFolders(() => changed.fire()),
    vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('codedeft.nodePath')) changed.fire(); }),
    api.lm.registerMcpServerDefinitionProvider(MCP_PROVIDER_ID, {
      onDidChangeMcpServerDefinitions: changed.event,
      provideMcpServerDefinitions: async () => {
        const root = workspaceRoot();
        if (!root) return [];
        const version = String((context.extension?.packageJSON as { version?: string } | undefined)?.version ?? '0');
        const def = new api.McpStdioServerDefinition('codeDeft', nodeCommand(), [serverPath(context)], { CODEDEFT_REPOSITORY: root }, version);
        def.cwd = vscode.Uri.file(root);
        return [def];
      }
    }));
  return true;
}

/** JSON for assistants configured by file (Claude Desktop, Cursor, Copilot CLI, Windsurf, …). */
export function portableConfig(context: vscode.ExtensionContext, root: string | undefined) {
  return { mcpServers: { codedeft: { command: nodeCommand(), args: [serverPath(context)], env: root ? { CODEDEFT_REPOSITORY: root } : {} } } };
}

async function readText(uri: vscode.Uri): Promise<string | undefined> {
  try { return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)); } catch { return undefined; }
}

/** Adds (or refreshes) the codeDeft section in .github/copilot-instructions.md without touching the rest. */
export function mergeInstructions(existing: string | undefined): string {
  if (!existing || !existing.trim()) return `# Copilot instructions\n\n${COPILOT_INSTRUCTIONS}\n`;
  const start = existing.indexOf(INSTRUCTIONS_START), end = existing.indexOf(INSTRUCTIONS_END);
  if (start >= 0 && end > start) return existing.slice(0, start) + COPILOT_INSTRUCTIONS + existing.slice(end + INSTRUCTIONS_END.length);
  return existing.replace(/\s*$/, '\n\n') + COPILOT_INSTRUCTIONS + '\n';
}

/** Adds the codeDeft server to .vscode/mcp.json, keeping other servers. Returns undefined if the file is not plain JSON. */
export function mergeWorkspaceMcp(existing: string | undefined, entry: Record<string, unknown>): string | undefined {
  let config: { servers?: Record<string, unknown>; [k: string]: unknown } = {};
  if (existing && existing.trim()) { try { config = JSON.parse(existing); } catch { return undefined; } }
  config.servers = { ...(config.servers ?? {}), codedeft: entry };
  return JSON.stringify(config, null, 2) + '\n';
}

export function registerAiCommands(context: vscode.ExtensionContext, mcpRegistered: boolean, guard: (fn: () => Promise<unknown>) => Promise<void>) {
  const writeWithApproval = async (uri: vscode.Uri, content: string, what: string) => {
    const preview = await vscode.workspace.openTextDocument({ language: uri.path.endsWith('.json') ? 'json' : 'markdown', content });
    await vscode.window.showTextDocument(preview, { preview: true });
    const ok = await vscode.window.showWarningMessage(`Write ${what} to ${vscode.workspace.asRelativePath(uri)}? The preview shows the full new content.`, { modal: true }, 'Write File');
    if (ok !== 'Write File') return false;
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
    return true;
  };

  context.subscriptions.push(vscode.commands.registerCommand('codedeft.connectAi', () => guard(async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    const items: (vscode.QuickPickItem & { id: string })[] = [
      { id: 'copilot', label: 'GitHub Copilot in VS Code', detail: mcpRegistered ? 'Already connected: codeDeft tools are available in Copilot Chat agent mode.' : 'This VS Code cannot register MCP servers automatically; add codeDeft to .vscode/mcp.json instead.' },
      { id: 'instructions', label: 'Tell Copilot to use codeDeft', detail: 'Adds a short codeDeft section to .github/copilot-instructions.md (your other instructions stay).' },
      { id: 'workspace', label: 'Add codeDeft to .vscode/mcp.json', detail: 'For teammates or VS Code versions without automatic registration.' },
      { id: 'other', label: 'Other assistants (Claude, Cursor, Copilot CLI, …)', detail: 'Copies a ready-to-paste MCP configuration to the clipboard.' }
    ];
    const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Connect codeDeft to an AI assistant', ignoreFocusOut: true });
    if (!pick) return;
    if (pick.id === 'copilot') {
      if (!mcpRegistered) { await vscode.commands.executeCommand('codedeft.connectAi.workspace'); return; }
      const next = await vscode.window.showInformationMessage('codeDeft is connected to Copilot. In Copilot Chat choose Agent mode, then make sure codeDeft is ticked in the tools picker. Its tools are read-only, so Copilot can use them without asking.', 'Also add Copilot instructions');
      if (next) await vscode.commands.executeCommand('codedeft.connectAi.instructions');
      return;
    }
    if (!root && pick.id !== 'other') throw new Error('Open a repository folder first');
    await vscode.commands.executeCommand(`codedeft.connectAi.${pick.id}`);
  })));

  context.subscriptions.push(vscode.commands.registerCommand('codedeft.connectAi.instructions', () => guard(async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri; if (!root) throw new Error('Open a repository folder first');
    const uri = vscode.Uri.joinPath(root, '.github', 'copilot-instructions.md');
    if (await writeWithApproval(uri, mergeInstructions(await readText(uri)), 'the codeDeft instructions')) vscode.window.showInformationMessage('codeDeft: Copilot will now be told to use codeDeft context and verification.');
  })));

  context.subscriptions.push(vscode.commands.registerCommand('codedeft.connectAi.workspace', () => guard(async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri; if (!root) throw new Error('Open a repository folder first');
    const uri = vscode.Uri.joinPath(root, '.vscode', 'mcp.json');
    const merged = mergeWorkspaceMcp(await readText(uri), { type: 'stdio', command: nodeCommand(), args: [serverPath(context)], env: { CODEDEFT_REPOSITORY: '${workspaceFolder}' } });
    if (merged === undefined) {
      await vscode.env.clipboard.writeText(JSON.stringify({ codedeft: { type: 'stdio', command: nodeCommand(), args: [serverPath(context)], env: { CODEDEFT_REPOSITORY: '${workspaceFolder}' } } }, null, 2));
      vscode.window.showWarningMessage('codeDeft: .vscode/mcp.json contains comments, so it was not changed. The codeDeft entry is on your clipboard: paste it inside "servers".');
      return;
    }
    if (await writeWithApproval(uri, merged, 'the codeDeft MCP server')) vscode.window.showInformationMessage('codeDeft: added to .vscode/mcp.json. Start it from the MCP servers list or Copilot\'s tools picker.');
  })));

  context.subscriptions.push(vscode.commands.registerCommand('codedeft.connectAi.other', () => guard(async () => {
    await vscode.env.clipboard.writeText(JSON.stringify(portableConfig(context, workspaceRoot()), null, 2));
    vscode.window.showInformationMessage('codeDeft: MCP configuration copied. Paste it into your assistant\'s MCP settings (for example claude_desktop_config.json, .cursor/mcp.json or ~/.copilot/mcp-config.json).');
  })));
}
