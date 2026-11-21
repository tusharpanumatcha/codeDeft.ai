import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {parseProposal,designRetrievalQuery,designSummary,validateGenerated} from '../apps/server/dist/figma-workflow.js';
import {assertIndependentProposal} from '../apps/server/dist/reuse-decision.js';
const proposal={changes:[{path:'src/New.vue',content:'<template/>'}],rationale:'ok'};
test('model replies wrapped in markdown fences or prose are accepted',()=>{
 for(const reply of [JSON.stringify(proposal),'```json\n'+JSON.stringify(proposal)+'\n```','Here you go:\n```\n'+JSON.stringify(proposal)+'\n```\nDone.','Sure! '+JSON.stringify(proposal)])
  assert.deepEqual(parseProposal(reply).changes,proposal.changes,reply.slice(0,20));
 assert.throws(()=>parseProposal('no json here'),/JSON object/);
});
test('one path rule everywhere: hidden/config paths and case variants are refused',()=>{
 const repo=fs.mkdtempSync(path.join(os.tmpdir(),'cd-guard-'));
 try{
  for(const bad of ['.vscode/tasks.json','.github/workflows/ci.yml','.husky/pre-commit','.npmrc','.yarnrc.yml','.Git/hooks/pre-commit','.ENV','src/.env.local','node_modules/x/index.js','NODE_MODULES/x.js','src/evil.','../x.ts','/abs.ts','src\\win.ts']){
   const p={changes:[{path:bad,content:'x'}]};
   assert.throws(()=>parseProposal(JSON.stringify(p)),/Unsafe proposal path/,'parseProposal '+bad);
   assert.throws(()=>assertIndependentProposal(repo,p),/Unsafe proposal path/,'assertIndependentProposal '+bad);
  }
  assert.throws(()=>parseProposal(JSON.stringify({changes:[{path:'src/A.ts',content:'x'},{path:'src/a.ts',content:'y'}]})),/Duplicate/);
 }finally{fs.rmSync(repo,{recursive:true,force:true});}
});
test('retrieval uses design words, not JSON field names',()=>{
 const design={name:'Checkout',fileKey:'K',nodeCount:3,nodes:[{id:'1',name:'Checkout',type:'FRAME',layout:{layoutMode:'VERTICAL'},bounds:{x:0,y:0,width:1,height:1},children:[{id:'2',name:'PaymentCard',type:'INSTANCE'},{id:'3',name:'t',type:'TEXT',text:{content:'Pay now'}}]}]};
 const q=designRetrievalQuery(designSummary(design));
 assert.match(q,/Checkout/);assert.match(q,/PaymentCard/);assert.match(q,/Pay now/);
 assert.doesNotMatch(q,/bounds|layoutMode|width/);
});
test('validation skips checks by default and runs them only on explicit opt-in',()=>{
 const repo=fs.mkdtempSync(path.join(os.tmpdir(),'cd-validate-'));
 try{
  fs.writeFileSync(path.join(repo,'package.json'),JSON.stringify({name:'t',version:'1.0.0',scripts:{test:'node -e "process.exit(0)"'}}));
  fs.writeFileSync(path.join(repo,'package-lock.json'),JSON.stringify({name:'t',version:'1.0.0',lockfileVersion:3,requires:true,packages:{'':{name:'t',version:'1.0.0'}}}));
  assert.equal(validateGenerated(repo,proposal).status,'incomplete');
  const ran=validateGenerated(repo,proposal,{install:true});
  assert.equal(ran.checks.find(c=>c.name==='test').status,'passed',JSON.stringify(ran.checks));
  assert.equal(fs.existsSync(path.join(repo,'src/New.vue')),false,'original repository untouched');
 }finally{fs.rmSync(repo,{recursive:true,force:true});}
});
