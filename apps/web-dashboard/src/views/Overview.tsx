import React from 'react';
import { useWorkspace } from '../state/workspace';

export function Overview() {
  const { stats } = useWorkspace();
  const keys = ['files', 'symbols', 'dependencies', 'conventions'] as const;
  return (
    <>
      <section className="cards" aria-label="Repository statistics">
        {keys.map(k => <div className="panel" key={k}><strong>{stats ? stats[k].toLocaleString() : '—'}</strong><p>{k}</p></div>)}
      </section>
      {!stats && <p className="muted">Index or refresh a repository to see its statistics.</p>}
      {stats?.indexedAt && <p className="muted small">Indexed {new Date(stats.indexedAt).toLocaleString()}</p>}
    </>
  );
}
