import React, { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { App } from '../src/App';
import { WorkspaceProvider } from '../src/state/workspace';
import { PreferencesProvider } from '../src/state/preferences';
import axe from 'axe-core';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { useTask } from '../src/state/useTask';
import { client } from '../src/api';

type Reply = { status?: number; body: unknown };
type Handler = (body: any, path: string, method: string) => Reply | Promise<Reply>;
const CAPS = ['index', 'search', 'graph', 'info', 'reuse.discover', 'reuse.decision', 'reuse.generate', 'figma.plan', 'figma.generate', 'figma.validate', 'figma.read', 'figma.designs', 'proposals', 'features'];
let routes: Record<string, Handler>;
let calls: { path: string; method: string; body: any }[];

/** A small in-memory stand-in for the server's feature API, so the UI is tested against realistic state changes. */
function featureServer(opts: { generateDelayPolls?: number; figmaFails?: boolean } = {}) {
  const now = () => new Date().toISOString();
  type F = { id: string; repository: string; name: string; status: string; archived: boolean; requirement: string; context: any; createdAt: string; updatedAt: string; stale?: boolean };
  const features = new Map<string, F>();
  const messages = new Map<string, any[]>();
  let n = 0; let polls = 0;
  const state = { figmaFails: !!opts.figmaFails };
  const add = (f: F, role: string, kind: string, text: string, payload?: unknown) => { const m = { id: `m${++n}`, featureId: f.id, role, kind, text, payload, createdAt: now(), updatedAt: now() }; messages.get(f.id)!.push(m); f.updatedAt = now(); return m; };
  const detail = (f: F) => ({ body: { feature: f, messages: messages.get(f.id) } });
  const candidates = [
    { id: 'c1', name: 'PayButton', kind: 'vue-component', file: 'src/components/PayButton.vue', startLine: 1, endLine: 3, usedBy: 2, score: 90, excerpt: '<button/>' },
    { id: 'c2', name: 'formatPrice', kind: 'function', file: 'src/utils/money.ts', startLine: 1, endLine: 1, usedBy: 3, score: 80, excerpt: 'export function formatPrice' }
  ];
  const handler: Handler = (body, path, method) => {
    const parts = path.split('/').filter(Boolean); // api, features, id?, action?
    if (parts.length === 2) {
      if (method === 'GET') return { body: { features: [...features.values()].filter(f => !f.archived).map(f => ({ ...f, lastMessage: messages.get(f.id)!.at(-1)?.text })) } };
      const f: F = { id: `f_${String(++n).padStart(8, '0')}-0000-0000-0000-000000000000`, repository: body.repository, name: body.name ?? 'Untitled feature', status: 'exploring', archived: false, requirement: '', context: {}, createdAt: now(), updatedAt: now() };
      features.set(f.id, f); messages.set(f.id, []); return detail(f);
    }
    const f = features.get(decodeURIComponent(parts[2]!));
    if (!f) return { status: 404, body: { error: 'Feature not found' } };
    const action = parts[3];
    if (!action) {
      if (method === 'POST') Object.assign(f, body.name ? { name: body.name } : {}, body.status ? { status: body.status } : {}, body.archived !== undefined ? { archived: body.archived } : {});
      if (f.status === 'generating' && ++polls > (opts.generateDelayPolls ?? 1)) {
        const g = messages.get(f.id)!.find(m => m.kind === 'generating')!;
        Object.assign(g, { kind: 'proposal', text: 'Proposal v1 · 2 new files', payload: { proposalId: 'p_11111111-1111-1111-1111-111111111111', version: 1, reuses: ['c1'], files: [{ path: 'src/views/Checkout.vue', lines: 9 }, { path: 'src/components/OrderSummary.vue', lines: 4 }], verification: { ok: true, errors: 0, attempts: 2 } } });
        f.status = 'proposal_ready';
        f.context.proposals = [{ id: 'p_11111111-1111-1111-1111-111111111111', version: 1, files: ['src/views/Checkout.vue', 'src/components/OrderSummary.vue'], ok: true, errors: 0, createdAt: now() }];
      }
      return detail(f);
    }
    if (action === 'messages') {
      const text: string = body.text;
      add(f, 'user', 'text', text);
      if (f.name === 'Untitled feature') f.name = text.replace(/https?:\S+/g, '').trim().slice(0, 40);
      f.requirement ||= text;
      const url = text.match(/https:\/\/\S*figma\.com\S*/)?.[0];
      if (url) add(f, 'assistant', 'design_request', 'Paste a Figma token to read this frame.', { url });
      else if (/^\/?reuse|reusable/i.test(text)) { f.context.reuse = { query: text, candidates, choices: {} }; f.status = 'deciding'; add(f, 'assistant', 'reuse', '2 reuse candidates', { candidates: ['c1', 'c2'] }); }
      else if (/^\/generate|generate/i.test(text)) { f.status = 'generating'; add(f, 'assistant', 'generating', 'Generating proposal v1…'); }
      else add(f, 'assistant', 'search', '1 related file', { hits: [{ path: 'src/views/CartView.vue', why: ['Name/path matches'] }] });
      return detail(f);
    }
    if (action === 'design') {
      if (state.figmaFails) return { status: 502, body: { error: 'Figma API HTTP 403 (check the token and that it can read this file)', code: 'upstream_error' } };
      f.context.design = { designId: 'd_' + 'a'.repeat(32), name: 'Checkout', url: body.url, nodeCount: 9, components: 6, texts: ['Pay now'] };
      add(f, 'assistant', 'design', 'Design read · Checkout', { name: 'Checkout', nodeCount: 9, components: 6, closest: ['src/components/PayButton.vue'] });
      return detail(f);
    }
    if (action === 'reuse') { f.context.reuse.choices = { ...f.context.reuse.choices, ...body.choices }; return detail(f); }
    if (action === 'generate') { f.status = 'generating'; add(f, 'assistant', 'generating', 'Generating proposal v1…'); return detail(f); }
    if (action === 'refresh') { f.stale = false; f.context.analysedAt = now(); return detail(f); }
    return { status: 404, body: { error: 'Unknown' } };
  };
  return { handler, features, messages, state };
}

function mockServer(overrides: Record<string, Handler> = {}) {
  routes = { '/api/health': () => ({ body: { ok: true, version: '1.0.0', api: { version: 2, minClient: 1 }, capabilities: CAPS } }), ...overrides };
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input, 'http://localhost'); const path = url.pathname; const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, method, body });
    const handler = routes[path] ?? Object.entries(routes).filter(([k]) => k.endsWith('*') && path.startsWith(k.slice(0, -1))).sort((a, b) => b[0].length - a[0].length)[0]?.[1];
    const r = handler ? await handler(body, path, method) : { status: 404, body: { error: 'Unknown API endpoint' } };
    const status = r.status ?? 200;
    return { ok: status < 400, status, text: async () => JSON.stringify(r.body) } as Response;
  }));
}
const withFeatures = (fs = featureServer(), extra: Record<string, Handler> = {}) => { mockServer({ '/api/features': fs.handler, '/api/features/*': fs.handler, ...extra }); return fs; };

