const {test}=require('node:test');const assert=require('node:assert/strict');
const {modelName,preferredModel}=require('../../../modules/chat/model-presentation.ts');
test('friendly names keep model versions distinct and leave custom IDs intact',()=>{
 assert.equal(modelName('claude-sonnet-4-5-20250929'),'Claude Sonnet 4.5');
 assert.equal(modelName('claude-3-7-sonnet-20250219'),'Claude 3.7 Sonnet');
 assert.equal(modelName('gpt-4.1-mini'),'GPT-4.1 mini');
 assert.equal(modelName('my/custom-tuned:latest'),'my/custom-tuned:latest');
 assert.notEqual(modelName('claude-sonnet-4-5'),modelName('claude-sonnet-4-6'));
});
test('new chats use the enabled default, then enabled prior choice, and never a hidden model',()=>{
 const connections=[{id:'a',enabledModels:['one','two']},{id:'b',enabledModels:['one']}];
 assert.deepEqual(preferredModel(connections,{connectionId:'b',model:'one'},{connectionId:'a',model:'two'}),{connectionId:'b',model:'one'});
 assert.deepEqual(preferredModel(connections,null,{connectionId:'a',model:'two'}),{connectionId:'a',model:'two'});
 assert.deepEqual(preferredModel(connections,{connectionId:'b',model:'hidden'},{connectionId:'a',model:'hidden'}),{connectionId:'a',model:'one'});
 assert.equal(preferredModel([{id:'a',enabledModels:[]}],null),null);
});
test('custom labels are display-only, reset to original names, and ignore inherited object keys',()=>{
 const id='my/custom:Q6_K',labels={[id]:'My coding model'};
 assert.equal(modelName(id,labels),'My coding model');assert.equal(modelName(id,{}),id);
 assert.equal(modelName('__proto__',{}),'__proto__');assert.equal(modelName('constructor',{}),'constructor');
});
