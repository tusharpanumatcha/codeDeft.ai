import test from 'node:test';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const serverEntry=path.join(here,'../apps/server/dist/index.js'); // the server `npm start` runs
function request(port,{method='GET',pathname='/api/health',headers={},body,chunks}={}){
 return new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port,method,path:pathname,headers:{host:`127.0.0.1:${port}`,...headers}},res=>{let d='';res.setEncoding('utf8');res.on('data',c=>d+=c);res.on('end',()=>resolve({status:res.statusCode,body:d,headers:res.headers}));});req.on('error',reject);
  if(chunks){req.write(chunks[0]);setTimeout(()=>req.end(chunks[1]),80);}else{if(body)req.write(body);req.end();}});
}
async function withServer(env,fn,{cwd}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cd-server-'));const port=20000+Math.floor(Math.random()*20000);
 const child=spawn(process.execPath,['--disable-warning=ExperimentalWarning',serverEntry],{cwd:cwd??process.cwd(),env:{...process.env,CODEDEFT_PORT:String(port),CODEDEFT_DB:path.join(dir,'t.db'),...env},stdio:['ignore','pipe','pipe']});
 let stderr='';child.stderr.on('data',d=>stderr+=d);
 try{
  await new Promise((resolve,reject)=>{child.stdout.on('data',d=>{if(String(d).includes('dashboard'))resolve();});child.on('exit',c=>reject(new Error('server exited '+c+'\n'+stderr)));setTimeout(()=>reject(new Error('server start timeout')),5000);});
  const repo=path.join(dir,'repo');fs.mkdirSync(path.join(repo,'src'),{recursive:true});fs.writeFileSync(path.join(repo,'src/login.ts'),'export function login(){}');
  await fn(port,repo,child);
 }finally{child.kill();fs.rmSync(dir,{recursive:true,force:true});}
}
const json={'content-type':'application/json'};
test('server refuses DNS-rebinding hosts, foreign origins and non-JSON POSTs, and accepts its own dashboard',async()=>{
 await withServer({},async(port,repo)=>{
  const payload=JSON.stringify({repository:repo});
  assert.equal((await request(port)).status,200);
  assert.equal((await request(port,{headers:{host:`localhost:${port}`}})).status,200);
  assert.equal((await request(port,{headers:{host:`attacker.example:${port}`}})).status,403,'rebinding host');
  assert.equal((await request(port,{pathname:'/',headers:{host:`attacker.example:${port}`}})).status,403,'rebinding host on static files');
  assert.equal((await request(port,{method:'POST',pathname:'/api/index',headers:{'content-type':'text/plain'},body:payload})).status,403,'simple-request POST');
  assert.equal((await request(port,{method:'POST',pathname:'/api/index',headers:{...json,origin:'https://evil.example'},body:payload})).status,403,'foreign origin');
  const ok=await request(port,{method:'POST',pathname:'/api/index',headers:{...json,origin:`http://127.0.0.1:${port}`},body:payload});
  assert.equal(ok.status,200,ok.body);
  const page=await request(port,{pathname:'/'});
  if(page.status===200){assert.match(page.headers['content-security-policy'],/default-src 'self'/);assert.doesNotMatch(page.body,/codedeft-token/,'no token meta without CODEDEFT_TOKEN');}
  else assert.equal(page.status,503,'unbuilt dashboard answers 503, not a crash');
 });
});
test('with CODEDEFT_TOKEN the API requires it and the same-origin dashboard receives it',async()=>{
 await withServer({CODEDEFT_TOKEN:'tok-123'},async(port,repo)=>{
  const body=JSON.stringify({repository:repo});
  assert.equal((await request(port,{method:'POST',pathname:'/api/index',headers:json,body})).status,401);
  assert.equal((await request(port,{method:'POST',pathname:'/api/index',headers:{...json,'x-codedeft-token':'tok-12'},body})).status,401,'prefix of token');
  assert.equal((await request(port,{method:'POST',pathname:'/api/index',headers:{...json,'x-codedeft-token':'tok-123'},body})).status,200);
  const page=await request(port,{pathname:'/'});
  if(page.status===200)assert.match(page.body,/<meta name="codedeft-token" content="tok-123">/);
 });
});
test('multi-byte characters split across request chunks are decoded intact',async()=>{
 await withServer({},async(port,repo)=>{
  const body=Buffer.from(JSON.stringify({repository:repo,requirement:'login café validation'}));
  const cut=body.indexOf(Buffer.from('é'))+1; // inside the two-byte é
  const res=await request(port,{method:'POST',pathname:'/api/reuse/discover',headers:{...json,'content-length':body.length},chunks:[body.subarray(0,cut),body.subarray(cut)]});
  assert.equal(res.status,200,res.body);
  assert.equal(JSON.parse(res.body).requirement,'login café validation');
 });
});
test('oversized and malformed bodies get clear errors',async()=>{
 await withServer({},async(port)=>{
  const big=await request(port,{method:'POST',pathname:'/api/search',headers:json,body:'"'+'x'.repeat(4.2*1024*1024)+'"'});
  assert.equal(big.status,413);
  const bad=await request(port,{method:'POST',pathname:'/api/search',headers:json,body:'{not json'});
  assert.equal(bad.status,400);assert.match(JSON.parse(bad.body).error,/not valid JSON/);
 });
});
test('server works when started from another directory and reports the package version',async()=>{
 const version=JSON.parse(fs.readFileSync(path.join(here,'../package.json'),'utf8')).version;
 await withServer({},async(port,_repo,child)=>{
  const health=JSON.parse((await request(port)).body);assert.equal(health.version,version);
  const page=await request(port,{pathname:'/'});assert.ok([200,503].includes(page.status),String(page.status));
  assert.equal((await request(port)).status,200,'still alive after the static request');
  assert.equal(child.exitCode,null);
 },{cwd:path.join(here,'../apps/server')});
});
