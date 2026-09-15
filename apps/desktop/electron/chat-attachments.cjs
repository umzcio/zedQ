const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {text}=require('./chat-store.cjs');
const {MAX_FILE,MAX_TEXT,MAX_IMAGE,isAttachment,publicAttachment}=require('./attachment-schema.cjs');
const {extractPdf}=require('./pdf-extractor.cjs');
class AttachmentService{
 constructor({extractPdf:pdf=extractPdf,normalizeImage}={}){this.pdf=pdf;this.normalizeImage=normalizeImage;this.items=new Map();this.importing=false}
 async importFiles(files){
  if(!Array.isArray(files)||files.length>10)throw Error('Attach up to 10 files at a time.');if(this.importing)throw Error('Wait for the current files to finish preparing.');
  this.importing=true;const items=[],errors=[];
  try{for(const file of files){try{const a=await this.parse(file);const size=[...this.items.values()].reduce((sum,a)=>sum+Buffer.byteLength(JSON.stringify(a)),0);if(this.items.size>=100||size+Buffer.byteLength(JSON.stringify(a))>20*1024*1024)throw Error('Too many pending attachments. Remove unused files first.');this.items.set(a.id,a);items.push(publicAttachment(a))}catch(e){errors.push({name:typeof file?.name==='string'?file.name.slice(0,200):'File',message:e.message||'Could not attach this file.'})}}}finally{this.importing=false}
  return{items,errors};
 }
 async parse(file){
  if(!file||!text(file.name,512)||!file.name.trim()||!(file.bytes instanceof Uint8Array))throw Error('Invalid file name or contents.');
  const data=Buffer.from(file.bytes);if(data.length>MAX_FILE)throw Error('Files can be up to 10 MB.');if(!data.length)throw Error('This file is empty.');
  const name=path.basename(file.name),base={id:randomUUID(),name,size:data.length,preview:''};let a;
  if(data.subarray(0,5).toString()==='%PDF-'){
   const result=await this.pdf(data);if(!result.text.trim())throw Error('This PDF has no readable text. For scanned pages, attach screenshots instead.');a={...base,kind:'pdf',mime:'application/pdf',text:result.text,pages:result.pages};
  }else if(data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||data[0]===255&&data[1]===216||data.subarray(8,12).toString()==='WEBP'){
   if(!this.normalizeImage)throw Error('Image processing is unavailable.');const image=this.normalizeImage(data);a={...base,kind:'image',mime:'image/jpeg',...image};
  }else{
   if(/\.(pdf|png|jpe?g|webp|gif|heic|zip|docx?|xlsx?|pptx?|exe|dmg)$/i.test(name))throw Error('Use PNG/JPG/WebP images, PDFs, or text/code files.');
   let body;try{body=new TextDecoder('utf-8',{fatal:true}).decode(data)}catch{throw Error('This file is not readable UTF-8 text.')}
   if(!text(body,MAX_TEXT)||/[\x00-\x08\x0b\x0e-\x1f]/.test(body))throw Error('Text attachments must be readable text under 100 KB.');a={...base,kind:'text',mime:'text/plain',text:body};
  }
  if(!isAttachment(a))throw Error('The attachment exceeds supported content limits.');return a;
 }
 resolve(ids){if(!Array.isArray(ids)||ids.length>10||!ids.every(id=>typeof id==='string'))throw Error('Attach up to 10 files.');return [...new Set(ids)].map(id=>{const a=this.items.get(id);if(!a)throw Error('An attachment is no longer available. Add it again.');return structuredClone(a)})}
 discard(id){this.items.delete(id)}
 preview(id,history=[]){const a=this.items.get(id)??history.find(a=>a.id===id);if(!a)throw Error('Attachment not found.');return structuredClone(a)}
 async fromPaths(paths){const files=[],errors=[];for(const name of paths){let fd;try{fd=fs.openSync(name,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.size>MAX_FILE)throw Error('Choose a regular file under 10 MB.');const data=Buffer.alloc(stat.size+1);let length=0;while(length<data.length){const read=fs.readSync(fd,data,length,data.length-length,length);if(!read)break;length+=read;}if(length>stat.size)throw Error('This file changed while reading. Try again.');files.push({name:path.basename(name),bytes:data.subarray(0,length)})}catch(e){errors.push({name:path.basename(name),message:e.message})}finally{if(fd!==undefined)fs.closeSync(fd)}}const result=await this.importFiles(files);return{items:result.items,errors:[...errors,...result.errors]}}
}
function imageNormalizer(nativeImage){return data=>{
 const {imageDimensions}=require('./image-dimensions.cjs');const size=imageDimensions(data);if(!size.width||!size.height||size.width*size.height>25000000)throw Error('Images can be up to 25 megapixels.');
 let image=nativeImage.createFromBuffer(data);if(image.isEmpty())throw Error('Could not read this image. Use PNG, JPG, or WebP.');
 const ratio=Math.min(1,1600/Math.max(size.width,size.height));if(ratio<1)image=image.resize({width:Math.round(size.width*ratio),height:Math.round(size.height*ratio),quality:'better'});
 const jpeg=image.toJPEG(85);if(jpeg.length>MAX_IMAGE)throw Error('This image is too detailed. Try a smaller image.');
 const thumbnail=image.resize({width:Math.max(1,Math.round(image.getSize().width*120/Math.max(image.getSize().width,image.getSize().height))),quality:'good'}).toJPEG(65);
 return{image:jpeg.toString('base64'),preview:`data:image/jpeg;base64,${thumbnail.toString('base64')}`,width:image.getSize().width,height:image.getSize().height};
 }}
module.exports={AttachmentService,imageNormalizer,extractPdf};
