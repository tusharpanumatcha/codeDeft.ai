// Feature chats end to end against the real server: routing, context, background generation,
// persistence across restarts, interrupted jobs and stale-analysis detection.
import test from 'node:test';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {createApiClient,endpoints,ApiError} from '../packages/protocol/dist/index.js';
const here=path.dirname(fileURLToPath(import.meta.url));
const listen=h=>new Promise(r=>{const s=http.createServer(h).listen(0,'127.0.0.1',()=>r(s));});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cd-feat-'));const repo=path.join(dir,'repo');
 const w=(p,c)=>{fs.mkdirSync(path.dirname(path.join(repo,p)),{recursive:true});fs.writeFileSync(path.join(repo,p),c);};
 w('package.json',JSON.stringify({name:'shop',dependencies:{vue:'^3.4.0'}}));
 w('src/components/PayButton.vue','<template><button>Pay now</button></template>\n<script setup lang="ts">\ndefineProps<{ label: string }>()\n</script>\n');
 w('src/utils/money.ts','export function formatPrice(n: number) { return n.toFixed(2); }\n');
 w('src/views/CartView.vue','<template><PayButton label="x"/></template>\n<script setup lang="ts">\nimport PayButton from "@/components/PayButton.vue"\nimport { formatPrice } from "@/utils/money"\n</script>\n');
 return {dir,repo:fs.realpathSync(repo),db:path.join(dir,'t.db')};
}
async function startServer(fx,env={}){
 const port=20000+Math.floor(Math.random()*20000);
 const child=spawn(process.execPath,['--disable-warning=ExperimentalWarning',path.join(here,'../apps/server/dist/index.js')],{env:{...process.env,CODEDEFT_PORT:String(port),CODEDEFT_DB:fx.db,...env},stdio:['ignore','pipe','pipe']});
 let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
 await new Promise((res,rej)=>{child.stdout.on('data',d=>{if(String(d).includes('dashboard'))res();});child.on('exit',c=>rej(new Error('exit '+c+logs)));setTimeout(()=>rej(new Error('timeout')),6000);});
 return {child,port,logs:()=>logs,api:endpoints(createApiClient({client:'test/1',baseUrl:`http://127.0.0.1:${port}`})),stop:()=>new Promise(r=>{child.on('exit',r);child.kill();})};
}
const answer=JSON.stringify({changes:[{path:'src/views/CheckoutView.vue',content:'<template><PayButton label="Pay"/></template>\n<script setup lang="ts">\nimport PayButton from "@/components/PayButton.vue"\nimport { formatPrice } from "@/utils/money"\n</script>\n'}],rationale:'Checkout view reusing PayButton'});
async function fakeModel(delayMs=0){const bodies=[];const s=await listen(async(q,r)=>{let b='';for await(const c of q)b+=c;bodies.push(JSON.parse(b));await sleep(delayMs);r.writeHead(200,{'content-type':'application/json'});r.end(JSON.stringify({choices:[{message:{content:answer}}]}));});return {bodies,endpoint:`http://127.0.0.1:${s.address().port}/v1`,close:()=>s.close()};}
async function waitFor(fn,ms=8000){const t=Date.now();for(;;){const v=await fn();if(v)return v;if(Date.now()-t>ms)throw new Error('timeout waiting');await sleep(100);}}

test('a feature chat routes messages, builds context, generates in the background and survives a restart',async()=>{
 const fx=fixture();const model=await fakeModel();
 const env={CODEDEFT_ENDPOINT:model.endpoint,CODEDEFT_MODEL:'m',CODEDEFT_API_KEY:'k',CODEDEFT_JSON_MODE:'0'};
 let s=await startServer(fx,env);
 try{
  await s.api.index(fx.repo);
  let d=await s.api.features.create(fx.repo);
  const id=d.feature.id;assert.equal(d.feature.name,'Untitled feature');assert.equal(d.messages.length,0);
  d=await s.api.features.send(id,'Build the checkout page with the pay button and total price');
  assert.equal(d.feature.name,'Checkout page with the pay button');
  assert.equal(d.feature.requirement,'Build the checkout page with the pay button and total price');
  assert.equal(d.messages.at(-1).kind,'search');assert.ok(d.feature.context.files.some(f=>f.path==='src/components/PayButton.vue'));
  d=await s.api.features.send(id,'find reusable price formatting');
  assert.equal(d.messages.at(-1).kind,'reuse');assert.equal(d.feature.status,'deciding');
  const cand=d.feature.context.reuse.candidates.find(c=>c.name==='formatPrice');assert.ok(cand);
  d=await s.api.features.setReuse(id,{[cand.id]:'reuse'});assert.equal(d.feature.context.reuse.choices[cand.id],'reuse');
  d=await s.api.features.send(id,'/graph');assert.equal(d.messages.at(-1).kind,'graph');assert.ok(d.feature.context.edges.some(e=>e.to==='src/components/PayButton.vue'));
  d=await s.api.features.send(id,'Here is the frame https://www.figma.com/design/ABC/Shop?node-id=1-2');
  assert.equal(d.messages.at(-1).kind,'design_request');assert.equal(d.messages.at(-1).payload.url,'https://www.figma.com/design/ABC/Shop?node-id=1-2');
  d=await s.api.features.send(id,'Generate it. Keep PayButton and formatPrice.');
  assert.equal(d.feature.status,'generating');assert.equal(d.messages.at(-1).kind,'generating');
  d=await waitFor(async()=>{const x=await s.api.features.get(id);return x.feature.status!=='generating'&&x;});
  assert.equal(d.feature.status,'proposal_ready',JSON.stringify(d.messages.at(-1)));
  const prop=d.messages.at(-1);assert.equal(prop.kind,'proposal');assert.equal(prop.payload.version,1);assert.equal(prop.payload.verification.ok,true);
  assert.match(model.bodies[0].messages[0].content,/REUSE these existing modules[\s\S]*formatPrice/);
  assert.match(model.bodies[0].messages[1].content,/PayButton\.vue/,'evidence includes the pay button');
  const stored=await s.api.proposal(prop.payload.proposalId);assert.equal(stored.result.proposal.changes[0].path,'src/views/CheckoutView.vue');
  assert.equal(d.feature.context.edges[0].from,'src/views/CheckoutView.vue','the proposal\'s own imports lead the dependency list');
  const before=d.messages.map(m=>m.id);
  await s.stop();
  s=await startServer(fx,env);
  const after=await s.api.features.get(id);
  assert.deepEqual(after.messages.map(m=>m.id),before,'conversation persisted');
  assert.equal(after.feature.context.proposals[0].id,prop.payload.proposalId);
  assert.equal((await s.api.proposal(prop.payload.proposalId)).id,prop.payload.proposalId,'proposal survives restart');
  const list=await s.api.features.list(fx.repo);assert.equal(list[0].id,id);assert.match(list[0].lastMessage,/Proposal v1/);
  assert.equal((await s.api.features.list(fx.repo,{q:'checkout'})).length,1);assert.equal((await s.api.features.list(fx.repo,{q:'zebra'})).length,0);
  d=await s.api.features.update(id,{status:'done',name:'Checkout'});assert.equal(d.feature.status,'done');assert.equal(d.feature.name,'Checkout');
  d=await s.api.features.update(id,{archived:true});assert.equal((await s.api.features.list(fx.repo)).length,0);assert.equal((await s.api.features.list(fx.repo,{archived:true})).length,1);
 }finally{await s.stop();model.close();fs.rmSync(fx.dir,{recursive:true,force:true});}
});

