import React, { useEffect, useState } from 'react';
import type { SearchHit } from '../../../../packages/protocol/src/index';
import { api } from '../api';
import { Field } from '../components/Field';
import { Busy, ErrorText, RequireCapability } from '../components/Feedback';
import { useTask } from '../state/useTask';
import { useWorkspace } from '../state/workspace';
import { plural } from '../format';

export function Search() {
  const ws = useWorkspace();
  const [query, setQuery] = useState('How is authentication implemented?');
  const task = useTask<SearchHit[]>();
  const search = (q = query) => task.run(signal => { if (!q.trim()) throw new Error('Type a question first.'); return api.search(ws.requireRepository(), q, 10, { signal }); });
  const intent = ws.intents.search;
  useEffect(() => { if (intent) { setQuery(intent.query); void search(intent.query); } }, [intent?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <RequireCapability capabilities={['search']}>
      <section className="panel">
        <h3>Ask your repository</h3>
        <div className="form end"><Field className="grow" label="Question" value={query} onChange={setQuery} onEnter={() => search()} /><button type="button" disabled={task.running} onClick={() => search()}>Search</button></div>
        <Busy running={task.running} label="Searching…" />
        <ErrorText error={task.error} />
        {task.status === 'done' && <p role="status" className="small">{plural(task.data!.length, 'result')}</p>}
        {task.data?.map(h => <article className="result" key={h.file}><strong>{h.file}</strong> <span>Score {h.score}</span><p>{h.reasons.join(' · ')}</p>{h.excerpt && <pre tabIndex={0}>{h.excerpt}</pre>}</article>)}
      </section>
    </RequireCapability>
  );
}
