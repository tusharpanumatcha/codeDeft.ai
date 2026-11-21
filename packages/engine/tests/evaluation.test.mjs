import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {codeSim,evaluateProposal,indexRepository,tokenEditDistance,winnow,containment} from '../dist/index.js';

const login=`<script setup lang="ts">
import { ref } from 'vue'
import { useAuth } from '@/composables/useAuth'
const email = ref('')
const password = ref('')
const error = ref<string | null>(null)
const { login } = useAuth()
async function submit() {
  error.value = null
  if (!email.value || !password.value) { error.value = 'Email and password are required'; return }
  try { await login(email.value, password.value) } catch (e) { error.value = 'Invalid credentials' }
}
</script>
<template>
  <form class="login" @submit.prevent="submit">
    <label>Email <input v-model="email" type="email" /></label>
    <label>Password <input v-model="password" type="password" /></label>
    <p v-if="error" class="error">{{ error }}</p>
    <button type="submit">Log in</button>
  </form>
</template>
<style scoped>.login { display: flex; gap: 12px; }</style>`;
const renamed=login.replaceAll('email','userEmail').replaceAll('password','pwd').replaceAll('error','msg').replaceAll('submit()','go()').replace('@submit.prevent="submit"','@submit.prevent="go"').replace(/\n {2}/g,'\n    ');
const different=`<script lang="ts">
import { defineComponent, reactive } from 'vue'
export default defineComponent({ setup() {
  const state = reactive({ username: '', secret: '', loading: false })
  const go = async () => { state.loading = true; await fetch('/api/login', { method: 'POST', body: JSON.stringify(state) }); state.loading = false }
  return { state, go }
} })
</script>
<template><div class="card"><input v-model="state.username" /><input v-model="state.secret" type="password" /><button :disabled="state.loading" @click="go">Enter</button></div></template>`;
const sim=(a,b,o)=>codeSim({path:'A.vue',content:a},{path:'B.vue',content:b},o).score;

test('CodeSim: identical files score 1 and the score is symmetric',()=>{
 assert.equal(sim(login,login),1);
 assert.equal(sim(login,different),sim(different,login));
});
test('CodeSim: renaming identifiers and reformatting barely changes the abstracted score',()=>{
 const s=sim(login,renamed);
 assert.ok(s>0.85,`expected > 0.85, got ${s}`);
 assert.ok(sim(login,renamed,{abstractIdentifiers:false})<s,'concrete comparison should be lower');
});
test('CodeSim: a different implementation scores low',()=>{
 const s=sim(login,different);
 assert.ok(s<0.4,`expected < 0.4, got ${s}`);
 assert.ok(sim(login,renamed)-s>0.4);
});
test('CodeSim: block weights sum to 1 and invalid weights are rejected',()=>{
 const r=codeSim({path:'A.vue',content:login},{path:'B.vue',content:different});
 const total=Object.values(r.blocks).reduce((n,b)=>n+b.weight,0);
 assert.ok(Math.abs(total-1)<0.01);
 assert.throws(()=>codeSim({path:'a.ts',content:'x'},{path:'b.ts',content:'y'},{weights:{alpha:0.5,beta:0.5,gamma:0.5}}),/sum to 1/);
});
test('building blocks: edit distance, winnowing guarantee and containment',()=>{
 assert.equal(tokenEditDistance(['a','b','c'],['a','x','c','d']),2);
 const base=Array.from({length:40},(_,i)=>`t${i}`);
 const shared=winnow(base);const extended=winnow([...['p','q','r'],...base,...['s']]);
 assert.ok(containment(shared,extended)>0.8,'a long shared run must share fingerprints');
 assert.equal(containment(new Set(),new Set([1])),0);
});

