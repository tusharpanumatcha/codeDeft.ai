import React, { useId } from 'react';

type Props = {
  label: string; value: string; onChange(value: string): void;
  type?: 'text' | 'password' | 'url' | 'search'; placeholder?: string; hint?: string; error?: string;
  onEnter?(): void; autoComplete?: string; disabled?: boolean; className?: string; id?: string; required?: boolean;
  labelHidden?: boolean;
};
/** Text input with a programmatically associated label, hint and error (WCAG 1.3.1, 3.3.1, 3.3.2). */
export function Field({ label, value, onChange, type = 'text', placeholder, hint, error, onEnter, autoComplete, disabled, className, id, required, labelHidden }: Props) {
  const auto = useId(); const fieldId = id ?? auto;
  const describedBy = [hint && `${fieldId}-hint`, error && `${fieldId}-error`].filter(Boolean).join(' ') || undefined;
  return (
    <div className={'field ' + (className ?? '')}>
      <label htmlFor={fieldId} className={labelHidden ? 'sr-only' : undefined}>{label}{required && <span aria-hidden="true"> *</span>}</label>
      <input id={fieldId} className="input" type={type} value={value} placeholder={placeholder} autoComplete={autoComplete} disabled={disabled} required={required}
        spellCheck={type === 'password' ? false : undefined} aria-invalid={error ? true : undefined} aria-describedby={describedBy}
        onChange={e => onChange(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && onEnter) { e.preventDefault(); onEnter(); } }} />
      {hint && <span id={`${fieldId}-hint`} className="hint">{hint}</span>}
      {error && <span id={`${fieldId}-error`} className="hint" style={{ color: 'var(--danger)' }}>{error}</span>}
    </div>
  );
}

export function SelectField<T extends string>({ label, value, onChange, options, hint }: { label: string; value: T; onChange(value: T): void; options: { value: T; label: string }[]; hint?: string }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} className="select" value={value} aria-describedby={hint ? `${id}-hint` : undefined} onChange={e => onChange(e.target.value as T)}>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
      {hint && <span id={`${id}-hint`} className="hint">{hint}</span>}
    </div>
  );
}
