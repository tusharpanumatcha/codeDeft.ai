import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {assertIndependentProposal,previewIndependentProposal,independentInstruction} from '../dist/reuse-decision.js';
const withRepo=fn=>{const repo=fs.mkdtempSync(path.join(os.tmpdir(),'codedeft-independent-test-'));try{fs.mkdirSync(path.join(repo,'src'));fs.writeFileSync(path.join(repo,'src','Existing.vue'),'original');fn(repo)}finally{fs.rmSync(repo,{recursive:true,force:true})}};
test('independent proposal previews new files and requires approval',()=>withRepo(repo=>{
 const proposal={changes:[{path:'src/NewForm.vue',content:'<template><form /></template>'}]};
 assert.doesNotThrow(()=>assertIndependentProposal(repo,proposal));
 assert.deepEqual(previewIndependentProposal(repo,proposal).files.map(f=>f.action),['create']);
 assert.equal(previewIndependentProposal(repo,proposal).approvalRequired,true);
 assert.equal(fs.existsSync(path.join(repo,'src','NewForm.vue')),false);
}));
test('independent proposal refuses existing files',()=>withRepo(repo=>assert.throws(()=>assertIndependentProposal(repo,{changes:[{path:'src/Existing.vue',content:'overwrite'}]}),/cannot modify existing/)));
test('independent proposal rejects traversal',()=>withRepo(repo=>assert.throws(()=>assertIndependentProposal(repo,{changes:[{path:'../outside.vue',content:'x'}]}),/Unsafe/)));
test('policy explicitly forbids reuse and edits',()=>{assert.match(independentInstruction(),/NEW files only/);assert.match(independentInstruction(),/Do not import existing/)});