test('reading a Figma frame inside a feature stores the design and matches it to the repository',async()=>{
 const fx=fixture();
 const frame={id:'1:2',name:'Checkout',type:'FRAME',children:[{id:'1:3',name:'PayButton',type:'INSTANCE'},{id:'1:4',name:'L',type:'TEXT',characters:'Pay now'}]};
 const figma=await listen((q,r)=>{r.writeHead(q.headers['x-figma-token']==='ok'?200:403,{'content-type':'application/json'});r.end(JSON.stringify({name:'Shop',nodes:{'1:2':{document:frame}}}));});
 const s=await startServer(fx,{CODEDEFT_FIGMA_API_BASE:`http://127.0.0.1:${figma.address().port}`});
 try{
  const id=(await s.api.features.create(fx.repo)).feature.id;
  await assert.rejects(s.api.features.readDesign(id,'https://www.figma.com/design/ABC/x?node-id=1-2','bad'),e=>e.code==='upstream_error'&&!e.message.includes('bad'));
  const d=await s.api.features.readDesign(id,'https://www.figma.com/design/ABC/x?node-id=1-2','ok');
  assert.equal(d.feature.name,'Checkout','a frame link names the frame, not the file');assert.equal(d.feature.context.design.nodeCount,3);assert.match(d.feature.context.design.designId,/^d_/);
  assert.equal(d.messages.at(-1).kind,'design');assert.ok(d.messages.at(-1).payload.closest.includes('src/components/PayButton.vue'));
  assert.ok(!JSON.stringify(d).includes('"ok"'),'token not stored');
 }finally{await s.stop();figma.close();fs.rmSync(fx.dir,{recursive:true,force:true});}
});

test('a generation interrupted by a restart is reported, and re-indexing marks the analysis stale',async()=>{
 const fx=fixture();const model=await fakeModel(60_000);
 const env={CODEDEFT_ENDPOINT:model.endpoint,CODEDEFT_MODEL:'m',CODEDEFT_API_KEY:'k'};
 let s=await startServer(fx,env);
 try{
  await s.api.index(fx.repo);
  const id=(await s.api.features.create(fx.repo,'Checkout')).feature.id;
  await s.api.features.send(id,'checkout page with pay button');
  await s.api.features.generate(id);
  await waitFor(()=>model.bodies.length>0);
  await s.stop();
  s=await startServer(fx,env);
  const d=await s.api.features.get(id);
  assert.equal(d.feature.status,'failed');assert.equal(d.messages.at(-1).kind,'error');assert.match(d.messages.at(-1).text,/interrupted/);
  assert.match(s.logs(),/1 generation job\(s\) were interrupted/);
  assert.equal(d.feature.stale,false);
  await sleep(20);await s.api.index(fx.repo);
  assert.equal((await s.api.features.get(id)).feature.stale,true);
  const r=await s.api.features.refresh(id);assert.equal(r.feature.stale,false);assert.match(r.messages.at(-1).text,/Re-ran matching/);
 }finally{await s.stop();model.close();fs.rmSync(fx.dir,{recursive:true,force:true});}
});

test('clear errors: unknown feature, empty message, generate without a model',async()=>{
 const fx=fixture();const s=await startServer(fx,{CODEDEFT_ENDPOINT:'',CODEDEFT_MODEL:'',CODEDEFT_API_KEY:''});
 try{
  await assert.rejects(s.api.features.get('f_00000000-0000-0000-0000-000000000000'),e=>e.code==='not_found');
  const id=(await s.api.features.create(fx.repo)).feature.id;
  await assert.rejects(s.api.features.send(id,'   '),e=>e instanceof ApiError&&/Type a message/.test(e.message));
  const d=await s.api.features.send(id,'/generate');
  assert.equal(d.messages.at(-1).kind,'error');assert.match(d.messages.at(-1).text,/needs a model/);
 }finally{await s.stop();fs.rmSync(fx.dir,{recursive:true,force:true});}
});
