import React, { useState } from 'react';
import type { GeneratedProposal } from '../../../../packages/protocol/src/index';

const VSCODE_URI = 'vscode://codedeft-local.codedeft-vscode/proposal';

async function copy(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

/** One generated proposal, readable: every file as path + size + code, rendered only when expanded. */
export function ProposalView({ result, title }: { result: GeneratedProposal; title: string }) {
  const [copied, setCopied] = useState<string>('');
  const changes = result.proposal.changes;
  const flash = (msg: string) => { setCopied(msg); setTimeout(() => setCopied(''), 2500); };
  return (
    <section className="panel" aria-label={title}>
      <h3>{title} <span className="badge">review only</span></h3>
      <p className="muted">{changes.length} new file{changes.length === 1 ? '' : 's'} · nothing has been written to your repository.</p>
      {result.proposal.rationale && <p>{result.proposal.rationale}</p>}
      <ul className="files">
        {changes.map(change => <FileItem key={change.path} path={change.path} content={change.content} onCopied={flash} />)}
      </ul>
      <div className="actions">
        {result.proposalId
          ? <>
              <a className="button" href={`${VSCODE_URI}?id=${encodeURIComponent(result.proposalId)}`}>Open in VS Code to review and create</a>
              <button type="button" className="secondary" onClick={async () => flash(await copy(result.proposalId!) ? 'Proposal ID copied' : 'Copy failed: select the ID manually')}>Copy proposal ID</button>
              <code className="muted" aria-label="Proposal ID">{result.proposalId}</code>
            </>
          : <p className="notice">This server version cannot hand proposals to VS Code. Update the server, or copy the files manually.</p>}
      </div>
      <p className="muted small">In VS Code you can also run <strong>codeDeft: Open Proposal by ID</strong>. Files are only created after you approve them there.</p>
      <p role="status" className="small">{copied}</p>
      {typeof result.warning === 'string' && <p className="muted small">{result.warning}</p>}
    </section>
  );
}

function FileItem({ path, content, onCopied }: { path: string; content: string; onCopied(msg: string): void }) {
  const [open, setOpen] = useState(false);
  const bytes = new TextEncoder().encode(content).length;
  return (
    <li>
      <details onToggle={e => setOpen(e.currentTarget.open)}>
        <summary><code>{path}</code> <span className="muted">{bytes.toLocaleString()} bytes · {content.split('\n').length} lines</span></summary>
        {open && <>
          <pre className="source code" tabIndex={0}><code>{content}</code></pre>
          <button type="button" className="secondary" onClick={async () => onCopied(await copy(content) ? `${path} copied` : 'Copy failed')}>Copy file</button>
        </>}
      </details>
    </li>
  );
}
