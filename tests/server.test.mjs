import test from 'node:test';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';
const here=path.dirname(new URL(import.meta.url).pathname);
function request(port,{method='GET',pathname='/api/health',headers={},body}={}){
 return new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port,method,path:pathname,headers:{host:`127.0.0.1:${port}`,...headers}},res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>resolve({status:res.statusCode,body:d,headers:res.headers}));});req.on('error',reject);if(body)req.write(body);req.end();});
}
async function withServer(env,fn){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cd-server-'));const port=20000+Math.floor(Math.random()*20000);
 const child=spawn(process.execPath,[path.join(here,'../apps/server/index.mjs')],{env:{...process.env,CODEDEFT_PORT:String(port),CODEDEFT_DB:path.join(dir,'t.db'),...env},stdio:['ignore','pipe','pipe']});
 try{
  await new Promise((resolve,reject)=>{child.stdout.on('data',d=>{if(String(d).includes('dashboard'))resolve();});child.on('exit',c=>reject(new Error('server exited '+c)));setTimeout(()=>reject(new Error('server start timeout')),5000);});
  const repo=path.join(dir,'repo');fs.mkdirSync(path.join(repo,'src'),{recursive:true});fs.writeFileSync(path.join(repo,'src/login.ts'),'export function login(){}');
  await fn(port,repo);
 }finally{child.kill();fs.rmSync(dir,{recursive:true,force:true});}
}
test('server refuses DNS-rebinding hosts, foreign origins and non-JSON POSTs, and accepts its own dashboard',async()=>{
 await withServer({},async(port,repo)=>{
  const json={'content-type':'application/json'};const payload=JSON.stringify({repository:repo});
  assert.equal((await request(port)).status,200);
  assert.equal((await request(port,{headers:{host:`localhost:${port}`}})).status,200);
  assert.equal((await request(port,{headers:{host:`attacker.example:${port}`}})).status,403,'rebinding host');
  assert.equal((await request(port,{pathname:'/',headers:{host:`attacker.example:${port}`}})).status,403,'rebinding host on static files');
  assert.equal((await request(port,{method:'POST',pathname:'/api/index',headers:{'content-type':'text/plain'},body:payload})).status,403,'simple-request POST');
  assert.equal((await request(port,{method:'POST',pathname:'/api/index',headers:{...json,origin:'https://evil.example'},body:payload})).status,403,'foreign origin');
  const ok=await request(port,{method:'POST',pathname:'/api/index',headers:{...json,origin:`http://127.0.0.1:${port}`},body:payload});
  assert.equal(ok.status,200,ok.body);
  const page=await request(port,{pathname:'/'});
  assert.equal(page.status,200);assert.match(page.headers['content-security-policy'],/default-src 'self'/);
  assert.doesNotMatch(page.body,/codedeft-token/,'no token meta without CODEDEFT_TOKEN');
 });
});
test('with CODEDEFT_TOKEN the API requires it and the same-origin dashboard receives it',async()=>{
 await withServer({CODEDEFT_TOKEN:'tok-123'},async(port,repo)=>{
  const body=JSON.stringify({repository:repo});
  assert.equal((await request(port,{method:'POST',pathname:'/api/index',headers:{'content-type':'application/json'},body})).status,401);
  assert.equal((await request(port,{method:'POST',pathname:'/api/index',headers:{'content-type':'application/json','x-codedeft-token':'tok-123'},body})).status,200);
  assert.match((await request(port,{pathname:'/'})).body,/<meta name="codedeft-token" content="tok-123">/);
 });
});
