import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {mkdtempSync,writeFileSync,readFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateProposal} from '../dist/validation.js';
test('validation never changes original repository and reports skipped checks',()=>{
 const dir=mkdtempSync(join(tmpdir(),'cd-test-'));
 try {
  const repo=join(dir,'repo');mkdirSync(repo);
  writeFileSync(join(repo,'package.json'),JSON.stringify({scripts:{build:'node -e "process.exit(0)"'}}));
  writeFileSync(join(repo,'src.ts'),'original');
  const proposal=join(dir,'proposal.json');writeFileSync(proposal,JSON.stringify({changes:[{path:'src.ts',content:'changed'}]}));
  const result=validateProposal(repo,proposal);
  assert.equal(result.status,'incomplete');
  assert.equal(readFileSync(join(repo,'src.ts'),'utf8'),'original');
  assert.equal(result.changedFiles[0],'src.ts');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('validation rejects traversal',()=>{
 const dir=mkdtempSync(join(tmpdir(),'cd-test-'));
 try {
  const repo=join(dir,'repo');mkdirSync(repo);
  const proposal=join(dir,'proposal.json');writeFileSync(proposal,JSON.stringify({changes:[{path:'../escape.ts',content:'bad'}]}));
  assert.throws(()=>validateProposal(repo,proposal),/Unsafe proposal path/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
