import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {indexRepository,queryRepository,buildAgentContext} from '../dist/index.js';
test('indexes symbols and resolves local imports',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'codedeft-'));
 try{
  fs.writeFileSync(path.join(root,'table.ts'),'export function searchCustomers() { return true }');
  fs.writeFileSync(path.join(root,'app.ts'),"import { searchCustomers } from './table';\nexport const page = searchCustomers();");
  const idx=indexRepository(root);
  assert.equal(idx.files.length,2);
  assert.deepEqual(idx.edges,[{from:'app.ts',to:'table.ts'}]);
  assert.ok(idx.files.find(f=>f.path==='table.ts').symbols.some(s=>s.name==='searchCustomers'&&s.exported));
  assert.equal(queryRepository(idx,'search customers')[0].file,'table.ts');
  assert.ok(buildAgentContext(idx,'search customers').evidence.length);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
