import test from 'node:test';import assert from 'node:assert/strict';import {parseFigmaUrl,normalizeFigmaResponse} from '../dist/index.js';
test('Figma URL frame selection',()=>assert.deepEqual(parseFigmaUrl('https://www.figma.com/design/ABC123/Example?node-id=12-45'),{fileKey:'ABC123',nodeId:'12:45'}));
test('reject non-Figma domains',()=>assert.throws(()=>parseFigmaUrl('https://figma.com.evil.test/design/ABC123/x')));
test('normalizes layout and text',()=>{const d=normalizeFigmaResponse('ABC',{name:'Demo',document:{children:[{id:'1:2',name:'Button',type:'FRAME',layoutMode:'HORIZONTAL',paddingLeft:12,children:[{id:'1:3',name:'Label',type:'TEXT',characters:'Continue',style:{fontSize:14}}]}]}});assert.equal(d.nodeCount,2);assert.equal(d.nodes[0].layout.paddingLeft,12);assert.equal(d.nodes[0].children[0].text.content,'Continue')});
test('branch URLs read the branch key',()=>assert.deepEqual(parseFigmaUrl('https://www.figma.com/design/MAIN123/branch/BR456/Example?node-id=1-2'),{fileKey:'BR456',branchOf:'MAIN123',nodeId:'1:2'}));
test('oversized designs fail early with a clear message',()=>{
 const children=Array.from({length:15001},(_,i)=>({id:`1:${i}`,name:'n',type:'RECTANGLE'}));
 assert.throws(()=>normalizeFigmaResponse('ABC',{document:{children:[{id:'0:1',name:'Page',type:'FRAME',children}]}}),/Select a single frame/);
});
