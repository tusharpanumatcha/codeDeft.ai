// Loads the bundled extension against a minimal fake `vscode` module and drives the
// "Generate Independent Feature" command end to end (server responses are stubbed).
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');

function fakeVscode(state) {
  class FileSystemError extends Error {}
  class WorkspaceEdit { constructor() { this.ops = []; } createFile(uri, options) { this.ops.push({ uri, options }); } }
  return {
    FileSystemError, WorkspaceEdit,
    Uri: { file: p => ({ fsPath: p }), parse: s => s },
    ProgressLocation: { Notification: 15 }, TextEditorRevealType: {}, Range: class {}, Selection: class {}, Position: class {},
    window: {
      createOutputChannel: () => ({ clear() {}, appendLine() {}, show() {}, dispose() {} }),
      showInputBox: async () => state.input,
      showWarningMessage: async (...args) => { state.warnings.push(args[0]); return state.approve; },
      showInformationMessage: async (m) => { state.info.push(m); },
      showErrorMessage: async (m) => { state.errors.push(m); },
      showTextDocument: async () => ({}), showQuickPick: async () => undefined,
      withProgress: async (_o, fn) => fn()
    },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: state.folder } }],
      getConfiguration: () => ({ get: (_k, d) => d }),
      openTextDocument: async () => ({}),
      applyEdit: async (edit) => { state.applied.push(edit); for (const op of edit.ops) fs.mkdirSync(path.dirname(op.uri.fsPath), { recursive: true }), fs.writeFileSync(op.uri.fsPath, op.options.contents); return true; }
    },
    commands: { registerCommand: (id, fn) => { state.commands[id] = fn; return { dispose() {} }; }, executeCommand: async () => {} },
    env: { openExternal: async () => true }
  };
}

function load(state) {
  const original = Module._load;
  Module._load = function (request, ...rest) { return request === 'vscode' ? fakeVscode(state) : original.call(this, request, ...rest); };
  try { const file = require.resolve('../dist/extension.js'); delete require.cache[file]; return require(file); } finally { Module._load = original; }
}

async function run(changes, approve = 'Approve and Create') {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-ext-'));
  const state = { folder, input: 'login form', approve, warnings: [], info: [], errors: [], applied: [], commands: {} };
  const ext = load(state);
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ decision: 'independent', approvalRequired: true, proposal: { changes, rationale: 'r' } }) });
  ext.activate({ subscriptions: [], secrets: { get: async () => undefined, store: async () => {}, delete: async () => {} } });
  await state.commands['codedeft.independent']();
  return { state, folder };
}

test('approved files are written with their full contents (no unsaved buffers)', async () => {
  const { state, folder } = await run([{ path: 'src/NewLogin.vue', content: '<template>é</template>' }]);
  assert.deepEqual(state.errors, []);
  assert.equal(state.applied.length, 1);
  assert.equal(fs.readFileSync(path.join(folder, 'src/NewLogin.vue'), 'utf8'), '<template>é</template>');
  assert.equal(state.applied[0].ops[0].options.overwrite, false);
});
test('cancelling approval creates nothing', async () => {
  const { state, folder } = await run([{ path: 'src/A.ts', content: 'x' }], null);
  assert.equal(state.applied.length, 0); assert.equal(fs.existsSync(path.join(folder, 'src/A.ts')), false);
});
for (const bad of ['.vscode/tasks.json', '.Git/hooks/pre-commit', '.github/workflows/x.yml', 'src/../../x.ts']) {
  test(`unsafe path is refused before any preview: ${bad}`, async () => {
    const { state } = await run([{ path: bad, content: 'x' }]);
    assert.equal(state.applied.length, 0); assert.equal(state.warnings.length, 0);
    assert.match(state.errors[0] ?? '', /Unsafe proposal path|escapes/);
  });
}
test('existing files are never overwritten', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-ext-'));
  fs.writeFileSync(path.join(folder, 'App.vue'), 'original');
  const state = { folder, input: 'x', approve: 'Approve and Create', warnings: [], info: [], errors: [], applied: [], commands: {} };
  const ext = load(state);
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ decision: 'independent', approvalRequired: true, proposal: { changes: [{ path: 'app.VUE', content: 'new' }] } }) });
  ext.activate({ subscriptions: [], secrets: { get: async () => undefined } });
  await state.commands['codedeft.independent']();
  // On case-insensitive file systems app.VUE is App.vue; on Linux it is a new file. Either way App.vue is untouched.
  assert.equal(fs.readFileSync(path.join(folder, 'App.vue'), 'utf8'), 'original');
});