function renderApp() {
  return render(<PreferencesProvider><WorkspaceProvider><App /></WorkspaceProvider></PreferencesProvider>);
}
const sidebar = () => within(screen.getByRole('navigation', { name: 'Features and repository' }));
const thread = () => within(screen.getByRole('log'));
const type = async (label: string | RegExp, value: string, root: HTMLElement = document.body) => fireEvent.change(await within(root).findByLabelText(label), { target: { value } });
const send = async (text: string) => { await type('Message', text); fireEvent.click(screen.getByRole('button', { name: 'Send message' })); };
async function newFeature() {
  fireEvent.click(await sidebar().findByRole('button', { name: /New feature/ }));
  await screen.findByText('What are you building?');
}

beforeEach(() => { localStorage.setItem('codedeft-repo', '/repo'); client.invalidate(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

describe('feature chats', () => {
  it('creates a feature, names it from the first message and lists it in the sidebar with its status', async () => {
    const fs = withFeatures(); renderApp();
    expect(await screen.findByText(/Start your first feature/)).toBeTruthy();
    await newFeature();
    await send('Where is the cart view?');
    expect(await thread().findByText('src/views/CartView.vue')).toBeTruthy();
    expect(await sidebar().findByRole('button', { name: /Where is the cart view\?/ })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Where is the cart view?' })).toBeTruthy();
    expect(fs.features.size).toBe(1);
    expect(calls.find(c => c.path === '/api/features' && c.method === 'POST')!.body.repository).toBe('/repo');
  });

  it('reads a Figma frame from a link in a sentence, keeping the token only after it works', async () => {
    const fs = withFeatures(featureServer({ figmaFails: true })); renderApp(); await newFeature();
    await send('Build checkout from https://www.figma.com/design/ABC/Shop?node-id=12-45 please');
    await type('Figma personal access token', 'figd_secret');
    fireEvent.click(await screen.findByRole('button', { name: 'Read frame' }));
    expect(await screen.findByText(/HTTP 403/)).toBeTruthy();
    expect((screen.getByLabelText('Figma personal access token') as HTMLInputElement).value).toBe('figd_secret');
    fs.state.figmaFails = false;
    fireEvent.click(screen.getByRole('button', { name: 'Read frame' }));
    expect(await thread().findByText('Design read · Checkout')).toBeTruthy();
    const read = calls.filter(c => c.path.endsWith('/design')).at(-1)!;
    expect(read.body).toEqual({ url: 'https://www.figma.com/design/ABC/Shop?node-id=12-45', token: 'figd_secret' });
    expect(JSON.stringify({ ...localStorage })).not.toContain('figd_secret');
    expect(within(screen.getByRole('complementary')).getByText(/Checkout/)).toBeTruthy();
  });

  it('records reuse decisions from the panel, then generates in the background and shows the verified proposal', async () => {
    withFeatures(); renderApp(); await newFeature();
    await send('find reusable pay button');
    fireEvent.click(await thread().findByRole('button', { name: 'Compare in panel' }));
    const panel = within(screen.getByRole('tabpanel'));
    const pay = (await panel.findByText('PayButton')).closest('fieldset')!;
    fireEvent.click(within(pay).getByLabelText('Reuse'));
    await waitFor(() => expect(calls.some(c => c.path.endsWith('/reuse') && c.body.choices.c1 === 'reuse')).toBe(true));
    expect(await thread().findByText(/Reuse$/)).toBeTruthy();
    await send('/generate');
    expect(await thread().findByText('Generating proposal v1…')).toBeTruthy();
    expect((screen.getByLabelText('Message') as HTMLInputElement).disabled).toBe(true);
    expect(await thread().findByText('Proposal v1 · 2 new files', {}, { timeout: 6000 })).toBeTruthy();
    expect(thread().getByText(/Checked: every import, export and package exists \(after an automatic fix\)/)).toBeTruthy();
    expect(thread().getByRole('link', { name: 'Open in VS Code' }).getAttribute('href')).toBe('vscode://codedeft-local.codedeft-vscode/proposal?id=p_11111111-1111-1111-1111-111111111111');
    expect(sidebar().getByText('Proposal ready')).toBeTruthy();
  }, 10000);

  it('reopens the last feature of the repository after a reload (the conversation is stored on the server)', async () => {
    withFeatures(); const first = renderApp(); await newFeature();
    await send('Where is the cart view?');
    await thread().findByText('src/views/CartView.vue');
    first.unmount();
    renderApp();
    expect(await screen.findByRole('heading', { level: 1, name: 'Where is the cart view?' })).toBeTruthy();
    expect(await thread().findByText('src/views/CartView.vue')).toBeTruthy();
  });

  it('renames, marks done and archives with undo', async () => {
    withFeatures(); renderApp(); await newFeature();
    await send('Where is the cart view?'); await thread().findByText('src/views/CartView.vue');
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    await type('Feature name', 'Cart lookup');
    fireEvent.submit(screen.getByLabelText('Feature name').closest('form')!);
    expect(await screen.findByRole('heading', { level: 1, name: 'Cart lookup' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }));
    expect(await screen.findByRole('button', { name: 'Reopen' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    expect(await sidebar().findByRole('button', { name: /Cart lookup/ })).toBeTruthy();
  });
});

describe('keyboard', () => {
  it('the slash menu opens on "/", moves with arrows and inserts the chosen action', async () => {
    withFeatures(); renderApp(); await newFeature();
    const input = screen.getByLabelText('Message') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '/' } });
    const list = await screen.findByRole('listbox', { name: 'Actions' });
    expect(input.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const selected = within(list).getAllByRole('option').find(o => o.getAttribute('aria-selected') === 'true')!;
    expect(input.getAttribute('aria-activedescendant')).toBe(selected.id);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.value).toMatch(/^\/figma/);
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.change(input, { target: { value: '/' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });
  it('context tabs follow the arrow keys (roving focus)', async () => {
    withFeatures(); renderApp(); await newFeature();
    await waitFor(() => expect(document.activeElement?.classList.contains('composer-input')).toBe(true)); // new features start in the message box
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map(t => t.textContent)).toEqual(['Summary', 'Design', 'Reuse', 'Files', 'Proposal']);
    tabs[0]!.focus(); fireEvent.keyDown(tabs[0]!, { key: 'ArrowRight' });
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Design'));
    expect(screen.getByRole('tab', { name: 'Design' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Proposal'));
  });
  it('Ctrl+K focuses the message box', async () => {
    withFeatures(); renderApp(); await newFeature();
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    await waitFor(() => expect(document.activeElement?.classList.contains('composer-input')).toBe(true));
  });
});

describe('version compatibility (no crashes)', () => {
  it('explains that an older server has no feature chats, while repository pages keep working', async () => {
    mockServer({ '/api/health': () => ({ body: { ok: true, version: '0.12.0', api: { version: 2, minClient: 1 }, capabilities: CAPS.filter(c => c !== 'features') } }), '/api/search': () => ({ body: { hits: [] } }) });
    renderApp();
    expect(await screen.findByText('Feature chats need a newer codeDeft server')).toBeTruthy();
    fireEvent.click(sidebar().getByRole('button', { name: 'Search code' }));
    await type('Question', 'auth');
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('0 results')).toBeTruthy();
  });
  it('refuses calmly when the server needs a newer client', async () => {
    mockServer({ '/api/health': () => ({ body: { ok: true, version: '9.0.0', api: { version: 9, minClient: 5 } } }) });
    renderApp();
    expect(await screen.findByText(/This client is too old/)).toBeTruthy();
  });
  it('shows a retry when the server is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    renderApp();
    expect(await screen.findByText(/did not answer \/api\/health/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
  it('survives malformed feature responses', async () => {
    mockServer({ '/api/features': (_b, _p, m) => m === 'GET' ? { body: { features: [{ junk: true }, null, { id: 'f_x', name: 7 }] } } : { body: { nope: true } } });
    renderApp();
    expect(await sidebar().findByRole('button', { name: /Untitled feature/ })).toBeTruthy();
    fireEvent.click(sidebar().getByRole('button', { name: /New feature/ }));
    expect(await screen.findByText(/invalid feature/)).toBeTruthy();
  });
});

describe('preferences', () => {
  it('applies theme and text size to <html>, persists them, and offers high contrast', async () => {
    withFeatures(); renderApp();
    fireEvent.click(await screen.findByRole('button', { name: /Appearance/ }));
    fireEvent.click(screen.getByLabelText('High contrast'));
    fireEvent.click(screen.getByLabelText('Larger (125%)'));
    expect(document.documentElement.dataset.theme).toBe('contrast');
    expect(document.documentElement.dataset.textSize).toBe('larger');
    expect(JSON.parse(localStorage.getItem('codedeft-preferences')!)).toMatchObject({ theme: 'contrast', textSize: 'larger' });
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toMatch(/Appearance/));
  });
  it('remembers recent repositories and switches between them', async () => {
    localStorage.setItem('codedeft-recent-repos', JSON.stringify(['/repo', '/other/project']));
    withFeatures(undefined, { '/api/info': () => ({ body: { stats: { files: 5, symbols: 9, dependencies: 1, conventions: 0, indexedAt: new Date().toISOString() } } }) });
    renderApp();
    fireEvent.click(await screen.findByRole('button', { name: /Repository: repo\b/ }));
    fireEvent.click(screen.getByRole('button', { name: /^project/ }));
    expect(await screen.findByRole('button', { name: /Repository: project\W+indexed just now/ })).toBeTruthy();
  });
});

describe('resilience and accessibility', () => {
  it('a crashing panel is contained by its error boundary', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const Boom = () => { throw new Error('kaboom'); };
    render(<div><ErrorBoundary name="Test"><Boom /></ErrorBoundary><p>still here</p></div>);
    expect(screen.getByRole('alert').textContent).toContain('kaboom');
    expect(screen.getByText('still here')).toBeTruthy();
    spy.mockRestore();
  });
  it('a slow, superseded request never overwrites a newer result (latest wins)', async () => {
    const resolvers: ((v: string) => void)[] = [];
    function Probe() {
      const t = useTask<string>();
      useEffect(() => { void t.run(() => new Promise(r => resolvers.push(r))); void t.run(() => new Promise(r => resolvers.push(r))); }, []); // eslint-disable-line
      return <p>{t.data ?? 'pending'}</p>;
    }
    render(<Probe />);
    await waitFor(() => expect(resolvers.length).toBe(2));
    resolvers[1]!('second'); await screen.findByText('second');
    resolvers[0]!('first'); await new Promise(r => setTimeout(r, 10));
    expect(screen.getByText('second')).toBeTruthy();
  });
  it('has a skip link and landmarks', async () => {
    withFeatures(); renderApp(); await newFeature();
    expect(screen.getByRole('link', { name: 'Skip to main content' }).getAttribute('href')).toBe('#main');
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getByRole('complementary')).toBeTruthy();
    expect(screen.getByRole('log')).toBeTruthy();
  });
  it('passes axe-core checks on the feature view and repository pages (contrast is checked in the theme test and in Chrome)', async () => {
    withFeatures(undefined, { '/api/info': () => ({ body: { stats: { files: 5, symbols: 9, dependencies: 1, conventions: 0 } } }) });
    const { container } = renderApp();
    const check = async (label: string) => {
      await waitFor(() => expect(screen.queryByText(/Connecting to the codeDeft server/)).toBeNull());
      const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
      expect(result.violations.map(v => `${label}: ${v.id} ${v.nodes.map(n => n.target).join(' ')}`)).toEqual([]);
    };
    await screen.findByText(/Start your first feature/); await check('empty');
    await newFeature(); await check('new feature');
    await send('find reusable pay button'); await thread().findByText('2 reuse candidates');
    fireEvent.click(screen.getByRole('tab', { name: 'Reuse' })); await check('reuse tab');
    for (const page of ['Overview', 'Search code', 'Full dependency graph']) {
      fireEvent.click(sidebar().getByRole('button', { name: page })); await check(page);
    }
  });
});
