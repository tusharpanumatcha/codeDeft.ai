import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
type Hit = {file:string;score:number;reasons:string[];excerpt?:string};
type Stats = {files:number;symbols:number;dependencies:number;conventions:number;indexedAt?:string};
type Edge = {from:string;to:string};
const apiToken = document.querySelector<HTMLMetaElement>('meta[name="codedeft-token"]')?.content || '';
async function api<T>(url:string, options:RequestInit = {}):Promise<T> {
 const headers = {'content-type':'application/json',...(apiToken?{'x-codedeft-token':apiToken}:{}),...options.headers};
 const res = await fetch(url,{...options,headers});const data = await res.json();if(!res.ok)throw Error(data.error||`HTTP ${res.status}`);return data as T;
}
function App(){
 const [repository,setRepository]=useState(localStorage.getItem('codedeft-repo')||'');
 const [question,setQuestion]=useState('How is authentication implemented?');
 const [view,setView]=useState<'overview'|'search'|'graph'>('overview');
 const [stats,setStats]=useState<Stats|null>(null);const [hits,setHits]=useState<Hit[]>([]);
 const [edges,setEdges]=useState<Edge[]>([]);const [filter,setFilter]=useState('');
 const [status,setStatus]=useState('Enter a repository path and index it.');const [busy,setBusy]=useState(false);
 const currentRepo=()=>{if(!repository.trim())throw Error('Enter a repository path');localStorage.setItem('codedeft-repo',repository.trim());return repository.trim()};
 const run=async (action:()=>Promise<void>)=>{setBusy(true);try{await action()}catch(e){setStatus(e instanceof Error?e.message:String(e))}finally{setBusy(false)}};
 const refresh=()=>run(async()=>{const d=await api<{stats:Stats}>('/api/info?repository='+encodeURIComponent(currentRepo()));setStats(d.stats);setStatus('Repository loaded')});
 const index=()=>run(async()=>{setStatus('Indexing repository...');await api('/api/index',{method:'POST',body:JSON.stringify({repository:currentRepo()})});const d=await api<{stats:Stats}>('/api/info?repository='+encodeURIComponent(currentRepo()));setStats(d.stats);setStatus('Index complete')});
 const search=()=>run(async()=>{const d=await api<{hits:Hit[]}>('/api/search',{method:'POST',body:JSON.stringify({repository:currentRepo(),query:question})});setHits(d.hits);setStatus(`${d.hits.length} results`)});
 const graph=()=>run(async()=>{const d=await api<{edges:Edge[]}>('/api/graph?repository='+encodeURIComponent(currentRepo())+'&filter='+encodeURIComponent(filter));setEdges(d.edges);setStatus(`${d.edges.length} dependencies`)});
 return <div className="shell"><aside className="sidebar"><h1>⌘ codeDeft</h1><p>Understand First. Code Better.</p>{(['overview','search','graph'] as const).map(v=><button key={v} className={view===v?'active':''} onClick={()=>setView(v)}>{v==='overview'?'Overview':v==='search'?'Code Intelligence':'Dependency Graph'}</button>)}</aside><main><header><h2>{view==='overview'?'Repository Overview':view==='search'?'Code Intelligence':'Dependency Graph'}</h2><span>Local workspace · v0.8</span></header><section className="panel"><label>Repository path</label><div className="form"><input aria-label="Repository path" value={repository} onChange={e=>setRepository(e.target.value)} placeholder="/Users/you/projects/repo"/><button disabled={busy} onClick={index}>Index repository</button><button disabled={busy} onClick={refresh}>Refresh</button></div><small role="status">{status}</small></section>{view==='overview'?<section className="cards">{(['files','symbols','dependencies','conventions'] as const).map(k=><div className="panel" key={k}><strong>{stats?.[k]?.toLocaleString()??'—'}</strong><p>{k}</p></div>)}</section>:view==='search'?<section className="panel"><h3>Ask your repository</h3><div className="form"><input aria-label="Question" value={question} onChange={e=>setQuestion(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')search()}}/><button disabled={busy} onClick={search}>Search</button></div>{hits.map((h,i)=><article key={i} className="result"><strong>{h.file}</strong><span>Score {h.score}</span><p>{h.reasons.join(' · ')}</p><pre>{h.excerpt}</pre></article>)}</section>:<section className="panel"><h3>Dependency Explorer</h3><div className="form"><input aria-label="Dependency filter" value={filter} onChange={e=>setFilter(e.target.value)}/><button disabled={busy} onClick={graph}>Explore</button></div>{edges.map((e,i)=><div className="edge" key={i}><code>{e.from}</code> → <code>{e.to}</code></div>)}</section>}</main></div>
}
createRoot(document.getElementById('root')!).render(<App/>);
