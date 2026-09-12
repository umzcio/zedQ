const test=require('node:test'),assert=require('node:assert/strict');
const {SkillCatalog}=require('../electron/skill-catalog.cjs');
const sha='a'.repeat(40);
const revision='b'.repeat(40),slugs=['doc-coauthoring','internal-comms','docx','pdf','xlsx','pptx'];
const document='---\nname: docx\ndescription: Word documents\n---\nUse the template.';
const treeEntries=(directoryRevision=revision)=>[...slugs.map(slug=>({path:'skills/'+slug,type:'tree',mode:'040000',sha:directoryRevision})),{path:'skills/docx/SKILL.md',type:'blob',mode:'100644',size:Buffer.byteLength(document)},{path:'skills/docx/assets/template.bin',type:'blob',mode:'100644',size:3}];
function transport(log,patch={}){return async(url,options)=>{log.push(url);if(url.endsWith('/commits/main'))return Response.json({sha});if(url.includes('/git/trees/'))return Response.json({truncated:false,tree:treeEntries(),...patch});if(url.endsWith('/SKILL.md'))return new Response(document);if(url.endsWith('/template.bin'))return new Response(Uint8Array.from([0,1,255]));throw Error('Unexpected URL '+url)}}
test('curated search is local and never fetches or installs',()=>{const catalog=new SkillCatalog({fetch:()=>{throw Error('No fetch expected')}});assert.equal(catalog.list().length,6);assert(catalog.list({query:'writing'}).length>0);assert.equal(catalog.list({query:'not-here'}).length,0);assert.throws(()=>catalog.list({query:'a'.repeat(201)}));assert.throws(()=>catalog.entry('../secret'))});
test('preview pins files to a commit while provenance records the skill directory revision and content hash',async()=>{const calls=[],catalog=new SkillCatalog({fetch:transport(calls)}),draft=await catalog.preview('anthropics/skills/docx');assert.equal(draft.name,'docx');assert.equal(draft.package.resources[0].path,'assets/template.bin');assert.equal(draft.package.resources[0].data,Buffer.from([0,1,255]).toString('base64'));assert(calls.filter(url=>url.includes('raw.githubusercontent.com')).every(url=>url.includes(sha)));assert(draft.warnings.some(w=>w.includes('scripts')));assert.deepEqual(draft.source,{catalogId:'anthropics/skills/docx',revision,contentHash:require('../electron/skill-source.cjs').skillContentHash(draft)});const row=catalog.list().find(row=>row.id===draft.source.catalogId);assert.equal(row.revision,revision);assert.equal(typeof row.checkedAt,'number')});
test('catalog rejects truncated trees, symlinks, unsafe paths and unavailable files',async()=>{for(const patch of [{truncated:true},{tree:[{path:'skills/docx/SKILL.md',type:'blob',mode:'120000',size:3}]},{tree:[{path:'skills/docx/../SKILL.md',type:'blob',mode:'100644',size:3}]}])await assert.rejects(new SkillCatalog({fetch:transport([],patch)}).preview('anthropics/skills/docx'));await assert.rejects(new SkillCatalog({fetch:async()=>new Response('Unavailable',{status:503})}).preview('anthropics/skills/docx'),/unavailable/i)});
test('compressed response headers do not reject a bounded decoded file',async()=>{const catalog=new SkillCatalog({fetch:async()=>new Response('\n',{headers:{'content-encoding':'gzip','content-length':'21'}})});assert.equal((await catalog.bytes('https://example.test',new AbortController().signal,1)).length,1);const oversized=new SkillCatalog({fetch:async()=>new Response('too large',{headers:{'content-encoding':'gzip'}})});await assert.rejects(oversized.bytes('https://example.test',new AbortController().signal,1),/too large/)});

