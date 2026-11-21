import React from 'react';
import { api } from '../api';
import { loadStats, useWorkspace } from '../state/workspace';
import { useTask } from '../state/useTask';
import { Field } from './Field';
import { Busy, ErrorText } from './Feedback';

export function RepositoryBar() {
  const ws = useWorkspace();
  const task = useTask<string>();
  const index = () => task.run(async signal => {
    const repo = ws.requireRepository();
    await api.index(repo, { signal });
    ws.setStats(await loadStats(repo, signal));
    return 'Index complete.';
  });
  const refresh = () => task.run(async signal => { ws.setStats(await loadStats(ws.requireRepository(), signal)); return 'Repository loaded.'; });
  return (
    <section className="panel" aria-label="Repository">
      <div className="form end">
        <Field className="grow" label="Repository path" value={ws.repository} onChange={ws.setRepository} placeholder="/Users/you/projects/repo" onEnter={index} autoComplete="off" />
        <button type="button" disabled={task.running || !ws.has('index')} onClick={index}>Index repository</button>
        <button type="button" className="secondary" disabled={task.running || !ws.has('info')} onClick={refresh}>Refresh</button>
      </div>
      <Busy running={task.running} label="Working… indexing a large repository can take a minute." onCancel={task.cancel} />
      <ErrorText error={task.error} />
      {task.status === 'done' && <p role="status" className="small">{task.data}</p>}
    </section>
  );
}
