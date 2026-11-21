import React, { useEffect, useId, useRef, useState } from 'react';
import type { Feature, ReuseChoice, StoredProposal } from '../../../../packages/protocol/src/index';
import { api, errorMessage } from '../api';
import { Alert } from '../components/Feedback';
import { Field } from '../components/Field';
import { Icon } from '../components/Icon';
import { JsonViewer } from '../components/JsonViewer';
import { ProposalView } from '../components/ProposalView';
import type { FeatureController } from '../state/features';
import { DesignForm } from './DesignForm';

export const PANEL_TABS = ['summary', 'design', 'reuse', 'files', 'proposal'] as const;
export type PanelTab = typeof PANEL_TABS[number];
const TAB_LABEL: Record<PanelTab, string> = { summary: 'Summary', design: 'Design', reuse: 'Reuse', files: 'Files', proposal: 'Proposal' };
const VSCODE_URI = 'vscode://codedeft-local.codedeft-vscode/proposal';

/** The feature's current state, always in view: requirement, design, reuse decision, files and proposals. */
export function ContextPanel({ feature, tab, onTab, ctl, onClose, overlay }: { feature: Feature; tab: PanelTab; onTab(t: PanelTab): void; ctl: FeatureController; onClose?(): void; overlay: boolean }) {
  const id = useId();
  const tabs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onKey = (e: React.KeyboardEvent) => {
    const i = PANEL_TABS.indexOf(tab);
    const next = e.key === 'ArrowRight' ? (i + 1) % PANEL_TABS.length : e.key === 'ArrowLeft' ? (i - 1 + PANEL_TABS.length) % PANEL_TABS.length : e.key === 'Home' ? 0 : e.key === 'End' ? PANEL_TABS.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault(); onTab(PANEL_TABS[next]!); tabs.current[PANEL_TABS[next]!]?.focus();
  };
  return (
    <aside className={`fc-context ${overlay ? 'overlay' : ''}`} aria-labelledby={`${id}-title`} onKeyDown={e => { if (e.key === 'Escape' && overlay && onClose) onClose(); }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 id={`${id}-title`}>Feature context</h2>
        {overlay && onClose && <button type="button" className="btn btn-ghost btn-icon" aria-label="Close feature context" onClick={onClose}><Icon name="close" /></button>}
      </div>
      <div role="tablist" aria-label="Feature context" className="tabs" onKeyDown={onKey}>
        {PANEL_TABS.map(t => <button key={t} ref={el => { tabs.current[t] = el; }} type="button" role="tab" id={`${id}-tab-${t}`} aria-controls={`${id}-panel`} aria-selected={tab === t} tabIndex={tab === t ? 0 : -1} className="tab" onClick={() => onTab(t)}>{TAB_LABEL[t]}</button>)}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${tab}`} className="tabpanel" tabIndex={0}>
        {feature.stale && <div className="alert warning" role="status"><Icon name="alert" size={16} /><span>The repository was re-indexed after this analysis. <button type="button" className="btn btn-ghost inline-link" onClick={() => void ctl.refresh()} disabled={!!ctl.busy}>Re-run matching</button></span></div>}
        {tab === 'summary' && <Summary feature={feature} onTab={onTab} />}
        {tab === 'design' && <DesignTab feature={feature} ctl={ctl} />}
        {tab === 'reuse' && <ReuseTab feature={feature} ctl={ctl} />}
        {tab === 'files' && <FilesTab feature={feature} />}
        {tab === 'proposal' && <ProposalTab feature={feature} />}
      </div>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="ctx-section"><h3 className="section-label">{title}</h3>{children}</section>;
}
const Empty = ({ children }: { children: React.ReactNode }) => <p className="small muted">{children}</p>;

function Summary({ feature, onTab }: { feature: Feature; onTab(t: PanelTab): void }) {
  const c = feature.context;
  const chosen = (k: ReuseChoice) => (c.reuse?.candidates ?? []).filter(x => c.reuse?.choices[x.id] === k).map(x => x.kind === 'vue-component' ? x.file.split('/').pop()! : `${x.name}()`);
  const latest = c.proposals?.at(-1);
  const created = latest?.files.map(f => f.split('/').pop()!.replace(/\.\w+$/, '')) ?? [];
  return <>
    <Section title="Requirement">{feature.requirement ? <p>{feature.requirement}</p> : <Empty>Describe the feature in the chat.</Empty>}</Section>
    <Section title="Design">{c.design
      ? <button type="button" className="ctx-box row" style={{ width: '100%', cursor: 'pointer' }} onClick={() => onTab('design')}><span className="frame-thumb small-thumb" aria-hidden="true" /><span>{c.design.name} <span className="muted">· {c.design.nodeCount} layers</span></span></button>
      : <Empty>No Figma frame yet. Use /figma or paste a link.</Empty>}</Section>
    <Section title="Reuse decision">{chosen('reuse').length || created.length
      ? <p>{chosen('reuse').length > 0 && <><strong>Reuse</strong> {chosen('reuse').join(', ')}<br /></>}{created.length > 0 && <><strong>New</strong> {created.join(', ')}</>}</p>
      : <Empty>{c.reuse ? 'Choose which candidates to reuse in the Reuse tab.' : 'Use /reuse to find existing code first.'}</Empty>}</Section>
    <Section title="Files and dependencies">{c.edges?.length
      ? <ul className="ctx-box mono small edge-list">{c.edges.slice(0, 8).map(e => <li key={e.from + e.to}>{e.from.split('/').pop()} <span className="muted" aria-label="imports">→</span> {e.to.replace(/^src\/(components\/)?/, '')}</li>)}</ul>
      : c.files?.length ? <ul className="ctx-box mono small edge-list">{c.files.slice(0, 6).map(f => <li key={f.path}>{f.path}</li>)}</ul> : <Empty>Files appear as you ask questions.</Empty>}</Section>
    <Section title="Proposal">{latest
      ? <div className="ctx-box row" style={{ justifyContent: 'space-between' }}><span>v{latest.version} · {latest.files.length} files{latest.version > 1 && <span className="muted"> (v{latest.version - 1} replaced)</span>}</span><a href={`${VSCODE_URI}?id=${encodeURIComponent(latest.id)}`}>Open in VS Code</a></div>
      : <Empty>No proposal yet. Use /generate when ready.</Empty>}</Section>
  </>;
}

function DesignTab({ feature, ctl }: { feature: Feature; ctl: FeatureController }) {
  const d = feature.context.design;
  return <>
    {d && <Section title="Current frame">
      <div className="ctx-box stack-sm">
        <strong>{d.name}</strong>
        <span className="small muted">{d.nodeCount} layers · {d.components} components</span>
        {d.texts.length > 0 && <span className="small">Text: {d.texts.slice(0, 8).join(' · ')}</span>}
        <a className="small mono" href={d.url} target="_blank" rel="noreferrer" style={{ overflowWrap: 'anywhere' }}>{d.url}</a>
      </div>
      <JsonViewer key={d.designId} label="Design data (JSON)" load={() => api.figmaDesign(d.designId)} />
    </Section>}
    <Section title={d ? 'Read another frame' : 'Read a Figma frame'}><DesignForm onRead={ctl.readDesign} busy={!!ctl.busy} /></Section>
  </>;
}

function ReuseTab({ feature, ctl }: { feature: Feature; ctl: FeatureController }) {
  const [query, setQuery] = useState(feature.context.reuse?.query ?? feature.requirement);
  const r = feature.context.reuse;
  return <>
    <form className="row end" onSubmit={e => { e.preventDefault(); if (query.trim()) void ctl.send(`/reuse ${query.trim()}`); }}>
      <Field className="grow" label="Find existing code for" value={query} onChange={setQuery} />
      <button type="submit" className="btn btn-secondary" disabled={!!ctl.busy}>Find</button>
    </form>
    {!r ? <Empty>No candidates yet.</Empty> : !r.candidates.length ? <Empty>Nothing similar exists; new code is reasonable.</Empty> :
      <ul className="stack-sm" style={{ listStyle: 'none' }}>{r.candidates.map(c => {
        const choice = r.choices[c.id];
        return <li key={c.id} className="ctx-box stack-sm">
          <fieldset className="radio-group">
            <legend><span className="mono">{c.name}</span> <span className="small muted">{c.kind} · {c.file}:{c.startLine} · score {c.score}{c.usedBy ? ` · used by ${c.usedBy}` : ''}{c.exported === false ? ' · not exported' : ''}</span></legend>
            <div className="row" style={{ gap: 'var(--space-2)' }}>
              {(['reuse', 'reference', 'ignore'] as ReuseChoice[]).map(k => <label key={k} className="choice">
                <input type="radio" name={`choice-${c.id}`} checked={choice === k} onChange={() => void ctl.setReuse({ [c.id]: k })} />{k === 'reuse' ? 'Reuse' : k === 'reference' ? 'Reference only' : 'Ignore'}
              </label>)}
            </div>
          </fieldset>
          <details><summary className="small">Source</summary><pre className="code-block small" tabIndex={0}>{c.excerpt}</pre></details>
        </li>;
      })}</ul>}
  </>;
}

function FilesTab({ feature }: { feature: Feature }) {
  const c = feature.context;
  return <>
    <Section title="Relevant files">{c.files?.length ? <ul className="stack-sm" style={{ listStyle: 'none' }}>{c.files.map(f => <li key={f.path} className="ctx-box"><span className="mono small">{f.path}</span><br /><span className="small muted">{f.why.slice(0, 4).join(' · ')}</span></li>)}</ul> : <Empty>None yet.</Empty>}</Section>
    <Section title="Imports">{c.edges?.length ? <ul className="ctx-box mono small edge-list">{c.edges.map(e => <li key={e.from + e.to}>{e.from} <span className="muted" aria-label="imports">→</span> {e.to}</li>)}</ul> : <Empty>Use /graph to show dependencies.</Empty>}</Section>
  </>;
}

function ProposalTab({ feature }: { feature: Feature }) {
  const versions = feature.context.proposals ?? [];
  const [selected, setSelected] = useState(versions.at(-1)?.id);
  const [loaded, setLoaded] = useState<{ id: string; data?: StoredProposal; error?: string }>();
  useEffect(() => { setSelected(versions.at(-1)?.id); }, [versions.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!selected || loaded?.id === selected) return;
    let live = true;
    setLoaded({ id: selected });
    api.proposal(selected).then(d => { if (live) setLoaded({ id: selected, data: d }); }, e => { if (live) setLoaded({ id: selected, error: errorMessage(e) }); });
    return () => { live = false; };
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!versions.length) return <Empty>No proposal yet. Use /generate when the requirement and reuse decisions are ready.</Empty>;
  return <>
    {versions.length > 1 && <div className="row" role="group" aria-label="Versions">{versions.map(v => <button key={v.id} type="button" className="btn btn-secondary" aria-pressed={v.id === selected} onClick={() => setSelected(v.id)}>v{v.version}</button>)}</div>}
    {loaded?.error && <Alert tone="error">{loaded.error}</Alert>}
    {loaded?.data ? <ProposalView result={loaded.data.result} title={`Proposal v${versions.find(v => v.id === selected)?.version ?? ''}`} /> : !loaded?.error && <p className="busy" role="status"><span className="spinner" aria-hidden="true" />Loading proposal…</p>}
  </>;
}
