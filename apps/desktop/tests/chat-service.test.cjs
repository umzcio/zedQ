const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {ChatStore}=require('../electron/chat-store.cjs');
const {ChatService}=require('../electron/chat-service.cjs');
function fixture(t,streamChat=async({onDelta})=>onDelta({content:'Hello',thinking:''})){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zq-chat-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const notes=[{id:'n1',title:'Reference',body:'Selected content'},{id:'n2',title:'Private',body:'Do not send'}];
 const provider={listModels:async()=>['model:small'],streamChat};
 const service=new ChatService({directory:dir,provider,getNotes:()=>notes});t.after(()=>service.shutdown());
 const connection=service.saveConnection({name:'Test',baseUrl:'http://example.test:11434',provider:'ollama'});
 const chat=service.createConversation({connectionId:connection.id,model:'model:small'});
 return{dir,notes,provider,service,connection,chat};
}
const eventually=async(fn)=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,5))}assert.fail('condition not met')};
test('chat saves full history and only explicitly selected reference snapshots',async t=>{
 let request;const f=fixture(t,async args=>{request=args;args.onDelta({content:'Saved answer',thinking:''})});
 f.service.send({conversationId:f.chat.id,text:'Question',noteIds:['n1']});
 await eventually(()=>f.service.snapshot().conversations[0].messages.at(-1).status==='complete');
 assert.match(JSON.stringify(request.messages),/Selected content/);assert.doesNotMatch(JSON.stringify(request.messages),/Do not send/);
 f.notes[0].body='Edited later';
 const saved=new ChatStore(f.dir).load();assert.equal(saved.conversations[0].messages[0].context[0].body,'Selected content');assert.equal(saved.conversations[0].messages.at(-1).content,'Saved answer');
 assert.equal(fs.statSync(path.join(f.dir,'chat.json')).mode&0o777,0o600);
});
test('stop preserves partial text and rejects duplicate sends during generation',async t=>{
 const f=fixture(t,({onDelta,signal})=>new Promise((resolve,reject)=>{onDelta({content:'Partial',thinking:''});signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true})}));
 f.service.send({conversationId:f.chat.id,text:'First',noteIds:[]});
 await eventually(()=>f.service.snapshot().conversations[0].messages.at(-1).content==='Partial');
 assert.throws(()=>f.service.send({conversationId:f.chat.id,text:'Duplicate',noteIds:[]}),/already/);
 f.service.stop(f.chat.id);
 const last=new ChatStore(f.dir).load().conversations[0].messages.at(-1);assert.equal(last.status,'stopped');assert.equal(last.content,'Partial');
});
test('failed provider request preserves submitted message with recoverable error',async t=>{
 const f=fixture(t,async()=>{throw new Error('Offline')});f.service.send({conversationId:f.chat.id,text:'Keep this question',noteIds:[]});
 await eventually(()=>f.service.snapshot().conversations[0].messages.at(-1).status==='error');
 assert.equal(new ChatStore(f.dir).load().conversations[0].messages[0].content,'Keep this question');
});
test('restart marks unfinished replies interrupted rather than leaving Stop forever',t=>{
 const f=fixture(t);const state=new ChatStore(f.dir).load();state.conversations[0].messages.push({id:'m',role:'assistant',content:'Recovered',thinking:'',status:'streaming',createdAt:1,context:[],error:''});new ChatStore(f.dir).save(state);
 const restored=new ChatService({directory:f.dir,provider:f.provider,getNotes:()=>[]});t.after(()=>restored.shutdown());assert.equal(restored.snapshot().conversations[0].messages[0].status,'interrupted');
});
test('unknown notes and excessive context reject before appending or sending',t=>{
 const f=fixture(t);assert.throws(()=>f.service.send({conversationId:f.chat.id,text:'Question',noteIds:['missing']}),/note/i);
 f.notes[0].body='x'.repeat(100001);assert.throws(()=>f.service.send({conversationId:f.chat.id,text:'Question',noteIds:['n1']}),/context/i);assert.equal(f.service.snapshot().conversations[0].messages.length,0);
});
test('corrupt chat store is preserved and blocks mutations',t=>{
 const f=fixture(t);const file=path.join(f.dir,'chat.json');fs.writeFileSync(file,'{corrupt');
 assert.throws(()=>new ChatStore(f.dir).load(),/read safely|schema/);assert.throws(()=>f.service.createConversation({connectionId:f.connection.id,model:'model:small'}));assert.equal(fs.readFileSync(file,'utf8'),'{corrupt');
 // Restore valid bytes so fixture shutdown can preserve its in-memory state.
 fs.unlinkSync(file);
});
test('stopping immediately prevents a queued provider from starting',async t=>{
 let called=false;const f=fixture(t,async()=>{called=true});
 f.service.send({conversationId:f.chat.id,text:'Immediate stop'});f.service.stop(f.chat.id);
 await new Promise(r=>setImmediate(r));assert.equal(called,false);
});
test('oversized deltas cannot poison persisted history',async t=>{
 const f=fixture(t,async({onDelta})=>{onDelta({content:'Valid partial'});onDelta({content:'x'.repeat(2*1024*1024)})});
 f.service.send({conversationId:f.chat.id,text:'Bound this'});
 await eventually(()=>f.service.snapshot().conversations[0].messages.at(-1).status==='error');
 const m=new ChatStore(f.dir).load().conversations[0].messages.at(-1);assert.equal(m.content,'Valid partial');assert.equal(m.status,'error');
});
test('automatic titles preserve unicode at the truncation boundary',async t=>{
 const f=fixture(t);f.service.send({conversationId:f.chat.id,text:'a'.repeat(79)+'🙂 hello'});
 await eventually(()=>f.service.snapshot().conversations[0].messages.at(-1).status==='complete');
 assert.equal(new ChatStore(f.dir).load().conversations[0].title,'a'.repeat(79)+'🙂');
});
test('invalid provider text preserves valid partial output and keeps storage writable',async t=>{
 const f=fixture(t,async({onDelta})=>{onDelta({content:'Valid'});onDelta({content:'\0bad'})});
 f.service.send({conversationId:f.chat.id,text:'Question'});
 await eventually(()=>f.service.snapshot().conversations[0].messages.at(-1).status==='error');
 const m=new ChatStore(f.dir).load().conversations[0].messages.at(-1);assert.equal(m.content,'Valid');f.service.createConversation();
});
test('stream growth at storage capacity saves a partial failure and allows shutdown',async t=>{
 const f=fixture(t,async({onDelta})=>{onDelta({content:'Partial'});onDelta({content:'x'.repeat(70000)})});
 const state=structuredClone(f.service.state);
 const template={role:'assistant',content:'x'.repeat(2*1024*1024),thinking:'',status:'complete',createdAt:1,context:[],error:''};
 const archived={...state.conversations[0],id:'archive',messages:Array.from({length:15},(_,i)=>({...template,id:`a${i}`}))};state.conversations.push(archived);
 const target=32*1024*1024-60000;const current=Buffer.byteLength(JSON.stringify({version:1,state}));archived.messages.push({...template,id:'tail',content:'x'.repeat(target-current-200)});
 new ChatStore(f.dir).save(state);
 const service=new ChatService({directory:f.dir,provider:f.provider});
 service.send({conversationId:f.chat.id,text:'Capacity check'});
 await eventually(()=>service.snapshot().conversations[0].messages.at(-1).status==='error');
 assert.equal(service.snapshot().conversations[0].messages.at(-1).content,'Partial');assert.doesNotThrow(()=>service.shutdown());
 // Keep fixture's final cleanup from replacing the checked saved state.
 f.service.state=new ChatStore(f.dir).load();
});
test('file snapshots reach the model and remain previewable after restart',async t=>{
 let request;const f=fixture(t,async args=>{request=args;args.onDelta({content:'Read it'})});
 const imported=await f.service.attachments.importFiles([{name:'brief.txt',bytes:Buffer.from('File codeword: BLUEBIRD')}]);const id=imported.items[0].id;
 await f.service.sendMessage({conversationId:f.chat.id,text:'Summarize',attachmentIds:[id]});await eventually(()=>f.service.snapshot().conversations[0].messages.at(-1).status==='complete');
 assert.match(request.messages.at(-1).content,/BLUEBIRD/);assert.equal(f.service.snapshot().conversations[0].messages[0].attachments[0].text,undefined);assert.throws(()=>f.service.attachments.resolve([id]),/no longer/);
 const restored=new ChatService({directory:f.dir,provider:f.provider});t.after(()=>restored.shutdown());const history=restored.state.conversations.flatMap(c=>c.messages.flatMap(m=>m.attachments??[]));assert.equal(restored.attachments.preview(id,history).text,'File codeword: BLUEBIRD');
});
test('images use the vision field and require model support before saving messages',async t=>{
 let request;const f=fixture(t,async args=>{request=args;args.onDelta({content:'Image read'})});
 const a={id:'image1',name:'test.jpg',kind:'image',size:3,mime:'image/jpeg',preview:'data:image/jpeg;base64,YWJj',image:'YWJj',width:1,height:1};f.service.attachments.items.set(a.id,a);
 f.provider.supportsImages=async()=>false;await assert.rejects(f.service.sendMessage({conversationId:f.chat.id,text:'Look',attachmentIds:[a.id]}),/vision/);assert.equal(f.service.conversation(f.chat.id).messages.length,0);
 f.provider.supportsImages=async()=>true;await f.service.sendMessage({conversationId:f.chat.id,text:'',attachmentIds:[a.id]});await eventually(()=>f.service.snapshot().conversations[0].messages.at(-1).status==='complete');assert.deepEqual(request.messages.at(-1).images,['YWJj']);assert.doesNotMatch(request.messages.at(-1).content,/YWJj/);assert.equal(f.service.snapshot().conversations[0].messages[0].attachments[0].image,undefined);assert.equal(new ChatStore(f.dir).load().conversations[0].messages[0].attachments[0].image,'YWJj');
 await f.service.sendMessage({conversationId:f.chat.id,text:'And now?'});await eventually(()=>f.service.snapshot().conversations[0].messages.at(-1).status==='complete');assert.deepEqual(request.messages.find(m=>m.images).images,['YWJj']);
});
test('closing during image capability lookup cancels the pending send',async t=>{
 const f=fixture(t);let resolve,entered;const checking=new Promise(r=>{entered=r});f.provider.supportsImages=()=>new Promise(r=>{resolve=r;entered()});f.service.attachments.items.set('image1',{id:'image1',kind:'image'});
 const send=f.service.sendMessage({conversationId:f.chat.id,text:'Look',attachmentIds:['image1']});await checking;f.service.shutdown();resolve(true);await assert.rejects(send,/cancelled/);assert.equal(f.service.conversation(f.chat.id).messages.length,0);
});

