// Generate → verify → repair. The model's proposal is checked against the repository (files, exports,
// packages, duplication). If references do not exist, the exact problems are sent back once for a fix,
// and the attempt with the fewest errors is kept. The result always carries the verification report.
import type { AgentPlan, RepositoryIndex } from '../../../packages/engine/dist/index.js';
import { verifyCode, analyzeRepository, type VerificationReport } from '../../../packages/engine/dist/index.js';
import { generateWithModel, type ModelConfig, type ModelResponse } from '../../../packages/engine/dist/agent.js';
import { parseProposal } from './figma-workflow.js';
import type { IndependentProposal } from './reuse-decision.js';

export type Verification = {
  ok: boolean;
  errors: number;
  warnings: number;
  attempts: number;
  files: { path: string; ok: boolean; errors: number; warnings: number; summary: string; findings: { severity: string; message: string; line?: number }[] }[];
};

export const GROUNDING_RULES = [
  'Use only files, exports and packages that exist in this repository (see SOURCE EVIDENCE and DECLARED DEPENDENCIES). Never invent an import path, export name or package.',
  'Reuse existing modules shown in the evidence by importing them instead of re-implementing them.',
  'Your answer will be checked automatically: every import must resolve to a real file or a declared package, and every named import must be exported by its module.'
];

/** Adds the repository's declared packages and grounding rules to a plan's prompts. */
export function groundPlan(plan: AgentPlan, index: RepositoryIndex): AgentPlan {
  const deps = Object.keys(analyzeRepository(index).packages).sort();
  return {
    ...plan,
    systemPrompt: `${plan.systemPrompt}\n${GROUNDING_RULES.join('\n')}`,
    userPrompt: `${plan.userPrompt}\n\nDECLARED DEPENDENCIES (the only packages you may import): ${deps.join(', ') || 'none'}`
  };
}

export function verifyProposal(index: RepositoryIndex, proposal: IndependentProposal, attempts: number): Verification {
  // Files in the same proposal may import each other.
  const reports: VerificationReport[] = proposal.changes.map(c => verifyCode(index, c.path, c.content, { siblings: proposal.changes }));
  return {
    ok: reports.every(r => r.ok), attempts,
    errors: reports.reduce((n, r) => n + r.errors, 0), warnings: reports.reduce((n, r) => n + r.warnings, 0),
    files: reports.map(r => ({ path: r.path, ok: r.ok, errors: r.errors, warnings: r.warnings, summary: r.summary, findings: r.findings.filter(f => f.severity !== 'info').map(f => ({ severity: f.severity, message: f.message, line: f.line })) }))
  };
}

function repairPrompt(plan: AgentPlan, previous: string, v: Verification): AgentPlan {
  const problems = v.files.flatMap(f => f.findings.filter(x => x.severity === 'error').map(x => `- ${f.path}${x.line ? ` line ${x.line}` : ''}: ${x.message}`));
  return {
    ...plan,
    userPrompt: `${plan.userPrompt}\n\nYOUR PREVIOUS ANSWER:\n${previous.slice(0, 60_000)}\n\nAUTOMATIC CHECK FOUND REFERENCES THAT DO NOT EXIST IN THIS REPOSITORY:\n${problems.join('\n')}\n\nReturn the complete corrected JSON (all files). Use only existing files, exports and declared packages; where something does not exist, use the suggested real name or implement it inside a new file you also return.`
  };
}

export async function generateVerified(plan: AgentPlan, index: RepositoryIndex, config: ModelConfig, options: { maxRepairs?: number } = {}): Promise<{ proposal: IndependentProposal; response: ModelResponse; verification: Verification }> {
  const grounded = groundPlan(plan, index);
  let response = await generateWithModel(grounded, config);
  let proposal = parseProposal(response.content);
  let verification = verifyProposal(index, proposal, 1);
  const maxRepairs = Math.max(0, Math.min(2, options.maxRepairs ?? 1));
  for (let attempt = 1; attempt <= maxRepairs && verification.errors > 0; attempt++) {
    let next: { response: ModelResponse; proposal: IndependentProposal; verification: Verification };
    try {
      const r = await generateWithModel(repairPrompt(grounded, response.content, verification), config);
      const p = parseProposal(r.content);
      next = { response: r, proposal: p, verification: verifyProposal(index, p, attempt + 1) };
    } catch { break; } // a failed repair keeps the verified first answer
    if (next.verification.errors <= verification.errors) ({ response, proposal } = next);
    verification = { ...(next.verification.errors <= verification.errors ? next.verification : verification), attempts: attempt + 1 };
  }
  return { proposal, response, verification };
}
