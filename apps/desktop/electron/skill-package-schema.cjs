'use strict';
const MAX_PACKAGE_BYTES=10*1024*1024,MAX_PACKAGE_FILES=200,MAX_FRONTMATTER=65536;
const text=(value,max)=>typeof value==='string'&&Buffer.byteLength(value)<=max&&!value.includes('\0')&&value.isWellFormed();
function validResourcePath(value){return Boolean(text(value,512)&&value&&value.toLowerCase()!=='skill.md'&&!value.startsWith('/')&&!/[\\:]/.test(value)&&value.split('/').every(part=>part&&part!=='.'&&part!=='..'))}
function validSkillPackage(value,{incoming=false}={}){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['frontmatter','resources'].includes(key))||!text(value.frontmatter,MAX_FRONTMATTER)||!Array.isArray(value.resources)||value.resources.length>=MAX_PACKAGE_FILES)return false;
 const seen=new Set();let size=0;
 const paths=value.resources.map(file=>typeof file?.path==='string'?file.path.normalize('NFC').toLowerCase():'');if(paths.some(name=>paths.some(other=>other!==name&&other.startsWith(name+'/'))))return false;
 return value.resources.every(file=>{if(!file||typeof file!=='object'||Array.isArray(file)||Object.keys(file).some(key=>![...['path','size'],incoming?'data':'digest'].includes(key))||!validResourcePath(file.path)||!Number.isSafeInteger(file.size)||file.size<0||(size+=file.size)>MAX_PACKAGE_BYTES)return false;const normalized=file.path.normalize('NFC').toLowerCase();if(seen.has(normalized))return false;seen.add(normalized);if(!incoming)return typeof file.digest==='string'&&/^[a-f0-9]{64}$/.test(file.digest);return typeof file.data==='string'&&file.data.length<=Math.ceil(MAX_PACKAGE_BYTES/3)*4&&file.data.length%4===0&&/^[A-Za-z0-9+/]*={0,2}$/.test(file.data)&&Buffer.from(file.data,'base64').length===file.size&&Buffer.from(file.data,'base64').toString('base64')===file.data});
}
module.exports={validResourcePath,validSkillPackage,MAX_PACKAGE_BYTES,MAX_PACKAGE_FILES,MAX_FRONTMATTER};
