const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {ChatService}=require('../electron/chat-service.cjs');
const {parseSkillImport}=require('../electron/skill-import.cjs');
const parse=(name,body)=>parseSkillImport({name,bytes:Buffer.from(body)});
const portable=(patch={})=>({name:'Reviewer',description:'Review drafts',instructions:'Keep exact spacing.  \n',files:[],...patch});
const json=skill=>JSON.stringify({format:'zq.skill',version:1,skill});
function fixture(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'zq-skill-import-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));return new ChatService({directory})}

test('legacy JSON imports exact extracted references with fresh identities and persists',t=>{
 const chat=fixture(t);
 const files=[{name:'notes\\draft.txt',kind:'text',mime:'text/plain',size:10,text:'First\n  second'},{name:'guide.pdf',kind:'pdf',mime:'application/pdf',size:200,text:'Exact PDF reference',pages:2}];
 const parsed=parse('review.zqskill.json',json(portable({files})));assert.deepEqual(parsed.warnings,[]);const imported=chat.importSkill(parsed),second=chat.importSkill(parsed);assert.notEqual(imported.id,second.id);assert.deepEqual(imported.files.map(file=>file.text),[undefined,undefined]);assert.notEqual(imported.files[0].id,second.files[0].id);
 const restarted=new ChatService({directory:chat.store.directory});assert.equal(restarted.state.skills.find(skill=>skill.id===imported.id).files[0].text,'First\n  second');
});

test('Markdown YAML supports quoted, literal and folded metadata while preserving the body',()=>{
 const instructions='\r\n# Review\r\nKeep  spaces.\r\n';
 const literal=parse('SKILL.md','---\r\nname: "Precise: reviewer"\r\ndescription: |\r\n  First line\r\n  Second line\r\n---\r\n'+instructions);
 assert.equal(literal.name,'Precise: reviewer');assert.equal(literal.description,'First line\nSecond line\n');assert.equal(literal.instructions,instructions);assert.deepEqual(literal.files,[]);
 const folded=parse('SKILL.md','---\nname: Reviewer\ndescription: >-\n  Review prose\n  carefully.\n---\nUse checks.\n');assert.equal(folded.description,'Review prose carefully.');assert.equal(folded.instructions,'Use checks.\n');
 const plain=parse('my-review.md','# Heading\n\nExact body  \n');assert.equal(plain.name,'my-review');assert.equal(plain.description,'');assert.equal(plain.instructions,'# Heading\n\nExact body  \n');
});

test('Markdown rejects ambiguous, unsafe or invalid metadata without following paths',()=>{
 for(const body of ['---\nname: First\nname: Second\n---\nBody','---\nname: [one, two]\n---\nBody','---\nname: Reviewer\ndescription: false\n---\nBody','---\nname: !!js/function >\n  function() {}\n---\nBody','---\nname: Reviewer\nBody','---\n- name\n---\nBody'])assert.throws(()=>parse('SKILL.md',body));
 const draft=parse('SKILL.md','---\nname: Reviewer\nallowed-tools: shell\nscript: ./run.sh\n---\nRead [guide](./guide.md).');assert.equal(draft.instructions,'Read [guide](./guide.md).');assert.deepEqual(draft.files,[]);assert.ok(draft.warnings.length);assert.equal(draft.script,undefined);
});

test('JSON import rejects wrong format/version, malformed references and all existing limits',()=>{
 for(const source of ['{',JSON.stringify({format:'zq.skill',version:2,skill:portable()}),JSON.stringify({format:'other',version:1,skill:portable()}),json(portable({name:''})),json(portable({instructions:'x'.repeat(1000001)})),json(portable({description:'x'.repeat(4097)})),json(portable({name:'é'.repeat(129)})),json(portable({files:Array.from({length:11},()=>({name:'a',kind:'text',mime:'text/plain',size:1,text:'a'}))})),json(portable({files:[{name:'a',kind:'image',mime:'image/jpeg',size:1,text:'a'}]})),json(portable({files:[{name:'a',kind:'text',mime:'text/plain',size:1,text:'a',path:'/private/reference'}]}))])assert.throws(()=>parse('test.zqskill.json',source));
 assert.throws(()=>parse('skill.zip','not a supported package'));assert.throws(()=>parse('skill.md','x'.repeat(1024*1024+1)));assert.throws(()=>parseSkillImport({name:'skill.md',bytes:new Uint8Array([0xc3,0x28])}));assert.throws(()=>parseSkillImport({name:'skill.md',bytes:'text'}));
});

test('standard skills preserve larger instructions and metadata while per-request limits remain separate',()=>{
 const body='x'.repeat(100000),description='Long description '.repeat(100);const draft=parse('SKILL.md','---\nname: standard-skill\ndescription: '+description+'\nlicense: MIT\n---\n'+body);assert.equal(draft.instructions,body);assert.equal(draft.description,description.trim());assert.match(draft.package.frontmatter,/license: MIT/);
});

test('native import revalidates edited portable drafts and fails atomically',t=>{
 const chat=fixture(t);const created=chat.importSkill({...portable(),warnings:['Preview warning']});assert.equal(created.name,'Reviewer');assert.equal(created.warnings,undefined);const before=structuredClone(chat.state),saved=fs.readFileSync(chat.store.path,'utf8');
 for(const input of [{...portable(),instructions:null},{...portable(),id:'injected'},{...portable(),files:[{id:'injected',name:'file',kind:'text',mime:'text/plain',text:'body',size:4}]},{...portable(),files:[{name:'file',kind:'text',mime:'text/plain',text:'body',size:4,script:'run'}]}])assert.throws(()=>chat.importSkill(input));assert.deepEqual(chat.state,before);
 chat.store.save=()=>{throw Error('Disk full')};assert.throws(()=>chat.importSkill(portable()),/Disk full/);assert.deepEqual(chat.state,before);assert.equal(fs.readFileSync(chat.store.path,'utf8'),saved);
});

test('native import respects library capacity without replacing same-named skills',t=>{
 const chat=fixture(t);const first=chat.importSkill(portable()),second=chat.importSkill(portable());assert.notEqual(first.id,second.id);
 chat.change(state=>{for(let i=state.skills.length;i<100;i++)state.skills.push({...structuredClone(state.skills[0]),id:'fixture-'+i})});const before=structuredClone(chat.state);assert.throws(()=>chat.importSkill(portable()),/100/);assert.deepEqual(chat.state,before);
});
