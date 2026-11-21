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
import {scriptEnvironment} from '../dist/validation.js';
test('validation rejects .env variants and package-manager credential files',()=>{
 const dir=mkdtempSync(join(tmpdir(),'cd-test-'));
 try {
  const repo=join(dir,'repo');mkdirSync(repo);
  for(const bad of ['.env.local','config/.env.production','.npmrc','.ENV']){
   const proposal=join(dir,'proposal.json');writeFileSync(proposal,JSON.stringify({changes:[{path:bad,content:'X=1'}]}));
   assert.throws(()=>validateProposal(repo,proposal),/Unsafe proposal path/,bad);
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('repository scripts do not receive API keys or tokens from the parent environment',()=>{
 const env=scriptEnvironment({PATH:'/usr/bin',HOME:'/home/u',CODEDEFT_API_KEY:'sk-secret',GITHUB_TOKEN:'ghp_x',AWS_SECRET_ACCESS_KEY:'a'});
 assert.equal(env.PATH,'/usr/bin');assert.equal(env.HOME,'/home/u');assert.equal(env.CI,'true');
 for(const k of ['CODEDEFT_API_KEY','GITHUB_TOKEN','AWS_SECRET_ACCESS_KEY'])assert.equal(env[k],undefined,k);
});
test('a repository test script cannot see CODEDEFT_API_KEY during validation',()=>{
 const dir=mkdtempSync(join(tmpdir(),'cd-test-'));const saved=process.env.CODEDEFT_API_KEY;
 try {
  process.env.CODEDEFT_API_KEY='sk-should-not-leak';
  const repo=join(dir,'repo');mkdirSync(repo);
  writeFileSync(join(repo,'package.json'),JSON.stringify({name:'t',version:'1.0.0',scripts:{test:'node -e "process.exit(process.env.CODEDEFT_API_KEY?1:0)"'}}));
  writeFileSync(join(repo,'package-lock.json'),JSON.stringify({name:'t',version:'1.0.0',lockfileVersion:3,requires:true,packages:{'':{name:'t',version:'1.0.0'}}}));
  const proposal=join(dir,'proposal.json');writeFileSync(proposal,JSON.stringify({changes:[{path:'a.ts',content:'x'}]}));
  const result=validateProposal(repo,proposal,{install:true});
  assert.equal(result.checks.find(c=>c.name==='test').status,'passed',JSON.stringify(result.checks));
 }finally{if(saved===undefined)delete process.env.CODEDEFT_API_KEY;else process.env.CODEDEFT_API_KEY=saved;rmSync(dir,{recursive:true,force:true});}
});
