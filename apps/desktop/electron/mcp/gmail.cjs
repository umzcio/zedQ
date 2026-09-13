'use strict';
// Standard Gmail REST API, exposed through a bundled, in-memory MCP server.
// https://developers.google.com/workspace/gmail/api/reference/rest
const {randomUUID,createHash}=require('node:crypto');
const {Client}=require('@modelcontextprotocol/client');
const {McpServer,InMemoryTransport}=require('@modelcontextprotocol/server');
const {z}=require('zod/v4');
const {ConnectorError,createSafeFetch,boundedJSON}=require('./security.cjs');
const API='https://gmail.googleapis.com/gmail/v1/users/me/';
const id=z.string().regex(/^[A-Za-z0-9_-]{1,256}$/);
const page={pageSize:z.number().int().min(1).max(10).default(5),pageToken:z.string().max(2048).optional()};
const query=z.string().max(2048).optional();
const format=z.enum(['PLAIN_TEXT','METADATA_ONLY','MINIMAL','FULL_CONTENT']).default('PLAIN_TEXT');
const read={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true};
const short=(value,max=2000)=>typeof value==='string'?value.slice(0,max):undefined;
function messageSummary(message,body=false,bodyLimit=16000){
 const headers=message.payload?.headers??[],header=name=>short(headers.find(h=>h.name?.toLowerCase()===name)?.value,512);
 const result={id:message.id,threadId:message.threadId,snippet:short(message.snippet,512),subject:header('subject'),from:header('from'),to:header('to'),cc:header('cc'),date:header('date'),labelIds:message.labelIds?.slice(0,20).map(label=>short(label,128))};
 if(body){
  const plain=[],html=[],attachments=[];let visited=0;
  const visit=(part,depth=0)=>{if(!part||depth>16||++visited>300)return;
   if(part.filename){attachments.push({filename:short(part.filename,128),mimeType:short(part.mimeType,128),size:part.body?.size});return}
   if(part.body?.data&&['text/plain','text/html'].includes(part.mimeType)){
    const text=Buffer.from(part.body.data,'base64url').toString('utf8');(part.mimeType==='text/plain'?plain:html).push(text);
   }
   for(const child of part.parts??[])visit(child,depth+1);
  };visit(message.payload);
  const text=(plain.length?plain:html).join('\n');result[plain.length?'body':'htmlBody']=text.slice(0,bodyLimit);if(text.length>bodyLimit)result.bodyTruncated=true;
  if(attachments.length)result.attachments=attachments.slice(0,5);if(attachments.length>5)result.attachmentsTruncated=true;
 }
 return result;
}
function mimeDraft(args,reply){
 const header=(name,value)=>value?`${name}: ${value}\r\n`:'';
 const subject=args.subject??(reply?.payload?.headers??[]).find(h=>h.name?.toLowerCase()==='subject')?.value??'';
 let mime=header('To',args.to?.join(', '))+header('Cc',args.cc?.join(', '))+header('Bcc',args.bcc?.join(', '))+header('Subject',`=?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`);
 if(reply){const msgId=reply.payload?.headers?.find(h=>h.name?.toLowerCase()==='message-id')?.value;if(typeof msgId!=='string'||/[\r\n]/.test(msgId))throw new ConnectorError('The original message has no usable reply header. Create a new draft instead.');mime+=header('In-Reply-To',msgId)+header('References',msgId)}
 mime+='MIME-Version: 1.0\r\n'+`Content-Type: ${args.htmlBody!==undefined?'text/html':'text/plain'}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n`;
 mime+=Buffer.from(args.htmlBody??args.body??'').toString('base64').match(/.{1,76}/g)?.join('\r\n')??'';
 return {message:{raw:Buffer.from(mime).toString('base64url'),...(reply?.threadId?{threadId:reply.threadId}:{})}};
}
async function createGmailSession({signal,fetchImpl=globalThis.fetch,getToken}={}){
 signal?.throwIfAborted();const controller=new AbortController(),server=new McpServer({name:'zQ Gmail',version:'1.0.0'}),client=new Client({name:'zQ',version:'1.0.0'});
 const [clientTransport,serverTransport]=InMemoryTransport.createLinkedPair();let closing;const reviews=new Map();
 const close=()=>{if(closing)return closing;reviews.clear();controller.abort();signal?.removeEventListener('abort',onAbort);closing=Promise.allSettled([client.close(),server.close()]).then(()=>undefined);return closing};
 const onAbort=()=>{void close()};signal?.addEventListener('abort',onAbort,{once:true});
 const request=async(route,params,signal,body)=>{
  const url=new URL(route,API);if(!url.href.startsWith(API))throw new ConnectorError('Invalid Gmail request.');
  for(const [key,value]of Object.entries(params??{}))if(value!==undefined)url.searchParams.set(key,String(value));
  const safeFetch=createSafeFetch({signal,fetchImpl,timeoutMs:20000,maxBytes:2*1024*1024,allowedQueryParams:['pageToken'],credentialOrigin:'https://gmail.googleapis.com'});
  for(let attempt=0;attempt<2;attempt++){
   signal.throwIfAborted();const token=await getToken(attempt>0);signal.throwIfAborted();
   const response=await safeFetch(url,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:boundedJSON(body,128*1024,'Gmail draft')}:{})});
   if(response.status===401){await response.body?.cancel();if(!attempt)continue;throw new ConnectorError('Gmail authorization expired. Reconnect Gmail to sign in.')}
   if(!response.ok){
    let data;try{data=await response.json()}catch{}
    const reason=data?.error?.errors?.[0]?.reason;
    if(response.status===403&&['accessNotConfigured','serviceDisabled'].includes(reason)||data?.error?.details?.some(d=>d.reason==='SERVICE_DISABLED'))throw new ConnectorError('Enable the Gmail API in your Google Cloud project, then reconnect Gmail.');
    if(response.status===403)throw new ConnectorError('Google denied Gmail access. Reconnect and approve mail access; check the OAuth app and account settings.');
    if(response.status===404)throw new ConnectorError('That Gmail message, thread, or draft no longer exists.');
    if(response.status===429)throw new ConnectorError('Gmail is limiting requests. Try again shortly.');
    throw new ConnectorError(route==='drafts/send'?'Gmail could not confirm sending. Check Sent before trying again; do not resend automatically.':body?'Gmail could not confirm the draft was created. Check Drafts before retrying to avoid duplicates.':'Gmail could not complete the request. Try again later.');
   }
   return response.json();
  }
 };
 const register=(name,title,description,inputSchema,execute,annotations=read)=>server.registerTool(name,{title,description,inputSchema:inputSchema.strict(),annotations},async(args,context)=>{
  const combined=AbortSignal.any([controller.signal,context.mcpReq.signal,AbortSignal.timeout(60000)]);
  try{const result=await execute(args,(route,params,body)=>request(route,params,combined,body));combined.throwIfAborted();return {content:[{type:'text',text:boundedJSON(result,90000,'Gmail result')}]} }
  catch(error){return {isError:true,content:[{type:'text',text:name==='send_draft'&&combined.aborted?'Sending was interrupted. Check Sent before trying again; do not resend automatically.':combined.aborted?'Gmail request cancelled or timed out.':error instanceof ConnectorError?error.message:name==='send_draft'?'Gmail could not confirm sending. Check Sent before trying again; do not resend automatically.':name==='create_draft'?'Gmail could not confirm the draft was created. Check Drafts before retrying to avoid duplicates.':'Gmail could not complete the request. Try again later.'}]}}
 });
 const thread=async(api,threadId,body,limit=10)=>{const data=await api(`threads/${id.parse(threadId)}`,{format:body?'full':'metadata'});const messages=data.messages??[],selected=messages.slice(-limit),bodyLimit=Math.min(16000,Math.floor(16000/Math.max(1,selected.length)));return {id:data.id,messages:selected.map(m=>messageSummary(m,body,bodyLimit)),...(messages.length>limit?{messagesTruncated:true,totalMessages:messages.length}:{})}};
 register('search_threads','Search Gmail','Search mail using Gmail search syntax. Returns the latest message metadata for each matching thread and a nextPageToken when there are more results. Read matching threads with get_thread. Up to ten results per page.',z.object({query,...page,includeTrash:z.boolean().default(false),view:z.enum(['THREAD_VIEW_UNSPECIFIED','THREAD_VIEW_METADATA_ONLY','THREAD_VIEW_MINIMAL']).optional()}),async(args,api)=>{
  const data=await api('threads',{q:args.query,maxResults:args.pageSize,pageToken:args.pageToken,includeSpamTrash:args.includeTrash});const threads=[];
  for(const item of (data.threads??[]).slice(0,args.pageSize))threads.push(await thread(api,item.id,false,1));
  return {threads,nextPageToken:data.nextPageToken,resultSizeEstimate:data.resultSizeEstimate};
 });
 register('get_thread','Read Gmail thread','Read a mail conversation. Returns decoded message text and attachment metadata. Long bodies and conversations are marked as truncated.',z.object({threadId:id,messageFormat:format}),async(args,api)=>thread(api,args.threadId,!['METADATA_ONLY','MINIMAL'].includes(args.messageFormat)));
 register('get_message','Read Gmail message','Read one message and decode its body. Attachments are listed but not downloaded.',z.object({messageId:id,messageFormat:format}),async(args,api)=>messageSummary(await api(`messages/${args.messageId}`,{format:['METADATA_ONLY','MINIMAL'].includes(args.messageFormat)?'metadata':'full'}),!['METADATA_ONLY','MINIMAL'].includes(args.messageFormat)));
 register('list_labels','List Gmail labels','List mailbox labels and their IDs.',z.object({}),(_,api)=>api('labels'));
 register('list_drafts','List Gmail drafts','List draft IDs and message IDs, with pagination. Use get_draft to read a draft.',z.object({...page,query}), (args,api)=>api('drafts',{q:args.query,maxResults:args.pageSize,pageToken:args.pageToken}));
 register('get_draft','Read Gmail draft','Read one saved draft.',z.object({draftId:id}),async(args,api)=>{const draft=await api(`drafts/${args.draftId}`,{format:'full'});return {id:draft.id,message:messageSummary(draft.message??{},true)}});
 const addresses=z.array(z.string().email().max(254).regex(/^[^\r\n]+$/)).max(50).optional();
 register('create_draft','Create Gmail draft','Create a draft for review. Use send_draft when the user asks to send it. This never sends mail. Supply plain text body or htmlBody. Optional replyToMessageId creates a threaded reply draft.',z.object({to:addresses,cc:addresses,bcc:addresses,subject:z.string().max(500).optional(),body:z.string().max(40000).optional(),htmlBody:z.string().max(40000).optional(),replyToMessageId:id.optional()}),async(args,api)=>{
  const reply=args.replyToMessageId?await api(`messages/${args.replyToMessageId}`,{format:'metadata'}):undefined;
  return api('drafts',undefined,mimeDraft(args,reply));
 },{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:true});
 const fingerprint=raw=>createHash('sha256').update(raw).digest('hex');
 const prepareSend=async(draftId,signal)=>{
  id.parse(draftId);const combined=AbortSignal.any([controller.signal,signal,AbortSignal.timeout(60000)].filter(Boolean));
  const draft=await request(`drafts/${draftId}`,{format:'full'},combined),encoded=await request(`drafts/${draftId}`,{format:'raw'},combined);
  if(!draft.message?.id||draft.message.id!==encoded.message?.id||typeof encoded.message.raw!=='string')throw new ConnectorError('The draft changed while loading. Review it again before sending.');
  const raw=encoded.message.raw;if(raw.length>100000)throw new ConnectorError('This draft is too large to send from zQ. Review and send it in Gmail.');
  const summary=messageSummary(draft.message,true,48000),headers=draft.message.payload?.headers??[];
  const recipients=['To','Cc','Bcc'].map(name=>`${name}: ${headers.filter(h=>h.name?.toLowerCase()===name.toLowerCase()).map(h=>h.value).join(', ')}`).join('\n');
  if(summary.bodyTruncated||summary.attachmentsTruncated)throw new ConnectorError('This draft is too large to preview fully. Review and send it in Gmail.');
  const html=[];let visited=0;const visit=part=>{if(!part||++visited>300)return;if(!part.filename&&part.mimeType==='text/html'&&part.body?.data)html.push(Buffer.from(part.body.data,'base64url').toString('utf8'));for(const child of part.parts??[])visit(child)};visit(draft.message.payload);
  const htmlPreview=html.length?'\n\nHTML source:\n'+html.join('\n'):'';
  const detail=`${recipients}\nSubject: ${headers.find(h=>h.name?.toLowerCase()==='subject')?.value??'(no subject)'}\n\n${summary.body??''}${htmlPreview}${summary.attachments?.length?'\n\nAttachments: '+summary.attachments.map(a=>a.filename).join(', '):''}`;
  if(Buffer.byteLength(detail)>60000)throw new ConnectorError('This draft is too large to preview fully. Review and send it in Gmail.');
  for(const [key,value]of reviews)if(value.expires<Date.now())reviews.delete(key);
  if(reviews.size>=30)throw new ConnectorError('Too many draft reviews are pending. Reconnect Gmail and try again.');
  const reviewToken=randomUUID();reviews.set(reviewToken,{draftId,raw,hash:fingerprint(raw),expires:Date.now()+10*60*1000});
  return {detail,arguments:{draftId,reviewToken}};
 };
 register('send_draft','Send Gmail draft','Send an existing Gmail draft when the user asks to send it. zQ shows the actual recipients and message for approval before sending. Supply draftId from create_draft or list_drafts. Never automatically retry an uncertain send.',z.object({draftId:id,reviewToken:z.string().uuid().optional().describe('Managed by zQ; omit this field.')}),async(args,api)=>{
  const review=reviews.get(args.reviewToken);reviews.delete(args.reviewToken);
  if(!review||review.draftId!==args.draftId||review.expires<Date.now())throw new ConnectorError('Review and approve this draft before sending.');
  const current=await api(`drafts/${args.draftId}`,{format:'raw'});
  if(typeof current.message?.raw!=='string'||fingerprint(current.message.raw)!==review.hash)throw new ConnectorError('The draft changed after review. Review the updated draft before sending.');
  // Pass the approved MIME as well as the ID, so a concurrent Gmail edit cannot
  // substitute different recipients or content between the check and the send.
  return api('drafts/send',undefined,{id:args.draftId,message:{raw:review.raw}});
 },{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:true});
 try{await server.connect(serverTransport);await client.connect(clientTransport,{signal:controller.signal,timeout:5000});signal?.throwIfAborted();return {client,close,prepareSend,verifyAccess:async()=>{const profile=await request('profile',undefined,controller.signal);if(typeof profile.emailAddress!=='string')throw new ConnectorError('Gmail account access could not be verified. Reconnect Gmail.')}}}
 catch(error){await close();throw error}
}
module.exports={createGmailSession};
