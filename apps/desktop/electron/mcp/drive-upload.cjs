'use strict';
const {randomUUID,createHash}=require('node:crypto');
const {z}=require('zod/v4');
const {ConnectorError,createSafeFetch}=require('./security.cjs');
const MAX_UPLOAD=5*1024*1024,FOLDER_FIELDS='id,name,mimeType,trashed,version,shared,driveId,parents,capabilities(canAddChildren)';
const FILE_TYPES={'application/pdf':'PDF document','application/vnd.openxmlformats-officedocument.wordprocessingml.document':'Word document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'Excel workbook','application/vnd.openxmlformats-officedocument.presentationml.presentation':'PowerPoint presentation'};
const fileId=z.string().regex(/^[A-Za-z0-9_-]{1,256}$/);
const schema=z.object({artifactId:z.string().uuid(),versionId:z.string().uuid(),folderId:fileId.default('root'),reviewToken:z.string().uuid().optional().describe('Managed by zQ; omit this field.')}).strict();
const line=value=>String(value??'').replace(/[\r\n\x00-\x1f]/g,' ').slice(0,1024);
const fingerprint=folder=>JSON.stringify([folder.id,folder.name,folder.mimeType,folder.trashed,folder.version,folder.shared,folder.driveId,folder.parents,folder.capabilities?.canAddChildren]);
const uncertain='The upload could not be confirmed. Check Google Drive before continuing. Do not retry automatically.';
function driveUpload({register,request,signal,fetchImpl,getToken,driveWriteAccess}){
 const reviews=new Map();
 function checkFolder(folder){
  if(!fileId.safeParse(folder?.id).success||typeof folder.name!=='string'||typeof folder.version!=='string')throw new ConnectorError('The destination folder could not be verified. Choose it again.');
  if(folder.trashed||folder.mimeType!=='application/vnd.google-apps.folder')throw new ConnectorError('Choose a Drive folder that is not in Trash.');
  if(folder.capabilities?.canAddChildren!==true)throw new ConnectorError('You cannot upload to this folder. Choose a writable destination.');
 }
 async function prepare(input,file,abortSignal){
  const args=schema.parse(input);delete args.reviewToken;
  if(!driveWriteAccess())throw new ConnectorError('Reconnect Google Drive and approve file access before uploading.');
  if(!file||file.id!==args.versionId||typeof file.data!=='string'||file.data.length>Math.ceil(MAX_UPLOAD/3)*4||!Number.isSafeInteger(file.size)||file.size<=0||file.size>MAX_UPLOAD)throw new ConnectorError('Choose an available document version up to 5 MB.');
  if(typeof file.name!=='string'||!file.name.trim()||Buffer.byteLength(file.name)>256||/[\\/\x00-\x1f\x7f]/.test(file.name)||/^\.+$/.test(file.name)||typeof file.mime!=='string'||file.mime.length>128||!/^[\w.+-]+\/[\w.+-]+$/.test(file.mime)||file.mime.startsWith('application/vnd.google-apps.'))throw new ConnectorError('The document name or type cannot be uploaded.');
  const bytes=Buffer.from(file.data,'base64');if(bytes.length!==file.size||bytes.toString('base64')!==file.data)throw new ConnectorError('The saved document bytes could not be verified.');
  const combined=AbortSignal.any([signal,abortSignal,AbortSignal.timeout(30000)].filter(Boolean));combined.throwIfAborted();
  const folder=await request(`files/${args.folderId}`,{fields:FOLDER_FIELDS,supportsAllDrives:true},combined);checkFolder(folder);
  if(args.folderId!=='root'&&folder.id!==args.folderId)throw new ConnectorError('The destination folder identity changed. Choose it again.');
  const account=await request('about',{fields:'user(emailAddress)'},combined);
  if(typeof account.user?.emailAddress!=='string'||!account.user.emailAddress)throw new ConnectorError('The Google Drive account could not be identified for review.');
  const generated=await request('files/generateIds',{count:1,space:'drive',type:'files'},combined);
  if(!fileId.safeParse(generated.ids?.[0]).success)throw new ConnectorError('Google Drive could not reserve a new file ID. Try again.');
  combined.throwIfAborted();for(const [key,value]of reviews)if(value.expires<Date.now())reviews.delete(key);
  if(reviews.size>=5)throw new ConnectorError('Too many file reviews are pending. Reconnect Drive and try again.');
  const token=randomUUID(),metadata={id:generated.ids[0],name:file.name,mimeType:file.mime,parents:[folder.id]};
  reviews.set(token,{args:JSON.stringify(args),metadata,bytes,checksum:createHash('md5').update(bytes).digest('hex'),folder:fingerprint(folder),expires:Date.now()+600000});
  return {discard:()=>reviews.delete(token),question:'Upload this file to Google Drive?',approvalAction:'upload_file',arguments:{...args,reviewToken:token},detail:[`Account: ${line(account.user.emailAddress)}`,`File: ${file.name}\nVersion: ${file.number}\nSize: ${bytes.length<1024?bytes.length+' bytes':bytes.length<1024*1024?(bytes.length/1024).toFixed(1)+' KB':(bytes.length/(1024*1024)).toFixed(1)+' MB'}\nType: ${FILE_TYPES[file.mime]??'Document'}`,`Destination: ${line(folder.name)}\nhttps://drive.google.com/drive/folders/${folder.id}`,'Access follows the destination folder’s permissions, including inherited access. People with access to that folder may be able to access this file.','A new copy will be uploaded. Existing files and sharing settings will not be changed.'].join('\n\n')};
 }
 register('upload_file','Upload document to Google Drive','Upload an exact saved document version available in this chat (up to 5 MB), after native file/destination review. Use artifactId and versionId from create_document, read_document, revise_document or available document references. Supply a folderId from Drive search; root means My Drive. If the requested folder or document is ambiguous, ask which one. This uploads original bytes as a new file; it does not overwrite, share, or convert files. Never supply file paths, URLs or base64. Do not retry uncertain uploads automatically.',schema,async(input,_api,callSignal)=>{
  const {reviewToken:token,...args}=input,review=reviews.get(token);reviews.delete(token);
  if(!review||review.args!==JSON.stringify(args)||review.expires<Date.now())throw new ConnectorError('Review and approve this file upload before continuing.');
  const combined=AbortSignal.any([signal,callSignal,AbortSignal.timeout(60000)].filter(Boolean));combined.throwIfAborted();
  const folder=await request(`files/${review.metadata.parents[0]}`,{fields:FOLDER_FIELDS,supportsAllDrives:true},combined);checkFolder(folder);
  if(fingerprint(folder)!==review.folder)throw new ConnectorError('The destination changed after review. Select the folder and review the upload again.');
  const accessToken=await getToken(false);combined.throwIfAborted();
  const boundary='zq-'+randomUUID();
  const body=Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(review.metadata)}\r\n--${boundary}\r\nContent-Type: ${review.metadata.mimeType}\r\n\r\n`),review.bytes,Buffer.from(`\r\n--${boundary}--\r\n`)]);
  const safe=createSafeFetch({signal:combined,fetchImpl,maxBytes:128*1024,timeoutMs:45000,credentialOrigin:'https://www.googleapis.com'});
  let response;
  try{response=await safe('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,mimeType,size,md5Checksum,parents',{method:'POST',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':`multipart/related; boundary=${boundary}`},body})}catch{throw new ConnectorError(uncertain)}
  if(!response.ok){await response.body?.cancel();if(response.status===401||response.status===403)throw new ConnectorError('Google Drive denied the upload. Reconnect and approve access, or choose a writable folder.');throw new ConnectorError(uncertain)}
  let result;try{result=await response.json()}catch{throw new ConnectorError(uncertain)}
  if(result?.id!==review.metadata.id||result.name!==review.metadata.name||result.mimeType!==review.metadata.mimeType||String(result.size)!==String(review.bytes.length)||result.md5Checksum!==review.checksum||!Array.isArray(result.parents)||result.parents.length!==1||result.parents[0]!==folder.id)throw new ConnectorError(uncertain);
  const url=`https://drive.google.com/file/d/${result.id}/view`;
  return {content:[{type:'text',text:JSON.stringify({status:'uploaded',name:result.name,size:review.bytes.length,folder:folder.name,url})},{type:'resource_link',uri:url,name:result.name,mimeType:result.mimeType}]};
 },{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:true});
 return prepare;
}
module.exports={driveUpload,MAX_UPLOAD};
