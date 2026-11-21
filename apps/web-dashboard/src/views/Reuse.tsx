import React, { useEffect, useState } from 'react';
import type { GeneratedProposal, ReuseDecision, ReuseUnit } from '../../../../packages/protocol/src/index';
import { api } from '../api';
import { Field, SelectField } from '../components/Field';
import { Busy, ErrorText, RequireCapability } from '../components/Feedback';
import { JsonViewer } from '../components/JsonViewer';
import { ProposalView } from '../components/ProposalView';
import { useTask } from '../state/useTask';
import { useWorkspace } from '../state/workspace';
import { plural } from '../format';

const decisions: { value: ReuseDecision; label: string }[] = [
  { value: 'reuse', label: 'Reuse (import the existing code)' },
  { value: 'extract', label: 'Extract shared logic' },
  { value: 'extend', label: 'Extend the existing code' },
  { value: 'independent', label: 'Independent (new files only)' }
];

export function Reuse() {
  const ws = useWorkspace();
  const [requirement, setRequirementState] = useState('Find reusable authentication validation logic');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [decision, setDecision] = useState<ReuseDecision>('independent');
  const [target, setTarget] = useState('');
  const discovery = useTask<{ results: ReuseUnit[]; scannedUnits: number; disclaimer: string }>();
  const plan = useTask<Record<string, unknown>>();
  const proposal = useTask<GeneratedProposal>();

  // Plans and proposals belong to one requirement + candidate + decision; any change makes them stale.
  const clearDownstream = () => { plan.reset(); proposal.reset(); };
  const setRequirement = (value: string) => { setRequirementState(value); clearDownstream(); };
  const discover = (text = requirement) => { clearDownstream(); setSelectedId(null); return discovery.run(async signal => {
    if (!text.trim()) throw new Error('Describe the functionality to look for.');
    const found = await api.discover(ws.requireRepository(), text, 15, { signal });
    setSelectedId(found.results[0]?.id ?? null);
    return found;
  }); };
  const intent = ws.intents.reuse;
  useEffect(() => { if (intent) { setRequirementState(intent.requirement); clearDownstream(); if (intent.autorun && ws.repository.trim()) void discover(intent.requirement); } }, [intent?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const units = discovery.data?.results ?? [];
  const selected = units.find(u => u.id === selectedId) ?? null;
  const select = (id: string) => { setSelectedId(id); clearDownstream(); };
  const prepare = () => plan.run(signal => api.decision({ repository: ws.requireRepository(), requirement, decision, sourceFile: selected?.file, targetFile: target.trim() || undefined }, { signal }));
  const generate = () => proposal.run(signal => api.generateIndependent(ws.requireRepository(), requirement, { signal }));

  return (
    <RequireCapability capabilities={['reuse.discover']}>
      <section className="panel">
        <h3>Find reusable code anywhere in your repository</h3>
        <p className="muted">Functions, classes, components and embedded logic. Scores and effort are heuristics; review the source before deciding.</p>
        <div className="form end"><Field className="grow" label="What functionality do you need?" value={requirement} onChange={setRequirement} onEnter={() => discover()} /><button type="button" disabled={discovery.running} onClick={() => discover()}>Discover</button></div>
        <Busy running={discovery.running} label="Scanning the repository…" onCancel={discovery.cancel} />
        <ErrorText error={discovery.error} />
        {discovery.data && <p role="status" className="small">{plural(units.length, 'candidate')} across {plural(discovery.data.scannedUnits, 'scanned code unit')}</p>}
      </section>
      {discovery.data && <div className="two-col">
        <section className="panel" aria-label="Candidates">
          <h3>Candidates ({units.length})</h3>
          {!units.length && <p className="muted">No likely matches. Try different words.</p>}
          <ul className="candidates">{units.map(u => <li key={u.id}>
            <button type="button" className={'candidate ' + (u.id === selectedId ? 'chosen' : '')} aria-pressed={u.id === selectedId} onClick={() => select(u.id)}>
              <strong>{u.name}</strong><small>{u.kind} · score {u.score} · {u.effort.level} effort</small><code>{u.file}:{u.startLine}–{u.endLine}</code>
            </button></li>)}</ul>
        </section>
        <section className="panel" aria-label="Selected candidate">
          {selected ? <>
            <h3>{selected.name}</h3>
            <p className="muted">{selected.file}:{selected.startLine}–{selected.endLine}</p>
            <p>{selected.reasons.join(' · ')}</p>
            <h4>Source excerpt</h4><pre className="source" tabIndex={0}>{selected.excerpt}</pre>
            <h4>Imports</h4><pre tabIndex={0}>{selected.imports.join('\n') || 'No imports detected'}</pre>
            <p className="muted">Referenced from: {selected.usedBy.join(', ') || 'no other files detected'}</p>
            <p>Effort: <strong>{selected.effort.level}</strong> — {selected.effort.reasons.join('; ')}</p>
            <div className="form end">
              <SelectField label="Implementation decision" value={decision} onChange={v => { setDecision(v); clearDownstream(); }} options={decisions} />
              <Field className="grow" label="Target file (optional)" value={target} onChange={setTarget} placeholder="src/features/new-feature.ts" />
            </div>
            <div className="actions">
              <button type="button" disabled={plan.running || !ws.has('reuse.decision')} onClick={prepare}>Prepare decision plan</button>
              {decision === 'independent' && <button type="button" disabled={proposal.running || !ws.has('reuse.generate')} onClick={generate}>Generate independent proposal</button>}
            </div>
          </> : <p className="muted">Select a candidate to inspect its source.</p>}
        </section>
      </div>}
      <Busy running={plan.running} label="Preparing plan…" />
      <ErrorText error={plan.error} />
      {plan.data && <section className="panel"><h3>Decision plan <span className="badge">approval required</span></h3><p>{String(plan.data.action ?? '')}</p>
        {Array.isArray(plan.data.constraints) && <ul>{plan.data.constraints.map(c => <li key={String(c)}>{String(c)}</li>)}</ul>}
        <JsonViewer label="Full plan JSON" value={plan.data} /><p className="small">No files have been changed.</p></section>}
      <Busy running={proposal.running} label="Generating with your model… this can take a few minutes." onCancel={proposal.cancel} />
      <ErrorText error={proposal.error} />
      {proposal.data && <ProposalView result={proposal.data} title="Generated proposal" />}
    </RequireCapability>
  );
}
