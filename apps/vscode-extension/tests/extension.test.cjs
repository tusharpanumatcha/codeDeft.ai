// Loads the bundled extension against a minimal fake `vscode` module and drives commands end to end
// with a fake codeDeft server (fetch stub). Covers approval flow, path safety, the dashboard → VS Code
// proposal handoff, the shared chat router, and behaviour against older/newer/absent servers.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');

const CAPS = ['index', 'search', 'graph', 'info', 'reuse.discover', 'reuse.decision', 'reuse.generate', 'figma.plan', 'figma.generate', 'figma.validate', 'figma.read', 'figma.designs', 'proposals'];
const HEALTH_V2 = { ok: true, version: '0.10.0', api: { version: 2, minClient: 1 }, capabilities: CAPS };
const reply = (status, body) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });

function fakeVscode(state) {
  class FileSystemError extends Error {}
  class WorkspaceEdit { constructor() { this.ops = []; } createFile(uri, options) { this.ops.push({ uri, options }); } }
  return {
    FileSystemError, WorkspaceEdit,
    Uri: { file: p => ({ fsPath: p }), parse: s => s },
    ProgressLocation: { Notification: 15 }, TextEditorRevealType: {}, Range: class {}, Selection: class {}, Position: class {},
    window: {
      createOutputChannel: () => ({ clear() {}, appendLine: l => state.output.push(l), show() {}, dispose() {} }),
      showInputBox: async (o) => { state.prompts.push(o?.prompt); return state.inputs.shift(); },
      showWarningMessage: async (...args) => { state.warnings.push(args[0]); return state.approve; },
      showInformationMessage: async (m) => { state.info.push(m); return undefined; },
      showErrorMessage: async (m) => { state.errors.push(m); return undefined; },
      showTextDocument: async () => ({ revealRange() {} }), showQuickPick: async (items) => state.pick ? state.pick(items) : undefined,
      withProgress: async (_o, fn) => fn(),
      registerUriHandler: (h) => { state.uriHandler = h; return { dispose() {} }; }
    },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: state.folder } }],
      getConfiguration: () => ({ get: (_k, d) => d }),
      onDidChangeConfiguration: () => ({ dispose() {} }),
      openTextDocument: async () => ({}),
      applyEdit: async (edit) => { state.applied.push(edit); for (const op of edit.ops) { fs.mkdirSync(path.dirname(op.uri.fsPath), { recursive: true }); fs.writeFileSync(op.uri.fsPath, op.options.contents); } return true; }
    },
    commands: { registerCommand: (id, fn) => { state.commands[id] = fn; return { dispose() {} }; }, executeCommand: async (...a) => { state.executed.push(a); } },
    env: { openExternal: async () => true }
  };
}

function setup({ routes = {}, inputs = [], approve = 'Approve and Create', folder } = {}) {
  folder = folder ?? fs.mkdtempSync(path.join(os.tmpdir(), 'cd-ext-'));
  const state = { folder, inputs: [...inputs], approve, warnings: [], info: [], errors: [], applied: [], commands: {}, prompts: [], output: [], executed: [], calls: [] };
  const original = Module._load;
  Module._load = function (request, ...rest) { return request === 'vscode' ? fakeVscode(state) : original.call(this, request, ...rest); };
  let ext;
  try { const file = require.resolve('../dist/extension.js'); delete require.cache[file]; ext = require(file); } finally { Module._load = original; }
  const all = { '/api/health': () => reply(200, HEALTH_V2), ...routes };
  global.fetch = async (url, init = {}) => {
    const p = new URL(url).pathname; state.calls.push({ path: p, body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers });
    const handler = all[p] ?? Object.entries(all).find(([k]) => k.endsWith('*') && p.startsWith(k.slice(0, -1)))?.[1];
    if (handler === 'down') throw new TypeError('fetch failed');
    return handler ? handler(state.calls.at(-1).body) : reply(404, { error: 'Unknown API endpoint' });
  };
  ext.activate({ subscriptions: [], secrets: { get: async () => undefined, store: async () => {}, delete: async () => {} } });
  return state;
}
const proposalBody = (changes) => ({ decision: 'independent', approvalRequired: true, proposal: { changes, rationale: 'r' }, proposalId: 'p_11111111-1111-1111-1111-111111111111' });
const generate = (changes) => ({ '/api/reuse/independent/generate': () => reply(200, proposalBody(changes)) });

