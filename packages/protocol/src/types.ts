/**
 * Wire types shared by the codeDeft server, the VS Code extension and the web dashboard.
 *
 * Compatibility rules (see compat.ts):
 * - Changes within one API version are additive only: new optional fields, new endpoints, new capabilities.
 * - Clients must ignore unknown fields and must treat missing optional fields as "not provided".
 * - Removing or changing the meaning of a field requires a new API version.
 */

export type Capability =
  | 'index' | 'search' | 'graph' | 'info'
  | 'reuse.discover' | 'reuse.decision' | 'reuse.generate'
  | 'figma.plan' | 'figma.generate' | 'figma.validate'
  /** Server-side Figma read (the PAT is sent to the local server for this one request). */
  | 'figma.read'
  /** Designs kept on the server and referenced by `designId`. */
  | 'figma.designs'
  /** Generated proposals kept on the server and fetched by id (dashboard → VS Code handoff). */
  | 'proposals';

export type HealthResponse = {
  ok: true;
  version: string;
  /** Absent on servers older than API version 2. */
  api?: { version: number; minClient: number };
  capabilities?: Capability[];
};

/** Every error response has `error` (a human-readable string, kept for old clients) and, since API 2, a `code`. */
export type ErrorCode =
  | 'bad_request' | 'unauthorized' | 'forbidden' | 'not_found' | 'expired'
  | 'unsupported_endpoint' | 'payload_too_large' | 'upstream_error' | 'timeout' | 'internal';
export type ErrorBody = { error: string; code?: ErrorCode };

export type Stats = { files: number; symbols: number; dependencies: number; conventions: number; indexedAt?: string };
export type SearchHit = { file: string; score: number; reasons: string[]; excerpt?: string; symbols?: { name: string; line: number }[] };
export type Edge = { from: string; to: string };

export type Effort = { level: 'low' | 'medium' | 'high'; reasons: string[] };
export type ReuseUnit = {
  id: string; file: string; startLine: number; endLine: number; name: string; kind: string;
  excerpt: string; imports: string[]; usedBy: string[]; exported?: boolean;
  score: number; reasons: string[]; effort: Effort;
};
export type ReuseDecision = 'reuse' | 'extract' | 'extend' | 'independent';

export type ProposedChange = { path: string; content: string };
export type Proposal = { changes: ProposedChange[]; rationale?: string };
export type ProposalPreview = { files: { path: string; action: 'create'; bytes: number }[]; existingFilesModified: number };

/** Response of the generate endpoints. `proposalId` exists when the server has the `proposals` capability. */
export type GeneratedProposal = {
  decision: 'independent';
  approvalRequired: true;
  proposal: Proposal;
  preview?: ProposalPreview;
  proposalId?: string;
  warning?: string;
  [extra: string]: unknown;
};

export type StoredProposal = {
  id: string;
  createdAt: string;
  expiresAt: string;
  repository: string;
  source: 'reuse.generate' | 'figma.generate';
  task: string;
  result: GeneratedProposal;
};

export type DesignSummary = {
  name: string; fileKey: string; nodeId?: string; nodeCount: number;
  components: { name: string; type: string }[];
  texts: string[];
  layout: unknown[];
};

export type FigmaReadResponse = {
  designId: string;
  expiresAt: string;
  summary: DesignSummary;
  warnings: string[];
};
