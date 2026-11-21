import React, { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { App } from '../src/App';
import { WorkspaceProvider } from '../src/state/workspace';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { useTask } from '../src/state/useTask';
import { client } from '../src/api';

type Handler = (body: any, url: string) => { status?: number; body: unknown } | Promise<{ status?: number; body: unknown }>;
const CAPS = ['index', 'search', 'graph', 'info', 'reuse.discover', 'reuse.decision', 'reuse.generate', 'figma.plan', 'figma.generate', 'figma.validate', 'figma.read', 'figma.designs', 'proposals'];
let routes: Record<string, Handler>;
let calls: { path: string; body: any }[];
function mockServer(overrides: Record<string, Handler> = {}) {
  routes = { '/api/health': () => ({ body: { ok: true, version: '0.10.0', api: { version: 2, minClient: 1 }, capabilities: CAPS } }), ...overrides };
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit = {}) => {
    const path = new URL(input, 'http://localhost').pathname;
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, body });
    const handler = routes[path] ?? Object.entries(routes).find(([k]) => k.endsWith('*') && path.startsWith(k.slice(0, -1)))?.[1];
    const r = handler ? await handler(body, path) : { status: 404, body: { error: 'Unknown API endpoint' } };
    const status = r.status ?? 200;
    return { ok: status < 400, status, text: async () => JSON.stringify(r.body) } as Response;
  }));
}
const unit = (name: string, file = `src/${name}.ts`) => ({ id: `${file}:1:${name}`, file, name, kind: 'function', startLine: 1, endLine: 3, excerpt: `function ${name}(){}`, imports: [], usedBy: [], score: 80, reasons: ['Name/path matches'], effort: { level: 'low', reasons: [] } });
const generated = (path: string, id = 'p_11111111-1111-1111-1111-111111111111') => ({ decision: 'independent', approvalRequired: true, proposal: { changes: [{ path, content: 'line1\nline2' }], rationale: 'because' }, proposalId: id });

function renderApp() {
  return render(<WorkspaceProvider><App /></WorkspaceProvider>);
}
const nav = (label: string) => fireEvent.click(screen.getByRole('button', { name: label }));
const type = (label: string | RegExp, value: string, root: HTMLElement = document.body) => fireEvent.change(within(root).getByLabelText(label), { target: { value } });

beforeEach(() => { localStorage.setItem('codedeft-repo', '/repo'); client.invalidate(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

describe('chat routing (#3)', () => {
  it('opens Figma with exactly the link from a sentence', async () => {
    mockServer(); renderApp(); nav('Chat');
    type('Message', 'Check this https://www.figma.com/design/ABC/x?node-id=1-2 please');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Figma-to-Code'));
    expect((screen.getByLabelText('Figma file or frame URL') as HTMLInputElement).value).toBe('https://www.figma.com/design/ABC/x?node-id=1-2');
  });
  it('treats "Where is the existing login form?" as a search, not reuse', async () => {
    mockServer({ '/api/search': () => ({ body: { hits: [{ file: 'src/LoginForm.vue', score: 9, reasons: [] }] } }) });
    renderApp(); nav('Chat');
    type('Message', 'Where is the existing login form?'); fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(/src\/LoginForm\.vue/)).toBeTruthy();
    expect(calls.some(c => c.path === '/api/reuse/discover')).toBe(false);
  });
  it('reports errors inside the conversation', async () => {
    localStorage.clear(); mockServer(); renderApp(); nav('Chat');
    type('Message', 'how does auth work'); fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await within(screen.getByRole('log')).findByText(/Enter the repository path/)).toBeTruthy();
  });
  it('routes clear reuse requests to Reuse and starts discovery', async () => {
    mockServer({ '/api/reuse/discover': () => ({ body: { results: [unit('formatDate')], scannedUnits: 10 } }) });
    renderApp(); nav('Chat');
    type('Message', 'find reusable date formatting'); fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('button', { name: /formatDate/ })).toBeTruthy();
    expect(calls.find(c => c.path === '/api/reuse/discover')!.body.requirement).toBe('find reusable date formatting');
  });
});

