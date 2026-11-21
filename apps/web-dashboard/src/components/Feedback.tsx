import React from 'react';
import type { Capability } from '../../../../packages/protocol/src/index';
import { missingCapabilityMessage } from '../../../../packages/protocol/src/index';
import { useWorkspace } from '../state/workspace';

export function ErrorText({ error }: { error?: string }) {
  return error ? <p className="error" role="alert">{error}</p> : null;
}
export function Busy({ running, label, onCancel }: { running: boolean; label: string; onCancel?(): void }) {
  if (!running) return null;
  return <p className="busy" role="status"><span className="spinner" aria-hidden="true" />{label}{onCancel && <button type="button" className="link" onClick={onCancel}>Cancel</button>}</p>;
}
/** Renders children only when the server supports every capability; otherwise explains what to update. */
export function RequireCapability({ capabilities, children }: { capabilities: Capability[]; children: React.ReactNode }) {
  const { compat, has } = useWorkspace();
  if (!compat) return <p className="muted" role="status">Connecting to the codeDeft server…</p>;
  if (!compat.compatible) return <p className="error" role="alert">{compat.message}</p>;
  const missing = capabilities.find(c => !has(c));
  if (missing) return <p className="notice" role="note">{missingCapabilityMessage(compat, missing)}</p>;
  return <>{children}</>;
}
