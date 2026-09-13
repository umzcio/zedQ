const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {ConnectorService}=require('../electron/mcp/service.cjs');const {getCatalogEntry}=require('../electron/mcp/catalog.cjs');
test('bundled arXiv uses standard MCP tool selection, schema validation and disconnection',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'zq-arxiv-service-'));let requests=0;const service=new ConnectorService({directory,credentials:{get(){throw Error('No credentials needed')},set(){throw Error('No credentials needed')}},openExternal(){throw Error('No browser needed')},fetchImpl:async()=>{requests++;return new Response('<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/abs/2601.00001v1</id><title>Example</title><summary>An abstract.</summary><author><name>A. Author</name></author><published>2026-01-01T00:00:00Z</published><updated>2026-01-01T00:00:00Z</updated></entry></feed>')}});
 try{
  const preset=getCatalogEntry('arxiv');const saved=await service.save({name:preset.name,url:preset.url,catalogId:preset.id});await service.connect(saved.id);let row=service.list()[0];assert.equal(row.status,'connected');assert.equal(row.tools.length,2);assert.ok(row.tools.every(t=>!t.enabled));
  await assert.rejects(service.callTool(row.id,'get_paper',{id:'2601.00001'},{expectedRevision:row.revision}),/not enabled/);await service.setTools({id:row.id,names:['get_paper']});row=service.list()[0];
  await assert.rejects(service.callTool(row.id,'get_paper',{id:3},{expectedRevision:row.revision}),/schema/);assert.equal(requests,0);
  const result=await service.callTool(row.id,'get_paper',{id:'2601.00001'},{expectedRevision:row.revision});assert.equal(result.isError,undefined);assert.ok(result.content.some(c=>c.type==='resource_link'));assert.equal(requests,1);
  await service.disconnect(row.id);await assert.rejects(service.callTool(row.id,'get_paper',{id:'2601.00001'},{expectedRevision:row.revision}),/disconnected/);
 }finally{await service.close();fs.rmSync(directory,{recursive:true,force:true})}
});
