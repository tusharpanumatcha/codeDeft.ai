// End-to-end tests of the API-2 additions against the real server, with fake Figma and model endpoints.
import test from 'node:test';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {createApiClient,endpoints,ApiError} from '../packages/protocol/dist/index.js';
const here=path.dirname(fileURLToPath(import.meta.url));
const PAT='figd_SECRET_TOKEN_123';
function listen(handler){return new Promise(r=>{const s=http.createServer(handler).listen(0,'127.0.0.1',()=>r(s));});}
const frame={id:'1:2',name:'Checkout',type:'FRAME',children:[{id:'1:3',name:'PayButton',type:'INSTANCE',componentId:'c1'},{id:'1:4',name:'Label',type:'TEXT',characters:'Pay now'}]};
async function fakeFigma(){
 const calls=[];
 const s=await listen((req,res)=>{calls.push({url:req.url,token:req.headers['x-figma-token']});
  if(req.headers['x-figma-token']!==PAT){res.writeHead(403);return res.end('{"err":"forbidden"}');}
  if(req.url.startsWith('/v1/files/MISSING')){res.writeHead(404);return res.end('{}');}
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({name:'Shop',nodes:{'1:2':{document:frame}}}));});
 return {base:`http://127.0.0.1:${s.address().port}`,calls,close:()=>s.close()};
}
async function fakeModel(){
 const s=await listen(async(req,res)=>{for await(const _ of req);res.writeHead(200,{'content-type':'application/json'});
  res.end(JSON.stringify({model:'fake',choices:[{message:{content:'```json\n{"changes":[{"path":"src/Checkout.vue","content":"<template>Pay now</template>"}],"rationale":"new"}\n```'}}]}));});
 return {endpoint:`http://127.0.0.1:${s.address().port}/v1/chat/completions`,close:()=>s.close()};
}
async function withServer(env,fn){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cd-api2-'));const port=20000+Math.floor(Math.random()*20000);
 const child=spawn(process.execPath,['--disable-warning=ExperimentalWarning',path.join(here,'../apps/server/dist/index.js')],{env:{...process.env,CODEDEFT_PORT:String(port),CODEDEFT_DB:path.join(dir,'t.db'),...env},stdio:['ignore','pipe','pipe']});
 let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
 try{
  await new Promise((resolve,reject)=>{child.stdout.on('data',d=>{if(String(d).includes('dashboard'))resolve();});child.on('exit',c=>reject(new Error('exited '+c+logs)));setTimeout(()=>reject(new Error('timeout')),5000);});
  const repo=path.join(dir,'repo');fs.mkdirSync(path.join(repo,'src'),{recursive:true});fs.writeFileSync(path.join(repo,'src/PayButton.vue'),'<template><button>Pay</button></template>');
  const api=endpoints(createApiClient({client:'test/1',baseUrl:`http://127.0.0.1:${port}`}));
  await fn({api,repo,port,logs:()=>logs});
 }finally{child.kill();fs.rmSync(dir,{recursive:true,force:true});}
}
test('health advertises API 2 and its capabilities',async()=>{
 await withServer({},async({port})=>{
  const h=await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
  assert.equal(h.api.version,2);assert.equal(h.api.minClient,1);assert.ok(h.capabilities.includes('figma.read')&&h.capabilities.includes('proposals'));
 });
});
test('Figma read → designId → plan, without the token ever appearing in responses or logs',async()=>{
 const figma=await fakeFigma();
 try{await withServer({CODEDEFT_FIGMA_API_BASE:figma.base},async({api,repo,logs})=>{
  const read=await api.figmaRead('Look at https://www.figma.com/design/ABC/Shop?node-id=1-2'.split(' ').pop(),PAT);
  assert.match(read.designId,/^d_[a-f0-9]{32}$/);assert.equal(read.summary.nodeCount,3);assert.deepEqual(read.summary.texts,['Pay now']);
  assert.equal(figma.calls[0].url,'/v1/files/ABC/nodes?ids=1%3A2');
  const again=await api.figmaRead('https://www.figma.com/design/ABC/Shop?node-id=1-2',PAT);
  assert.equal(again.designId,read.designId,'content-addressed: same design, same id');
  const full=await api.figmaDesign(read.designId);assert.equal(full.nodes[0].name,'Checkout');
  const plan=await api.figmaPlan({repository:repo,designId:read.designId});
  assert.equal(plan.design.name,'Shop');assert.ok(plan.repositoryEvidence.some(e=>e.path==='src/PayButton.vue'),'retrieval used design words');
  await assert.rejects(api.figmaRead('https://www.figma.com/design/ABC/x',PAT+'x'),e=>e instanceof ApiError&&e.code==='upstream_error'&&/403/.test(e.message)&&!e.message.includes(PAT));
  await assert.rejects(api.figmaRead('https://www.figma.com/design/MISSING/x',PAT),e=>e.code==='upstream_error'&&/not found/.test(e.message));
  await assert.rejects(api.figmaRead('https://figma.com.evil.test/design/A',PAT),e=>e.code==='bad_request'&&!e.message.includes(PAT));
  await assert.rejects(api.figmaRead('https://www.figma.com/design/A/x',' '),e=>e.code==='bad_request'&&/token required/.test(e.message));
  await assert.rejects(api.figmaPlan({repository:repo,designId:'d_'+'0'.repeat(32)}),e=>e.code==='not_found');
  await assert.rejects(api.figmaDesign('../../etc/passwd'),e=>e.code==='not_found');
  assert.ok(!logs().includes(PAT),'token never logged');
 });}finally{figma.close();}
});
test('older clients that send the design inline still work',async()=>{
 await withServer({},async({api,repo})=>{
  const design={name:'Inline',fileKey:'K',nodeCount:1,nodes:[{id:'1',name:'PayButton',type:'INSTANCE'}]};
  const plan=await api.figmaPlan({repository:repo,design});assert.equal(plan.design.name,'Inline');
 });
});
test('generated proposals get an id and can be fetched for the VS Code handoff',async()=>{
 const model=await fakeModel();
 try{await withServer({CODEDEFT_ENDPOINT:model.endpoint,CODEDEFT_MODEL:'m',CODEDEFT_API_KEY:'k'},async({api,repo})=>{
  const gen=await api.generateIndependent(repo,'checkout page');
  assert.match(gen.proposalId,/^p_[a-f0-9-]{36}$/);assert.equal(gen.proposal.changes[0].path,'src/Checkout.vue');
  const stored=await api.proposal(gen.proposalId);
  assert.equal(stored.repository,fs.realpathSync(repo));assert.equal(stored.source,'reuse.generate');assert.deepEqual(stored.result.proposal,gen.proposal);
  await assert.rejects(api.proposal('p_00000000-0000-0000-0000-000000000000'),e=>e.code==='not_found');
 });}finally{model.close();}
});
test('API-1 clients still understand errors (string `error`, unknown-endpoint text)',async()=>{
 await withServer({},async({port})=>{
  const r=await fetch(`http://127.0.0.1:${port}/api/nope`);const b=await r.json();
  assert.equal(r.status,404);assert.equal(b.error,'Unknown API endpoint');assert.equal(b.code,'unsupported_endpoint');
 });
});
