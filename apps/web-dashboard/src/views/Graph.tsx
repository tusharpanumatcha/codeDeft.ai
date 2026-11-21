import React, { useState } from 'react';
import type { Edge } from '../../../../packages/protocol/src/index';
import { api } from '../api';
import { Field } from '../components/Field';
import { Busy, ErrorText, RequireCapability } from '../components/Feedback';
import { useTask } from '../state/useTask';
import { useWorkspace } from '../state/workspace';
import { plural } from '../format';

export function Graph() {
  const ws = useWorkspace();
  const [filter, setFilter] = useState('');
  const task = useTask<{ edges: Edge[]; limited: boolean }>();
  const explore = () => task.run(signal => api.graph(ws.requireRepository(), filter, { signal }));
  return (
    <RequireCapability capabilities={['graph']}>
      <section className="panel">
        <h3>Dependency Explorer</h3>
        <div className="form end"><Field className="grow" label="Filter by file path" value={filter} onChange={setFilter} onEnter={explore} placeholder="e.g. auth" /><button type="button" disabled={task.running} onClick={explore}>Explore</button></div>
        <Busy running={task.running} label="Loading dependencies…" />
        <ErrorText error={task.error} />
        {task.data && <p role="status" className="small">{plural(task.data.edges.length, 'dependency', 'dependencies')}{task.data.limited ? ' (first 200 shown; narrow the filter)' : ''}</p>}
        <ul className="edges">{task.data?.edges.map(e => <li className="edge" key={e.from + '\0' + e.to}><code>{e.from}</code> <span aria-label="imports">→</span> <code>{e.to}</code></li>)}</ul>
      </section>
    </RequireCapability>
  );
}
