// Real packaged app, native Keychain, MCP handshake and window lifecycle.
// Only the remote service is a local fixture; the normal workspace is never opened.
const {_electron:electron}=require('playwright-core');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'zq-reconnect-packaged-'));
let app,page,origin,opens=0,refreshes=0,rejectAccess=false;
const unwrap=r=>{assert.equal(r.ok,true,JSON.stringify(r.error));return r.value};
const server=http.createServer(async(req,res)=>{try{
 let bytes='';for await(const chunk of req)bytes+=chunk;
 const url=new URL(req.url,origin),json=(body,status=200,headers={})=>{res.writeHead(status,{'Content-Type':'application/json',...headers});res.end(JSON.stringify(body))};
 if(url.pathname.startsWith('/.well-known/oauth-protected-resource'))return json({resource:origin+'/mcp',authorization_servers:[origin]});
 if(url.pathname==='/.well-known/oauth-authorization-server')return json({issuer:origin,authorization_endpoint:origin+'/authorize',token_endpoint:origin+'/token',registration_endpoint:origin+'/register',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],token_endpoint_auth_methods_supported:['none'],code_challenge_methods_supported:['S256'],authorization_response_iss_parameter_supported:true});
 if(url.pathname==='/register')return json({...JSON.parse(bytes),client_id:'fixture-public'},201);
 if(url.pathname==='/authorize'){opens++;const callback=new URL(url.searchParams.get('redirect_uri'));callback.searchParams.set('state',url.searchParams.get('state'));callback.searchParams.set('code','fixture-code');callback.searchParams.set('iss',origin);assert.equal((await fetch(callback)).status,200);return json({ok:true})}
 if(url.pathname==='/token'){if(new URLSearchParams(bytes).get('grant_type')==='refresh_token')refreshes++;rejectAccess=false;return json({access_token:'fixture-access',refresh_token:'fixture-refresh',token_type:'Bearer',expires_in:3600})}
 if(url.pathname==='/mcp'){
  if(rejectAccess||req.headers.authorization!=='Bearer fixture-access')return json({},401,{'WWW-Authenticate':`Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`});
  if(req.method!=='POST'){res.writeHead(405);return res.end()}
  const message=JSON.parse(bytes);if(!('id'in message)){res.writeHead(202);return res.end()}
  const result=message.method==='initialize'?{protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'Relaunch fixture',version:'1'}}:message.method==='tools/list'?{tools:[{name:'echo',description:'Read fixture data',inputSchema:{type:'object'},annotations:{readOnlyHint:true}}]}:{content:[{type:'text',text:'Connected after restart'}]};
  return json({jsonrpc:'2.0',id:message.id,result});
 }
 res.writeHead(404);res.end();
}catch(error){console.error(error);res.writeHead(500);res.end()}});
async function launch(){app=await electron.launch({executablePath:process.env.ZQ_TEST_APP,env:{...process.env,ZQ_DATA_DIR:directory},timeout:30000});page=await app.firstWindow();await page.waitForFunction(()=>!!window.zq)}
async function quit(){const closed=app.waitForEvent('close',{timeout:20000});await app.evaluate(({app})=>{setTimeout(()=>app.quit(),0)});await closed;app=undefined}
(async()=>{try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}`;await launch();
 await app.evaluate(({shell},origin)=>{shell.openExternal=async url=>{if(!url.startsWith(origin+'/authorize?'))throw Error('Unexpected browser destination');await fetch(url)}},origin);
 let rows=unwrap(await page.evaluate(url=>window.zq.connectors.save({name:'Remembered research',url}),origin+'/mcp'));const active=rows[0].id;
 unwrap(await page.evaluate(id=>window.zq.connectors.connect(id),active));unwrap(await page.evaluate(id=>window.zq.connectors.setTools({id,names:['echo']}),active));
 rows=unwrap(await page.evaluate(url=>window.zq.connectors.save({name:'Deliberately off',url}),origin+'/mcp'));const off=rows[1].id;
 unwrap(await page.evaluate(id=>window.zq.connectors.connect(id),off));unwrap(await page.evaluate(id=>window.zq.connectors.disconnect(id),off));assert.equal(opens,2);
 const revision=unwrap(await page.evaluate(()=>window.zq.connectors.list()))[0].revision;
 await quit();const saved=JSON.parse(fs.readFileSync(path.join(directory,'mcp-connectors.json')));assert.equal(saved.connectors[0].autoConnect,true);assert.equal(saved.connectors[1].autoConnect,false);
 rejectAccess=true;await launch();
 const deadline=Date.now()+20000;while(true){const row=unwrap(await page.evaluate(()=>window.zq.connectors.list())).find(row=>row.id===active);if(row.status==='connected')break;if(row.status==='error'||Date.now()>deadline)throw Error(row.error??'Background reconnect timed out');await new Promise(resolve=>setTimeout(resolve,50))}
 rows=unwrap(await page.evaluate(()=>window.zq.connectors.list()));assert.equal(rows[0].revision,revision);assert.equal(rows[0].tools[0].enabled,true);assert.equal(rows[1].status,'disconnected');assert.equal(opens,2);assert.equal(refreshes,1);
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Connectors',exact:true}).click();
 const row=page.locator(`[data-connector-id="${active}"]`);await row.getByText('Connected · 1 tool enabled',{exact:true}).waitFor();
 await row.getByRole('button',{name:'Actions for connector Remembered research',exact:true}).click();await page.getByRole('menuitem',{name:'Disconnect',exact:true}).click();await row.getByText('Disconnected',{exact:true}).waitFor();
 await quit();await launch();rows=unwrap(await page.evaluate(()=>window.zq.connectors.list()));assert.ok(rows.every(row=>row.status==='disconnected'&&!row.autoConnect));assert.equal(opens,2);
 console.log('PASS packaged relaunch: silent OAuth refresh, saved tool selection, explicit disconnect persists, native quit preserves intent.');
}finally{
 if(app){for(const row of unwrap(await page.evaluate(()=>window.zq.connectors.list())))unwrap(await page.evaluate(id=>window.zq.connectors.remove(id),row.id));await quit()}
 server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(directory,{recursive:true,force:true});
}})().catch(error=>{console.error(error);process.exitCode=1});