test('approved files are written with their full contents (no unsaved buffers)', async () => {
  const s = setup({ routes: generate([{ path: 'src/NewLogin.vue', content: '<template>é</template>' }]), inputs: ['login form'] });
  await s.commands['codedeft.independent']();
  assert.deepEqual(s.errors, []);
  assert.equal(fs.readFileSync(path.join(s.folder, 'src/NewLogin.vue'), 'utf8'), '<template>é</template>');
  assert.equal(s.applied[0].ops[0].options.overwrite, false);
  assert.match(s.calls.find(c => c.path.includes('generate')).headers['x-codedeft-client'], /^vscode-extension\/0\.10\.0; api=2$/);
});
test('cancelling approval creates nothing', async () => {
  const s = setup({ routes: generate([{ path: 'src/A.ts', content: 'x' }]), inputs: ['x'], approve: null });
  await s.commands['codedeft.independent']();
  assert.equal(s.applied.length, 0); assert.equal(fs.existsSync(path.join(s.folder, 'src/A.ts')), false);
});
for (const bad of ['.vscode/tasks.json', '.Git/hooks/pre-commit', '.github/workflows/x.yml', 'src/../../x.ts']) {
  test(`unsafe path is refused before any preview: ${bad}`, async () => {
    const s = setup({ routes: generate([{ path: bad, content: 'x' }]), inputs: ['x'] });
    await s.commands['codedeft.independent']();
    assert.equal(s.applied.length, 0); assert.equal(s.warnings.length, 0);
    assert.match(s.errors[0] ?? '', /Unsafe proposal path|escapes/);
  });
}
test('existing files are never overwritten', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-ext-')); fs.writeFileSync(path.join(folder, 'App.vue'), 'original');
  const s = setup({ folder, routes: generate([{ path: 'app.VUE', content: 'new' }]), inputs: ['x'] });
  await s.commands['codedeft.independent']();
  assert.equal(fs.readFileSync(path.join(folder, 'App.vue'), 'utf8'), 'original');
});
test('dashboard handoff: a vscode:// link loads the proposal and goes through approval', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-ext-'));
  const stored = { id: 'p_11111111-1111-1111-1111-111111111111', createdAt: '', expiresAt: '', repository: fs.realpathSync(folder), source: 'figma.generate', task: 't', result: proposalBody([{ path: 'src/Checkout.vue', content: '<template/>' }]) };
  const s = setup({ folder, routes: { '/api/proposals/*': () => reply(200, stored) } });
  await s.uriHandler.handleUri({ path: '/proposal', query: 'id=p_11111111-1111-1111-1111-111111111111' });
  assert.deepEqual(s.errors, []);
  assert.equal(fs.readFileSync(path.join(folder, 'src/Checkout.vue'), 'utf8'), '<template/>');
});
test('handoff warns when the proposal belongs to another repository, and rejects bad links', async () => {
  const stored = { id: 'p_11111111-1111-1111-1111-111111111111', repository: '/somewhere/else', result: proposalBody([{ path: 'src/X.ts', content: 'x' }]) };
  const s = setup({ routes: { '/api/proposals/*': () => reply(200, stored) }, approve: null });
  await s.uriHandler.handleUri({ path: '/proposal', query: 'id=p_11111111-1111-1111-1111-111111111111' });
  assert.match(s.warnings[0], /generated for \/somewhere\/else/); assert.equal(s.applied.length, 0);
  await s.uriHandler.handleUri({ path: '/proposal', query: 'id=../../etc' });
  assert.match(s.errors.at(-1), /valid proposal ID/);
});
test('chat: a sentence with a Figma link opens the Figma flow with exactly that link', async () => {
  const s = setup({ inputs: ['Check this https://www.figma.com/design/ABC/x?node-id=1-2 please'] });
  await s.commands['codedeft.chat']();
  assert.deepEqual(s.errors, []);
  assert.match(s.info.at(-1), /needs a Figma personal access token/, 'URL accepted, token requested next');
});
test('chat: "Where is the existing login form?" searches instead of opening reuse', async () => {
  const s = setup({ inputs: ['Where is the existing login form?'], routes: { '/api/search': () => reply(200, { hits: [{ file: 'src/Login.vue', score: 3, reasons: [] }] }) } });
  await s.commands['codedeft.chat']();
  assert.ok(s.calls.some(c => c.path === '/api/search')); assert.ok(!s.calls.some(c => c.path === '/api/reuse/discover'));
});
test('older (API-1) server: existing features keep working, handoff explains it is unsupported', async () => {
  const s = setup({ routes: { '/api/health': () => reply(200, { ok: true, version: '0.9.0' }), ...generate([{ path: 'src/Ok.ts', content: 'x' }]) }, inputs: ['x', 'p_11111111-1111-1111-1111-111111111111'] });
  await s.commands['codedeft.independent']();
  assert.ok(fs.existsSync(path.join(s.folder, 'src/Ok.ts')));
  await s.commands['codedeft.openProposal']();
  assert.match(s.errors.at(-1), /0\.9\.0 does not support proposal handoff/);
});
test('newer server that needs a newer extension: clear message, no crash', async () => {
  const s = setup({ routes: { '/api/health': () => reply(200, { ok: true, version: '3.0.0', api: { version: 9, minClient: 7 } }) }, inputs: ['question'] });
  await s.commands['codedeft.ask']();
  assert.match(s.errors[0], /too old for codeDeft server 3\.0\.0/);
});
test('server not running: clear message with a settings shortcut, no crash', async () => {
  const s = setup({ routes: { '/api/health': 'down' }, inputs: ['question'] });
  await s.commands['codedeft.ask']();
  assert.match(s.errors[0], /did not answer \/api\/health|Cannot reach/);
});
