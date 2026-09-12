const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {ChatService}=require('../electron/chat-service.cjs');
const {ChatStore}=require('../electron/chat-store.cjs');
function fixture(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'zq-connections-'));const keys=new Map();
 const credentials={get:async id=>keys.get(id)??null,set:async(id,key)=>{keys.set(id,key)},delete:async id=>{keys.delete(id)}};
 const requests=[];const providerFactory=(provider,{apiKey})=>({listModels:async baseUrl=>{requests.push({provider,apiKey,baseUrl});return ['test-model']},supportsImages:async()=>true,streamChat:async args=>{requests.push({provider,apiKey,...args});args.onDelta({content:'Reply'})}});
 const service=new ChatService({directory,credentials,providerFactory});
 t.after(()=>{service.shutdown();fs.rmSync(directory,{recursive:true,force:true})});return{directory,keys,credentials,requests,service,providerFactory};
}
const draft={provider:'openai',name:'Personal API',baseUrl:'',apiKey:'test-secret-do-not-persist'};
for(const provider of ['perplexity','openrouter','groq','bedrock'])test(`${provider} requires a key, preserves curated models on disk, and keeps credentials native`,async t=>{
 const f=fixture(t);
 await assert.rejects(async()=>f.service.saveConnection({...draft,provider,apiKey:''}),/API key/);
 const saved=await f.service.saveConnection({...draft,provider,enabledModels:['chosen-model']});
 assert.equal(saved.hasApiKey,true);assert.deepEqual(saved.enabledModels,['chosen-model']);
 const restored=new ChatStore(f.directory).load();assert.equal(restored.connections[0].provider,provider);
 assert.deepEqual(restored.connections[0].enabledModels,['chosen-model']);
 assert.doesNotMatch(fs.readFileSync(path.join(f.directory,'chat.json'),'utf8'),/test-secret/);
 await f.service.models(saved.id);assert.equal(f.requests.at(-1).provider,provider);
});
test('Bedrock persists its chosen region and requires an explicit key when changing regions',async t=>{
 const f=fixture(t),baseUrl='https://bedrock-runtime.us-west-2.amazonaws.com';
 const c=await f.service.saveConnection({...draft,provider:'bedrock',baseUrl,enabledModels:['us.anthropic.claude-sonnet-4-6']});
 const restored=new ChatStore(f.directory).load();assert.equal(restored.connections[0].baseUrl,baseUrl);
 const next='https://bedrock-runtime.eu-west-1.amazonaws.com';
 await assert.rejects(async()=>f.service.saveConnection({...c,baseUrl:next}),/new API key/);
 await assert.rejects(async()=>f.service.testConnection({...c,baseUrl:next}),/new API key/);
 assert.equal(f.keys.size,1);assert.equal(f.service.snapshot().connections[0].baseUrl,baseUrl);
 const changed=await f.service.saveConnection({...c,baseUrl:next,apiKey:'replacement-for-region'});
 assert.equal(changed.baseUrl,next);assert.deepEqual(changed.enabledModels,c.enabledModels);assert.equal(f.keys.size,1);
});
test('connection credentials stay out of snapshots and chat storage and route only to their provider',async t=>{
 const f=fixture(t),saved=await f.service.saveConnection(draft);
 assert.equal(saved.provider,'openai');assert.equal(saved.hasApiKey,true);assert.equal(saved.baseUrl,'https://api.openai.com/v1');
 assert.equal(saved.apiKey,undefined);assert.equal(saved.credentialRef,undefined);
 assert.doesNotMatch(JSON.stringify(f.service.snapshot()),/test-secret|credentialRef|pendingCredentialDeletes/);
 assert.doesNotMatch(fs.readFileSync(path.join(f.directory,'chat.json'),'utf8'),/test-secret/);
 assert.deepEqual(await f.service.models(saved.id),['test-model']);assert.equal(f.requests[0].apiKey,draft.apiKey);
 const restored=new ChatService({directory:f.directory,credentials:f.credentials,providerFactory:f.providerFactory});
 await restored.models(saved.id);assert.equal(f.requests.at(-1).apiKey,draft.apiKey);restored.shutdown();
});
test('editing a name preserves key; replacing a key retires the old item; deletion preserves chats',async t=>{
 const f=fixture(t),a=await f.service.saveConnection(draft);const first=[...f.keys.keys()][0];
 const b=await f.service.saveConnection({...a,name:'Work API',apiKey:''});assert.equal(b.hasApiKey,true);assert.equal(f.keys.get(first),draft.apiKey);
 await f.service.saveConnection({...b,apiKey:'replacement-secret'});assert.equal(f.keys.has(first),false);assert.deepEqual([...f.keys.values()],['replacement-secret']);
 const chat=f.service.createConversation({connectionId:a.id,model:'test-model'});
 await f.service.sendMessage({conversationId:chat.id,text:'Keep my chat'});
 await new Promise(r=>setImmediate(r));
 await f.service.deleteConnection(a.id);assert.equal(f.keys.size,0);
 const restored=new ChatStore(f.directory).load();assert.equal(restored.connections.length,0);assert.equal(restored.conversations[0].connectionId,null);assert.equal(restored.conversations[0].messages[0].content,'Keep my chat');
});
test('failed key write preserves prior connection and credential, never appends a broken connection',async t=>{
 const f=fixture(t),a=await f.service.saveConnection(draft);f.credentials.set=async()=>{throw Error('Keychain unavailable')};
 await assert.rejects(Promise.resolve().then(()=>f.service.saveConnection({...a,apiKey:'replacement'})),/Keychain/);
 assert.equal(f.service.snapshot().connections[0].name,a.name);await f.service.models(a.id);assert.equal(f.requests.at(-1).apiKey,draft.apiKey);
});
test('connection tests use unsaved keys without persisting and cannot reuse keys at a different endpoint',async t=>{
 const f=fixture(t);await f.service.testConnection(draft);assert.equal(f.keys.size,0);assert.equal(f.service.snapshot().connections.length,0);
 const a=await f.service.saveConnection({name:'Local',provider:'vllm',baseUrl:'http://local.test:8000',apiKey:'local-secret'});
 await assert.rejects(Promise.resolve().then(()=>f.service.testConnection({...a,baseUrl:'http://elsewhere.test:8000'})),/key|credential/i);
 assert.equal(f.requests.at(-1).provider,'openai');
});
test('pending credential edits block sending, deletion and closing until they finish',async t=>{
 const f=fixture(t),a=await f.service.saveConnection(draft);const chat=f.service.createConversation({connectionId:a.id,model:'test-model'});
 let release;f.credentials.set=()=>new Promise(r=>{release=r});const saving=f.service.saveConnection({...a,apiKey:'replacement'});
 await new Promise(r=>setImmediate(r));
 await assert.rejects(f.service.sendMessage({conversationId:chat.id,text:'Wait'}),/connection|saving/i);
 await assert.rejects(Promise.resolve().then(()=>f.service.deleteConnection(a.id)),/connection|saving/i);
 assert.throws(()=>f.service.shutdown(),/connection|saving/i);release();await saving;
});
test('missing saved key fails before creating messages',async t=>{
 const f=fixture(t),a=await f.service.saveConnection(draft);f.keys.clear();const chat=f.service.createConversation({connectionId:a.id,model:'test-model'});
 await assert.rejects(f.service.sendMessage({conversationId:chat.id,text:'Do not save an unsendable request'}),/key|credential/i);
 assert.equal(f.service.conversation(chat.id).messages.length,0);
});
test('retired key cleanup failures survive restart and can be retried',async t=>{
 const f=fixture(t),a=await f.service.saveConnection(draft),old=[...f.keys.keys()][0];const remove=f.credentials.delete;
 f.credentials.delete=async()=>{throw Error('Locked')};await f.service.saveConnection({...a,apiKey:'replacement'});
 assert.equal(f.keys.has(old),true);assert.ok(new ChatStore(f.directory).load().pendingCredentialDeletes.includes(old));
 f.credentials.delete=remove;await f.service.connections.cleanup();assert.equal(f.keys.has(old),false);assert.deepEqual(new ChatStore(f.directory).load().pendingCredentialDeletes,[]);
});
test('metadata save failure retains the working key and retires a newly written replacement',async t=>{
 const f=fixture(t),a=await f.service.saveConnection(draft);const save=f.service.store.save.bind(f.service.store);let writes=0;
 f.service.store.save=state=>{if(++writes===2)throw Error('Disk unavailable');return save(state)};
 await assert.rejects(f.service.saveConnection({...a,apiKey:'replacement'}),/Disk/);
 assert.deepEqual([...f.keys.values()],[draft.apiKey]);await f.service.models(a.id);assert.equal(f.requests.at(-1).apiKey,draft.apiKey);
});
test('changing a model during Keychain lookup cancels the pending send',async t=>{
 const f=fixture(t),a=await f.service.saveConnection(draft),chat=f.service.createConversation({connectionId:a.id,model:'test-model'});
 let release;const get=f.credentials.get;f.credentials.get=id=>new Promise(resolve=>{release=()=>get(id).then(resolve)});
 const sending=f.service.sendMessage({conversationId:chat.id,text:'Stale model'});
 f.service.configureConversation({id:chat.id,connectionId:a.id,model:'another-model'});release();
 await assert.rejects(sending,/changed/i);assert.equal(f.service.conversation(chat.id).messages.length,0);
});
test('cloud connection JSON cannot redirect saved credentials to a different origin',async t=>{
 const f=fixture(t);await f.service.saveConnection(draft);const state=structuredClone(f.service.state);state.connections[0].baseUrl='https://elsewhere.test/v1';
 assert.throws(()=>f.service.store.save(state),/Invalid/);
 state.connections[0].baseUrl='https://api.openai.com/v1';state.connections[0].apiKey='must-not-write';assert.throws(()=>f.service.store.save(state),/Invalid/);
});
