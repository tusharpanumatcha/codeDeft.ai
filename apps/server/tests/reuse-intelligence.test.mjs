import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {findReusable,buildReuseDecision} from '../dist/reuse-intelligence.js';
test('finds embedded code and reports exact file location without editing',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'codedeft-reuse-'));
 try {
 fs.mkdirSync(path.join(root,'src'));
 const file=path.join(root,'src','users.ts');
 const original=`export function validateAccessToken(token: string) {\n  return token.length > 0;\n}\n`;
 fs.writeFileSync(file,original);
 const result=findReusable(root,'validate access token');
 assert.ok(result.results.some(x=>x.file==='src/users.ts'&&x.name==='validateAccessToken'&&x.startLine===1));
 const decision=buildReuseDecision(root,{decision:'independent',requirement:'validate access token',sourceFile:'src/users.ts',targetFile:'src/new.ts'});
 assert.equal(decision.approvalRequired,true);
 assert.equal(decision.decision,'independent');
 assert.equal(fs.readFileSync(file,'utf8'),original);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('reuse scan is linear and cached: 1,500 files well under a few seconds, repeat scans reuse the result',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'codedeft-reuse-big-'));
 try{
  for(let f=0;f<1500;f++){const d=path.join(root,'src',`m${f%30}`);fs.mkdirSync(d,{recursive:true});let s='';for(let i=0;i<10;i++)s+=`export function fn${f}_${i}(a){\n  return helper${(f+i)%97}(a);\n}\n`;fs.writeFileSync(path.join(d,`file${f}.ts`),s);}
  fs.writeFileSync(path.join(root,'src','caller.ts'),'import {fn7_3} from "./m7/file7"; fn7_3(1);');
  let t=Date.now();const first=findReusable(root,'fn7 helper',5);const firstMs=Date.now()-t;
  assert.equal(first.scannedUnits,15000);
  assert.ok(firstMs<4000,`first scan took ${firstMs} ms`);
  t=Date.now();findReusable(root,'fn8 helper',5);const secondMs=Date.now()-t;
  assert.ok(secondMs<=firstMs,`cached scan ${secondMs} ms vs ${firstMs} ms`);
  const decision=buildReuseDecision(root,{decision:'reuse',requirement:'x',sourceFile:'src/m7/file7.ts'});
  assert.ok(decision.sourceEvidence.find(u=>u.name==='fn7_3').usedBy.includes('src/caller.ts'));
  fs.writeFileSync(path.join(root,'src','late.ts'),'export function brandNewThing(){ return 1 }');
  assert.ok(findReusable(root,'brand new thing',5).results.some(r=>r.name==='brandNewThing'),'cache invalidated by new file');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
