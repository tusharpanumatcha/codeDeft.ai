import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {indexRepository,resolveImport} from '../dist/index.js';
function repo(files){const root=fs.mkdtempSync(path.join(os.tmpdir(),'cd-resolve-'));for(const[f,c]of Object.entries(files)){fs.mkdirSync(path.dirname(path.join(root,f)),{recursive:true});fs.writeFileSync(path.join(root,f),c);}return root;}
const edges=root=>indexRepository(root).edges.map(e=>`${e.from} -> ${e.to}`).sort();

test('resolves @/ imports in a Vue project with no alias config (Vite default)',()=>{
 const root=repo({'src/components/BaseInput.vue':'<script setup lang="ts"></script>','src/composables/useAuth.ts':'export const useAuth=()=>1',
  'src/views/Login.vue':"<script setup lang=\"ts\">\nimport BaseInput from '@/components/BaseInput.vue'\nimport { useAuth } from '@/composables/useAuth'\n</script>"});
 try{assert.deepEqual(edges(root),['src/views/Login.vue -> src/components/BaseInput.vue','src/views/Login.vue -> src/composables/useAuth.ts']);}
 finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('reads tsconfig paths, including a config that extends another and index.vue folders',()=>{
 const root=repo({'tsconfig.base.json':JSON.stringify({compilerOptions:{baseUrl:'.',paths:{'#shared/*':['lib/shared/*']}}}),
  'tsconfig.json':JSON.stringify({extends:'./tsconfig.base.json'}),
  'lib/shared/table/index.vue':'<template><table/></template>','app/page.ts':"import T from '#shared/table'"});
 try{assert.deepEqual(edges(root),['app/page.ts -> lib/shared/table/index.vue']);}
 finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('reads aliases from vite.config without executing it',()=>{
 const root=repo({'vite.config.ts':"export default defineConfig({ resolve: { alias: { '@': fileURLToPath(new URL('./client', import.meta.url)), '~ui': path.resolve(__dirname, 'client/ui') } } })",
  'client/ui/Btn.ts':'export const Btn=1','client/pages/Home.vue':"<script setup>\nimport {Btn} from '~ui/Btn'\nimport Same from '@/ui/Btn'\n</script>"});
 try{assert.deepEqual(edges(root),['client/pages/Home.vue -> client/ui/Btn.ts']);}
 finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('never resolves packages, missing files or paths outside the repository',()=>{
 const files=new Set(['src/a.ts']);const cfg={aliases:[{pattern:'@/*',targets:['src/*'],source:'t'}]};
 assert.equal(resolveImport('src/b.ts','vue',files,cfg),undefined);
 assert.equal(resolveImport('src/b.ts','@/missing',files,cfg),undefined);
 assert.equal(resolveImport('src/b.ts','../../etc/passwd',files,cfg),undefined);
 assert.equal(resolveImport('src/b.ts','./a.js',files,cfg),'src/a.ts');
 assert.equal(resolveImport('src/b.ts','@/a?raw',files,cfg),'src/a.ts');
});
