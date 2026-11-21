import React, { useEffect, useState } from 'react';
import type { FigmaReadResponse, GeneratedProposal } from '../../../../packages/protocol/src/index';
import { api } from '../api';
import { Field } from '../components/Field';
import { Busy, ErrorText, RequireCapability } from '../components/Feedback';
import { JsonViewer } from '../components/JsonViewer';
import { ProposalView } from '../components/ProposalView';
import { useTask } from '../state/useTask';
import { useWorkspace } from '../state/workspace';
import { plural } from '../format';

export function Figma() {
  const ws = useWorkspace();
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const read = useTask<FigmaReadResponse>();
  const analysis = useTask<Record<string, unknown>>();
  const generated = useTask<GeneratedProposal>();
  const intent = ws.intents.figma;
  useEffect(() => { if (intent) setUrl(intent.url); }, [intent?.nonce]);

  const design = read.data;
  const readDesign = () => { analysis.reset(); generated.reset(); return read.run(async signal => {
    if (!url.trim()) throw new Error('Paste a Figma file or frame URL.');
    if (!token.trim()) throw new Error('Paste a Figma personal access token.');
    const result = await api.figmaRead(url.trim(), token, { signal });
    setToken(''); // only needed for this one request
    return result;
  }); };
  const analyze = () => analysis.run(signal => api.figmaPlan({ repository: ws.requireRepository(), designId: design!.designId }, { signal }));
  const generate = () => generated.run(signal => api.figmaGenerate({ repository: ws.requireRepository(), designId: design!.designId }, { signal }));

  return (
    <RequireCapability capabilities={['figma.read', 'figma.designs', 'figma.plan']}>
      <section className="panel">
        <h3>Read a Figma design</h3>
        <p className="muted">Your token is sent once to the local codeDeft server, which uses it for this single request to Figma. It is never saved (not in the browser, not on the server) and never logged. The field is cleared after a successful read and kept after a failed one so you can retry.</p>
        <Field label="Figma file or frame URL" type="url" value={url} onChange={setUrl} placeholder="https://www.figma.com/design/FILE/Name?node-id=12-45" hint="Use “Copy link to selection” in Figma so the link includes node-id: whole files can be too large." />
        <Field label="Figma personal access token" type="password" value={token} onChange={setToken} autoComplete="off" onEnter={readDesign} />
        <div className="actions"><button type="button" disabled={read.running} onClick={readDesign}>Read design</button></div>
        <Busy running={read.running} label="Reading from Figma…" onCancel={read.cancel} />
        <ErrorText error={read.error} />
      </section>
      {design && <section className="panel" aria-label="Design">
        <h3>{design.summary.name || 'Untitled design'}</h3>
        <p>{plural(design.summary.nodeCount, 'layer')} · {design.summary.nodeId ? 'selected frame' : 'whole file'} · {plural(design.summary.components.length, 'component')} · {plural(design.summary.texts.length, 'text layer')}</p>
        {design.warnings.map(w => <p className="notice" key={w}>{w}</p>)}
        <p className="muted small">Kept on the server until {new Date(design.expiresAt).toLocaleTimeString()} (refreshed while you use it).</p>
        <div className="actions">
          <button type="button" disabled={analysis.running} onClick={analyze}>Analyze with repository</button>
          <button type="button" disabled={generated.running || !ws.has('figma.generate')} onClick={generate}>Generate independent proposal</button>
        </div>
        <JsonViewer key={design.designId} label="Normalized design JSON" load={() => api.figmaDesign(design.designId)} />
      </section>}
      <Busy running={analysis.running} label="Analyzing…" />
      <ErrorText error={analysis.error} />
      {analysis.data && <section className="panel"><h3>Repository evidence</h3>
        <ul>{(Array.isArray(analysis.data.repositoryEvidence) ? analysis.data.repositoryEvidence as { path: string; score: number }[] : []).map(e => <li key={e.path}><code>{e.path}</code> <span className="muted">score {e.score}</span></li>)}</ul>
        <JsonViewer label="Full analysis JSON" value={analysis.data} /></section>}
      <Busy running={generated.running} label="Generating with your model… this can take a few minutes." onCancel={generated.cancel} />
      <ErrorText error={generated.error} />
      {generated.data && <ProposalView result={generated.data} title="Figma proposal" />}
    </RequireCapability>
  );
}