test('forced checks compare own directory trees and never download packages',async()=>{
 let commit=sha,directory=revision;const calls=[],catalog=new SkillCatalog({fetch:async(url,options)=>{calls.push(url);assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');if(url.endsWith('/commits/main'))return Response.json({sha:commit});if(url.includes('/git/trees/'))return Response.json({truncated:false,tree:treeEntries(directory)});throw Error('Checks must not download package files')}});
 const first=await catalog.check();assert.equal(first[0].revision,revision);commit='c'.repeat(40);assert.equal((await catalog.check())[0].revision,revision);directory='d'.repeat(64);assert.equal((await catalog.check())[0].revision,directory);assert.equal(calls.length,6);assert.ok(calls[3].includes(commit));const count=calls.length;assert.equal(catalog.list({query:'documents'}).every(row=>row.revision===directory),true);assert.equal(calls.length,count);
});

test('concurrent checks and previews share one commit/tree request and return independent copies',async()=>{
 const calls=[],catalog=new SkillCatalog({fetch:transport(calls)});const [a,b,draft,duplicate]=await Promise.all([catalog.check(),catalog.check(),catalog.preview('anthropics/skills/docx'),catalog.preview('anthropics/skills/docx')]);assert.equal(calls.filter(url=>url.endsWith('/commits/main')).length,1);assert.equal(calls.filter(url=>url.includes('/git/trees/')).length,1);assert.equal(calls.filter(url=>url.includes('raw.githubusercontent.com')).length,2);a[0].revision='changed';draft.name='Changed';assert.equal(b[0].revision,revision);assert.equal(duplicate.name,'docx');assert.equal(catalog.list()[0].revision,revision);
});

test('offline and rate-limited checks replace prior success with an explicit per-row error',async()=>{
 let status=200;const fetch=transport([]),catalog=new SkillCatalog({fetch:(url,options)=>{if(status===0)throw Error('Offline');if(status!==200)return Promise.resolve(new Response('Rate limited',{status}));return fetch(url,options)}});
 await catalog.check();for(const failure of [0,429]){status=failure;const rows=await catalog.check();assert.equal(rows.length,6);assert.ok(rows.every(row=>row.revision===undefined&&row.checkError));assert.deepEqual(catalog.list(),rows);if(failure===429)assert.match(rows[0].checkError,/rate limit/i)}
});

test('invalid or missing directory revisions are row errors; incomplete trees invalidate every row',async()=>{
 for(const malformed of [null,{path:'skills/docx',type:'blob',mode:'120000',sha:revision},{path:'skills/docx',type:'tree',mode:'120000',sha:revision},{path:'skills/docx',type:'tree',mode:'040000',sha:'not-a-sha'}]){
  const entries=treeEntries().filter(entry=>entry.path!=='skills/docx');if(malformed)entries.push(malformed);const catalog=new SkillCatalog({fetch:transport([],{tree:entries})}),checked=await catalog.check();assert.ok(checked.find(row=>row.id==='anthropics/skills/docx').checkError);assert.equal(checked.find(row=>row.id==='anthropics/skills/pdf').revision,revision);await assert.rejects(catalog.preview('anthropics/skills/docx'));
 }
 const duplicate=new SkillCatalog({fetch:transport([],{tree:[...treeEntries(),{path:'skills/docx',type:'tree',mode:'040000',sha:revision}]})});assert.ok((await duplicate.check()).find(row=>row.id==='anthropics/skills/docx').checkError);
 for(const patch of [{truncated:true},{tree:Array(10001).fill({})}])assert.ok((await new SkillCatalog({fetch:transport([],patch)}).check()).every(row=>row.checkError&&!row.revision));
});

test('an older preview cannot overwrite a newer failed check',async()=>{
 let release,offline=false;const fetch=transport([]),catalog=new SkillCatalog({fetch:async(url,options)=>{if(offline)throw Error('Offline');if(url.endsWith('/template.bin')){await new Promise(resolve=>release=resolve);return new Response(Uint8Array.from([0,1,255]))}return fetch(url,options)}});
 const pending=catalog.preview('anthropics/skills/docx');while(!release)await new Promise(resolve=>setImmediate(resolve));offline=true;await catalog.check();release();const draft=await pending;assert.equal(draft.source.revision,revision);assert.match(catalog.list().find(row=>row.id===draft.source.catalogId).checkError,/offline/i);assert.equal(catalog.list().find(row=>row.id===draft.source.catalogId).revision,undefined);
});

test('checks time out after 30 seconds and remain retryable',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let calls=0;const catalog=new SkillCatalog({fetch:(_url,{signal})=>{calls++;return new Promise((resolve,reject)=>{if(signal.aborted)reject(new DOMException('Aborted','AbortError'));else signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true})})}});
 const pending=catalog.check();await Promise.resolve();t.mock.timers.tick(29999);assert.equal(catalog.list().some(row=>row.checkError),false);t.mock.timers.tick(1);assert.ok((await pending).every(row=>/timed out/.test(row.checkError)));const again=catalog.check();await Promise.resolve();t.mock.timers.tick(30000);await again;assert.equal(calls,2);
});

test('preview only records successful downloads and rejects truncated pinned resources',async()=>{
 const log=[],base=transport(log),catalog=new SkillCatalog({fetch:(url,options)=>url.endsWith('/template.bin')?Promise.resolve(new Response(Uint8Array.from([0,1]))):base(url,options)});await assert.rejects(catalog.preview('anthropics/skills/docx'),/size|incomplete|changed/i);assert.equal(catalog.list().find(row=>row.id==='anthropics/skills/docx').revision,undefined);
 const invalid=new SkillCatalog({fetch:async()=>new Response('x'.repeat(2*1024*1024+1))});assert.ok((await invalid.check()).every(row=>/too large/.test(row.checkError)));
});
