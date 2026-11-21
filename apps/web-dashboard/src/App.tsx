import React, { useCallback, useEffect, useState } from 'react';
import { API_VERSION } from '../../../packages/protocol/src/index';
import { api, errorMessage } from './api';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Alert, NeedsRepository } from './components/Feedback';
import { Icon } from './components/Icon';
import { Sidebar } from './components/Sidebar';
import { FeatureView } from './feature/FeatureView';
import { useFeature, useFeatureList } from './state/features';
import { useWorkspace } from './state/workspace';
import { Overview } from './views/Overview';
import { Search } from './views/Search';
import { Graph } from './views/Graph';

function ServerBanner() {
  const { compat, recheckServer } = useWorkspace();
  if (compat === null) return null;
  if (compat.compatible) return compat.serverApi < API_VERSION
    ? <Alert tone="warning">Connected to an older codeDeft server ({compat.serverVersion}). Features it does not support are turned off; update and restart the server to enable them.</Alert>
    : null;
  return <Alert tone="error" action={<div><button type="button" className="btn btn-secondary" onClick={recheckServer}>Try again</button></div>}>{compat.message}</Alert>;
}

export function App() {
  const ws = useWorkspace();
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string>();
  const [archived, setArchived] = useState<{ name: string; id: string }>();
  const supported = ws.has('features');
  const list = useFeatureList(ws.repository, supported, query);
  const reloadList = list.reload;
  const onChanged = useCallback(() => { void reloadList(); }, [reloadList]);
  const ctl = useFeature(ws.view === 'feature' && supported ? ws.featureId : undefined, onChanged);

  useEffect(() => { document.title = ws.view === 'feature' && ctl.detail ? `${ctl.detail.feature.name} · codeDeft` : 'codeDeft'; }, [ws.view, ctl.detail?.feature.name]);
  // A remembered feature that no longer exists (deleted database, other machine): fall back to the list.
  useEffect(() => { if (ctl.error && /not found/i.test(ctl.error)) ws.openFeature(undefined); }, [ctl.error]); // eslint-disable-line react-hooks/exhaustive-deps
  // Ctrl/⌘+K focuses the message box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') { const box = document.querySelector<HTMLInputElement>('.composer-input'); if (box) { e.preventDefault(); box.focus(); } } };
    document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey);
  }, []);

  const [focusFor, setFocusFor] = useState<string>();
  const newFeature = async () => {
    setCreating(true); setCreateError(undefined);
    try {
      const d = await api.features.create(ws.requireRepository());
      setQuery(''); await list.reload(); ws.openFeature(d.feature.id);
      setFocusFor(d.feature.id); // focus the message box once this feature is on screen
    } catch (e) { setCreateError(errorMessage(e)); }
    finally { setCreating(false); }
  };
  const undoArchive = async () => {
    if (!archived) return;
    try { await api.features.update(archived.id, { archived: false }); setArchived(undefined); await list.reload(); ws.openFeature(archived.id); }
    catch (e) { setCreateError(errorMessage(e)); }
  };

  return (
    <div className="fc-app">
      <a className="skip-link" href="#main">Skip to main content</a>
      <Sidebar features={list.features} loading={list.loading} error={list.error} query={query} onQuery={setQuery} onNew={newFeature} creating={creating} />
      <main id="main" className="fc-content" tabIndex={-1}>
        <div className="fc-banners">
          <ServerBanner />
          {createError && <Alert tone="error">{createError}</Alert>}
          {archived && <Alert tone="info" action={<div className="row"><button type="button" className="btn btn-secondary" onClick={() => void undoArchive()}>Undo</button><button type="button" className="btn btn-ghost" onClick={() => setArchived(undefined)}>Dismiss</button></div>}>Archived “{archived.name}”.</Alert>}
        </div>
        {ws.view === 'feature' && !ctl.detail && <h1 className="sr-only">Features</h1>}
        {ws.view === 'feature'
          ? <ErrorBoundary name="feature">
              {!ws.repository.trim() ? <div className="fc-page"><NeedsRepository>{null}</NeedsRepository></div>
                : !supported ? <div className="fc-page"><div className="empty"><strong style={{ color: 'var(--text)' }}>Feature chats need a newer codeDeft server</strong><span>Update and restart the server. Repository pages (Overview, Search code, Full dependency graph) still work.</span></div></div>
                : !ws.featureId ? <div className="fc-page"><div className="empty">
                    <strong style={{ color: 'var(--text)' }}>{list.features.length ? 'Pick a feature on the left, or start a new one' : 'Start your first feature'}</strong>
                    <span>Each feature keeps its own chat, design, reuse decisions, dependencies and proposals, saved in codeDeft’s local database.</span>
                    <button type="button" className="btn btn-primary" onClick={() => void newFeature()} disabled={creating}><Icon name="plus" />New feature</button>
                  </div></div>
                : ctl.detail ? <FeatureView ctl={ctl} focusComposer={focusFor === ctl.detail.feature.id} onFocused={() => setFocusFor(undefined)} onArchived={(name, id) => { setArchived({ name, id }); ws.openFeature(undefined); }} />
                : ctl.error ? <div className="fc-page"><Alert tone="error">{ctl.error}</Alert></div>
                : <div className="fc-page"><p className="busy" role="status"><span className="spinner" aria-hidden="true" />Loading feature…</p></div>}
            </ErrorBoundary>
          : <div className="fc-page"><div className="content stack" style={{ gap: 'var(--space-6)' }}>
              <ErrorBoundary name={ws.view}>{ws.view === 'overview' ? <Overview /> : ws.view === 'search' ? <Search /> : <Graph />}</ErrorBoundary>
            </div></div>}
      </main>
    </div>
  );
}