test('renamed chats survive restart and keep their name when the first message is sent',async t=>{
 const f=fixture(t);
 f.service.renameConversation({id:f.chat.id,title:'  Project ideas  '});
 const restored=new ChatService({directory:f.dir,provider:f.provider});t.after(()=>restored.shutdown());
 assert.equal(restored.snapshot().conversations[0].title,'Project ideas');
 restored.send({conversationId:f.chat.id,text:'A different automatic title'});
 await eventually(()=>restored.snapshot().conversations[0].messages.at(-1).status==='complete');
 assert.equal(new ChatStore(f.dir).load().conversations[0].title,'Project ideas');
});
test('invalid chat names and missing targets leave saved conversations unchanged',t=>{
 const f=fixture(t),before=new ChatStore(f.dir).load();
 for(const title of ['', '  ', 'x'.repeat(1025), '\0', 42])assert.throws(()=>f.service.renameConversation({id:f.chat.id,title}),/name/i);
 assert.throws(()=>f.service.renameConversation({id:'missing',title:'Name'}),/not found/i);
 assert.throws(()=>f.service.deleteConversation('missing'),/not found/i);
 assert.deepEqual(new ChatStore(f.dir).load(),before);
});
test('deleting a chat removes its history durably and preserves other conversations',async t=>{
 const f=fixture(t);
 f.service.send({conversationId:f.chat.id,text:'Remove this history'});
 await eventually(()=>f.service.snapshot().conversations[0].messages.at(-1).status==='complete');
 const keep=f.service.createConversation();
 f.service.deleteConversation(f.chat.id);
 assert.deepEqual(f.service.snapshot().conversations.map(c=>c.id),[keep.id]);
 assert.deepEqual(new ChatStore(f.dir).load().conversations.map(c=>c.id),[keep.id]);
 f.service.deleteConversation(keep.id);
 assert.deepEqual(new ChatStore(f.dir).load().conversations,[]);
});
test('a running chat cannot be deleted until stopped; renaming preserves its response',async t=>{
 const f=fixture(t,({onDelta,signal})=>new Promise(resolve=>{onDelta({content:'Partial'});signal.addEventListener('abort',resolve,{once:true})}));
 f.service.send({conversationId:f.chat.id,text:'Running'});
 await eventually(()=>f.service.snapshot().conversations[0].messages.at(-1).content==='Partial');
 f.service.renameConversation({id:f.chat.id,title:'Working'});
 assert.throws(()=>f.service.deleteConversation(f.chat.id),/stop/i);
 assert.equal(f.service.snapshot().conversations[0].messages.at(-1).content,'Partial');
 f.service.stop(f.chat.id);f.service.deleteConversation(f.chat.id);
 await new Promise(r=>setImmediate(r));
 assert.deepEqual(new ChatStore(f.dir).load().conversations,[]);
});
test('failed deletion does not remove the in-memory conversation',t=>{
 const f=fixture(t);const file=path.join(f.dir,'chat.json');fs.writeFileSync(file,'{corrupt');
 assert.throws(()=>f.service.deleteConversation(f.chat.id),/read safely/i);
 assert.equal(f.service.snapshot().conversations[0].id,f.chat.id);
 fs.unlinkSync(file);
});

