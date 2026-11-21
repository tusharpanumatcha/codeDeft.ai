import React, { useState } from 'react';
import type { Edge } from '../../../../packages/protocol/src/index';
import { api } from '../api';
import { Field } from '../components/Field';
import { Busy, ErrorText, NeedsRepository, RequireCapability } from '../components/Feedback';
import { PageHeader } from '../components/PageHeader';
import { useTask } from '../state/useTask';
import { useWorkspace } from '../state/workspace';
import { plural } from '../format';

export function Graph() {
  const ws = useWorkspace();
  const [filter, setFilter] = useState('');
  const task = useTask<{ edges: Edge[]; limited: boolean }>();
  const explore = () => task.run(signal => api.graph(ws.requireRepository(), filter, { signal }));
  return (
    <>
      <PageHeader title="Dependencies">Which files import which. Filter by part of a path to focus on one area.</PageHeader>
      <RequireCapability capabilities={['graph']}><NeedsRepository>
        <form className="card" onSubmit={e => { e.preventDefault(); void explore(); }}>
          <div className="row end">
            <Field className="grow" label="Filter by file path (optional)" value={filter} onChange={setFilter} placeholder="e.g. auth" />
            <button type="submit" className="btn btn-primary" disabled={task.running}>Show dependencies</button>
          </div>
          <Busy running={task.running} label="Loading dependencies…" />
          <ErrorText error={task.error} />
        </form>
        {task.data && <section className="card" aria-label="Dependencies">
          <p role="status" className="muted">{plural(task.data.edges.length, 'dependency', 'dependencies')}{task.data.limited ? ' · showing the first 200, narrow the filter to see more' : ''}</p>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <caption className="sr-only">File imports</caption>
            <thead><tr><th scope="col" style={{ textAlign: 'left', padding: 'var(--space-2)' }} className="small muted">File</th><th scope="col" style={{ textAlign: 'left', padding: 'var(--space-2)' }} className="small muted">Imports</th></tr></thead>
            <tbody>{task.data.edges.map(e => <tr key={e.from + '\0' + e.to} style={{ borderTop: 'var(--border-width) solid var(--border)' }}><td className="mono" style={{ padding: 'var(--space-2)' }}>{e.from}</td><td className="mono" style={{ padding: 'var(--space-2)' }}>{e.to}</td></tr>)}</tbody>
          </table>
        </section>}
      </NeedsRepository></RequireCapability>
    </>
  );
}
