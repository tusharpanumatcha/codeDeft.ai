import test from 'node:test';import assert from 'node:assert/strict';
import {LruCache} from '../dist/lru.js';
test('evicts least-recently-used entries under the entry budget',()=>{
 const c=new LruCache({maxEntries:2,maxBytes:100,ttlMs:1000});c.set('a',1,1);c.set('b',2,1);c.get('a');c.set('c',3,1);
 assert.equal(c.get('b'),undefined);assert.equal(c.get('a'),1);assert.equal(c.get('c'),3);
});
test('evicts by bytes and rejects values larger than the budget',()=>{
 const c=new LruCache({maxEntries:10,maxBytes:10,ttlMs:1000});c.set('a',1,6);c.set('b',2,6);
 assert.equal(c.get('a'),undefined);assert.equal(c.totalBytes,6);assert.equal(c.set('huge',3,11),false);assert.equal(c.size,1);
});
test('expires entries with a sliding TTL',()=>{
 let t=0;const c=new LruCache({maxEntries:10,maxBytes:100,ttlMs:100,now:()=>t});c.set('a',1,1);c.set('b',2,1);
 t=90;assert.equal(c.get('a'),1);t=150;assert.equal(c.get('b'),undefined,'b expired');assert.equal(c.get('a'),1,'a refreshed at 90');
 t=400;c.set('c',3,1);assert.equal(c.size,1,'expired swept on insert');
});
test('replacing a key keeps byte accounting exact',()=>{
 const c=new LruCache({maxEntries:10,maxBytes:100,ttlMs:1000});c.set('a',1,10);c.set('a',2,20);assert.equal(c.totalBytes,20);c.delete('a');assert.equal(c.totalBytes,0);
});