test('chat projects persist with new chats and moved conversations',t=>{
 const f=fixture(t);
 const project=f.service.saveProject({name:'  Research  '});
 const grouped=f.service.createConversation({projectId:project.id});
 f.service.moveConversation({id:f.chat.id,projectId:project.id});
 f.service.saveProject({id:project.id,name:'Reading'});
 const saved=new ChatStore(f.dir).load();
 assert.deepEqual(saved.projects.map(p=>p.name),['Reading']);
 assert.equal(saved.conversations.find(c=>c.id===grouped.id).projectId,project.id);
 assert.equal(saved.conversations.find(c=>c.id===f.chat.id).projectId,project.id);
 f.service.moveConversation({id:f.chat.id,projectId:null});
 assert.equal(new ChatStore(f.dir).load().conversations.find(c=>c.id===f.chat.id).projectId,null);
});
test('removing a project preserves its chats and their messages',async t=>{
 const f=fixture(t),project=f.service.saveProject({name:'Temporary'});
 f.service.moveConversation({id:f.chat.id,projectId:project.id});
 f.service.send({conversationId:f.chat.id,text:'Keep this conversation'});
 await eventually(()=>f.service.snapshot().conversations[0].messages.at(-1).status==='complete');
 f.service.deleteProject(project.id);
 const saved=new ChatStore(f.dir).load();
 assert.deepEqual(saved.projects,[]);assert.equal(saved.conversations[0].projectId,null);
 assert.equal(saved.conversations[0].messages[0].content,'Keep this conversation');
});
test('invalid projects and missing move targets do not mutate saved chats',t=>{
 const f=fixture(t),before=new ChatStore(f.dir).load();
 for(const name of ['', ' ', 'x'.repeat(257), '\0', 42])assert.throws(()=>f.service.saveProject({name}),/name/i);
 assert.throws(()=>f.service.createConversation({projectId:'missing'}),/project/i);
 assert.throws(()=>f.service.moveConversation({id:f.chat.id,projectId:'missing'}),/project/i);
 assert.throws(()=>f.service.saveProject({id:'missing',name:'Valid'}),/project/i);
 assert.throws(()=>f.service.deleteProject('missing'),/project/i);
 assert.deepEqual(new ChatStore(f.dir).load(),before);
});
test('older chat stores gain empty projects without losing conversations',t=>{
 const f=fixture(t),store=new ChatStore(f.dir),old=store.load();delete old.projects;store.save(old);
 const restored=new ChatService({directory:f.dir,provider:f.provider});
 assert.deepEqual(restored.snapshot().projects,[]);
 assert.equal(restored.snapshot().conversations[0].id,f.chat.id);
 restored.shutdown();
 assert.deepEqual(new ChatStore(f.dir).load().projects,[]);
});

