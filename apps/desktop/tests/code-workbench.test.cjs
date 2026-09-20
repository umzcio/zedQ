const {test}=require('node:test'),assert=require('node:assert/strict');
const {emptyLayout,restoreLayout,openTab,closeTab,splitLayout,moveTab,mergePanes}=require('../../../modules/code/workbench-layout.ts');
test('split, move and merge preserve unique session identities and focused tab',()=>{
 let s=openTab(openTab(openTab(emptyLayout(),'a'),'b'),'c');s=splitLayout(s,'columns');
 assert.deepEqual(s.panes,[{tabs:['b','c'],active:'c'},{tabs:['a'],active:'a'}]);
 s=moveTab(s,'c',1);assert.deepEqual(s.panes,[{tabs:['b'],active:'b'},{tabs:['a','c'],active:'c'}]);
 s=openTab(s,'b');assert.equal(s.focus,0);s=mergePanes(s);assert.deepEqual(s.panes,[{tabs:['b','a','c'],active:'b'}]);
});
test('closing active/last tab picks a neighbor and collapses only empty panes',()=>{
 let s=splitLayout(openTab(openTab(emptyLayout(),'a'),'b'),'rows');s=closeTab(s,'b');assert.deepEqual(s.panes,[{tabs:['a'],active:'a'}]);assert(s.shown);s=closeTab(s,'a');assert.equal(s.shown,false);assert.equal(s.panes.length,1);
});
test('restore validates persisted layout and deduplicates tabs across panes',()=>{
 const s=restoreLayout({panes:[{tabs:['a','a',null],active:'missing'},{tabs:['a','b'],active:'b'}],focus:10,shown:true,axis:'oops',ratio:150});
 assert.deepEqual(s,{panes:[{tabs:['a'],active:'a'},{tabs:['b'],active:'b'}],focus:0,shown:true,axis:'columns',ratio:80});assert.equal(restoreLayout(null,'legacy').panes[0].active,'legacy');
});
