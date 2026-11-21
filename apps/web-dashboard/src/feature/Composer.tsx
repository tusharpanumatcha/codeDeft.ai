import React, { forwardRef, useImperativeHandle, useId, useRef, useState } from 'react';
import { Icon } from '../components/Icon';

export const COMMANDS = [
  { cmd: '/reuse', label: 'Find reusable code', hint: 'Candidates appear in the Reuse tab' },
  { cmd: '/figma', label: 'Add Figma frame', hint: 'Read a design into this feature' },
  { cmd: '/graph', label: 'Show dependencies', hint: 'Only the files this feature touches' },
  { cmd: '/generate', label: 'Generate proposal', hint: 'New files, checked, reviewed in VS Code' }
] as const;

export type ComposerHandle = { focus(prefill?: string): void };

/**
 * Message box with a slash-command menu (WAI-ARIA combobox + listbox): typing "/" opens the menu,
 * ↑/↓ move, Enter or Tab chooses, Esc closes. Enter without the menu sends the message.
 */
export const Composer = forwardRef<ComposerHandle, { onSend(text: string): Promise<boolean>; busy: boolean; disabled?: boolean }>(function Composer({ onSend, busy, disabled }, ref) {
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  useImperativeHandle(ref, () => ({ focus: (prefill?: string) => { if (prefill !== undefined) { setText(prefill); setDismissed(true); } input.current?.focus(); } }));

  const query = text.startsWith('/') && !text.includes(' ') ? text.toLowerCase() : null;
  const options = query !== null ? COMMANDS.filter(c => c.cmd.startsWith(query)) : [];
  const open = !dismissed && options.length > 0;
  const choose = (cmd: string) => { setText(cmd + ' '); setDismissed(true); setActive(0); input.current?.focus(); };
  const send = async () => {
    const value = text.trim();
    if (!value || busy || disabled) return;
    if (await onSend(value)) { setText(''); setDismissed(false); }
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (open && e.key === 'ArrowDown') { e.preventDefault(); setActive(a => (a + 1) % options.length); }
    else if (open && e.key === 'ArrowUp') { e.preventDefault(); setActive(a => (a - 1 + options.length) % options.length); }
    else if (open && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); choose(options[Math.min(active, options.length - 1)]!.cmd); }
    else if (open && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setDismissed(true); }
    else if (e.key === 'Enter') { e.preventDefault(); void send(); }
  };

  return (
    <div className="composer">
      <div role="group" aria-label="Quick actions" className="chips">
        {COMMANDS.map(c => <button key={c.cmd} type="button" className="chip" disabled={disabled} onClick={() => choose(c.cmd)}><span className="mono muted chip-cmd" aria-hidden="true">{c.cmd}</span>{c.label}</button>)}
      </div>
      <label htmlFor={`${id}-input`} className="label">Message</label>
      <div className="row composer-row" style={{ position: 'relative', flexWrap: 'nowrap' }}>
        {open && <ul id={`${id}-list`} role="listbox" aria-label="Actions" className="slash-menu">
          {options.map((o, i) => <li key={o.cmd} id={`${id}-opt-${i}`} role="option" aria-selected={i === active} className="slash-option" onMouseDown={e => { e.preventDefault(); choose(o.cmd); }}>
            <span className="mono">{o.cmd}</span><span className="stack-sm" style={{ gap: 0 }}><span>{o.label}</span><span className="small muted">{o.hint}</span></span>
          </li>)}
          <li role="presentation" className="small muted slash-help">↑ ↓ to move · Enter to choose · Esc to close</li>
        </ul>}
        <input ref={input} id={`${id}-input`} className="input composer-input" value={text} disabled={disabled} autoComplete="off"
          placeholder="Ask about this feature, or type / for actions"
          role="combobox" aria-expanded={open} aria-controls={open ? `${id}-list` : undefined} aria-autocomplete="list"
          aria-activedescendant={open ? `${id}-opt-${Math.min(active, options.length - 1)}` : undefined}
          onChange={e => { setText(e.target.value); setDismissed(false); setActive(0); }} onKeyDown={onKeyDown} />
        <button type="button" className="btn btn-primary btn-icon composer-send" aria-label="Send message" disabled={busy || disabled || !text.trim()} onClick={() => void send()}><Icon name="send" /></button>
      </div>
    </div>
  );
});
