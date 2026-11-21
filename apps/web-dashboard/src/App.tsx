import React, { useState, useEffect } from 'react';
import { API_VERSION } from '../../../packages/protocol/src/index';
import { ErrorBoundary } from './components/ErrorBoundary';
import { RepositoryBar } from './components/RepositoryBar';
import { useWorkspace, type View } from './state/workspace';
import { Overview } from './views/Overview';
import { Search } from './views/Search';
import { Graph } from './views/Graph';
import { Reuse } from './views/Reuse';
import { Figma } from './views/Figma';
import { Chat } from './views/Chat';

const views: { id: View; label: string; Component: React.ComponentType }[] = [
  { id: 'overview', label: 'Overview', Component: Overview },
  { id: 'search', label: 'Code Intelligence', Component: Search },
  { id: 'graph', label: 'Dependency Graph', Component: Graph },
  { id: 'reuse', label: 'Reuse Intelligence', Component: Reuse },
  { id: 'figma', label: 'Figma-to-Code', Component: Figma },
  { id: 'chat', label: 'Chat', Component: Chat }
];

function ServerBanner() {
  const { compat, recheckServer } = useWorkspace();
  if (compat === null) return null;
  if (compat.compatible) return compat.serverApi < API_VERSION
    ? <div className="banner notice" role="note">Connected to an older codeDeft server ({compat.serverVersion}). Features it does not support are turned off; update and restart the server to enable them.</div>
    : null;
  return <div className="banner error" role="alert">{compat.message} <button type="button" className="link" onClick={recheckServer}>Retry</button></div>;
}

export function App() {
  const ws = useWorkspace();
  // Views stay mounted after their first visit (hidden when inactive) so in-progress work and inputs survive tab switches.
  const [visited, setVisited] = useState<Set<View>>(() => new Set([ws.view]));
  useEffect(() => { setVisited(v => v.has(ws.view) ? v : new Set(v).add(ws.view)); }, [ws.view]);
  const active = views.find(v => v.id === ws.view)!;
  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Sections">
        <h1>⌘ codeDeft</h1><p>Understand First. Code Better.</p>
        <ul>{views.map(v => <li key={v.id}><button type="button" className={ws.view === v.id ? 'active' : ''} aria-current={ws.view === v.id ? 'page' : undefined} onClick={() => ws.navigate(v.id)}>{v.label}</button></li>)}</ul>
      </nav>
      <main>
        <header><h2>{active.label}</h2><span className="muted small">Dashboard {__APP_VERSION__}{ws.compat?.compatible ? ` · server ${ws.compat.serverVersion}` : ''}</span></header>
        <ServerBanner />
        <ErrorBoundary name="repository"><RepositoryBar /></ErrorBoundary>
        {views.filter(v => visited.has(v.id)).map(({ id, label, Component }) => (
          <div key={id} hidden={ws.view !== id}>
            <ErrorBoundary name={label}><Component /></ErrorBoundary>
          </div>
        ))}
      </main>
    </div>
  );
}
