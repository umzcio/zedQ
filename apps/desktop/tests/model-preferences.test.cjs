const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {ChatService}=require('../electron/chat-service.cjs');
const {ChatStore}=require('../electron/chat-store.cjs');
function fixture(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'zq-model-preferences-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const keys=new Map(),credentials={get:async id=>keys.get(id),set:async(id,key)=>keys.set(id,key),delete:async id=>keys.delete(id)};
 const service=new ChatService({directory,credentials,provider:{listModels:async()=>{throw Error('Catalog must not be fetched')}}});
 const connection=service.saveConnection({name:'Local',provider:'ollama',baseUrl:'http://localhost:11434'});
 return {directory,keys,credentials,service,connection,file:path.join(directory,'chat.json')};
}
test('new connections opt in to no models and preferences survive restart without fetching catalogs',t=>{
 const f=fixture(t);assert.deepEqual(f.connection.enabledModels,[]);assert.deepEqual(f.connection.favoriteModels,[]);assert.equal(f.service.snapshot().defaultModel,null);
 const snapshot=f.service.saveModelPreferences({connectionId:f.connection.id,enabledModels:['local:a','local:b'],favoriteModels:['local:b'],defaultModel:'local:b'});
 assert.deepEqual(snapshot.defaultModel,{connectionId:f.connection.id,model:'local:b'});
 const restored=new ChatService({directory:f.directory});assert.deepEqual(restored.snapshot().connections[0].enabledModels,['local:a','local:b']);assert.deepEqual(restored.snapshot().connections[0].favoriteModels,['local:b']);assert.deepEqual(restored.snapshot().defaultModel,snapshot.defaultModel);
 snapshot.connections[0].enabledModels.push('external');assert.deepEqual(f.service.snapshot().connections[0].enabledModels,['local:a','local:b']);
});
test('provider setup saves selected models with credentials atomically and edits prune hidden defaults',async t=>{
 const f=fixture(t),input={name:'Cloud',provider:'openai',baseUrl:'',apiKey:'test-key',enabledModels:['selected']};
 const cloud=await f.service.saveConnection(input);assert.deepEqual(cloud.enabledModels,['selected']);
 f.service.saveModelPreferences({connectionId:cloud.id,favoriteModels:['selected'],defaultModel:'selected'});
 const edited=await f.service.saveConnection({...cloud,enabledModels:[]});assert.deepEqual(edited.favoriteModels,[]);assert.equal(f.service.snapshot().defaultModel,null);
 const save=f.service.store.save.bind(f.service.store);let writes=0;f.service.store.save=state=>{if(++writes===2)throw Error('Disk unavailable');return save(state)};
 await assert.rejects(f.service.saveConnection({...input,name:'Failed setup'}),/Disk/);
 assert.equal(f.service.snapshot().connections.length,2);assert.equal(new ChatStore(f.directory).load().connections.length,2);assert.deepEqual([...f.keys.values()],['test-key']);
 assert.throws(()=>f.service.saveConnection({...input,enabledModels:['duplicate','duplicate']}));
});
test('legacy connections migrate only distinct conversation models and preserve original bytes until saved',t=>{
 const f=fixture(t);f.service.createConversation({connectionId:f.connection.id,model:'used:a'});f.service.createConversation({connectionId:f.connection.id,model:'used:a'});f.service.createConversation();
 const legacy=JSON.parse(fs.readFileSync(f.file,'utf8'));delete legacy.state.defaultModel;for(const c of legacy.state.connections){delete c.enabledModels;delete c.favoriteModels}
 const original=JSON.stringify(legacy);fs.writeFileSync(f.file,original);
 const restored=new ChatService({directory:f.directory});assert.deepEqual(restored.snapshot().connections[0].enabledModels,['used:a']);assert.deepEqual(restored.snapshot().connections[0].favoriteModels,[]);assert.equal(restored.snapshot().defaultModel,null);assert.equal(fs.readFileSync(f.file,'utf8'),original);
 restored.saveModelPreferences({connectionId:f.connection.id,enabledModels:[]});assert.deepEqual(new ChatService({directory:f.directory}).snapshot().connections[0].enabledModels,[]);
});
test('hiding a model prunes favorite and default without changing conversation model or history',t=>{
 const f=fixture(t),chat=f.service.createConversation({connectionId:f.connection.id,model:'used:a'});const before=f.service.conversation(chat.id);
 f.service.saveModelPreferences({connectionId:f.connection.id,enabledModels:['used:a','other'],favoriteModels:['used:a'],defaultModel:'used:a'});
 const result=f.service.saveModelPreferences({connectionId:f.connection.id,enabledModels:['other']});
 assert.deepEqual(result.connections[0].favoriteModels,[]);assert.equal(result.defaultModel,null);assert.deepEqual(f.service.conversation(chat.id),before);
 f.service.saveModelPreferences({connectionId:f.connection.id,favoriteModels:['other']});assert.deepEqual(f.service.snapshot().connections[0].enabledModels,['other']);
});
test('default moves between connections and deletion preserves the conversation model',async t=>{
 const f=fixture(t),other=f.service.saveConnection({name:'Other',provider:'ollama',baseUrl:'http://localhost:11435'}),chat=f.service.createConversation({connectionId:other.id,model:'other'});
 f.service.saveModelPreferences({connectionId:f.connection.id,enabledModels:['one'],defaultModel:'one'});
 f.service.saveModelPreferences({connectionId:other.id,enabledModels:['other'],defaultModel:'other'});
 f.service.saveModelPreferences({connectionId:f.connection.id,enabledModels:[]});assert.deepEqual(f.service.snapshot().defaultModel,{connectionId:other.id,model:'other'});
 await f.service.deleteConnection(other.id);assert.equal(f.service.snapshot().defaultModel,null);assert.equal(f.service.conversation(chat.id).model,'other');assert.equal(f.service.conversation(chat.id).connectionId,null);
});
test('invalid model preferences reject atomically while bounded Unicode and maximum list sizes persist',t=>{
 const f=fixture(t);f.service.saveModelPreferences({connectionId:f.connection.id,enabledModels:['one'],favoriteModels:['one'],defaultModel:'one'});
 const before=f.service.snapshot(),original=fs.readFileSync(f.file,'utf8');
 for(const patch of [{enabledModels:['']},{enabledModels:[' ']},{enabledModels:['a','a']},{enabledModels:['a\0b']},{enabledModels:['🙂'.repeat(129)]},{enabledModels:[1]},{enabledModels:null},{enabledModels:Array.from({length:1001},(_,i)=>String(i))},{favoriteModels:['missing']},{favoriteModels:['one','one']},{defaultModel:'missing'},{defaultModel:1},{connectionId:'missing'}]){
  assert.throws(()=>f.service.saveModelPreferences({connectionId:f.connection.id,...patch}));assert.deepEqual(f.service.snapshot(),before);assert.equal(fs.readFileSync(f.file,'utf8'),original);
 }
 const models=['🙂'.repeat(128),...Array.from({length:999},(_,i)=>String(i))];f.service.saveModelPreferences({connectionId:f.connection.id,enabledModels:models,defaultModel:null});assert.deepEqual(new ChatStore(f.directory).load().connections[0].enabledModels,models);
});
test('failed preference write leaves memory, persisted preferences and credentials unchanged',async t=>{
 const f=fixture(t),cloud=await f.service.saveConnection({name:'Cloud',provider:'openai',baseUrl:'',apiKey:'test-key'});
 f.service.saveModelPreferences({connectionId:cloud.id,enabledModels:['one'],favoriteModels:['one'],defaultModel:'one'});
 const before=f.service.snapshot(),original=fs.readFileSync(f.file,'utf8'),keys=[...f.keys];f.service.store.save=()=>{throw Error('Disk unavailable')};
 assert.throws(()=>f.service.saveModelPreferences({connectionId:cloud.id,enabledModels:[]}),/Disk/);assert.deepEqual(f.service.snapshot(),before);assert.equal(fs.readFileSync(f.file,'utf8'),original);assert.deepEqual([...f.keys],keys);
});
test('credential edits preserve preferences saved while the replacement key is pending',async t=>{
 const f=fixture(t),cloud=await f.service.saveConnection({name:'Cloud',provider:'openai',baseUrl:'',apiKey:'test-key'});
 f.service.saveModelPreferences({connectionId:cloud.id,enabledModels:['one']});
 const set=f.credentials.set;let release;f.credentials.set=(id,key)=>new Promise(resolve=>{release=()=>set(id,key).then(resolve)});
 const saving=f.service.saveConnection({id:cloud.id,provider:cloud.provider,baseUrl:cloud.baseUrl,name:'Renamed',apiKey:'replacement'});
 f.service.saveModelPreferences({connectionId:cloud.id,favoriteModels:['one'],defaultModel:'one'});release();const updated=await saving;
 assert.deepEqual(updated.enabledModels,['one']);assert.deepEqual(updated.favoriteModels,['one']);assert.deepEqual(f.service.snapshot().defaultModel,{connectionId:cloud.id,model:'one'});assert.deepEqual([...f.keys.values()],['replacement']);
});
test('invalid persisted preference relationships remain unreadable and original bytes are preserved',t=>{
 const f=fixture(t);f.service.saveModelPreferences({connectionId:f.connection.id,enabledModels:['one']});
 const good=JSON.parse(fs.readFileSync(f.file,'utf8'));
 for(const mutate of [s=>s.connections[0].favoriteModels=['missing'],s=>s.defaultModel={connectionId:f.connection.id,model:'missing'},s=>s.defaultModel={connectionId:'missing',model:'one'}]){
  const broken=structuredClone(good);mutate(broken.state);const original=JSON.stringify(broken);fs.writeFileSync(f.file,original);assert.throws(()=>new ChatStore(f.directory).load(),/preserved/);assert.throws(()=>f.service.saveModelPreferences({connectionId:f.connection.id,enabledModels:[]}));assert.equal(fs.readFileSync(f.file,'utf8'),original);
 }
});
test('custom model labels persist per connection without changing identity or sent model IDs',async t=>{
 const f=fixture(t),model='my/model:Q6_K';
 f.service.saveModelPreferences({connectionId:f.connection.id,enabledModels:[model],favoriteModels:[model],defaultModel:model});
 const chat=f.service.createConversation({connectionId:f.connection.id,model});
 const result=f.service.saveModelPreferences({connectionId:f.connection.id,modelLabel:{model,label:'  My coding model  '}});
 assert.equal(result.connections[0].modelLabels[model],'My coding model');
 assert.equal(result.conversations[0].model,model);assert.deepEqual(result.defaultModel,{connectionId:f.connection.id,model});assert.deepEqual(result.connections[0].favoriteModels,[model]);
 assert.equal(new ChatService({directory:f.directory}).snapshot().connections[0].modelLabels[model],'My coding model');
 const other=f.service.saveConnection({name:'Other',provider:'vllm',baseUrl:'http://localhost:8000/v1'});
 assert.equal(other.modelLabels[model],undefined);
 const edited=f.service.saveConnection({id:f.connection.id,name:'Renamed server',provider:'ollama',baseUrl:f.connection.baseUrl});assert.equal(edited.modelLabels[model],'My coding model');
 let sent;f.service.connections.override={streamChat:async({model,onDelta})=>{sent=model;onDelta({content:'hello'})}};
 await f.service.sendMessage({conversationId:chat.id,text:'hello',noteIds:[]});await new Promise(resolve=>setImmediate(resolve));assert.equal(sent,model);
 f.service.saveModelPreferences({connectionId:f.connection.id,enabledModels:[]});assert.equal(f.service.snapshot().connections[0].modelLabels[model],'My coding model');
 f.service.saveModelPreferences({connectionId:f.connection.id,modelLabel:{model,label:null}});assert.equal(new ChatService({directory:f.directory}).snapshot().connections[0].modelLabels[model],undefined);
});
test('model labels reject invalid values atomically and safely support unusual model IDs',async t=>{
 const f=fixture(t);const before=fs.readFileSync(f.file,'utf8');
 for(const modelLabel of [null,[],{model:'',label:'hi'},{model:'a',label:''},{model:'a',label:'  '},{model:'a',label:'x'.repeat(81)},{model:'a',label:'two\nlines'},{model:'a',label:4}]){assert.throws(()=>f.service.saveModelPreferences({connectionId:f.connection.id,modelLabel}));assert.equal(fs.readFileSync(f.file,'utf8'),before)}
 f.service.saveModelPreferences({connectionId:f.connection.id,modelLabel:{model:'__proto__',label:'Custom model'}});
 assert.equal(new ChatService({directory:f.directory}).snapshot().connections[0].modelLabels['__proto__'],'Custom model');assert.equal({}.polluted,undefined);
 const cloud=await f.service.saveConnection({name:'Cloud',provider:'anthropic',apiKey:'test-key'});
 assert.throws(()=>f.service.saveModelPreferences({connectionId:cloud.id,modelLabel:{model:'claude',label:'Alias'}}),/Ollama|vLLM/);
 const snapshot=f.service.snapshot();f.service.store.save=()=>{throw Error('Disk unavailable')};assert.throws(()=>f.service.saveModelPreferences({connectionId:f.connection.id,modelLabel:{model:'a',label:'New label'}}),/Disk/);assert.deepEqual(f.service.snapshot(),snapshot);
});
test('corrupt stored labels are rejected without replacing the original file',t=>{
 const f=fixture(t),good=JSON.parse(fs.readFileSync(f.file,'utf8'));
 for(const labels of [null,[],{model:3},{model:''},{model:'a\nb'}]){const value=structuredClone(good);value.state.connections[0].modelLabels=labels;const original=JSON.stringify(value);fs.writeFileSync(f.file,original);assert.throws(()=>new ChatStore(f.directory).load(),/preserved/);assert.equal(fs.readFileSync(f.file,'utf8'),original)}
});