describe('Figma (#4, #6)', () => {
  it('sends a designId (not the design), clears the token on success, keeps it on failure, and loads JSON only when opened', async () => {
    let fail = true;
    mockServer({
      '/api/figma/read': () => fail ? { status: 502, body: { error: 'Figma API HTTP 403 (check the token and that it can read this file)', code: 'upstream_error' } }
        : { body: { designId: 'd_' + 'a'.repeat(32), expiresAt: new Date(Date.now() + 3600e3).toISOString(), summary: { name: 'Shop', fileKey: 'ABC', nodeId: '1:2', nodeCount: 3, components: [], texts: ['Pay'], layout: [] }, warnings: [] } },
      '/api/figma/plan': () => ({ body: { design: {}, repositoryEvidence: [{ path: 'src/Pay.vue', score: 3 }] } }),
      '/api/figma/designs/*': () => ({ body: { name: 'Shop', nodes: [{ id: '1:2', name: 'FrameName' }] } })
    });
    renderApp(); nav('Figma-to-Code');
    await screen.findByLabelText('Figma personal access token');
    type('Figma file or frame URL', 'https://www.figma.com/design/ABC/x?node-id=1-2');
    type('Figma personal access token', 'figd_secret');
    fireEvent.click(screen.getByRole('button', { name: 'Read design' }));
    expect(await screen.findByText(/HTTP 403/)).toBeTruthy();
    expect((screen.getByLabelText('Figma personal access token') as HTMLInputElement).value).toBe('figd_secret');
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Read design' }));
    expect(await screen.findByText(/3 layers/)).toBeTruthy();
    expect((screen.getByLabelText('Figma personal access token') as HTMLInputElement).value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Analyze with repository' }));
    expect(await screen.findByText('src/Pay.vue')).toBeTruthy();
    const plan = calls.find(c => c.path === '/api/figma/plan')!;
    expect(plan.body.designId).toMatch(/^d_a+$/); expect(plan.body.design).toBeUndefined();
    expect(calls.some(c => c.path.startsWith('/api/figma/designs/'))).toBe(false);
    const details = screen.getByText('Normalized design JSON').closest('details')!;
    details.open = true; fireEvent(details, new Event('toggle'));
    expect(await screen.findByText(/FrameName/)).toBeTruthy();
  });
});

describe('proposals (#5)', () => {
  it('shows files readably with a VS Code handoff, and clears stale proposals on a new discovery or candidate', async () => {
    let n = 0;
    mockServer({
      '/api/reuse/discover': () => ({ body: { results: [unit('a'), unit('b')], scannedUnits: 2 } }),
      '/api/reuse/independent/generate': () => ({ body: generated(`src/New${++n}.ts`) })
    });
    renderApp(); nav('Reuse Intelligence');
    fireEvent.click(await screen.findByRole('button', { name: 'Discover' }));
    await screen.findByRole('button', { name: /^b/ });
    fireEvent.click(screen.getByRole('button', { name: 'Generate independent proposal' }));
    expect(await screen.findByText('src/New1.ts')).toBeTruthy();
    expect(screen.getByText('2 lines', { exact: false })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Open in VS Code/ }).getAttribute('href')).toBe('vscode://codedeft-local.codedeft-vscode/proposal?id=p_11111111-1111-1111-1111-111111111111');
    fireEvent.click(screen.getByRole('button', { name: /^b/ }));
    expect(screen.queryByText('src/New1.ts')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Generate independent proposal' }));
    expect(await screen.findByText('src/New2.ts')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Discover' }));
    expect(screen.queryByText('src/New2.ts')).toBeNull();
  });
});

describe('version compatibility (no crashes)', () => {
  it('works against an API-1 server: Figma read is turned off with an explanation', async () => {
    mockServer({ '/api/health': () => ({ body: { ok: true, version: '0.9.0' } }), '/api/search': () => ({ body: { hits: [] } }) });
    renderApp();
    expect(await screen.findByText(/older codeDeft server \(0\.9\.0\)/)).toBeTruthy();
    nav('Figma-to-Code');
    expect(await screen.findByText(/0\.9\.0 does not support reading Figma designs through the server/)).toBeTruthy();
    nav('Code Intelligence');
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('0 results')).toBeTruthy();
  });
  it('refuses calmly when the server needs a newer client', async () => {
    mockServer({ '/api/health': () => ({ body: { ok: true, version: '9.0.0', api: { version: 9, minClient: 5 } } }) });
    renderApp();
    expect(await screen.findByText(/This client is too old/)).toBeTruthy();
  });
  it('shows a retryable banner when the server is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    renderApp();
    expect(await screen.findByText(/did not answer \/api\/health/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
  it('survives malformed responses', async () => {
    mockServer({ '/api/search': () => ({ body: { hits: 'not-a-list' } }), '/api/reuse/discover': () => ({ body: { results: [{ junk: true }, null] } }) });
    renderApp(); nav('Code Intelligence');
    fireEvent.click(await screen.findByRole('button', { name: 'Search' }));
    expect(await screen.findByText('0 results')).toBeTruthy();
    nav('Reuse Intelligence'); fireEvent.click(screen.getByRole('button', { name: 'Discover' }));
    expect(await screen.findByText(/0 candidates/)).toBeTruthy();
  });
});

describe('resilience and accessibility (#7, #8)', () => {
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
  it('every input and select on every view has an accessible label', async () => {
    mockServer(); renderApp();
    for (const label of ['Overview', 'Code Intelligence', 'Dependency Graph', 'Reuse Intelligence', 'Figma-to-Code', 'Chat']) {
      nav(label);
      await waitFor(() => expect(screen.queryByText(/Connecting to the codeDeft server/)).toBeNull());
    }
    const unlabeled = [...document.querySelectorAll('input, select')].filter(el => !(el as HTMLInputElement).labels?.length && !el.getAttribute('aria-label'));
    expect(unlabeled.map(el => el.outerHTML)).toEqual([]);
    expect(screen.getByRole('button', { name: 'Chat' }).getAttribute('aria-current')).toBe('page');
  });
});
