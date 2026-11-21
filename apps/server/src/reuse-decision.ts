// Independent implementation policy: no existing file may be changed.
import fs from 'node:fs';
import { resolveProposalTarget, proposalPathKey } from '../../../packages/engine/dist/safe-path.js';

export type ProposedChange = { path: string; content: string };
export type IndependentProposal = { changes: ProposedChange[]; rationale?: string };
export const MAX_PROPOSED_FILES = 30;
export const MAX_FILE_CHARS = 500_000;

export function independentInstruction(): string {
  return [
    'DEVELOPER DECISION: INDEPENDENT. This is a hard requirement, not a suggestion.',
    'Generate NEW files only. Do not edit, extract, move, or delete existing repository files.',
    'Do not import existing application form/component implementations; avoid creating shared implementation dependencies.',
    'You may follow existing styling, framework, naming and design-system conventions.',
    'Never create hidden or configuration paths (any path segment starting with "."), such as .vscode, .github, .husky or .env files.',
    'Show file paths and explain that the developer must approve before applying changes.',
    'If independent implementation cannot be achieved without editing an existing file, explain the limitation instead of proposing that edit.'
  ].join('\n');
}

/** Throws unless every change creates a new, safely located file inside the repository. */
export function assertIndependentProposal(repository: string, proposal: unknown): asserts proposal is IndependentProposal {
  const root = fs.realpathSync(repository);
  const changes = (proposal as IndependentProposal | null)?.changes;
  if (!Array.isArray(changes) || changes.length < 1 || changes.length > MAX_PROPOSED_FILES) throw new Error(`Expected 1–${MAX_PROPOSED_FILES} proposed files`);
  const seen = new Set<string>();
  for (const change of changes) {
    if (!change || typeof change.content !== 'string' || !change.content || change.content.length > MAX_FILE_CHARS) throw new Error('Invalid proposed file content');
    const target = resolveProposalTarget(root, change.path);
    const key = proposalPathKey(change.path);
    if (seen.has(key)) throw new Error(`Duplicate proposed path: ${change.path}`);
    seen.add(key);
    if (fs.existsSync(target)) throw new Error(`Independent mode cannot modify existing file: ${change.path}`);
  }
}

export function previewIndependentProposal(repository: string, proposal: IndependentProposal) {
  assertIndependentProposal(repository, proposal);
  return {
    decision: 'independent' as const,
    approvalRequired: true,
    files: proposal.changes.map(c => ({ path: c.path, action: 'create' as const, bytes: Buffer.byteLength(c.content) })),
    existingFilesModified: 0
  };
}
