'use strict';
// Standard Calendar and Drive APIs exposed through local, in-memory MCP.
const {Client}=require('@modelcontextprotocol/client');
const {McpServer,InMemoryTransport}=require('@modelcontextprotocol/server');
const {z}=require('zod/v4');
const {ConnectorError,createSafeFetch,boundedJSON}=require('./security.cjs');
const read={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true};
const fileId=z.string().regex(/^[A-Za-z0-9_-]{1,256}$/);
const calendarId=z.string().min(1).max(1024).regex(/^[A-Za-z0-9_@.+-]+$/).default('primary');
const dateTime=z.string().datetime({offset:true});
const paging={pageSize:z.number().int().min(1).max(25).default(10),pageToken:z.string().max(2048).optional()};
const windowSchema={timeMin:dateTime,timeMax:dateTime};
const checkWindow=args=>{if(Date.parse(args.timeMin)>=Date.parse(args.timeMax))throw new ConnectorError('The end of the time window must be after its start.');};
const FILE_FIELDS='id,name,mimeType,size,modifiedTime,webViewLink,description';
async function createWorkspaceSession({catalogId,signal,fetchImpl=globalThis.fetch,getToken,calendarWriteAccess=()=>false,driveWriteAccess=()=>false}){
 const calendar=catalogId==='google-calendar';if(!calendar&&catalogId!=='google-drive')throw new ConnectorError('Unknown Google API connector.');
 const name=calendar?'Google Calendar':'Google Drive',base=calendar?'https://www.googleapis.com/calendar/v3/':'https://www.googleapis.com/drive/v3/';
 const controller=new AbortController(),server=new McpServer({name:`zQ ${name}`,version:'1.0.0'}),client=new Client({name:'zQ',version:'1.0.0'});let closing;
 const [ct,st]=InMemoryTransport.createLinkedPair();
 const close=()=>{if(closing)return closing;controller.abort();signal?.removeEventListener('abort',onAbort);return closing=Promise.allSettled([client.close(),server.close()]).then(()=>undefined)};
 const onAbort=()=>{void close()};signal?.throwIfAborted();signal?.addEventListener('abort',onAbort,{once:true});
 const request=async(route,params,signal,body,bytes=false,options={})=>{
  const url=new URL(route,base);if(!url.href.startsWith(base))throw new ConnectorError('Invalid Google API request.');
  for(const [key,value]of Object.entries(params??{}))if(value!==undefined)url.searchParams.set(key,String(value));
  const safe=createSafeFetch({signal,fetchImpl,timeoutMs:20000,maxBytes:1024*1024,allowedQueryParams:['pageToken'],credentialOrigin:'https://www.googleapis.com'});
  const mutation=!!options.method;
  for(let attempt=0;attempt<(mutation?1:2);attempt++){
   signal.throwIfAborted();const token=await getToken(attempt>0);signal.throwIfAborted();
   const response=await safe(url,{method:options.method??(body?'POST':'GET'),headers:{Authorization:`Bearer ${token}`,Accept:bytes?'*/*':'application/json',...(body?{'Content-Type':'application/json'}:{}),...options.headers},...(body?{body:boundedJSON(body,32000,'Calendar request')}:{})});
   if(response.status===401){await response.body?.cancel();if(!attempt&&!mutation)continue;throw new ConnectorError(`Reconnect ${name} to renew authorization.`)}
   if(!response.ok){let data;try{data=await response.json()}catch{}
    if(data?.error?.errors?.some(e=>e.reason==='accessNotConfigured')||data?.error?.details?.some(d=>d.reason==='SERVICE_DISABLED'))throw new ConnectorError(`Enable the ${calendar?'Google Calendar':'Google Drive'} API in your Google Cloud project, then reconnect.`);
    if(response.status===412)throw new ConnectorError('The event changed after review. Read the updated event and review it again before making changes.');
    if(mutation&&response.status>=500)throw new ConnectorError('The Calendar change could not be confirmed. Check Google Calendar before continuing. Do not retry automatically.');
    if(response.status===403)throw new ConnectorError(`Google denied access. Reconnect ${name} and approve the requested access. The item may also be outside this account's permissions.`);
    if(response.status===404)throw new ConnectorError('That item was not found or this account cannot access it.');
    if(response.status===429)throw new ConnectorError(`${name} is limiting requests. Try again shortly.`);
    throw new ConnectorError(`${name} could not complete the request. Try again later.`);
   }
   if(response.status===204)return null;
   return bytes?Buffer.from(await response.arrayBuffer()):response.json();
  }
 };
 const register=(tool,title,description,schema,execute,annotations=read)=>server.registerTool(tool,{title,description,inputSchema:schema.strict(),annotations},async(args,ctx)=>{
  const combined=AbortSignal.any([controller.signal,ctx.mcpReq.signal,AbortSignal.timeout(60000)]);
  try{const result=await execute(args,(route,params,body,bytes,options)=>request(route,params,combined,body,bytes,options),combined);combined.throwIfAborted();return result?.content?result:{content:[{type:'text',text:boundedJSON(result,90000,'Google API result')}]}}
  catch(error){return {isError:true,content:[{type:'text',text:!annotations.readOnlyHint&&(!(error instanceof ConnectorError)||combined.aborted)?`The ${calendar?'Calendar change':'upload'} could not be confirmed. Check ${name} before continuing. Do not retry automatically.`:combined.aborted?`${name} request cancelled or timed out.`:error instanceof ConnectorError?error.message:`${name} could not complete this request. Try a smaller result.`}]}}
 });
 let prepareCalendarAction,prepareDriveUpload;
 if(calendar){
  prepareCalendarAction=require('./calendar-actions.cjs').calendarActions({register,request,signal:controller.signal,calendarWriteAccess});
  register('list_calendars','List calendars','List calendars accessible to this account, including IDs, primary status, and time zones. Use the calendar time zone when constructing a day window.',z.object(paging),(args,api)=>api('users/me/calendarList',{maxResults:args.pageSize,pageToken:args.pageToken,fields:'nextPageToken,items(id,summary,timeZone,primary,accessRole)'}));
  const eventsSchema=z.object({calendarId,...windowSchema,...paging,query:z.string().max(2048).optional()});
  const events=(args,api)=>{checkWindow(args);return api(`calendars/${encodeURIComponent(args.calendarId)}/events`,{timeMin:args.timeMin,timeMax:args.timeMax,q:args.query,maxResults:args.pageSize,pageToken:args.pageToken,singleEvents:true,orderBy:'startTime',maxAttendees:10,fields:'summary,timeZone,nextPageToken,items(id,status,summary,description,location,start,end,htmlLink,organizer,attendees,attendeesOmitted,recurringEventId)'})};
  register('list_events','List calendar events','List events overlapping an explicit RFC3339 time window, with timezone offsets. Recurring events are expanded; all-day dates and the calendar time zone are preserved. For today, use midnight to next midnight in the calendar time zone.',eventsSchema,events);
  register('search_events','Search calendar events','Search event text within an explicit time window. Use query for keywords.',eventsSchema.extend({query:z.string().min(1).max(2048)}),events);
  register('get_event','Read calendar event','Read event details from a selected calendar.',z.object({calendarId,eventId:fileId}),(args,api)=>api(`calendars/${encodeURIComponent(args.calendarId)}/events/${args.eventId}`,{maxAttendees:25}));
  register('free_busy','Check calendar availability','Read busy intervals for up to ten calendars. This does not create or change events.',z.object({...windowSchema,calendarIds:z.array(calendarId).min(1).max(10)}),(args,api)=>{checkWindow(args);return api('freeBusy',undefined,{timeMin:args.timeMin,timeMax:args.timeMax,items:args.calendarIds.map(id=>({id}))})});
 }else{
  prepareDriveUpload=require('./drive-upload.cjs').driveUpload({register,request,signal:controller.signal,fetchImpl,getToken,driveWriteAccess});
  register('search_files','Search Google Drive','Find files by text using query (e.g. car registration). Optional q accepts native Drive search syntax instead. Searches file contents and names; excludes trashed files. Follow nextPageToken for additional results.',z.object({...paging,query:z.string().max(2048).optional(),q:z.string().max(4096).optional()}),(args,api)=>{
   const escaped=args.query?.replaceAll('\\','\\\\').replaceAll("'","\\'");const filter=args.q??(escaped?`fullText contains '${escaped}'`:'');
   return api('files',{q:'trashed = false'+(filter?` and ${args.q?'('+filter+')':filter}`:''),pageSize:args.pageSize,pageToken:args.pageToken,fields:`nextPageToken,incompleteSearch,files(${FILE_FIELDS})`,supportsAllDrives:true,includeItemsFromAllDrives:true});
  });
  register('get_file','Read Drive file details','Read file metadata and its original link.',z.object({fileId}),(args,api)=>api(`files/${args.fileId}`,{fields:FILE_FIELDS,supportsAllDrives:true}));
  register('read_file','Read Drive file','Read a small file. Google Docs and Slides export as text; Sheets export the first sheet as CSV. Text is returned for analysis; binary files are attached. Files above 1 MB should be opened through their original Drive link.',z.object({fileId}),async(args,api)=>{
   const file=await api(`files/${args.fileId}`,{fields:FILE_FIELDS,supportsAllDrives:true});
   const exports={'application/vnd.google-apps.document':'text/plain','application/vnd.google-apps.presentation':'text/plain','application/vnd.google-apps.spreadsheet':'text/csv'};
   const mime=exports[file.mimeType]??file.mimeType;
   if(file.mimeType?.startsWith('application/vnd.google-apps.')&&!exports[file.mimeType])throw new ConnectorError('Open this Google file through its Drive link; this file type cannot be read here.');
   if(Number(file.size)>1024*1024)throw new ConnectorError('This file is larger than 1 MB. Open it using its Drive link.');
   const bytes=exports[file.mimeType]?await api(`files/${args.fileId}/export`,{mimeType:mime},undefined,true):await api(`files/${args.fileId}`,{alt:'media',supportsAllDrives:true},undefined,true);
   if(mime?.startsWith('text/')||['application/json','application/xml'].includes(mime)){const text=bytes.toString('utf8');return {file,text:text.slice(0,18000),...(text.length>18000?{truncated:true}:{}),...(mime==='text/csv'?{note:'CSV export contains the first sheet only.'}:{})}}
   return {content:[{type:'text',text:JSON.stringify({file})},{type:'resource',resource:{uri:`zq-drive://file/${encodeURIComponent(file.name||args.fileId)}`,mimeType:mime||'application/octet-stream',blob:bytes.toString('base64')}}]};
  });
 }
 try{await server.connect(st);await client.connect(ct,{signal:controller.signal,timeout:5000});return {client,close,prepareCalendarAction,prepareDriveUpload,verifyAccess:()=>request(calendar?'users/me/calendarList':'about',calendar?{maxResults:1,fields:'items(id)'}:{fields:'user(permissionId)'},controller.signal)}}catch(error){await close();throw error}
}
module.exports={createWorkspaceSession};
