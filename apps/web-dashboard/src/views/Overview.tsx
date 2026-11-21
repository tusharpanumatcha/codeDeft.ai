import React from 'react';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/PageHeader';
import { useWorkspace } from '../state/workspace';
import { plural } from '../format';

export function Overview() {
  const ws = useWorkspace();
  const { stats } = ws;
  const steps = [
    { done: !!ws.repository.trim() && !!stats, title: 'Choose and index a repository', body: 'Use the repository button at the top left.', action: <button type="button" className="btn btn-secondary" onClick={() => document.getElementById('repo-switcher')?.click()}>Choose repository</button> },
    { done: false, title: 'Start a feature', body: 'Each feature keeps its own chat, design, reuse decisions and proposals.', action: <button type="button" className="btn btn-secondary" onClick={() => ws.openFeature(undefined)}>Go to features</button> },
    { done: false, title: 'Connect your AI assistant', body: 'In VS Code run “codeDeft: Connect AI Assistants” so Copilot uses codeDeft context.', action: null },
  ];
  const keys = [['files', 'file'], ['symbols', 'symbol'], ['dependencies', 'dependency'], ['conventions', 'convention']] as const;
  return (
    <>
      <PageHeader title="Overview">Understand the repository first, then reuse or generate with evidence.</PageHeader>
      {stats && <section aria-label="Repository statistics" className="grid-4">
        {keys.map(([k, one]) => <div className="card" key={k} style={{ gap: 'var(--space-1)' }}><strong style={{ fontSize: 'var(--text-2xl)' }}>{stats[k].toLocaleString()}</strong><span className="muted">{plural(stats[k], one, k).replace(/^[\d,.\s]+/, '')}</span></div>)}
      </section>}
      <section className="card" aria-labelledby="start-title">
        <h2 id="start-title">Get started</h2>
        <ol className="list" style={{ listStyle: 'none' }}>
          {steps.map((s, i) => <li key={s.title} className="list-item" style={{ flexDirection: 'row', alignItems: 'center', gap: 'var(--space-4)' }}>
            <span className={'step ' + (s.done ? 'done' : '')} style={{ border: 0, padding: 0 }}><span className="num" aria-hidden="true">{s.done ? <Icon name="check" size={12} /> : i + 1}</span></span>
            <span className="stack-sm grow" style={{ gap: 0 }}><strong>{s.title}{s.done && <span className="sr-only"> (done)</span>}</strong><span className="small muted">{s.body}</span></span>
            {s.action ?? null}
          </li>)}
        </ol>
      </section>
    </>
  );
}
