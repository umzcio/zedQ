'use strict';
const path=require('node:path');
const yaml=require('js-yaml');
const {validSkillSource}=require('./skill-source.cjs');
const {isAttachment}=require('./attachment-schema.cjs');
const {validResourcePath,validSkillPackage,MAX_FRONTMATTER}=require('./skill-package-schema.cjs');
const MAX_IMPORT_BYTES=1024*1024;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const text=(value,max)=>typeof value==='string'&&Buffer.byteLength(value)<=max&&!value.includes('\0')&&value.isWellFormed();
const allowed=(value,keys)=>object(value)&&Object.keys(value).every(key=>keys.includes(key));
function validateSkillImport(input){
 if(!allowed(input,['name','description','instructions','files','warnings','package','source'])||!Array.isArray(input.files)||input.files.length>10)throw Error('Invalid skill file. Expected a name, description, instructions, and up to ten references.');
 if(input.source!==undefined&&!validSkillSource(input.source))throw Error('Invalid skill source revision.');
 if(input.package!==undefined){if(!validSkillPackage(input.package,{incoming:true}))throw Error('Invalid or oversized skill package resources.');readFrontmatter(input.package.frontmatter)}
 const files=input.files.map((file,index)=>{
  if(!allowed(file,['name','kind','mime','size','text','pages','resourcePath'])||!['text','pdf'].includes(file.kind)||file.mime!==(file.kind==='pdf'?'application/pdf':'text/plain')||!isAttachment({...file,id:String(index),preview:''})||file.resourcePath!==undefined&&(!validResourcePath(file.resourcePath)||!input.package?.resources.some(resource=>resource.path===file.resourcePath)))throw Error('Skill references must be named text or PDF files with extracted text.');
  return{name:file.name,kind:file.kind,mime:file.mime,size:file.size,text:file.text,...(file.pages!==undefined?{pages:file.pages}:{}),...(file.resourcePath!==undefined?{resourcePath:file.resourcePath}:{})};
 });
 const value={...(input.source?{source:structuredClone(input.source)}:{}),name:input.name,description:input.description,instructions:input.instructions,files,...(input.package?{package:structuredClone(input.package)}:{})};
 if(!text(value.name,256)||!value.name.trim()||!text(value.description,4096)||!text(value.instructions,1000000)||Buffer.byteLength(value.instructions)+files.reduce((total,file)=>total+Buffer.byteLength(file.text),0)>2000000)throw Error('Skills need a name up to 256 bytes, description up to 4 KB, instructions up to 1 MB, and at most 10 references with 2 MB total stored text.');
 return value;
}
function readFrontmatter(source){
 if(!text(source,MAX_FRONTMATTER))throw Error('Skill YAML metadata must be valid text under 64 KB.');
 let metadata;try{metadata=yaml.load(source,{schema:yaml.JSON_SCHEMA,maxDepth:20,maxTotalMergeKeys:0})??{}}catch{throw Error('Invalid YAML frontmatter. Use unique fields with valid YAML values.');}
 if(!object(metadata))throw Error('Markdown frontmatter must be a mapping with name and description fields.');
 let count=0,expandedBytes=0;const ancestors=new Set();function inspect(value,depth){if(++count>10000||depth>20)throw Error('Skill YAML metadata is too complex.');if(typeof value==='string')expandedBytes+=Buffer.byteLength(value);if(expandedBytes>MAX_FRONTMATTER)throw Error('Expanded skill YAML metadata exceeds 64 KB.');if(value&&typeof value==='object'){if(ancestors.has(value))throw Error('Skill YAML metadata cannot contain cycles.');ancestors.add(value);for(const [key,item] of Object.entries(value)){expandedBytes+=Buffer.byteLength(key);inspect(item,depth+1)}ancestors.delete(value)}}inspect(metadata,0);return metadata;
}
function parseMarkdown(name,source){
 let instructions=source,metadata={},warnings=[],frontmatter='';
 if(/^---[ \t]*(?:\r?\n|$)/.test(source)){
  const opening=/^---[ \t]*\r?\n/.exec(source);
  if(!opening)throw Error('Markdown frontmatter needs a closing --- line.');
  const rest=source.slice(opening[0].length),closing=/^---[ \t]*(?:\r?\n|$)/m.exec(rest);
  if(!closing)throw Error('Markdown frontmatter needs a closing --- line.');
  frontmatter=rest.slice(0,closing.index);metadata=readFrontmatter(frontmatter);
  instructions=rest.slice(closing.index+closing[0].length);
  if(metadata.compatibility!==undefined||metadata['allowed-tools']!==undefined)warnings.push('Compatibility and tool requirements are preserved as metadata. Importing a skill does not grant tools or execute scripts.');
 }
 if(/\]\((?!https?:|mailto:|#|data:)[^)]+\)/i.test(instructions))warnings.push('Links to other files are preserved as text. Upload those references separately if the skill needs them.');
 if(Buffer.byteLength(instructions)>=100000)warnings.push('These instructions exceed the per-request context limit. Shorten them before enabling this skill in a chat.');
 const fallback=path.basename(name.replace(/\\/g,'/')).replace(/\.md$/i,'');
 const value=validateSkillImport({name:Object.hasOwn(metadata,'name')?metadata.name:fallback,description:Object.hasOwn(metadata,'description')?metadata.description:'',instructions,files:[],package:{frontmatter,resources:[]}});
 return{...value,warnings};
}
function parseSkillImport({name,bytes}={}){
 if(!text(name,512)||!name.trim()||!(bytes instanceof Uint8Array))throw Error('Choose a Markdown or .zqskill.json file.');
 if(bytes.byteLength>MAX_IMPORT_BYTES)throw Error('Skill uploads can be up to 1 MB.');
 if(!bytes.byteLength)throw Error('This skill file is empty.');
 let source;try{source=new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{throw Error('Skill files must contain valid UTF-8 text.');}
 if(/\.md$/i.test(name))return parseMarkdown(name,source);
 if(!/\.zqskill\.json$/i.test(name))throw Error('Choose a Markdown or .zqskill.json file.');
 let payload;try{payload=JSON.parse(source)}catch{throw Error('This skill file contains invalid JSON.');}
 if(!allowed(payload,['format','version','skill'])||payload.format!=='zq.skill'||payload.version!==1)throw Error('Unsupported skill format. Choose a version 1 zQ skill export.');
 return{...validateSkillImport(payload.skill),warnings:[]};
}
module.exports={parseSkillImport,validateSkillImport,readFrontmatter,MAX_IMPORT_BYTES};
