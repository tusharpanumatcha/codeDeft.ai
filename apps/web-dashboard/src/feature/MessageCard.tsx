import React from 'react';
import type { FeatureContext, FeatureMessage, ReuseCandidate } from '../../../../packages/protocol/src/index';
import { Icon } from '../components/Icon';
import { DesignForm } from './DesignForm';
import type { PanelTab } from './ContextPanel';

const VSCODE_URI = 'vscode://codedeft-local.codedeft-vscode/proposal';
const choiceLabel = { reuse: '✓ Reuse', reference: 'Reference only', ignore: 'Ignored' } as const;

type Props = {
  message: FeatureMessage; context: FeatureContext; latestDesignRequest: boolean; busy: boolean;
  showPanel(tab: PanelTab): void; readDesign(url: string, token: string): Promise<boolean>;
};

/** One entry of the feature conversation. Results are compact cards; the full detail lives in the context panel. */
export function MessageCard({ message: m, context, latestDesignRequest, busy, showPanel, readDesign }: Props) {
  if (m.role === 'user') return <div className="msg user"><span className="sr-only">You: </span>{m.text}</div>;
  const p = m.payload ?? {};
  switch (m.kind) {
    case 'search': {
      const hits = Array.isArray(p.hits) ? p.hits as { path: string; why?: string[] }[] : [];
      return <Card title={m.text} action={hits.length ? <PanelButton tab="files" label="Show in panel" showPanel={showPanel} /> : undefined}>
        {hits.length > 0 && <ul className="rows">{hits.map(h => <li key={h.path} className="row-item"><span className="mono">{h.path}</span><span className="small muted">{(h.why ?? []).slice(0, 3).join(' · ')}</span></li>)}</ul>}
      </Card>;
    }
    case 'reuse': {
      const ids = Array.isArray(p.candidates) ? p.candidates as string[] : [];
      const all = context.reuse?.candidates ?? [];
      const shown = ids.map(id => all.find(c => c.id === id)).filter((c): c is ReuseCandidate => !!c);
      return <Card title={m.text} action={shown.length ? <PanelButton tab="reuse" label="Compare in panel" showPanel={showPanel} /> : undefined}>
        {shown.length > 0 && <ul className="rows">{shown.map(c => {
          const choice = context.reuse?.choices[c.id];
          return <li key={c.id} className="row-item"><span className="mono">{c.kind === 'vue-component' ? c.file.split('/').pop() : `${c.name}() in ${c.file.replace(/^src\//, '')}`}</span>
            <span className={`small ${choice === 'reuse' ? 'tone-success strong' : 'muted'}`}>{choice ? choiceLabel[choice] : 'Not decided'}</span></li>;
        })}</ul>}
      </Card>;
    }
    case 'design_request':
      return <Card title={typeof p.url === 'string' ? 'Figma frame' : 'Add a Figma frame'}>
        {typeof p.url === 'string' && <p className="mono small" style={{ overflowWrap: 'anywhere' }}>{p.url}</p>}
        {latestDesignRequest ? <DesignForm initialUrl={typeof p.url === 'string' ? p.url : undefined} compact={typeof p.url === 'string'} onRead={readDesign} busy={busy} /> : <p className="small muted">{m.text}</p>}
      </Card>;
    case 'design':
      return <Card title={m.text} media={<div className="frame-thumb" role="img" aria-label={`Frame ${String(p.name ?? '')}`}>Frame</div>} action={<PanelButton tab="design" label="Show in panel" showPanel={showPanel} />}>
        <p className="muted">{String(p.nodeCount ?? '?')} layers · {String(p.components ?? 0)} components.{Array.isArray(p.closest) && p.closest.length ? ` Closest existing files: ${(p.closest as string[]).map(f => f.split('/').pop()).join(', ')}.` : ''}</p>
      </Card>;
    case 'graph': {
      const edges = Array.isArray(p.edges) ? p.edges as { from: string; to: string }[] : [];
      return <Card title={m.text} action={edges.length ? <PanelButton tab="files" label="Show in panel" showPanel={showPanel} /> : undefined}>
        {edges.length > 0 && <ul className="rows mono small">{edges.slice(0, 8).map(e => <li key={e.from + e.to} className="row-item"><span>{e.from} <span aria-label="imports">→</span> {e.to}</span></li>)}</ul>}
        {edges.length > 8 && <p className="small muted">and {edges.length - 8} more in the panel</p>}
      </Card>;
    }
    case 'generating':
      return <Card title={m.text}><p className="busy" role="status"><span className="spinner" aria-hidden="true" />The model is writing the files; codeDeft then checks every import against the repository. You can leave this feature and come back.</p></Card>;
    case 'proposal': {
      const files = Array.isArray(p.files) ? p.files as { path: string }[] : [];
      const v = (p.verification ?? {}) as { ok?: boolean; errors?: number; attempts?: number };
      const reuses = Array.isArray(p.reuses) ? p.reuses as string[] : [];
      return <Card title={m.text} tone="success" meta={`${reuses.length ? `reuses ${reuses.length} · ` : ''}not applied`}>
        <p className="mono small muted">{files.map(f => f.path.split('/').pop()).join(' · ')}</p>
        <p className={`small ${v.errors ? 'tone-danger' : 'tone-success'}`}><Icon name={v.errors ? 'alert' : 'check'} size={14} /> {v.errors ? `${v.errors} reference${v.errors === 1 ? ' does' : 's do'} not exist in the repository` : 'Checked: every import, export and package exists'}{(v.attempts ?? 1) > 1 ? ' (after an automatic fix)' : ''}</p>
        <div className="row">
          {typeof p.proposalId === 'string' && <a className="btn btn-primary" href={`${VSCODE_URI}?id=${encodeURIComponent(p.proposalId)}`}>Open in VS Code</a>}
          <PanelButton tab="proposal" label="Review files in panel" showPanel={showPanel} />
        </div>
      </Card>;
    }
    case 'error':
      return <div className="msg error" role="alert"><Icon name="alert" size={16} /><span>{m.text}</span></div>;
    default:
      return <div className="msg assistant"><span className="sr-only">codeDeft: </span>{m.text}</div>;
  }
}

function Card({ title, children, action, media, tone, meta }: { title: string; children?: React.ReactNode; action?: React.ReactNode; media?: React.ReactNode; tone?: 'success'; meta?: string }) {
  return (
    <article className={`msg-card ${tone === 'success' ? 'success' : ''}`}>
      {media}
      <div className="stack-sm grow">
        <div className="row" style={{ justifyContent: 'space-between' }}><h2 className="card-title">{title}</h2>{meta && <span className="small muted">{meta}</span>}</div>
        {children}
        {action && <div className="row">{action}</div>}
      </div>
    </article>
  );
}
function PanelButton({ tab, label, showPanel }: { tab: PanelTab; label: string; showPanel(t: PanelTab): void }) {
  return <button type="button" className="btn btn-secondary" onClick={() => showPanel(tab)}>{label}</button>;
}
