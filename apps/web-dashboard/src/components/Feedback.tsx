import React from 'react';
import type { Capability } from '../../../../packages/protocol/src/index';
import { missingCapabilityMessage } from '../../../../packages/protocol/src/index';
import { useWorkspace } from '../state/workspace';
import { Icon } from './Icon';

/** Error, warning, info or success message: icon + text + colour, announced to screen readers. */
export function Alert({ tone, children, action }: { tone: 'error' | 'warning' | 'info' | 'success'; children: React.ReactNode; action?: React.ReactNode }) {
  const icon = tone === 'error' || tone === 'warning' ? 'alert' : tone === 'success' ? 'check' : 'info';
  return (
    <div className={`alert ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon name={icon} size={16} />
      <div className="stack-sm grow"><span>{children}</span>{action}</div>
    </div>
  );
}
export function ErrorText({ error }: { error?: string }) {
  return error ? <Alert tone="error">{error}</Alert> : null;
}
export function Busy({ running, label, onCancel }: { running: boolean; label: string; onCancel?(): void }) {
  if (!running) return null;
  return <p className="busy" role="status"><span className="spinner" aria-hidden="true" />{label}{onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>}</p>;
}
/** Renders children only when the server supports every capability; otherwise explains what to update. */
export function RequireCapability({ capabilities, children }: { capabilities: Capability[]; children: React.ReactNode }) {
  const { compat, has } = useWorkspace();
  if (!compat) return <p className="busy" role="status"><span className="spinner" aria-hidden="true" />Connecting to the codeDeft server…</p>;
  if (!compat.compatible) return <Alert tone="error">{compat.message}</Alert>;
  const missing = capabilities.find(c => !has(c));
  if (missing) return <Alert tone="warning">{missingCapabilityMessage(compat, missing)}</Alert>;
  return <>{children}</>;
}
/** Shown on pages that need a repository when none is chosen yet. */
export function NeedsRepository({ children }: { children: React.ReactNode }) {
  const { repository } = useWorkspace();
  if (repository.trim()) return <>{children}</>;
  return (
    <div className="empty">
      <strong style={{ color: 'var(--text)' }}>Choose a repository to start</strong>
      <span>Use the repository button at the top left to pick a folder and index it.</span>
      <button type="button" className="btn btn-primary" onClick={() => document.getElementById('repo-switcher')?.click()}>Choose repository</button>
    </div>
  );
}
