import test from 'node:test';import assert from 'node:assert/strict';
import {routeChatMessage,extractFigmaUrl} from '../dist/index.js';
const intent=m=>routeChatMessage(m).intent;
test('extracts exactly the Figma link from surrounding text and punctuation',()=>{
 assert.equal(extractFigmaUrl('Check this https://www.figma.com/design/ABC/x?node-id=1-2'),'https://www.figma.com/design/ABC/x?node-id=1-2');
 assert.equal(extractFigmaUrl('(see https://figma.com/file/K1/Name?node-id=3-4).'),'https://figma.com/file/K1/Name?node-id=3-4');
 assert.equal(extractFigmaUrl('link: https://www.figma.com/design/ABC/Page-(v2)!'),'https://www.figma.com/design/ABC/Page-(v2)');
 assert.equal(extractFigmaUrl('http://www.figma.com/design/ABC/x'),'https://www.figma.com/design/ABC/x');
 assert.equal(extractFigmaUrl('https://figma.com.evil.test/design/ABC'),undefined);
 assert.equal(extractFigmaUrl('no link'),undefined);
});
test('routes a message with a Figma link to Figma and keeps the rest as the query',()=>{
 const r=routeChatMessage('Check this https://www.figma.com/design/ABC/x?node-id=1-2 please');
 assert.equal(r.intent,'figma');assert.equal(r.figmaUrl,'https://www.figma.com/design/ABC/x?node-id=1-2');assert.equal(r.query,'Check this please');
});
test('explicit Figma commands route to Figma; merely mentioning Figma does not',()=>{
 for(const m of ['figma','Figma.','connect to figma','import figma design','read my figma file','Import the checkout screen from Figma'])assert.equal(intent(m),'figma',m);
 for(const m of ['where do we use figma tokens?','how is the figma color palette mapped','what does figmaTheme.ts do'])assert.equal(intent(m),'search',m);
});
test('reuse needs real evidence; ambiguous words alone stay search',()=>{
 for(const m of ['find reusable date formatting','can I reuse the data table?','is there something similar to useDebounce','we already have JWT validation somewhere','find duplicated validation logic','avoid rewriting the pagination component'])assert.equal(intent(m),'reuse',m);
 for(const m of ['Where is the existing login form?','how do we extract the user id from the token','what does the shared config do','explain the common utils folder','authentication'])assert.equal(intent(m),'search',m);
});
test('empty input',()=>assert.equal(intent('   '),'empty'));
