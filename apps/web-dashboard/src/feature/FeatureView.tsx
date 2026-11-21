import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Alert } from '../components/Feedback';
import { Field } from '../components/Field';
import { Icon } from '../components/Icon';
import type { FeatureController } from '../state/features';
import { Composer, type ComposerHandle } from './Composer';
import { ContextPanel, type PanelTab } from './ContextPanel';
import { MessageCard } from './MessageCard';
import { STATUS } from './status';

const COMPACT = '(max-width: 1279px)';
function useCompact(): boolean {
  return useSyncExternalStore(
    cb => { const m = window.matchMedia?.(COMPACT); m?.addEventListener?.('change', cb); return () => m?.removeEventListener?.('change', cb); },
    () => !!window.matchMedia?.(COMPACT).matches, () => false);
}

export function FeatureView({ ctl, onArchived, focusComposer, onFocused }: { ctl: FeatureController; onArchived(name: string, id: string): void; focusComposer?: boolean; onFocused?(): void }) {
  const detail = ctl.detail!;
  const { feature, messages } = detail;
  const [tab, setTab] = useState<PanelTab>('summary');
  const compact = useCompact();
  const [panelOpen, setPanelOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(feature.name);
  const composer = useRef<ComposerHandle>(null);
  const thread = useRef<HTMLDivElement>(null);
  useEffect(() => { setName(feature.name); }, [feature.name]);
  useEffect(() => { thread.current?.scrollTo?.({ top: thread.current.scrollHeight }); }, [messages.length, messages.at(-1)?.updatedAt]);
  useEffect(() => { setTab('summary'); setPanelOpen(false); setRenaming(false); }, [feature.id]);
  // A newly created feature starts with the cursor in the message box (once, so later re-renders never steal focus).
  useEffect(() => { if (focusComposer) { composer.current?.focus(); onFocused?.(); } }, [focusComposer, onFocused]);

  const showPanel = (t: PanelTab) => { setTab(t); setPanelOpen(true); };
  const st = STATUS[feature.status];
  const lastDesignRequest = [...messages].reverse().find(m => m.kind === 'design_request')?.id;
  const saveName = async () => { if (name.trim() && name.trim() !== feature.name) await ctl.update({ name: name.trim() }); setRenaming(false); };

  return (
    <div className="fc-feature">
      <section className="fc-main" aria-labelledby="feature-title">
        <header className="fc-header">
          {renaming
            ? <form className="row grow" onSubmit={e => { e.preventDefault(); void saveName(); }} onKeyDown={e => { if (e.key === 'Escape') { setName(feature.name); setRenaming(false); } }}>
                <Field className="grow" label="Feature name" value={name} onChange={setName} labelHidden />
                <button type="submit" className="btn btn-primary">Save</button>
                <button type="button" className="btn btn-secondary" onClick={() => { setName(feature.name); setRenaming(false); }}>Cancel</button>
              </form>
            : <>
                <h1 id="feature-title" tabIndex={-1}>{feature.name}</h1>
                <span className={`status-badge tone-${st.tone}`}>{st.label}</span>
                <span className="spacer" />
                <button type="button" className="btn btn-secondary" onClick={() => setRenaming(true)}>Rename</button>
                {feature.status === 'done'
                  ? <button type="button" className="btn btn-secondary" onClick={() => void ctl.update({ status: 'exploring' })}>Reopen</button>
                  : <button type="button" className="btn btn-secondary" disabled={feature.status === 'generating'} onClick={() => void ctl.update({ status: 'done' })}>Mark done</button>}
                <button type="button" className="btn btn-secondary" onClick={async () => { if (await ctl.update({ archived: true })) onArchived(feature.name, feature.id); }}>Archive</button>
                {compact && <button type="button" className="btn btn-secondary" aria-expanded={panelOpen} aria-controls="feature-context" onClick={() => setPanelOpen(o => !o)}><Icon name="panel" size={16} />Context</button>}
              </>}
        </header>

        <div className="fc-thread" ref={thread} role="log" aria-label={`${feature.name} conversation`} aria-live="polite" aria-relevant="additions text">
          {messages.length === 0
            ? <StartCards onStart={prefill => composer.current?.focus(prefill)} />
            : messages.map(m => <MessageCard key={m.id} message={m} context={feature.context} latestDesignRequest={m.id === lastDesignRequest && !feature.context.design} busy={!!ctl.busy} showPanel={showPanel} readDesign={ctl.readDesign} />)}
          {ctl.busy && <p className="busy" role="status"><span className="spinner" aria-hidden="true" />{ctl.busy}</p>}
        </div>
        {ctl.error && <div className="fc-error"><Alert tone="error" action={<div><button type="button" className="btn btn-secondary" onClick={ctl.clearError}>Dismiss</button></div>}>{ctl.error}</Alert></div>}
        <Composer ref={composer} onSend={ctl.send} busy={!!ctl.busy} disabled={feature.status === 'generating'} />
      </section>
      {(!compact || panelOpen) && <div id="feature-context" className="fc-context-wrap"><ContextPanel feature={feature} tab={tab} onTab={setTab} ctl={ctl} overlay={compact} onClose={() => setPanelOpen(false)} /></div>}
    </div>
  );
}

function StartCards({ onStart }: { onStart(prefill: string): void }) {
  const cards = [
    { title: 'From a Figma frame', body: 'Paste a frame link; codeDeft reads it and finds matching code.', prefill: '/figma ', icon: 'figma' as const },
    { title: 'Find code to reuse', body: 'Describe what you need before writing anything new.', prefill: '/reuse ', icon: 'reuse' as const },
    { title: 'Ask about the code', body: 'Understand how something works first.', prefill: '', icon: 'search' as const }
  ];
  return (
    <div className="start">
      <h2>What are you building?</h2>
      <p className="muted">This feature keeps its own chat, design, reuse decisions, dependencies and proposals. Start in any of these ways:</p>
      <div className="start-grid">
        {cards.map(c => <button key={c.title} type="button" className="start-card" onClick={() => onStart(c.prefill)}>
          <Icon name={c.icon} size={22} /><strong>{c.title}</strong><span className="small muted">{c.body}</span>
        </button>)}
      </div>
    </div>
  );
}
