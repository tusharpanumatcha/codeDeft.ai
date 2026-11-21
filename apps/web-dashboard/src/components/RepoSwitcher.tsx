import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { loadStats, useWorkspace } from '../state/workspace';
import { useTask } from '../state/useTask';
import { Field } from './Field';
import { Busy, ErrorText } from './Feedback';
import { Icon } from './Icon';
import { useDisclosure } from './useDisclosure';

const nameOf = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;
function ago(iso?: string): string {
  if (!iso) return 'not indexed yet';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(mins)) return 'indexed';
  if (mins < 1) return 'indexed just now';
  if (mins < 60) return `indexed ${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `indexed ${hours} h ago` : `indexed ${new Date(iso).toLocaleDateString()}`;
}

/** Compact repository picker in the header: current repo, index status, recent repos, index/refresh. */
export function RepoSwitcher() {
  const ws = useWorkspace();
  const pop = useDisclosure();
  const [draft, setDraft] = useState(ws.repository);
  const task = useTask<string>();
  useEffect(() => { if (pop.open) setDraft(ws.repository); }, [pop.open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load statistics for a remembered repository on start, so the header shows its status straight away.
  useEffect(() => {
    if (!ws.repository.trim() || ws.stats || !ws.has('info')) return;
    void task.run(async signal => { ws.setStats(await loadStats(ws.repository.trim(), signal)); return 'Loaded.'; });
  }, [ws.compat]); // eslint-disable-line react-hooks/exhaustive-deps

  const use = (path: string, index: boolean) => task.run(async signal => {
    const repo = path.trim();
    if (!repo) throw new Error('Enter the full path of a repository folder.');
    ws.setRepository(repo);
    if (index) await api.index(repo, { signal });
    try { ws.setStats(await loadStats(repo, signal)); }
    catch (e) { if (!index) { ws.setStats(undefined); return 'Not indexed yet. Choose Index to analyse it.'; } throw e; }
    ws.rememberRepository(repo);
    if (index) pop.close();
    return index ? 'Index complete.' : 'Repository loaded.';
  });

  const current = ws.repository.trim();
  return (
    <div className="anchor">
      <button id="repo-switcher" type="button" {...pop.triggerProps} aria-controls="repo-popover" onClick={pop.toggle}
        className="btn btn-secondary repo-switcher">
        <Icon name="folder" />
        {/* The accessible name contains the visible text (WCAG 2.5.3); the hidden words only add context. */}
        <span className="stack-sm" style={{ gap: 0, alignItems: 'flex-start', minWidth: 0 }}>
          <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{current && <span className="sr-only">Repository: </span>}{current ? nameOf(current) : 'Choose repository'}</span>
          <span className="small muted"><span className="sr-only">, </span>{task.running ? 'working…' : current ? ago(ws.stats?.indexedAt) : 'no repository selected'}</span>
        </span>
        <Icon name="chevron" size={16} />
      </button>
      {pop.open && (
        <div id="repo-popover" className="popover" role="dialog" aria-label="Repository" ref={pop.panelRef}>
          <Field label="Repository folder" value={draft} onChange={setDraft} placeholder="/Users/you/projects/my-app" autoComplete="off" hint="The full path of the folder on this computer." onEnter={() => use(draft, true)} />
          <div className="row">
            <button type="button" className="btn btn-primary" disabled={task.running || !ws.has('index')} onClick={() => use(draft, true)}><Icon name="refresh" size={16} />{draft.trim() && draft.trim() === current && ws.stats ? 'Re-index' : 'Index'}</button>
            <button type="button" className="btn btn-secondary" disabled={task.running || !ws.has('info')} onClick={() => use(draft, false)}>Open without indexing</button>
          </div>
          <Busy running={task.running} label="Indexing… large repositories can take a minute." onCancel={task.cancel} />
          <ErrorText error={task.error} />
          {ws.recentRepositories.length > 0 && <div className="stack-sm">
            <h2 className="label" id="recent-heading">Recent</h2>
            <ul className="list" aria-labelledby="recent-heading">
              {ws.recentRepositories.map(path => <li key={path} className="row" style={{ flexWrap: 'nowrap' }}>
                <button type="button" className="btn btn-secondary grow" style={{ justifyContent: 'flex-start', fontWeight: 400 }} aria-current={path === current ? 'true' : undefined} onClick={() => use(path, false).then(() => pop.close())}>
                  <span className="stack-sm" style={{ gap: 0, alignItems: 'flex-start', minWidth: 0 }}><strong>{nameOf(path)}</strong><span className="small muted mono" style={{ fontFamily: 'var(--font-mono)' }}>{path}</span></span>
                </button>
                <button type="button" className="btn btn-ghost btn-icon" aria-label={`Remove ${nameOf(path)} from recent`} onClick={() => ws.forgetRepository(path)}><Icon name="close" size={16} /></button>
              </li>)}
            </ul>
          </div>}
        </div>
      )}
    </div>
  );
}
