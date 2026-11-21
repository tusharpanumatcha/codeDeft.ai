import type { FeatureStatus } from '../../../../packages/protocol/src/index';

export const STATUS: Record<FeatureStatus, { label: string; tone: 'success' | 'warning' | 'info' | 'muted' | 'danger' }> = {
  exploring: { label: 'Exploring', tone: 'muted' },
  deciding: { label: 'Deciding', tone: 'warning' },
  generating: { label: 'Generating…', tone: 'info' },
  proposal_ready: { label: 'Proposal ready', tone: 'success' },
  done: { label: 'Done', tone: 'muted' },
  failed: { label: 'Needs attention', tone: 'danger' }
};

/** "now", "12 min", "3 h", "yesterday", "Mon", "12 Nov". */
export function relativeTime(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime(); if (!Number.isFinite(t)) return '';
  const mins = Math.round((now - t) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h`;
  if (hours < 48) return 'yesterday';
  const d = new Date(t);
  return hours < 24 * 7 ? d.toLocaleDateString(undefined, { weekday: 'short' }) : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
