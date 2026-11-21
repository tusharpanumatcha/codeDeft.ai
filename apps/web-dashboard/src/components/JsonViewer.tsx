import React, { useMemo, useState } from 'react';
import { errorMessage } from '../api';

const MAX_RENDER_CHARS = 200_000;

/**
 * Collapsible JSON view that does no work while closed: the value is serialised only when opened (and
 * memoised), so large designs do not slow down typing elsewhere. Very large values are truncated on
 * screen with a full download. Pass `load` to fetch the value lazily on first open.
 */
export function JsonViewer({ label, value, load }: { label: string; value?: unknown; load?(): Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<{ value?: unknown; error?: string; loading: boolean }>({ loading: false });
  const data = load ? loaded.value : value;
  const text = useMemo(() => open && data !== undefined ? JSON.stringify(data, null, 2) : '', [open, data]);

  const toggle = (event: React.SyntheticEvent<HTMLDetailsElement>) => {
    const isOpen = event.currentTarget.open; setOpen(isOpen);
    if (isOpen && load && loaded.value === undefined && !loaded.loading) {
      setLoaded({ loading: true });
      load().then(v => setLoaded({ value: v, loading: false }), e => setLoaded({ error: errorMessage(e), loading: false }));
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <details onToggle={toggle}>
      <summary>{label}</summary>
      {open && (loaded.loading ? <p className="busy" role="status"><span className="spinner" aria-hidden="true" />Loading…</p> : loaded.error ? <div className="alert error" role="alert">{loaded.error}</div> : text && <div className="stack-sm">
        <pre className="code-block wrap" tabIndex={0} aria-label={label}>{text.length > MAX_RENDER_CHARS ? text.slice(0, MAX_RENDER_CHARS) + '\n… truncated on screen' : text}</pre>
        <div className="row"><button type="button" className="btn btn-secondary" onClick={download}>Download JSON ({Math.ceil(text.length / 1024).toLocaleString()} KB)</button></div>
      </div>)}
    </details>
  );
}
