import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RepositoryStore, indexRepository, createContextBundle } from '../dist/index.js';

test('SQLite persists files, symbols, edges, conventions and supports reindex',()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'codedeft-sqlite-'));
 const root=path.join(base,'repo');fs.mkdirSync(root);
 const db=path.join(base,'data','codedeft.db');
 try {
  fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({dependencies:{vue:'^3.0.0',pinia:'^2.0.0'}}));
  fs.writeFileSync(path.join(root,'customers.ts'),'export function searchCustomers() { return true; }');
  fs.writeFileSync(path.join(root,'app.ts'),"import { searchCustomers } from './customers';\nexport const page = searchCustomers();");
  fs.writeFileSync(path.join(root,'store.ts'),"export const useStore = defineStore('customers', {});");
  let store=new RepositoryStore(db);
  const saved=store.save(indexRepository(root));
  assert.equal(saved.files,3);assert.equal(saved.dependencies,1);assert.ok(saved.symbols>=3);assert.ok(saved.conventions>=1);
  store.close();
  store=new RepositoryStore(db);
  const loaded=store.load(root);
  assert.equal(loaded.files.length,3);
  assert.deepEqual(loaded.edges,[{from:'app.ts',to:'customers.ts'}]);
  assert.ok(loaded.files.find(f=>f.path==='customers.ts').symbols.some(s=>s.name==='searchCustomers'));
  assert.ok(createContextBundle(loaded,'search customers').evidence.length);
  assert.ok(store.profile(root).conventions.some(c=>c.id==='pinia'));
  fs.rmSync(path.join(root,'app.ts'));
  const updated=store.index(root);
  assert.equal(updated.files,2);assert.equal(updated.dependencies,0);
  store.close();
 } finally {fs.rmSync(base,{recursive:true,force:true});}
});
