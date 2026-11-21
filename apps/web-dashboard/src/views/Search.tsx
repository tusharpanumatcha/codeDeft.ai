import React, { useEffect, useState } from 'react';
import type { SearchHit } from '../../../../packages/protocol/src/index';
import { api } from '../api';
import { Field } from '../components/Field';
import { Busy, ErrorText, NeedsRepository, RequireCapability } from '../components/Feedback';
import { PageHeader } from '../components/PageHeader';
import { useTask } from '../state/useTask';
import { useWorkspace } from '../state/workspace';
import { plural } from '../format';

export function Search() {
  const ws = useWorkspace();
  const [query, setQuery] = useState('');
  const task = useTask<SearchHit[]>();
  const search = (q = query) => task.run(signal => { if (!q.trim()) throw new Error('Type a question or a few keywords first.'); return api.search(ws.requireRepository(), q, 10, { signal }); });
  const intent = ws.intents.search;
  useEffect(() => { if (intent) { setQuery(intent.query); void search(intent.query); } }, [intent?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <PageHeader title="Search code">Ask in plain words. Results show which files match and why.</PageHeader>
      <RequireCapability capabilities={['search']}><NeedsRepository>
        <form className="card" role="search" onSubmit={e => { e.preventDefault(); void search(); }}>
          <div className="row end">
            <Field className="grow" label="Question" type="search" value={query} onChange={setQuery} placeholder="How is authentication implemented?" />
            <button type="submit" className="btn btn-primary" disabled={task.running}><span>Search</span></button>
          </div>
          <Busy running={task.running} label="Searching…" />
          <ErrorText error={task.error} />
        </form>
        {task.status === 'done' && <section className="stack" aria-label="Results">
          <p role="status" className="muted">{plural(task.data!.length, 'result')}</p>
          {task.data!.map(h => <article className="card" key={h.file} style={{ gap: 'var(--space-3)' }}>
            <div className="card-header"><h2 className="mono" style={{ fontSize: 'var(--text-md)' }}>{h.file}</h2><span className="small muted">score {h.score}</span></div>
            {h.reasons.length > 0 && <p className="small muted">Matched: {h.reasons.join(' · ')}</p>}
            {h.excerpt && <pre className="code-block" tabIndex={0} aria-label={`Excerpt from ${h.file}`} style={{ maxHeight: '14rem' }}>{h.excerpt}</pre>}
          </article>)}
        </section>}
      </NeedsRepository></RequireCapability>
    </>
  );
}
