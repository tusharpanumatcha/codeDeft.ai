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
    <details className="json" onToggle={toggle}>
      <summary>{label}</summary>
      {open && (loaded.loading ? <p role="status">Loading…</p> : loaded.error ? <p className="error" role="alert">{loaded.error}</p> : text && <>
        <pre className="source" tabIndex={0}>{text.length > MAX_RENDER_CHARS ? text.slice(0, MAX_RENDER_CHARS) + '\n… truncated on screen' : text}</pre>
        <button type="button" className="secondary" onClick={download}>Download JSON ({Math.ceil(text.length / 1024).toLocaleString()} KB)</button>
      </>)}
    </details>
  );
}
