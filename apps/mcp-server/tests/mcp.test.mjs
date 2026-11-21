// End-to-end: starts the bundled server over stdio with the official MCP client, like Copilot or Claude would.
import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {ListRootsRequestSchema} from '@modelcontextprotocol/sdk/types.js';
const SERVER=fileURLToPath(new URL('../dist/codedeft-mcp.mjs',import.meta.url));
function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cd-mcp-'));
 const w=(p,c)=>{fs.mkdirSync(path.dirname(path.join(dir,p)),{recursive:true});fs.writeFileSync(path.join(dir,p),c);};
 w('package.json',JSON.stringify({name:'shop',dependencies:{vue:'^3.4.0',axios:'^1.7.0'}}));
 w('src/utils/money.ts','// Money helpers\nexport function formatPrice(amount: number, currency = "USD") {\n  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);\n}\nexport const TAX_RATE = 0.2;\n');
 w('src/components/PayButton.vue','<template><button class="pay" @click="$emit(\'pay\')">Pay {{ label }}</button></template>\n<script setup lang="ts">\ndefineProps<{ label: string }>()\n</script>\n');
 w('src/views/CartView.vue','<template><PayButton label="now" /></template>\n<script setup lang="ts">\nimport PayButton from "@/components/PayButton.vue"\nimport { formatPrice } from "@/utils/money"\nconst total = formatPrice(10)\n</script>\n');
 w('src/api/orders.ts','import axios from "axios";\nexport async function createOrder(body: unknown) { return axios.post("/orders", body); }\n');
 return dir;
}
async function connect(env,{roots}={}){
 const client=new Client({name:'test-client',version:'1.0.0'},{capabilities:roots?{roots:{listChanged:false}}:{}});
 if(roots)client.setRequestHandler(ListRootsRequestSchema,async()=>({roots:roots.map(r=>({uri:pathToFileURL(r).href,name:'ws'}))}));
 const transport=new StdioClientTransport({command:process.execPath,args:[SERVER],env:{...process.env,...env},cwd:os.tmpdir(),stderr:'pipe'});
 await client.connect(transport);
 return client;
}
const textOf=r=>r.content.map(c=>c.text).join('\n');

test('advertises read-only tools, a prompt and usage instructions',async()=>{
 const repo=fixture();const c=await connect({CODEDEFT_REPOSITORY:repo});
 try{
  const {tools}=await c.listTools();
  assert.deepEqual(tools.map(t=>t.name).sort(),['find_reusable_code','get_conventions','get_dependencies','get_task_context','lookup_symbol','search_code','verify_code']);
  assert.ok(tools.every(t=>t.annotations?.readOnlyHint===true),'all read-only: no confirmation dialogs in VS Code');
  assert.match(c.getInstructions(),/call get_task_context/);assert.match(c.getInstructions(),/verify_code/);
  const {prompts}=await c.listPrompts();assert.equal(prompts[0].name,'implement_with_context');
  const p=await c.getPrompt({name:'implement_with_context',arguments:{task:'checkout page'}});
  assert.match(p.messages[0].content.text,/Task: checkout page[\s\S]*get_task_context[\s\S]*verify_code/);
 }finally{await c.close();fs.rmSync(repo,{recursive:true,force:true});}
});