test('project instructions and files reach only member chats and survive restart',async t=>{
 const requests=[];const f=fixture(t,async args=>{requests.push(args.messages);args.onDelta({content:'Done'})});
 const p=f.service.saveProject({name:'Research',instructions:'Always answer in concise bullet points.'});
 const upload=await f.service.attachments.importFiles([{name:'reference.txt',bytes:Buffer.from('Project codeword: ORCHID')}]);
 f.service.addProjectFiles({id:p.id,attachmentIds:upload.items.map(a=>a.id)});
 f.service.moveConversation({id:f.chat.id,projectId:p.id});
 await f.service.sendMessage({conversationId:f.chat.id,text:'Use the project'});
 await eventually(()=>f.service.conversation(f.chat.id).messages.at(-1).status==='complete');
 assert.match(requests[0][0].content,/concise bullet points/);assert.match(JSON.stringify(requests[0]),/ORCHID/);
 const snapshot=f.service.snapshot();assert.equal(snapshot.projects[0].files[0].text,undefined);
 assert.equal(snapshot.conversations[0].messages[0].projectContext.files[0].text,undefined);
 const restored=new ChatService({directory:f.dir,provider:f.provider});
 assert.equal(restored.state.projects[0].files[0].text,'Project codeword: ORCHID');
 f.service.removeProjectFile({id:p.id,attachmentId:upload.items[0].id});
 f.service.moveConversation({id:f.chat.id,projectId:null});
 await f.service.sendMessage({conversationId:f.chat.id,text:'Now outside the project'});
 await eventually(()=>f.service.conversation(f.chat.id).messages.at(-1).status==='complete');
 assert.doesNotMatch(JSON.stringify(requests[1]),/ORCHID|concise bullet points/);
 assert.equal(new ChatStore(f.dir).load().conversations[0].messages[0].projectContext.files[0].text,'Project codeword: ORCHID');
});
test('project image files require a vision model before a message is saved',async t=>{
 const f=fixture(t),p=f.service.saveProject({name:'Images'});
 f.service.attachments.items.set('image-p',{id:'image-p',name:'test.jpg',kind:'image',size:3,mime:'image/jpeg',preview:'data:image/jpeg;base64,YWJj',image:'YWJj',width:1,height:1});
 f.service.addProjectFiles({id:p.id,attachmentIds:['image-p']});f.service.moveConversation({id:f.chat.id,projectId:p.id});
 f.provider.supportsImages=async()=>false;
 await assert.rejects(f.service.sendMessage({conversationId:f.chat.id,text:'Look'}),/vision/i);
 assert.equal(f.service.conversation(f.chat.id).messages.length,0);
});
test('project file and instruction limits reject atomically',async t=>{
 const f=fixture(t),p=f.service.saveProject({name:'Limits'});
 const imported=await f.service.attachments.importFiles([{name:'large.txt',bytes:Buffer.from('x'.repeat(60000))},{name:'extra.txt',bytes:Buffer.from('y'.repeat(60000))}]);
 assert.throws(()=>f.service.addProjectFiles({id:p.id,attachmentIds:imported.items.map(a=>a.id)}),/100 KB/);
 assert.deepEqual(new ChatStore(f.dir).load().projects[0].files,[]);
 assert.throws(()=>f.service.saveProject({id:p.id,instructions:'x'.repeat(16001)}),/16 KB/);
 assert.equal(new ChatStore(f.dir).load().projects[0].instructions,'');
});

