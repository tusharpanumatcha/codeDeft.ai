import React, { useEffect, useId, useState } from 'react';
import { Field } from '../components/Field';
import { useWorkspace } from '../state/workspace';

/**
 * Reads a Figma frame into the feature. The token is kept only in this tab's memory when the user asks
 * (never stored, cleared when Figma rejects it) and is sent once to the local server for the request.
 */
export function DesignForm({ initialUrl, onRead, busy, compact }: { initialUrl?: string; onRead(url: string, token: string): Promise<boolean>; busy: boolean; compact?: boolean }) {
  const ws = useWorkspace();
  const [url, setUrl] = useState(initialUrl ?? '');
  const [token, setToken] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string>();
  const rememberId = useId();
  useEffect(() => { if (initialUrl) setUrl(initialUrl); }, [initialUrl]);
  const connected = !!ws.figmaToken;
  const read = async () => {
    setError(undefined);
    if (!url.trim()) { setError('Paste a Figma frame link.'); return; }
    const use = token.trim() || ws.figmaToken;
    if (!use) { setError('Paste your Figma personal access token.'); return; }
    const ok = await onRead(url.trim(), use);
    if (ok) { if (token.trim() && remember) ws.setFigmaToken(token.trim()); setToken(''); }
    else if (!token.trim() && connected) ws.setFigmaToken(''); // remembered token rejected: forget it
  };
  return (
    <form className="stack-sm" onSubmit={e => { e.preventDefault(); void read(); }}>
      {!compact && <Field label="Figma frame link" type="url" value={url} onChange={setUrl} placeholder="https://www.figma.com/design/FILE/Name?node-id=12-45" hint="In Figma, right-click the frame › Copy link to selection." />}
      {connected
        ? <p className="small muted row" style={{ gap: 'var(--space-2)' }}><span className="status-dot" style={{ color: 'var(--success)' }} aria-hidden="true" />Figma connected for this tab <button type="button" className="btn btn-ghost small" onClick={() => ws.setFigmaToken('')}>Disconnect</button></p>
        : <>
            <Field label="Figma personal access token" type="password" value={token} onChange={setToken} autoComplete="off" hint="Sent once to your local codeDeft server for this request. Never saved or logged." />
            <label className="radio" htmlFor={rememberId} style={{ paddingLeft: 0 }}>
              <input id={rememberId} type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
              <span>Keep me connected in this tab</span>
            </label>
          </>}
      {error && <p className="small" role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
      <div className="row"><button type="submit" className="btn btn-primary" disabled={busy}>Read frame</button></div>
    </form>
  );
}
