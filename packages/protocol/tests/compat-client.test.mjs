import test from 'node:test';import assert from 'node:assert/strict';
import {negotiate,parseHealth,createApiClient,endpoints,ApiError,API_VERSION,LEGACY_CAPABILITIES} from '../dist/index.js';
test('API-1 servers (no api field) are compatible with the legacy capability set',()=>{
 const c=negotiate(parseHealth({ok:true,version:'0.9.0'}));
 assert.equal(c.compatible,true);assert.equal(c.serverApi,1);assert.deepEqual([...c.capabilities].sort(),[...LEGACY_CAPABILITIES].sort());assert.equal(c.capabilities.has('figma.read'),false);
});
test('newer servers that still serve this client are compatible; unknown capabilities are ignored',()=>{
 const c=negotiate(parseHealth({ok:true,version:'2.0.0',api:{version:5,minClient:1},capabilities:['search','teleport']}));
 assert.equal(c.compatible,true);assert.deepEqual([...c.capabilities],['search']);
});
test('servers that require a newer client are reported, not crashed on',()=>{
 const c=negotiate(parseHealth({ok:true,version:'3.0.0',api:{version:7,minClient:API_VERSION+1}}));
 assert.equal(c.compatible,false);assert.match(c.message,/too old/);
});
test('malformed health responses never throw',()=>{
 for(const h of [null,'x',{},{ok:false},{ok:true,api:'bad',capabilities:'x'}])assert.doesNotThrow(()=>negotiate(parseHealth(h)));
 assert.equal(negotiate(undefined).compatible,false);
});
const reply=(status,body,raw)=>({ok:status<400,status,text:async()=>raw??JSON.stringify(body)});
function fakeServer(routes){return async(url,init)=>{const path=new URL(url,'http://x').pathname;const r=routes[path];if(!r)return reply(404,{error:'Unknown API endpoint'});return typeof r==='function'?r(init):r;};}
test('client gates calls on capabilities and explains what to update',async()=>{
 const api=endpoints(createApiClient({client:'test',baseUrl:'http://127.0.0.1:1',fetch:fakeServer({'/api/health':reply(200,{ok:true,version:'0.9.0'})})}));
 await assert.rejects(api.figmaRead('https://www.figma.com/design/A/x','t'),e=>e instanceof ApiError&&e.code==='unsupported'&&/0\.9\.0 does not support reading Figma/.test(e.message));
});
test('client maps legacy 404s, non-JSON bodies, network errors and timeouts to ApiError',async()=>{
 const health=reply(200,{ok:true,version:'x',api:{version:2,minClient:1},capabilities:['search','graph','info','index']});
 const api=endpoints(createApiClient({client:'test',baseUrl:'http://127.0.0.1:1',fetch:fakeServer({'/api/health':health,'/api/info':reply(502,null,'<html>Bad gateway</html>'),'/api/graph':reply(200,null,'not json')})}));
 await assert.rejects(api.search('/r','q'),e=>e.code==='unsupported');
 await assert.rejects(api.info('/r'),e=>e.code==='upstream_error'&&e.status===502);
 await assert.rejects(api.graph('/r',''),e=>e.code==='bad_response');
 const down=createApiClient({client:'t',baseUrl:'http://127.0.0.1:1',fetch:async()=>{throw new TypeError('fetch failed')}});
 await assert.rejects(down.raw('GET','/api/health'),e=>e.code==='network');
 const slow=createApiClient({client:'t',baseUrl:'http://127.0.0.1:1',fetch:(u,i)=>new Promise((_,rej)=>i.signal.addEventListener('abort',()=>rej(new Error('aborted'))))});
 await assert.rejects(slow.raw('GET','/api/x',undefined,{timeoutMs:30}),e=>e.code==='timeout');
 const ctl=new AbortController();const p=slow.raw('GET','/api/x',undefined,{signal:ctl.signal});ctl.abort();
 await assert.rejects(p,e=>e.code==='aborted');
});
test('a failed health probe is retried on the next call (server started later)',async()=>{
 let up=false;const client=createApiClient({client:'t',baseUrl:'http://127.0.0.1:1',fetch:async(u)=>{if(!up)throw new TypeError('down');return reply(200,{ok:true,version:'1',api:{version:2,minClient:1},capabilities:['search']});}});
 assert.equal((await client.compat()).compatible,false);up=true;
 await new Promise(r=>setTimeout(r,0));
 assert.equal((await client.compat()).compatible,true);
});
test('responses missing fields are normalised instead of crashing the UI',async()=>{
 const health=reply(200,{ok:true,version:'x',api:{version:2,minClient:1},capabilities:['search','reuse.discover']});
 const api=endpoints(createApiClient({client:'t',baseUrl:'http://127.0.0.1:1',fetch:fakeServer({'/api/health':health,'/api/search':reply(200,{hits:[{file:'a.ts'},{nope:1},'x']}),'/api/reuse/discover':reply(200,{results:[{file:'a.ts',name:'f',effort:'weird'}]})})}));
 assert.deepEqual(await api.search('/r','q'),[{file:'a.ts',score:0,reasons:[],excerpt:undefined,symbols:[]}]);
 const d=await api.discover('/r','x');assert.equal(d.results[0].effort.level,'medium');assert.deepEqual(d.results[0].usedBy,[]);
});
