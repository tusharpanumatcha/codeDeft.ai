import React, { useId } from 'react';

type Props = {
  label: string; value: string; onChange(value: string): void;
  type?: 'text' | 'password' | 'url'; placeholder?: string; hint?: string;
  onEnter?(): void; autoComplete?: string; disabled?: boolean; className?: string;
};
/** Text input with a programmatically associated label and optional hint (screen-reader friendly). */
export function Field({ label, value, onChange, type = 'text', placeholder, hint, onEnter, autoComplete, disabled, className }: Props) {
  const id = useId(); const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className={'field ' + (className ?? '')}>
      <label htmlFor={id}>{label}</label>
      <input id={id} type={type} value={value} placeholder={placeholder} autoComplete={autoComplete} disabled={disabled} spellCheck={type === 'password' ? false : undefined}
        aria-describedby={hintId} onChange={e => onChange(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && onEnter) { e.preventDefault(); onEnter(); } }} />
      {hint && <small id={hintId}>{hint}</small>}
    </div>
  );
}

export function SelectField<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange(value: T): void; options: { value: T; label: string }[] }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={e => onChange(e.target.value as T)}>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
    </div>
  );
}
