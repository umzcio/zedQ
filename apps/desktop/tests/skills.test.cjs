const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {ChatService}=require('../electron/chat-service.cjs');
const {validSkill,validSkills,validSkillIds,publicSkill}=require('../electron/skill-schema.cjs');
function setup(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'zq-skills-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));return new ChatService({directory})}
function reference(id='file',body='Exact reference\n  spacing'){return{id,name:'guide.md',kind:'text',mime:'text/plain',size:Buffer.byteLength(body),text:body,preview:''}}
function skill(patch={}){return{id:'skill',name:'Writer',description:'',instructions:'Use short sentences.',files:[],createdAt:1,updatedAt:1,...patch}}

test('skill schema bounds UTF-8, files, selections and sent snapshots',()=>{
 assert.equal(validSkill(skill()),true);assert.equal(validSkill(skill({instructions:''})),true);
 for(const patch of [{name:' '},{name:'é'.repeat(129)},{description:'a'.repeat(4097)},{instructions:'a'.repeat(1000001)},{files:[reference('f','x'.repeat(100001))]},{files:[{...reference(),kind:'image'}]},{files:[reference(),reference()]},{instructions:'\ud800'},{createdAt:-1}])assert.equal(Boolean(validSkill(skill(patch))),false);
 assert.equal(validSkillIds(undefined),true);assert.equal(validSkillIds(null),false);assert.equal(validSkillIds(null,{nullable:true}),true);assert.equal(validSkillIds([]),true);assert.equal(validSkillIds(['a','a']),false);assert.equal(validSkillIds(Array.from({length:11},(_,i)=>String(i))),false);
 assert.equal(validSkills(Array.from({length:10},(_,i)=>skill({id:String(i)})),{max:10}),true);assert.equal(validSkills(Array.from({length:11},(_,i)=>skill({id:String(i)})),{max:10}),false);
 assert.equal(validSkills([skill(),skill()]),false);
 assert.deepEqual(publicSkill(skill({files:[reference()]})).files,[{id:'file',name:'guide.md',kind:'text',mime:'text/plain',size:25,preview:''}]);
});

test('save merges partial edits and persists extracted references across restart',t=>{
 const service=setup(t),created=service.saveSkill({name:'  Writer  ',instructions:'Keep formatting.  \n',description:'For drafts'});
 assert.equal(created.name,'Writer');service.attachments.items.set('file',reference());service.addSkillFiles({id:created.id,attachmentIds:['file']});
 const edited=service.saveSkill({id:created.id,name:'Editor'});assert.equal(edited.instructions,'Keep formatting.  \n');assert.equal(edited.description,'For drafts');assert.equal(edited.files[0].text,undefined);
 const reloaded=new ChatService({directory:service.store.directory});assert.equal(reloaded.state.skills[0].files[0].text,'Exact reference\n  spacing');assert.equal(service.attachments.items.has('file'),false);
});

test('invalid saves and library overflow leave the library unchanged',t=>{
 const service=setup(t);for(const value of [{},{name:''},{name:'Bad',instructions:null},{id:'missing',name:'No'},{name:'x',instructions:'é'.repeat(500001)}])assert.throws(()=>service.saveSkill(value));
 for(let i=0;i<100;i++)service.saveSkill({name:'Skill '+i});const before=structuredClone(service.state);assert.throws(()=>service.saveSkill({name:'Overflow'}));assert.throws(()=>service.duplicateSkill(service.state.skills[0].id));assert.deepEqual(service.state,before);
});

test('duplicate owns fresh file identities and export contains standard exact source',async t=>{
 const service=setup(t),created=service.saveSkill({name:'é'.repeat(128),description:'Description',instructions:'  Exact instructions\n'});service.attachments.items.set('file',reference());service.addSkillFiles({id:created.id,attachmentIds:['file']});
 const copy=service.duplicateSkill(created.id);assert.notEqual(copy.id,created.id);assert.notEqual(copy.files[0].id,'file');assert.ok(copy.name.endsWith(' copy'));assert.ok(Buffer.byteLength(copy.name)<=256);
 const exported=await service.exportSkillPackage(created.id);assert.match(exported.name,/\.zip$/);const parsed=await require('../electron/skill-package.cjs').parseSkillPackage({name:exported.name,bytes:exported.bytes});assert.equal(parsed.instructions,'  Exact instructions\n');assert.equal(parsed.files[0].text,'Exact reference\n  spacing');
 service.removeSkillFile({id:created.id,attachmentId:'file'});assert.equal(service.state.skills.find(s=>s.id===copy.id).files.length,1);assert.throws(()=>service.removeSkillFile({id:created.id,attachmentId:'missing'}));
});

test('reference limits reject atomically and preserve staged attachments on failure',t=>{
 const service=setup(t),created=service.saveSkill({name:'Skill',instructions:'x'.repeat(16000)});service.attachments.items.set('large',reference('large','x'.repeat(100001)));const before=structuredClone(service.state);
 assert.throws(()=>service.addSkillFiles({id:created.id,attachmentIds:['large']}));assert.deepEqual(service.state,before);assert.equal(service.attachments.items.has('large'),true);
 service.attachments.items.set('image',{...reference('image'),kind:'image',mime:'image/jpeg',image:'AAAA'});assert.throws(()=>service.addSkillFiles({id:created.id,attachmentIds:['image']}));
 const files=Array.from({length:10},(_,i)=>reference(String(i),'body'));for(const file of files)service.attachments.items.set(file.id,file);service.addSkillFiles({id:created.id,attachmentIds:files.map(f=>f.id)});service.attachments.items.set('eleven',reference('eleven','body'));assert.throws(()=>service.addSkillFiles({id:created.id,attachmentIds:['eleven']}));assert.equal(service.state.skills[0].files.length,10);
});

test('deletion cleans future selections while preserving sent and branch snapshots',t=>{
 const service=setup(t),created=service.saveSkill({name:'Skill',instructions:'Original'}),other=service.saveSkill({name:'Other'}),project=service.saveProject({name:'Project'}),chat=service.createConversation({projectId:project.id});
 const message={id:'m',role:'user',content:'Hello',thinking:'',status:'complete',createdAt:1,error:'',context:[],skillContext:[structuredClone(service.state.skills[0])]};
 service.change(s=>{s.projects[0].skillIds=[created.id,other.id];s.conversations[0].skillIds=[created.id];s.conversations[0].messages=[message];s.conversations[0].branches=[{id:'m',anchorId:'m',messages:[structuredClone(message)]}];s.drafts={one:{text:'',noteIds:[],attachments:[],skillIds:[created.id]},two:{text:'',noteIds:[],attachments:[],skillIds:null}}});
 assert.equal(service.deleteSkill(created.id),null);assert.deepEqual(service.state.projects[0].skillIds,[other.id]);assert.deepEqual(service.state.conversations[0].skillIds,[]);assert.deepEqual(service.state.drafts.one.skillIds,[]);assert.equal(service.state.drafts.two.skillIds,null);assert.equal(service.state.conversations[0].messages[0].skillContext[0].instructions,'Original');assert.equal(service.state.conversations[0].branches[0].messages[0].skillContext[0].instructions,'Original');assert.throws(()=>service.exportSkillPackage(created.id));
});

test('failed persistence leaves library and staged attachments untouched',t=>{
 const service=setup(t),created=service.saveSkill({name:'Skill'});service.attachments.items.set('file',reference());const before=structuredClone(service.state),saved=fs.readFileSync(service.store.path,'utf8');service.store.save=()=>{throw Error('Disk full')};
 assert.throws(()=>service.saveSkill({id:created.id,instructions:'Changed'}),/Disk full/);assert.throws(()=>service.addSkillFiles({id:created.id,attachmentIds:['file']}),/Disk full/);assert.throws(()=>service.deleteSkill(created.id),/Disk full/);assert.deepEqual(service.state,before);assert.equal(service.attachments.items.has('file'),true);assert.equal(fs.readFileSync(service.store.path,'utf8'),saved);
});
