import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {indexRepository,verifyCode,lookupSymbol,suggestNames} from '../dist/index.js';
function repo(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cd-verify-'));
 const w=(p,c)=>{fs.mkdirSync(path.dirname(path.join(dir,p)),{recursive:true});fs.writeFileSync(path.join(dir,p),c);};
 w('package.json',JSON.stringify({name:'shop',dependencies:{vue:'^3.4.0',axios:'^1.7.0'},devDependencies:{'@types/lodash':'^4'}}));
 w('src/utils/money.ts','export function formatPrice(n: number) { return n.toFixed(2); }\nexport const CURRENCY = "USD";\nexport type Money = number;\n');
 w('src/utils/index.ts',"export * from './money';\n");
 w('src/components/PayButton.vue','<template><button>Pay</button></template>\n<script setup lang="ts">\ndefineProps<{ amount: number }>()\n</script>\n');
 w('src/api/orders.ts','import axios from "axios";\nexport default async function fetchOrders() { return axios.get("/orders"); }\nexport async function createOrder(body: unknown) { return axios.post("/orders", body); }\n');
 return dir;
}
test('accepts code whose files, packages and exports all exist',()=>{
 const dir=repo();try{const index=indexRepository(dir);
  const r=verifyCode(index,'src/views/Checkout.vue',`<template><PayButton :amount="1"/></template>\n<script setup lang="ts">\nimport PayButton from '@/components/PayButton.vue'\nimport { formatPrice } from '../utils/money'\nimport fetchOrders, { createOrder } from '@/api/orders'\nimport { ref } from 'vue'\nimport path from 'node:path'\n</script>`);
  assert.equal(r.ok,true,JSON.stringify(r.findings));assert.equal(r.imports.filter(i=>i.kind==='repository').length,3);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('catches hallucinated files, exports, default exports and packages, with suggestions',()=>{
 const dir=repo();try{const index=indexRepository(dir);
  const r=verifyCode(index,'src/views/Checkout.ts',[
   "import { formatCurrency } from '@/utils/money'",
   "import money from '@/utils/money'",
   "import { useCart } from '@/composables/useCart'",
   "import dayjs from 'dayjs'",
   "import { createOrdr } from '../api/orders'"
  ].join('\n'));
  const by=c=>r.findings.filter(f=>f.code===c);
  assert.equal(r.ok,false);
  assert.match(by('missing_export')[0].message,/formatCurrency.*not exported.*formatPrice/);
  assert.equal(by('missing_default_export').length,1);
  assert.match(by('missing_file')[0].message,/@\/composables\/useCart/);
  assert.match(by('undeclared_package')[0].message,/dayjs/);
  assert.deepEqual(by('missing_export')[1].suggestions,['createOrder']);
  assert.equal(by('missing_export')[1].line,5);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('export * targets are reported as unverifiable, not as errors',()=>{
 const dir=repo();try{const r=verifyCode(indexRepository(dir),'src/x.ts',"import { formatPrice } from './utils'");
  assert.equal(r.ok,true);assert.ok(r.findings.some(f=>f.code==='unverifiable_export'));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('flags code copied from an existing file instead of importing it',()=>{
 const dir=repo();try{
  const big=Array.from({length:30},(_,i)=>`export function helper${i}(value: number, factor: number) { const scaled = value * factor + ${i}; return Math.round(scaled * 100) / 100; }`).join('\n');
  fs.writeFileSync(path.join(dir,'src/utils/math.ts'),big);
  const r=verifyCode(indexRepository(dir),'src/utils/math-copy.ts',big.replace(/helper/g,'calc'));
  assert.ok(r.findings.some(f=>f.code==='duplicates_existing'&&/src\/utils\/math\.ts/.test(f.message)),JSON.stringify(r.findings));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('symbol lookup finds definitions or suggests real names',()=>{
 const dir=repo();try{const index=indexRepository(dir);
  const hit=lookupSymbol(index,'formatPrice');assert.equal(hit.definitions[0].file,'src/utils/money.ts');assert.match(hit.definitions[0].signature,/export function formatPrice/);
  const miss=lookupSymbol(index,'formatCurrency');assert.equal(miss.definitions.length,0);assert.ok(miss.suggestions.includes('formatPrice'));
  assert.deepEqual(suggestNames('creatOrder',['createOrder','fetchOrders','CURRENCY']),['createOrder']);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('files created together may import each other (siblings), with their exports checked',()=>{
 const dir=repo();try{const index=indexRepository(dir);
  const files=[{path:'src/views/Checkout.vue',content:'<script setup lang="ts">\nimport OrderSummary from "@/components/OrderSummary.vue"\nimport { useCheckout, useCart } from "../composables/useCheckout"\n</script>'},
   {path:'src/components/OrderSummary.vue',content:'<template><p>Total</p></template>'},
   {path:'src/composables/useCheckout.ts',content:'export function useCheckout() { return {}; }'}];
  const r=verifyCode(index,files[0].path,files[0].content,{siblings:files});
  assert.equal(r.findings.filter(f=>f.severity==='error').length,1,JSON.stringify(r.findings));
  assert.match(r.findings.find(f=>f.code==='missing_export').message,/useCart.*src\/composables\/useCheckout\.ts.*useCheckout/);
  assert.equal(verifyCode(index,files[0].path,files[0].content).errors,2,'without siblings both imports are missing');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
