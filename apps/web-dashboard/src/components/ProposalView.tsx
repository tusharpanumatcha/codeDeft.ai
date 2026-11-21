import React, { useState } from 'react';
import type { GeneratedProposal } from '../../../../packages/protocol/src/index';
import { Icon } from './Icon';
import { Alert } from './Feedback';

const VSCODE_URI = 'vscode://codedeft-local.codedeft-vscode/proposal';

async function copy(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

/** A generated proposal, readable: every file as path, size and code (rendered only when expanded). */
export function ProposalView({ result, title }: { result: GeneratedProposal; title: string }) {
  const [notice, setNotice] = useState('');
  const changes = result.proposal.changes;
  const flash = (msg: string) => { setNotice(msg); setTimeout(() => setNotice(''), 3000); };
  return (
    <section className="card" aria-labelledby="proposal-title">
      <div className="card-header">
        <h2 id="proposal-title">{title}</h2>
        <span className="badge success">{changes.length} new file{changes.length === 1 ? '' : 's'} · not applied</span>
      </div>
      {result.proposal.rationale && <p>{result.proposal.rationale}</p>}
      <VerificationSummary value={result.verification} />
      <ul className="list">
        {changes.map(change => <FileItem key={change.path} path={change.path} content={change.content} onCopied={flash} />)}
      </ul>
      <div className="card sunken" style={{ gap: 'var(--space-3)' }}>
        <h3>Next: review and create the files in VS Code</h3>
        {result.proposalId
          ? <>
              <div className="row">
                <a className="btn btn-primary" href={`${VSCODE_URI}?id=${encodeURIComponent(result.proposalId)}`}><Icon name="external" size={16} />Open in VS Code</a>
                <button type="button" className="btn btn-secondary" onClick={async () => flash(await copy(result.proposalId!) ? 'Proposal ID copied.' : 'Could not copy. Select the ID and copy it manually.')}><Icon name="copy" size={16} />Copy proposal ID</button>
                <code className="mono muted" aria-label="Proposal ID">{result.proposalId}</code>
              </div>
              <p className="small muted">Needs the codeDeft extension. If the link does nothing, run <strong>codeDeft: Open Proposal by ID</strong> in VS Code and paste the ID. Proposals are kept until the server restarts.</p>
            </>
          : <p className="small muted">This server version cannot hand proposals to VS Code. Update the server, or copy the files below.</p>}
      </div>
      <p role="status" className="small">{notice}</p>
    </section>
  );
}

function FileItem({ path, content, onCopied }: { path: string; content: string; onCopied(msg: string): void }) {
  const [open, setOpen] = useState(false);
  const bytes = new TextEncoder().encode(content).length;
  const lines = content.split('\n').length;
  return (
    <li className="list-item">
      <details onToggle={e => setOpen(e.currentTarget.open)}>
        <summary><span className="mono" style={{ color: 'var(--text)' }}>{path}</span><span className="small muted">{lines} line{lines === 1 ? '' : 's'} · {bytes.toLocaleString()} bytes</span></summary>
        {open && <div className="stack-sm">
          <pre className="code-block" tabIndex={0} aria-label={`Contents of ${path}`}><code>{content}</code></pre>
          <div className="row"><button type="button" className="btn btn-secondary" onClick={async () => onCopied(await copy(content) ? `${path} copied.` : 'Could not copy.')}><Icon name="copy" size={16} />Copy file</button></div>
        </div>}
      </details>
    </li>
  );
}

type VerificationLike = { ok?: unknown; errors?: unknown; warnings?: unknown; attempts?: unknown; files?: { path?: unknown; findings?: { severity?: unknown; message?: unknown; line?: unknown }[] }[] };

/** Result of codeDeft's check of the generated files against the repository (absent on older servers). */
function VerificationSummary({ value }: { value: unknown }) {
  if (!value || typeof value !== 'object') return null;
  const v = value as VerificationLike;
  const errors = typeof v.errors === 'number' ? v.errors : 0;
  const warnings = typeof v.warnings === 'number' ? v.warnings : 0;
  const attempts = typeof v.attempts === 'number' ? v.attempts : 1;
  const findings = (Array.isArray(v.files) ? v.files : []).flatMap(f => (Array.isArray(f.findings) ? f.findings : []).map(x => ({ path: String(f.path ?? ''), severity: String(x.severity ?? ''), message: String(x.message ?? ''), line: typeof x.line === 'number' ? x.line : undefined })));
  const repaired = attempts > 1 ? ` codeDeft sent ${attempts - 1 === 1 ? 'one round' : `${attempts - 1} rounds`} of fixes back to the model.` : '';
  return (
    <div className="stack-sm">
      {errors === 0
        ? <Alert tone="success">Checked against the repository: every imported file, export and package exists.{warnings ? ` ${warnings} warning${warnings === 1 ? '' : 's'} below.` : ''}{repaired}</Alert>
        : <Alert tone="error">{errors} reference{errors === 1 ? ' in this proposal does' : 's in this proposal do'} not exist in the repository.{repaired} Fix them before creating the files.</Alert>}
      {findings.length > 0 && <ul className="list">{findings.map((f, i) => <li key={i} className="list-item small"><span><strong>{f.severity === 'error' ? 'Error' : 'Warning'}</strong> · <span className="mono">{f.path}{f.line ? `:${f.line}` : ''}</span></span><span>{f.message}</span></li>)}</ul>}
    </div>
  );
}
