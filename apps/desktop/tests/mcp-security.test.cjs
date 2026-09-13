const test=require('node:test');const assert=require('node:assert/strict');const http=require('node:http');
const {SecretStore,createSafeFetch}=require('../electron/mcp/security.cjs');
test('chunked Keychain storage roundtrips large Unicode credentials and replaces/deletes all chunks',async()=>{
 const entries=new Map();let fail=false;const credentials={get:async k=>entries.get(k),set:async(k,v)=>{assert.match(v,/^[\x21-\x7e]{1,8192}$/);if(fail&&k.endsWith('-1'))throw Error('denied');entries.set(k,v)},delete:async k=>entries.delete(k)};const store=new SecretStore(credentials,'fixture');const value={token:'private🔥'.repeat(2000)};await store.set('tokens',value);assert.deepEqual(await store.get('tokens'),value);assert.ok(entries.size>2);fail=true;await assert.rejects(store.set('tokens',{token:'b'.repeat(12000)}));assert.deepEqual(await store.get('tokens'),value);fail=false;await store.set('tokens',{token:'small'});assert.equal(entries.size,2);await store.delete('tokens');assert.equal(entries.size,0);
});
test('bounded transport rejects redirects before credentials can escape, oversized and stalled bodies',async t=>{
 let leaked=false;const server=http.createServer((req,res)=>{if(req.url==='/redirect'){res.writeHead(302,{Location:'/leak'});return res.end()}if(req.url==='/leak'){leaked=true;return res.end()}if(req.url==='/huge'){res.writeHead(200);return res.end('x'.repeat(200))}if(req.url==='/stall'){res.writeHead(200);res.flushHeaders();return}});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close()});const base=`http://127.0.0.1:${server.address().port}`;
 const fetcher=createSafeFetch({signal:new AbortController().signal,allowLoopbackHttp:true,maxBytes:100,timeoutMs:50});await assert.rejects(fetcher(base+'/redirect',{headers:{Authorization:'Bearer secret'}}));assert.equal(leaked,false);await assert.rejects(async()=>(await fetcher(base+'/huge')).text(),/size limit/);await assert.rejects(async()=>(await fetcher(base+'/stall')).text());
});

test('bound fetch rejects credential-bearing requests to other origins and unrecognized token endpoints',async()=>{
 const fetcher=createSafeFetch({credentialOrigin:'https://mcp.example',tokenEndpoint:()=> 'https://login.example/token',fetchImpl:async()=>new Response('{}')});
 await assert.rejects(fetcher('https://evil.example/mcp',{headers:{Authorization:'Bearer private'}}),/credential|origin/i);
 await assert.rejects(fetcher('https://evil.example/token',{method:'POST',body:new URLSearchParams({client_secret:'private'})}),/credential|endpoint/i);
 await assert.rejects(fetcher('https://login.example/other',{headers:{Authorization:'Basic private'}}),/credential|endpoint/i);
 assert.equal((await fetcher('https://mcp.example/mcp',{headers:{Authorization:'Bearer private'}})).status,200);
 assert.equal((await fetcher('https://login.example/token',{method:'POST',body:new URLSearchParams({client_secret:'private'})})).status,200);
});

test('multi-slot Keychain failure keeps all old credentials readable',async()=>{
 const values=new Map();let denied=false;const store=new SecretStore({get:async key=>values.get(key),set:async(key,value)=>{if(denied&&key==='mcp-test-clientSecret'){denied=false;throw Error('Keychain denied')}values.set(key,value)},delete:async key=>values.delete(key)},'test');await store.set('token',{value:'old-token'});await store.set('clientSecret',{value:'old-secret'});let committed=false;denied=true;
 await assert.rejects(store.transaction({token:{value:'new-token'},clientSecret:{value:'new-secret'}},()=>{committed=true}));assert.equal(committed,false);assert.deepEqual(await store.get('token'),{value:'old-token'});assert.deepEqual(await store.get('clientSecret'),{value:'old-secret'});assert.equal(values.size,4);
});
