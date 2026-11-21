import React, { useState } from 'react';
import type { FeatureSummary } from '../../../../packages/protocol/src/index';
import { useWorkspace, type View } from '../state/workspace';
import { STATUS, relativeTime } from '../feature/status';
import { AppearanceMenu } from './AppearanceMenu';
import { Field } from './Field';
import { Icon, type IconName } from './Icon';
import { RepoSwitcher } from './RepoSwitcher';

const pages: { id: Exclude<View, 'feature'>; label: string; icon: IconName }[] = [
  { id: 'overview', label: 'Overview', icon: 'overview' },
  { id: 'search', label: 'Search code', icon: 'search' },
  { id: 'graph', label: 'Full dependency graph', icon: 'graph' }
];

export function Sidebar({ features, loading, error, query, onQuery, onNew, creating }: {
  features: FeatureSummary[]; loading: boolean; error?: string; query: string; onQuery(q: string): void; onNew(): void; creating: boolean;
}) {
  const ws = useWorkspace();
  const [now] = useState(() => Date.now());
  const supported = ws.has('features');
  return (
    <nav className="fc-sidebar" aria-label="Features and repository">
      <span className="brand"><BrandMark /><span>code<span className="brand-accent">Deft</span></span></span>
      <RepoSwitcher />
      <button type="button" className="btn btn-primary btn-block" onClick={onNew} disabled={creating || !supported || !ws.repository.trim()}><Icon name="plus" />New feature</button>
      <Field label="Search features" type="search" value={query} onChange={onQuery} placeholder="Name or file" autoComplete="off" />
      <h2 className="section-label" id="features-heading">Features</h2>
      {!supported && ws.compat?.compatible && <p className="small muted">This codeDeft server does not store feature chats. Update and restart it.</p>}
      {error && <p className="small" style={{ color: 'var(--danger)' }}>{error}</p>}
      <ul className="feature-list" aria-labelledby="features-heading" aria-busy={loading}>
        {features.map(f => {
          const st = STATUS[f.status];
          const current = ws.view === 'feature' && ws.featureId === f.id;
          return <li key={f.id}>
            <button type="button" className="feature-item" aria-current={current ? 'page' : undefined} onClick={() => ws.openFeature(f.id)}>
              <span className="feature-name">{f.name}</span>
              <span className={`feature-status tone-${st.tone}`}><span className="status-dot" aria-hidden="true" />{st.label}<span className="muted"> · {relativeTime(f.updatedAt, now)}</span></span>
            </button>
          </li>;
        })}
        {supported && !loading && !features.length && ws.repository.trim() && <li className="small muted">{query ? 'No features match.' : 'No features yet.'}</li>}
      </ul>
      <span className="spacer" />
      <h2 className="section-label" id="repo-heading">Repository</h2>
      <ul className="page-list" aria-labelledby="repo-heading">
        {pages.map(p => <li key={p.id}><button type="button" className="nav-link" aria-current={ws.view === p.id ? 'page' : undefined} onClick={() => ws.navigate(p.id)}><Icon name={p.icon} size={16} /><span>{p.label}</span></button></li>)}
      </ul>
      <div className="row sidebar-foot">
        <ServerDot />
        <span className="spacer" />
        <AppearanceMenu />
      </div>
    </nav>
  );
}

function ServerDot() {
  const { compat, recheckServer } = useWorkspace();
  const [text, color] = compat === null ? ['Connecting…', 'var(--text-muted)'] : compat.compatible ? [`Server ${compat.serverVersion}`, 'var(--success)'] : ['Server unavailable', 'var(--danger)'];
  return <button type="button" className="btn btn-ghost small" style={{ color: 'var(--text-muted)', fontWeight: 400, paddingLeft: 0 }} onClick={recheckServer} aria-label={`${text}. Check connection again`}><span className="status-dot" style={{ color }} aria-hidden="true" />{text}</button>;
}

/** The codeDeft mark: code brackets around a check mark ("code, verified"). Decorative; the name follows it. */
function BrandMark() {
  return <svg className="brand-mark" width="26" height="26" viewBox="0 0 512 512" aria-hidden="true" focusable="false">
    <rect width="512" height="512" rx="110" fill="var(--brand-tile, #2f5d50)" />
    <path d="M160 136 L56 256 L160 376 M352 136 L456 256 L352 376" fill="none" stroke="#fff" strokeWidth="64" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M178 266 L236 322 L334 196" fill="none" stroke="#9fd6bf" strokeWidth="64" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}
