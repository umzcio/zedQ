'use strict';
const fs=require('node:fs'),path=require('node:path');
const {MAX_PACKAGE_BYTES,MAX_PACKAGE_FILES}=require('./skill-package-schema.cjs');
const {MAX_IMPORT_BYTES}=require('./skill-import.cjs');
function boundedFile(file,limit,message,check=()=>{}){
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const stat=fs.fstatSync(fd);if(!stat.isFile())throw Error('Choose a regular skill file.');if(stat.size>limit)throw Error(message);check(stat);const chunks=[];let total=0;
  while(total<=limit){const chunk=Buffer.alloc(Math.min(65536,limit+1-total));const count=fs.readSync(fd,chunk,0,chunk.length,null);if(!count)break;total+=count;if(total>limit)throw Error(message);chunks.push(chunk.subarray(0,count));}const after=fs.fstatSync(fd);if(after.size!==stat.size||after.mtimeMs!==stat.mtimeMs||total!==stat.size)throw Error('A skill file changed while reading. Try again.');check(after);return Buffer.concat(chunks);
 }finally{fs.closeSync(fd)}
}
function readSkillFile(file){const archive=/\.(zip|skill)$/i.test(file);return boundedFile(file,archive?MAX_PACKAGE_BYTES:MAX_IMPORT_BYTES,`Skill imports must be ${archive?'10':'1'} MB or smaller.`)}
async function readSkillDirectory(directory){
 const selected=fs.lstatSync(directory);if(selected.isSymbolicLink()||!selected.isDirectory())throw Error('Choose a skill folder without symbolic links.');
 const root=fs.realpathSync(directory),entries=[];let count=0,total=0;
 const identity=(name,stat)=>({path:name,ino:stat.ino,dev:stat.dev});
 const checkParents=parents=>{for(const parent of parents){const current=fs.lstatSync(parent.path);if(current.isSymbolicLink()||!current.isDirectory()||current.ino!==parent.ino||current.dev!==parent.dev)throw Error('A skill folder changed or contains a symbolic link.')}};
 function visit(folder,relative,parents){
  checkParents(parents);const handle=fs.opendirSync(folder);
  try{let item;while((item=handle.readSync())){
   if(++count>MAX_PACKAGE_FILES)throw Error('Skill packages can contain up to 200 entries.');checkParents(parents);
   const filename=path.join(folder,item.name),resourcePath=relative?relative+'/'+item.name:item.name,stat=fs.lstatSync(filename);
   if(stat.isSymbolicLink())throw Error('Skill folders cannot contain symbolic links.');
   if(stat.isDirectory()){if(resourcePath.split('/').length>20)throw Error('Skill folder nesting is too deep.');visit(filename,resourcePath,[...parents,identity(filename,stat)]);continue}
   if(!stat.isFile())throw Error('Skill folders can contain only regular files and folders.');
   const isDocument=/^skill\.md$/i.test(item.name),remaining=MAX_PACKAGE_BYTES-total,limit=Math.min(remaining,isDocument?MAX_IMPORT_BYTES:MAX_PACKAGE_BYTES);
   const bytes=boundedFile(filename,limit,isDocument&&limit===MAX_IMPORT_BYTES?'SKILL.md can be up to 1 MB.':'Skill packages can be up to 10 MB.',opened=>{checkParents(parents);const current=fs.lstatSync(filename);if(current.isSymbolicLink()||current.ino!==opened.ino||current.dev!==opened.dev||opened.ino!==stat.ino||opened.dev!==stat.dev)throw Error('A skill file changed or became a symbolic link.');});
   total+=bytes.length;entries.push({path:resourcePath,bytes});
  }}finally{handle.closeSync()}
 }
 const rootStat=fs.lstatSync(root);if(rootStat.ino!==selected.ino||rootStat.dev!==selected.dev)throw Error('The selected skill folder changed. Try again.');visit(root,'',[identity(root,rootStat)]);
 return require('./skill-package.cjs').parseSkillEntries(entries);
}
module.exports={readSkillFile,readSkillDirectory};
