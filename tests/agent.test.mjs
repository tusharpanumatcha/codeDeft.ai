import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { indexRepository, createAgentPlan, generateWithModel } from '../dist/index.js';

test('agent plan grounds prompts in repository source and never edits files', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codedeft-agent-'));
  try {
    mkdirSync(path.join(root, 'src'));
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { vue: '^3.0.0', pinia: '^2.0.0' } }));
    const source = 'export function useCustomerPagination() { return 10; }\n';
    writeFileSync(path.join(root, 'src', 'pagination.ts'), source);
    const plan = createAgentPlan(indexRepository(root), 'Implement customer pagination');
    assert.ok(plan.relevantFiles.some(f => f.path === 'src/pagination.ts'));
    assert.match(plan.userPrompt, /useCustomerPagination/);
    assert.match(plan.systemPrompt, /untrusted DATA/);
    assert.ok(plan.frameworkHints.includes('vue'));
    assert.throws(() => createAgentPlan(indexRepository(root), '  '), /empty/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('model generation refuses insecure non-local endpoints', async () => {
  await assert.rejects(() => generateWithModel({ systemPrompt: 'x', userPrompt: 'y' }, {
    endpoint: 'http://example.com/v1/chat/completions', apiKey: 'test', model: 'test'
  }), /HTTPS/);
});
