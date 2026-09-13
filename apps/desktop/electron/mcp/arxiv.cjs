'use strict';
const {Client}=require('@modelcontextprotocol/client');
const {McpServer,InMemoryTransport}=require('@modelcontextprotocol/server');
const {z}=require('zod/v4');
const sax=require('sax');

// arXiv API manual: https://info.arxiv.org/help/api/user-manual.html
// This bundled server retrieves public metadata; it never downloads paper PDFs.
const API='https://export.arxiv.org/api/query';
const ATOM='http://www.w3.org/2005/Atom',OPEN_SEARCH='http://a9.com/-/spec/opensearch/1.1/';
const MAX_RESPONSE=1024*1024,REQUEST_TIMEOUT=20000;
const PAPER_ID=/^(?:\d{2}(?:0[1-9]|1[0-2])\.\d{4,5}|[a-z]+(?:-[a-z]+)*(?:\.[A-Z]{2})?\/\d{2}(?:0[1-9]|1[0-2])\d{3})(?:v[1-9]\d{0,3})?$/;
const annotations={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true};
let requestTail=Promise.resolve(),nextRequestAt=0,pendingRequests=0;
class ArxivError extends Error{}
const invalidFeed=()=>new ArxivError('arXiv returned invalid or excessive metadata. Try a smaller query.');