const table=`<script setup lang="ts">
import { computed, ref } from 'vue'
const props = defineProps<{ rows: Record<string, unknown>[]; columns: { key: string; label: string }[]; pageSize?: number }>()
const query = ref('')
const page = ref(1)
const filtered = computed(() => props.rows.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(query.value.toLowerCase()))))
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / (props.pageSize ?? 10))))
const visible = computed(() => filtered.value.slice((page.value - 1) * (props.pageSize ?? 10), page.value * (props.pageSize ?? 10)))
function next() { if (page.value < pages.value) page.value++ }
function prev() { if (page.value > 1) page.value-- }
</script>
<template>
  <div>
    <input v-model="query" placeholder="Search" />
    <table><thead><tr><th v-for="c in columns" :key="c.key">{{ c.label }}</th></tr></thead>
      <tbody><tr v-for="(r, i) in visible" :key="i"><td v-for="c in columns" :key="c.key">{{ r[c.key] }}</td></tr></tbody></table>
    <button @click="prev">Prev</button><span>{{ page }} / {{ pages }}</span><button @click="next">Next</button>
  </div>
</template>`;
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cd-eval-'));
 const w=(f,c)=>{fs.mkdirSync(path.dirname(path.join(root,f)),{recursive:true});fs.writeFileSync(path.join(root,f),c);};
 w('src/components/SharedDataTable.vue',table);
 w('src/composables/useAuth.ts','export function useAuth(){ return { login: async (u: string, p: string) => { if (!u || !p) throw new Error("missing"); return true } } }');
 w('src/views/LoginView.vue',login);
 w('src/views/Settings.vue','<script setup lang="ts">\nimport { ref } from \'vue\'\nconst dark = ref(false)\n</script>\n<template><label><input type="checkbox" v-model="dark" /> Dark mode</label></template>');
 return root;
}
test('R: copying an existing component instead of importing it is penalised',()=>{
 const root=fixture();
 try{
  const index=indexRepository(root);
  const copied=table.replaceAll('query','search').replaceAll('visible','pageRows');
  const r=evaluateProposal(index,{changes:[{path:'src/views/CustomerTable.vue',content:copied}]});
  assert.equal(r.files[0].matches[0].file,'src/components/SharedDataTable.vue');
  assert.ok(r.files[0].duplication>0.8,JSON.stringify(r.files[0]));
  assert.ok(r.reusability<0.2);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('R: reusing the component through an @/ import is not penalised',()=>{
 const root=fixture();
 try{
  const index=indexRepository(root);
  const page=`<script setup lang="ts">
import { ref, onMounted } from 'vue'
import SharedDataTable from '@/components/SharedDataTable.vue'
const customers = ref<Record<string, unknown>[]>([])
const columns = [{ key: 'name', label: 'Name' }, { key: 'email', label: 'Email' }, { key: 'plan', label: 'Plan' }]
onMounted(async () => { const res = await fetch('/api/customers'); customers.value = await res.json() })
</script>
<template><section><h1>Customers</h1><SharedDataTable :rows="customers" :columns="columns" :page-size="20" /></section></template>`;
  const r=evaluateProposal(index,{changes:[{path:'src/views/Customers.vue',content:page}]});
  assert.ok(!r.files[0].notes.some(n=>n.startsWith("Too little")),"page must be big enough to be judged: "+JSON.stringify(r.files[0]));
  assert.equal(r.files[0].duplication,0,JSON.stringify(r.files[0]));
  assert.equal(r.files[0].matches.find(m=>m.file==="src/components/SharedDataTable.vue")?.imported??true,true);
  assert.equal(r.reusability,1);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('R: an edited file is not compared with its own previous version, and tiny files are not judged',()=>{
 const root=fixture();
 try{
  const index=indexRepository(root);
  const edited=evaluateProposal(index,{changes:[{path:'src/components/SharedDataTable.vue',content:table+'\n<style>div{padding:4px}</style>'}]});
  assert.ok(edited.files[0].matches.every(m=>m.file!=='src/components/SharedDataTable.vue'));
  assert.ok(edited.files[0].reusability>0.8,JSON.stringify(edited.files[0]));
  const tiny=evaluateProposal(index,{changes:[{path:'src/x.ts',content:'export const a = 1'}]});
  assert.equal(tiny.files[0].reusability,1);assert.match(tiny.files[0].notes.join(' '),/Too little/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
