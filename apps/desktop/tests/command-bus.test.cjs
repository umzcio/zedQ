const {test}=require('node:test');const assert=require('node:assert/strict');
const {createCommandBus}=require('../src/command-bus.ts');
test('missing module commands report rejection so callers preserve unsaved captures',()=>{
 const missing=[];const bus=createCommandBus(name=>missing.push(name));assert.equal(bus.run('notes.new','keep me'),false);assert.deepEqual(missing,['notes.new']);
});
test('dispatch confirms acceptance only after the owning module handles it',()=>{
 const bus=createCommandBus(()=>{});const created=[];const off=bus.register('notes.new',body=>created.push(body));assert.equal(bus.run('notes.new','capture'),true);assert.deepEqual(created,['capture']);off();assert.equal(bus.run('notes.new','preserve'),false);
});
test('commands have a single owner and propagate failure without reporting success',()=>{
 const bus=createCommandBus(()=>{});bus.register('notes.new',()=>{throw Error('cannot save')});assert.throws(()=>bus.register('notes.new',()=>{}),/already registered/);assert.throws(()=>bus.run('notes.new','preserve'),/cannot save/);
});