function abortable(promise,signal,onAbort=()=>{}){
 signal.throwIfAborted();
 return new Promise((resolve,reject)=>{
  const abort=()=>{onAbort();finish(signal.reason??Error('arXiv request cancelled.'))};
  const finish=(error,value)=>{signal.removeEventListener('abort',abort);error?reject(error):resolve(value)};
  signal.addEventListener('abort',abort,{once:true});
  Promise.resolve(promise).then(value=>finish(null,value),error=>finish(error));
  if(signal.aborted)abort();
 });
}
function wait(ms,signal){
 if(ms<=0){signal.throwIfAborted();return Promise.resolve()}
 let timer;return abortable(new Promise(resolve=>{timer=setTimeout(resolve,ms)}),signal,()=>clearTimeout(timer));
}
function rateLimited(fn,signal){
 signal.throwIfAborted();
 if(pendingRequests>=32)throw new ArxivError('arXiv has too many queued requests. Try again after the current requests finish.');
 pendingRequests++;
 const work=requestTail.then(async()=>{
  signal.throwIfAborted();await wait(nextRequestAt-Date.now(),signal);signal.throwIfAborted();
  nextRequestAt=Date.now()+3000;
  return fn();
 });
 requestTail=work.then(()=>{pendingRequests--},()=>{pendingRequests--});
 return abortable(work,signal);
}
function paperIdFromURL(value){
 let url;try{url=new URL(value)}catch{throw invalidFeed()}
 if(!['http:','https:'].includes(url.protocol)||url.hostname!=='arxiv.org'||url.port||url.username||url.password||url.search||url.hash||!url.pathname.startsWith('/abs/'))throw invalidFeed();
 const id=url.pathname.slice(5);if(!PAPER_ID.test(id))throw invalidFeed();return id;
}
function parseFeed(xml,maxResults){
 if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw invalidFeed();
 const parser=sax.parser(true,{xmlns:true,strictEntities:true});
 const stack=[],papers=[];let entry=null,nodes=0,root=false,totalResults;
 const normalize=value=>value.replace(/\s+/g,' ').trim();
 parser.ondoctype=()=>{throw invalidFeed()};
 parser.onerror=()=>{throw invalidFeed()};
 parser.onopentag=node=>{
  if(++nodes>10000||stack.length>=16)throw invalidFeed();
  if(!stack.length){if(root||node.uri!==ATOM||node.local!=='feed')throw invalidFeed();root=true}
  const frame={local:node.local,uri:node.uri,text:''};
  if(stack.length===1&&node.uri===ATOM&&node.local==='entry'){
   if(papers.length>=maxResults||entry)throw invalidFeed();
   entry={authors:[],categories:[]};
  }
  if(entry&&stack.length===2&&node.uri===ATOM&&node.local==='category'){
   const term=node.attributes.term?.value;
   if(typeof term!=='string'||!term||term.length>100||entry.categories.length>=100)throw invalidFeed();
   entry.categories.push(term);
  }
  stack.push(frame);
 };
 const addText=value=>{const frame=stack.at(-1);if(frame){frame.text+=value;if(frame.text.length>60000)throw invalidFeed()}};
 parser.ontext=addText;parser.oncdata=addText;
 parser.onclosetag=()=>{
  const frame=stack.pop(),value=normalize(frame.text);
  if(stack.length===1&&frame.uri===OPEN_SEARCH&&frame.local==='totalResults'){
   if(!/^\d{1,10}$/.test(value)||!Number.isSafeInteger(Number(value)))throw invalidFeed();totalResults=Number(value);
  }
  if(!entry)return;
  if(stack.length===2&&frame.uri===ATOM&&['id','title','summary','published','updated'].includes(frame.local)){
   if(entry[frame.local]!==undefined)throw invalidFeed();entry[frame.local]=value;
  }
  if(stack.length===3&&frame.uri===ATOM&&frame.local==='name'&&stack.at(-1).uri===ATOM&&stack.at(-1).local==='author'){
   if(!value||value.length>512||entry.authors.length>=1000)throw invalidFeed();entry.authors.push(value);
  }
  if(stack.length===1&&frame.uri===ATOM&&frame.local==='entry'){
   const id=paperIdFromURL(entry.id);
   if(!entry.title||!entry.summary||!entry.authors.length||!entry.published||!entry.updated||!Number.isFinite(Date.parse(entry.published))||!Number.isFinite(Date.parse(entry.updated))||papers.some(p=>p.id===id))throw invalidFeed();
   papers.push({id,title:entry.title,abstract:entry.summary,authors:entry.authors,categories:[...new Set(entry.categories)],published:entry.published,updated:entry.updated,abstractUrl:`https://arxiv.org/abs/${id}`,pdfUrl:`https://arxiv.org/pdf/${id}`});
   entry=null;
  }
 };
 try{parser.write(xml).close()}catch{throw invalidFeed()}
 if(!root||entry||stack.length)throw invalidFeed();
 return {papers,...(totalResults!==undefined?{totalResults}:{})};
}
async function fetchMetadata(url,{signal,fetchImpl,maxResults}){
 const response=await abortable(Promise.resolve().then(()=>fetchImpl(url,{method:'GET',redirect:'error',credentials:'omit',headers:{Accept:'application/atom+xml','User-Agent':'zQ/0.1 (arXiv metadata connector)'},signal})),signal);
 if(!response.ok){void response.body?.cancel().catch(()=>{});throw new ArxivError(response.status===429?'arXiv is rate limiting requests. Try again later.':'arXiv is temporarily unavailable. Try again later.')}
 const length=response.headers.get('content-length');
 if(length!==null&&(!/^\d+$/.test(length)||Number(length)>MAX_RESPONSE)){void response.body?.cancel().catch(()=>{});throw invalidFeed()}
 if(!response.body)throw invalidFeed();
 const reader=response.body.getReader(),chunks=[];let bytes=0;
 try{
  while(true){
   const {done,value}=await abortable(reader.read(),signal,()=>{void reader.cancel().catch(()=>{})});
   if(done)break;bytes+=value.byteLength;if(bytes>MAX_RESPONSE)throw invalidFeed();chunks.push(value);
  }
  signal.throwIfAborted();
  const xml=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
  return parseFeed(xml,maxResults);
 }finally{void reader.cancel().catch(()=>{});try{reader.releaseLock()}catch{}}
}
function toolResult(output){
 const content=[{type:'text',text:JSON.stringify({...output,note:'Metadata and abstracts only. PDF links are provided; full paper text has not been retrieved.'})}];
 for(const paper of output.papers){
  content.push({type:'resource_link',uri:paper.abstractUrl,name:`${paper.id} abstract`,title:Array.from(paper.title).slice(0,250).join(''),mimeType:'text/html'});
  content.push({type:'resource_link',uri:paper.pdfUrl,name:`${paper.id} PDF`,title:Array.from(paper.title).slice(0,250).join(''),mimeType:'application/pdf'});
 }
 if(Buffer.byteLength(JSON.stringify(content))>90000)throw invalidFeed();
 return {content};
}
async function createArxivSession({signal,fetchImpl=globalThis.fetch}={}){
 signal?.throwIfAborted();
 const controller=new AbortController(),server=new McpServer({name:'zQ arXiv',version:'1.0.0'}),client=new Client({name:'zQ',version:'1.0.0'});
 const [clientTransport,serverTransport]=InMemoryTransport.createLinkedPair();let closing;
 const close=()=>{
  if(closing)return closing;
  controller.abort();signal?.removeEventListener('abort',onAbort);
  closing=Promise.allSettled([client.close(),server.close()]).then(()=>undefined);return closing;
 };
 const onAbort=()=>{void close()};signal?.addEventListener('abort',onAbort,{once:true});
 const execute=async(params,context)=>{
  const timeout=new AbortController(),timer=setTimeout(()=>timeout.abort(),REQUEST_TIMEOUT);
  const combined=AbortSignal.any([controller.signal,context.mcpReq.signal,timeout.signal]);
  try{
   combined.throwIfAborted();
   const url=new URL(API);for(const [key,value] of Object.entries(params))url.searchParams.set(key,String(value));
   const output=await rateLimited(()=>fetchMetadata(url,{signal:combined,fetchImpl,maxResults:Number(params.max_results)}),combined);
   combined.throwIfAborted();
   if(params.id_list){
    if(!output.papers.length)throw new ArxivError('No arXiv paper was found for that identifier.');
    const actual=output.papers[0].id,requested=params.id_list;
    if(/v\d+$/.test(requested)?actual!==requested:actual.replace(/v\d+$/,'')!==requested)throw invalidFeed();
   }
   return toolResult(output);
  }catch(error){
   const message=controller.signal.aborted||context.mcpReq.signal.aborted?'arXiv request cancelled.':timeout.signal.aborted?'arXiv request timed out. Try again later.':error instanceof ArxivError?error.message:'arXiv metadata could not be retrieved. Try again later.';
   return {isError:true,content:[{type:'text',text:message}]};
  }finally{clearTimeout(timer)}
 };
 server.registerTool('search_papers',{
  title:'Search arXiv papers',description:'Search public arXiv paper metadata and abstracts. Uses arXiv query syntax, for example all:quantum AND ti:gravity. Returns official abstract and PDF links, not full paper text. Up to ten results per page.',annotations,
  inputSchema:z.object({query:z.string().trim().min(1).max(1024).regex(/^[^\x00-\x1f\x7f]+$/),maxResults:z.number().int().min(1).max(10).default(5),start:z.number().int().min(0).max(29990).default(0)}).strict(),
 },(args,context)=>execute({search_query:args.query,max_results:args.maxResults,start:args.start},context));
 server.registerTool('get_paper',{
  title:'Get arXiv paper metadata',description:'Get metadata and the abstract for one arXiv identifier, such as 2401.12345v2 or hep-th/9901001. Returns official abstract and PDF links; does not read the full paper.',annotations,
  inputSchema:z.object({id:z.string().max(80).regex(PAPER_ID)}).strict(),
 },(args,context)=>execute({id_list:args.id,max_results:1},context));
 try{await server.connect(serverTransport);await client.connect(clientTransport,{signal:controller.signal,timeout:5000});signal?.throwIfAborted();return {client,close}}
 catch(error){await close();throw error}
}
module.exports={createArxivSession};
