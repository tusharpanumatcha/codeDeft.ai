import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {indexRepository,analyzeRepository,createContextBundle,saveProfile} from '../dist/index.js';
test('repository profile detects framework and grounded conventions',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'codedeft-intelligence-'));
 try{
  fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({dependencies:{vue:'^3.0.0',pinia:'^2.0.0'}}));
  fs.writeFileSync(path.join(root,'CustomerTable.vue'),'<script setup lang="ts">\nconst customer = 1;\n</script>\n<template><p>Customer</p></template>');
  fs.writeFileSync(path.join(root,'customerStore.ts'),"import { defineStore } from 'pinia'; export const useCustomerStore = defineStore('customer',()=>({}));");
  const index=indexRepository(root);const profile=analyzeRepository(index);
  assert.ok(profile.frameworks.includes('vue'));
  assert.ok(profile.conventions.some(c=>c.id==='vue-script-setup' && c.evidence.includes('CustomerTable.vue')));
  assert.ok(profile.conventions.some(c=>c.id==='pinia'));
  const bundle=createContextBundle(index,'customer store');
  assert.ok(bundle.evidence.some(e=>e.path==='customerStore.ts'));
  const output=path.join(root,'output','profile.json');saveProfile(profile,output);
  assert.equal(JSON.parse(fs.readFileSync(output,'utf8')).files,2);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
