// Real packaged document creation, OAuth/Keychain, MCP, chat and review UI. Network is a local fixture.
const {_electron:electron}=require('playwright-core');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),net=require('node:net'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const output=path.resolve('.local-data/drive-upload-verification');fs.mkdirSync(output,{recursive:true});const directory=fs.mkdtempSync(path.join(output,'profile-'));
let app,page,origin,authorization,uploads=[],nextId=0,target;
const unwrap=r=>{assert.equal(r.ok,true,JSON.stringify(r.error));return r.value};
const server=http.createServer(async(req,res)=>{try{
 const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks),url=new URL(req.url,origin),json=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data))};
 if(url.pathname==='/.well-known/oauth-authorization-server')return json({issuer:'https://accounts.google.com',authorization_endpoint:'https://accounts.google.com/o/oauth2/v2/auth',token_endpoint:'https://oauth2.googleapis.com/token',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],token_endpoint_auth_methods_supported:['client_secret_post'],code_challenge_methods_supported:['S256'],authorization_response_iss_parameter_supported:true});
 if(url.pathname==='/authorize'){authorization=url;const callback=new URL(url.searchParams.get('redirect_uri'));callback.searchParams.set('state',url.searchParams.get('state'));callback.searchParams.set('code','fixture-code');callback.searchParams.set('iss','https://accounts.google.com');assert.equal((await fetch(callback)).status,200);return json({ok:true})}
 if(url.pathname==='/token')return json({access_token:'fixture-drive-token',refresh_token:'fixture-refresh',token_type:'Bearer',expires_in:3600,scope:authorization.searchParams.get('scope')});
 if(url.pathname.startsWith('/drive/v3/')){
  assert.equal(req.method,'GET');assert.equal(req.headers.authorization,'Bearer fixture-drive-token');
  if(url.pathname.endsWith('/about'))return json({user:{permissionId:'fixture',emailAddress:'me@example.test'}});
  if(url.pathname.endsWith('/generateIds'))return json({ids:['fixtureFile'+(++nextId)]});
  if(url.pathname.endsWith('/files/folder1'))return json({id:'folder1',name:'Reports',mimeType:'application/vnd.google-apps.folder',version:'1',shared:true,trashed:false,capabilities:{canAddChildren:true}});
 }
 if(url.pathname==='/upload/drive/v3/files'){
  assert.equal(req.method,'POST');assert.equal(req.headers.authorization,'Bearer fixture-drive-token');assert.equal(url.searchParams.get('uploadType'),'multipart');
  const boundary=req.headers['content-type'].split('boundary=')[1];assert.ok(boundary);const metaStart=body.indexOf('\r\n\r\n')+4,metaEnd=body.indexOf('\r\n--'+boundary,metaStart);const metadata=JSON.parse(body.subarray(metaStart,metaEnd));assert.equal(metadata.name,'Drive report.docx');assert.deepEqual(metadata.parents,['folder1']);
  const fileStart=body.indexOf('\r\n\r\n',metaEnd+4)+4,fileEnd=body.lastIndexOf('\r\n--'+boundary+'--'),bytes=body.subarray(fileStart,fileEnd);assert.equal(bytes.subarray(0,2).toString(),'PK');uploads.push({metadata,bytes});
  return json({...metadata,size:String(bytes.length),md5Checksum:crypto.createHash('md5').update(bytes).digest('hex')});
 }
 if(url.pathname==='/api/show')return json({capabilities:['tools']});
 if(url.pathname==='/api/tags')return json({models:[{name:'fixture:tools',model:'fixture:tools',details:{family:'fixture'}}]});
 if(url.pathname==='/api/chat'){
  const data=JSON.parse(body),upload=data.tools?.find(t=>t.function.name.startsWith('mcp_'));assert.ok(upload);let message;
  if(data.messages.at(-1)?.role!=='tool')message={content:'',tool_calls:[{function:{index:0,name:'create_document',arguments:{format:'docx',title:'Drive report',content:'# Report\n\nSaved from this chat.'}}}]};
  else{const result=JSON.parse(data.messages.at(-1).content);assert.ok(!result.isError&&!result.error,JSON.stringify(result));if(result.artifactId){target={artifactId:result.artifactId,versionId:result.versionId};message={content:'',tool_calls:[{function:{index:0,name:upload.function.name,arguments:{...target,folderId:'folder1'}}}]}}else{assert.match(data.messages.at(-1).content,/uploaded/);message={content:'Your document is saved in Google Drive.'}}}
  res.writeHead(200,{'Content-Type':'application/x-ndjson'});return res.end(JSON.stringify({message:{role:'assistant',...message},done:false})+'\n'+JSON.stringify({done:true,done_reason:'stop'})+'\n');
 }
 throw Error('Unexpected fixture route '+url.pathname);
}catch(error){console.error(error);res.writeHead(500);res.end()}});
async function reply(id,predicate){const end=Date.now()+30000;while(Date.now()<end){const state=unwrap(await page.evaluate(()=>window.zq.chat.load()));const last=state.conversations.find(c=>c.id===id)?.messages.at(-1);if(last?.status==='error')throw Error(last.error);if(predicate(last))return last;await new Promise(r=>setTimeout(r,50))}throw Error('Expected chat state did not arrive')}
(async()=>{try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}`;
 app=await electron.launch({executablePath:process.env.ZQ_TEST_APP,env:{...process.env,ZQ_DATA_DIR:directory},timeout:30000});page=await app.firstWindow();await page.waitForFunction(()=>!!window.zq);
 await app.evaluate(({app,shell},origin)=>{const load=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/electron/main.cjs');const {ConnectorService}=load('./mcp/service.cjs'),connect=ConnectorService.prototype.connect;ConnectorService.prototype.connect=function(...args){this.fetchImpl=(raw,init)=>{const url=new URL(raw);if(!['accounts.google.com','oauth2.googleapis.com','www.googleapis.com'].includes(url.hostname))throw Error('Unexpected Google host');return fetch(origin+url.pathname+url.search,init)};return connect.apply(this,args)};shell.openExternal=async raw=>{const url=new URL(raw);if(url.origin+url.pathname!=='https://accounts.google.com/o/oauth2/v2/auth')throw Error('Unexpected sign-in URL');await fetch(origin+'/authorize'+url.search)}},origin);
 const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
 const rows=unwrap(await page.evaluate(port=>window.zq.connectors.save({name:'Google Drive',catalogId:'google-drive',url:'https://www.googleapis.com/drive/v3',authType:'oauth',clientId:'fixture-client',clientSecret:'fixture-secret',redirectHost:'127.0.0.1',redirectPort:port}),port)),connector=rows[0];
 unwrap(await page.evaluate(id=>window.zq.connectors.connect(id),connector.id));assert.ok(authorization.searchParams.get('scope').includes('/auth/drive.file'));unwrap(await page.evaluate(id=>window.zq.connectors.setTools({id,names:['upload_file']}),connector.id));
 const connection=unwrap(await page.evaluate(baseUrl=>window.zq.chat.saveConnection({provider:'ollama',name:'Fixture model',baseUrl}),origin));await page.getByRole('button',{name:'Chat module',exact:true}).click();
 for(const deny of [true,false]){
  const c=unwrap(await page.evaluate(connectionId=>window.zq.chat.createConversation({connectionId,model:'fixture:tools'}),connection.id));unwrap(await page.evaluate(id=>window.zq.chat.saveChatView({selected:id,projectId:null,projectHome:false,positions:{}}),c.id));
  unwrap(await page.evaluate(({conversationId,id})=>window.zq.chat.send({conversationId,text:'Create a report and upload it to Reports in Google Drive',connectorIds:[id]}),{conversationId:c.id,id:connector.id}));
  const waiting=await reply(c.id,r=>r?.interactions?.some(i=>i.status==='waiting')),card=waiting.interactions.find(i=>i.status==='waiting');assert.equal(card.onceOnly,true);assert.equal(card.approvalAction,'upload_file');assert.match(card.detail,/Reports/);assert.match(card.detail,/Drive report.docx/);assert.match(card.detail,/inherited/);assert.equal(uploads.length,0);
  const section=page.locator('.chat-interaction-approval').filter({has:page.getByRole('button',{name:'Upload file',exact:true})});await section.waitFor();assert.equal(await section.getByRole('button',{name:'Allow for this chat',exact:true}).count(),0);assert.equal(await section.getByRole('button',{name:'Send email',exact:true}).count(),0);
  if(deny){await section.getByRole('button',{name:'Deny',exact:true}).click();await reply(c.id,r=>r?.status==='stopped');assert.equal(uploads.length,0);continue}
  await section.screenshot({path:path.join(output,'upload-review.png')});await section.getByRole('button',{name:'Upload file',exact:true}).click();const done=await reply(c.id,r=>r?.status==='complete');assert.equal(uploads.length,1);assert.ok(done.sources.some(s=>s.url===`https://drive.google.com/file/d/${uploads[0].metadata.id}/view`));const original=unwrap(await page.evaluate(target=>window.zq.artifacts.document(target),target));assert.deepEqual(uploads[0].bytes,Buffer.from(original.data,'base64'));await page.getByRole('button',{name:'Allowed once',exact:true}).waitFor();
 }
 console.log('PASS packaged Drive: create document → reviewed upload, original bytes, chosen folder, denial, file link, and collapsed approval. No real cloud mutations.');
}finally{
 if(app){for(const row of unwrap(await page.evaluate(()=>window.zq.connectors.list())))unwrap(await page.evaluate(id=>window.zq.connectors.remove(id),row.id));await app.evaluate(({app})=>app.exit(0));await app.close()}
 server.closeAllConnections();await new Promise(r=>server.close(r));
}})().catch(error=>{console.error(error);process.exitCode=1});
