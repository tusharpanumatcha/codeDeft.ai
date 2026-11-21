import test from 'node:test';
import assert from 'node:assert/strict';
import {queryRepository} from '../packages/engine/dist/index.js';
const makeFile=(file,content)=>({path:file,content,imports:[],symbols:[]});
test('authentication query excludes filler words and ranks relevant files',()=>{
  const index={root:'/tmp/example',indexedAt:'now',edges:[],files:[makeFile('src/Cropper.vue','function how() { return 1 }'),makeFile('src/store/auth.ts','export const authenticateUser = () => token') ,makeFile('src/ripple.ts','function how() {}')]};
  const hits=queryRepository(index,'How is authentication implemented?');
  assert.equal(hits[0]?.file,'src/store/auth.ts');
  assert.equal(hits.length,1);
});
import {createContextBundle} from '../packages/engine/dist/index.js';
test('CLI context bundles and server search share one ranking, including two-letter terms',()=>{
 const index={root:'/tmp/example',indexedAt:'now',edges:[],files:[makeFile('src/ui/Button.vue','<template><button/></template>'),makeFile('src/db/client.ts','export const db = connect()'),makeFile('src/author.ts','export const author = "x"')]};
 for(const q of ['where is the db client','how does the UI button work','How is authentication implemented?']){
  assert.deepEqual(createContextBundle(index,q).evidence.map(e=>e.path),queryRepository(index,q,6).map(h=>h.file),q);
 }
 assert.equal(queryRepository(index,'db')[0].file,'src/db/client.ts');
 assert.equal(queryRepository(index,'ui')[0].file,'src/ui/Button.vue');
 assert.equal(queryRepository(index,'authentication').length,0,'"author" must not match "authentication"');
});