test('get_task_context returns grounded files, exports, reuse candidates, packages and rules',async()=>{
 const repo=fixture();const c=await connect({CODEDEFT_REPOSITORY:repo});
 try{
  const r=await c.callTool({name:'get_task_context',arguments:{task:'add a checkout page that shows the total price and a pay button'}});
  const t=textOf(r);
  assert.match(t,/## Ground rules/);assert.match(t,/Declared dependencies \(only these may be imported\): axios, vue/);
  assert.match(t,/### src\/components\/PayButton\.vue/);assert.match(t,/formatPrice/);
  assert.match(t,/## Reuse before writing new code/);
  assert.match(t,/src\/views\/CartView\.vue → src\/components\/PayButton\.vue/,'alias-resolved relationships');
  assert.ok(r.structuredContent.files.length>0);assert.ok(r.structuredContent.reuse.some(x=>x.name==='PayButton'||x.name==='formatPrice'));
 }finally{await c.close();fs.rmSync(repo,{recursive:true,force:true});}
});

test('verify_code catches hallucinated imports and confirms correct code',async()=>{
 const repo=fixture();const c=await connect({CODEDEFT_REPOSITORY:repo});
 try{
  const bad=await c.callTool({name:'verify_code',arguments:{files:[{path:'src/views/CheckoutView.vue',content:'<template><PayButton label="x"/></template>\n<script setup lang="ts">\nimport PayButton from "@/components/PayButton.vue"\nimport { formatCurrency } from "@/utils/money"\nimport { useCart } from "@/stores/cart"\nimport dayjs from "dayjs"\n</script>'}]}});
  const t=textOf(bad);
  assert.equal(bad.structuredContent.ok,false);assert.equal(bad.structuredContent.errors,3);
  assert.match(t,/formatCurrency.*not exported.*formatPrice/);assert.match(t,/@\/stores\/cart.*does not resolve/);assert.match(t,/dayjs.*not declared/);
  const good=await c.callTool({name:'verify_code',arguments:{files:[{path:'src/views/CheckoutView.vue',content:'<template><PayButton :label="total"/></template>\n<script setup lang="ts">\nimport PayButton from "@/components/PayButton.vue"\nimport { formatPrice } from "@/utils/money"\nimport { createOrder } from "../api/orders"\nconst total = formatPrice(5)\n</script>'}]}});
  assert.equal(good.structuredContent.ok,true,textOf(good));
 }finally{await c.close();fs.rmSync(repo,{recursive:true,force:true});}
});

test('lookup_symbol, search_code, find_reusable_code, get_dependencies, get_conventions',async()=>{
 const repo=fixture();const c=await connect({CODEDEFT_REPOSITORY:repo});
 try{
  assert.match(textOf(await c.callTool({name:'lookup_symbol',arguments:{name:'formatPrice'}})),/src\/utils\/money\.ts:2/);
  assert.match(textOf(await c.callTool({name:'lookup_symbol',arguments:{name:'formatCurrency'}})),/does not exist[\s\S]*formatPrice/);
  assert.match(textOf(await c.callTool({name:'search_code',arguments:{query:'pay button'}})),/PayButton\.vue/);
  assert.match(textOf(await c.callTool({name:'find_reusable_code',arguments:{requirement:'format a price as currency'}})),/formatPrice/);
  const deps=await c.callTool({name:'get_dependencies',arguments:{file:'src/components/PayButton.vue'}});
  assert.deepEqual(deps.structuredContent.importedBy,['src/views/CartView.vue']);
  assert.match(textOf(await c.callTool({name:'get_dependencies',arguments:{file:'src/components/PayBtn.vue'}})),/not in the repository index/);
  assert.match(textOf(await c.callTool({name:'get_conventions',arguments:{}})),/Frameworks: .*vue/);
 }finally{await c.close();fs.rmSync(repo,{recursive:true,force:true});}
});

test('uses the client workspace root (MCP roots) and re-indexes when files change',async()=>{
 const repo=fixture();const c=await connect({CODEDEFT_REPOSITORY:''},{roots:[repo]});
 try{
  assert.match(textOf(await c.callTool({name:'lookup_symbol',arguments:{name:'formatPrice'}})),/money\.ts/);
  fs.writeFileSync(path.join(repo,'src/utils/discount.ts'),'export function applyDiscount(p: number) { return p * 0.9; }\n');
  assert.match(textOf(await c.callTool({name:'lookup_symbol',arguments:{name:'applyDiscount'}})),/src\/utils\/discount\.ts:1/,'new file visible without restart');
 }finally{await c.close();fs.rmSync(repo,{recursive:true,force:true});}
});

test('errors are returned as tool errors, not crashes',async()=>{
 const c=await connect({CODEDEFT_REPOSITORY:''});
 try{
  const r=await c.callTool({name:'search_code',arguments:{query:'x',repository:'/definitely/not/here'}});
  assert.equal(r.isError,true);assert.match(textOf(r),/codeDeft:/);
  const ok=await c.callTool({name:'get_conventions',arguments:{}});assert.ok(ok.content.length,'server still alive');
 }finally{await c.close();}
});