test('project icons and colors persist without replacing instructions or files',t=>{
 const f=fixture(t),p=f.service.saveProject({name:'Personal',instructions:'Keep this instruction'});
 f.service.saveProject({id:p.id,icon:'Rocket',color:'green'});
 let saved=new ChatStore(f.dir).load().projects[0];assert.equal(saved.icon,'Rocket');assert.equal(saved.color,'green');assert.equal(saved.instructions,'Keep this instruction');
 f.service.saveProject({id:p.id,name:'Renamed'});
 saved=new ChatStore(f.dir).load().projects[0];assert.equal(saved.icon,'Rocket');assert.equal(saved.color,'green');
 const restored=new ChatService({directory:f.dir,provider:f.provider});assert.equal(restored.snapshot().projects[0].icon,'Rocket');assert.equal(restored.snapshot().projects[0].color,'green');
});
test('invalid project appearance leaves saved data unchanged',t=>{
 const f=fixture(t),p=f.service.saveProject({name:'Appearance'}),before=new ChatStore(f.dir).load();
 for(const patch of [{icon:'MissingIcon'},{icon:42},{color:'url(evil)'},{color:42}])assert.throws(()=>f.service.saveProject({id:p.id,...patch}),/icon|color/i);
 assert.deepEqual(new ChatStore(f.dir).load(),before);
});
