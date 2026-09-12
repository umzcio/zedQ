const MAX_FILE=10*1024*1024,MAX_TEXT=100000,MAX_IMAGE=1024*1024;
const string=(s,max)=>typeof s==='string'&&Buffer.byteLength(s)<=max&&!s.includes('\0')&&s.isWellFormed();
function isAttachment(a){return a&&typeof a==='object'&&string(a.id,256)&&a.id&&string(a.name,512)&&a.name&&['text','pdf','image'].includes(a.kind)&&Number.isInteger(a.size)&&a.size>=0&&a.size<=MAX_FILE&&string(a.mime,100)&&string(a.preview??'',40000)&&(a.preview===''||/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(a.preview))&&(a.pages===undefined||Number.isInteger(a.pages)&&a.pages>0&&a.pages<=100)&&['width','height'].every(k=>a[k]===undefined||Number.isInteger(a[k])&&a[k]>0&&a[k]<=25000000)&&
 (a.kind==='image'?a.mime==='image/jpeg'&&typeof a.image==='string'&&a.image.length<=Math.ceil(MAX_IMAGE/3)*4&&/^[A-Za-z0-9+/]+={0,2}$/.test(a.image)&&a.image.length%4===0:string(a.text,MAX_TEXT))}
function publicAttachment(a){const {text,image,...info}=a;return info}
module.exports={MAX_FILE,MAX_TEXT,MAX_IMAGE,isAttachment,publicAttachment};
