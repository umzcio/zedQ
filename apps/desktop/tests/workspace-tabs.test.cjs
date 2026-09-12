const { test } = require('node:test');
const assert = require('node:assert/strict');
const { restoreTabState, openTab, closeTabs, moveTab } = require('../../../modules/notes/tab-state.ts');

const mixed = () => ({order:['note:a','file:f','note:b','note:c'],active:'file:f'});
test('legacy tabs migrate without duplicates or missing documents', () => {
 assert.deepEqual(restoreTabState({tabs:['a','missing','a','b'],activeFileId:'f'},['a','b'],['f']),{order:['file:f','note:a','note:b'],active:'file:f'});
});
test('saved mixed order and deliberately closed files stay closed after restart', () => {
 assert.deepEqual(restoreTabState({tabOrder:['note:b','file:f','note:a','file:missing'],activeFileId:'f'},['a','b'],['f','closed']),{order:['note:b','file:f','note:a'],active:'file:f'});
 assert.deepEqual(restoreTabState({tabOrder:[],selectedNote:'a'},['a'],['f']),{order:[],active:null});
});
test('opening an existing tab selects it without changing its position', () => {
 assert.deepEqual(openTab(mixed(),'note:a'),{order:mixed().order,active:'note:a'});
 assert.deepEqual(openTab(mixed(),'file:new'),{order:[...mixed().order,'file:new'],active:'file:new'});
});
test('closing an active tab selects its right neighbor, then left at the end', () => {
 assert.deepEqual(closeTabs(mixed(),'file:f','one'),{order:['note:a','note:b','note:c'],active:'note:b'});
 assert.deepEqual(closeTabs({...mixed(),active:'note:c'},'note:c','one'),{order:['note:a','file:f','note:b'],active:'note:b'});
 assert.equal(closeTabs(mixed(),'note:b','one').active,'file:f');
});
test('bulk close is scoped to the right-clicked tab and preserves active when retained', () => {
 assert.deepEqual(closeTabs(mixed(),'note:b','others'),{order:['note:b'],active:'note:b'});
 assert.deepEqual(closeTabs(mixed(),'note:b','right'),{order:['note:a','file:f','note:b'],active:'file:f'});
 assert.deepEqual(closeTabs({...mixed(),active:'note:c'},'note:a','right'),{order:['note:a'],active:'note:a'});
 assert.deepEqual(closeTabs(mixed(),'file:f','all'),{order:[],active:null});
});
test('mixed tabs reorder in either direction without changing the active document', () => {
 const original=mixed();
 assert.deepEqual(moveTab(original,'note:a','note:b','after'),{order:['file:f','note:b','note:a','note:c'],active:'file:f'});
 assert.deepEqual(moveTab(original,'note:c','file:f','before'),{order:['note:a','note:c','file:f','note:b'],active:'file:f'});
 assert.deepEqual(moveTab(original,'external','note:a','before'),original);
 assert.deepEqual(closeTabs(original,'external','others'),original);
 assert.deepEqual(original,mixed());
});
