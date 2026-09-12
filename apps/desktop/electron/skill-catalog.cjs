'use strict';
const {parseSkillEntries}=require('./skill-package.cjs');
const {validResourcePath,MAX_PACKAGE_BYTES,MAX_PACKAGE_FILES}=require('./skill-package-schema.cjs');
const rows=[
 ['doc-coauthoring','Document coauthoring','A structured writing workflow for proposals, plans, and documentation.','Writing','Instructions work in chat; optional external integrations depend on the available tools.'],
 ['internal-comms','Internal communications','Draft updates, newsletters, reports, and team communications.','Writing','Uses instructions and examples.'],
 ['docx','Word documents','Create and edit Word documents with formatting guidance.','Documents','Includes scripts and external tools that zQ does not execute yet.'],
 ['pdf','PDF documents','Guidance and supporting tools for working with PDFs.','Documents','Includes scripts and external tools that zQ does not execute yet.'],
 ['xlsx','Spreadsheets','Guidance for spreadsheet analysis, formulas, and formatting.','Data','Includes scripts and external tools that zQ does not execute yet.'],
 ['pptx','Presentations','Guidance and resources for building presentations.','Documents','Includes scripts and external tools that zQ does not execute yet.'],
].map(([slug,name,description,category,requirements])=>({id:`anthropics/skills/${slug}`,name,description,category,requirements,url:`https://skills.sh/anthropics/skills/${slug}`,source:`https://github.com/anthropics/skills/tree/main/skills/${slug}`}));
class SkillCatalog{
 constructor({fetch:transport=globalThis.fetch}={}){this.fetch=transport;this.tree=null;this.treePending=null;this.checkPending=null;this.pending=new Map();this.checks=new Map();this.statusTokens=new Map();this.statusSequence=0}
 list({query=''}={}){if(typeof query!=='string'||query.length>200)throw Error('Search with up to 200 characters.');const q=query.trim().toLowerCase();return structuredClone(rows.filter(row=>[row.name,row.description,row.category].some(value=>value.toLowerCase().includes(q))).map(row=>({...row,...this.checks.get(row.id)})))}
 entry(id){const row=rows.find(row=>row.id===id);if(!row)throw Error('This skill is not in the curated collection.');return row}
 async bytes(url,signal,limit){const response=await this.fetch(url,{signal,redirect:'error',credentials:'omit',headers:{'User-Agent':'zQ-skills','Accept':'application/vnd.github+json'}});if(!response.ok){await response.body?.cancel();throw Error(response.status===403||response.status===429?'The skill source is rate limited. Try again later.':'The skill source is unavailable. Try again.')}if(!response.headers.get('content-encoding')&&Number(response.headers.get('content-length'))>limit){await response.body?.cancel();throw Error('Skill source response is too large.')}if(!response.body)throw Error('The skill source returned an empty response.');const reader=response.body.getReader(),chunks=[];let total=0;try{while(true){const {value,done}=await reader.read();if(done)break;total+=value.byteLength;if(total>limit)throw Error('Skill source response is too large.');chunks.push(Buffer.from(value))}return Buffer.concat(chunks)}finally{await reader.cancel().catch(()=>{})}}
 async json(url,signal){return JSON.parse((await this.bytes(url,signal,2*1024*1024)).toString('utf8'))}
 async refreshTree(force=false){
  if(this.treePending)return this.treePending;
  if(!force&&this.tree&&this.tree.expires>=Date.now())return this.tree;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
  const request=Promise.resolve().then(async()=>{
   try{
    const commit=await this.json('https://api.github.com/repos/anthropics/skills/commits/main',controller.signal);
    if(typeof commit?.sha!=='string'||!/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(commit.sha))throw Error('Invalid skill source revision.');
    const listing=await this.json(`https://api.github.com/repos/anthropics/skills/git/trees/${commit.sha}?recursive=1`,controller.signal);
    if(listing?.truncated!==false||!Array.isArray(listing.tree)||listing.tree.length>10000)throw Error('The skill source tree is incomplete.');
    controller.signal.throwIfAborted();const tree={sha:commit.sha,entries:listing.tree,expires:Date.now()+300000};this.tree=tree;return tree;
   }catch(error){this.tree=null;if(error.name==='AbortError'||error.name==='TimeoutError')throw Error('The skill source check timed out. Try again.');throw error}
   finally{clearTimeout(timer)}
  });
  this.treePending=request;try{return await request}finally{if(this.treePending===request)this.treePending=null}
 }
 directoryRevision(tree,id){
  this.entry(id);const directory='skills/'+id.split('/').at(-1),matching=tree.entries.filter(entry=>entry?.path===directory);
  if(matching.length!==1)throw Error('This skill directory is missing or ambiguous in the source tree.');
  const entry=matching[0];if(entry.type!=='tree'||entry.mode!=='040000'||typeof entry.sha!=='string'||!/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(entry.sha))throw Error('This skill directory has an invalid or unsupported source revision.');return entry.sha;
 }
 recordCheck(id,status,token){if((this.statusTokens.get(id)??0)>token)return;this.statusTokens.set(id,token);this.checks.set(id,status)}
 async check(){
  if(!this.checkPending)this.checkPending=this.checkLatest();const request=this.checkPending;
  try{return structuredClone(await request)}finally{if(this.checkPending===request)this.checkPending=null}
 }
 async checkLatest(){
  const token=++this.statusSequence;
  try{const tree=await this.refreshTree(true),checkedAt=Date.now();for(const row of rows){try{this.recordCheck(row.id,{revision:this.directoryRevision(tree,row.id),checkedAt},token)}catch(error){this.recordCheck(row.id,{checkedAt,checkError:String(error.message||'This skill could not be checked.').slice(0,1000)},token)}}}
  catch(error){const checkedAt=Date.now();for(const row of rows)this.recordCheck(row.id,{checkedAt,checkError:String(error.message||'The skill source is unavailable. Try again.').slice(0,1000)},token)}
  return this.list();
 }
 async preview(id){this.entry(id);if(this.pending.has(id))return structuredClone(await this.pending.get(id));const request=this.load(id);this.pending.set(id,request);try{return structuredClone(await request)}finally{this.pending.delete(id)}}
 async load(id){const row=this.entry(id),slug=id.split('/').at(-1),token=++this.statusSequence,controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);try{
  const tree=await this.refreshTree(),revision=this.directoryRevision(tree,id);controller.signal.throwIfAborted();
  const prefix=`skills/${slug}/`,selected=tree.entries.filter(entry=>typeof entry?.path==='string'&&entry.path.startsWith(prefix)&&entry.type!=='tree');if(!selected.length||selected.length>MAX_PACKAGE_FILES)throw Error('This skill package is unavailable or has too many files.');let declared=0;
  for(const entry of selected){const relative=entry.path.slice(prefix.length);if(entry.type!=='blob'||!['100644','100755'].includes(entry.mode)||!Number.isSafeInteger(entry.size)||entry.size<0||(declared+=entry.size)>MAX_PACKAGE_BYTES||(relative!=='SKILL.md'&&!validResourcePath(relative)))throw Error('This skill package contains unsupported files or paths.')}
  const entries=[];let offset=0,total=0;await Promise.all(Array.from({length:Math.min(4,selected.length)},async()=>{while(offset<selected.length){const entry=selected[offset++],bytes=await this.bytes(`https://raw.githubusercontent.com/anthropics/skills/${tree.sha}/${entry.path.split('/').map(encodeURIComponent).join('/')}`,controller.signal,entry.size);if(bytes.length!==entry.size)throw Error('A pinned skill resource has an incomplete or changed size.');total+=bytes.length;if(total>MAX_PACKAGE_BYTES)throw Error('Skill package exceeds 10 MB.');entries.push({path:entry.path.slice(prefix.length),bytes})}}));
  entries.sort((a,b)=>a.path.localeCompare(b.path));const draft=await parseSkillEntries(entries);controller.signal.throwIfAborted();draft.warnings=[...draft.warnings,row.requirements];draft.source={catalogId:id,revision,contentHash:require('./skill-source.cjs').skillContentHash(draft)};this.recordCheck(id,{revision,checkedAt:Date.now()},token);return draft;
 }catch(e){controller.abort();if(e.name==='AbortError'||e.name==='TimeoutError')throw Error('The skill download timed out. Try again.');throw e}finally{clearTimeout(timer)}}
}
module.exports={SkillCatalog};
