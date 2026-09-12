'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {validateDocumentFile}=require('../electron/artifact-document-validation.cjs');
const directory=path.resolve(__dirname,'../../../.local-data/skill-helper-prototype');
const enabled=process.platform==='darwin'&&process.env.ZQ_TEST_NATIVE_HELPER_DOCUMENTS==='1';
if(![undefined,'app-sandbox-only-probe','seatbelt-only-probe'].includes(process.env.ZQ_NATIVE_HELPER_MODE))throw new Error('Invalid document test mode');
const seatbelt=process.env.ZQ_NATIVE_HELPER_MODE==='seatbelt-only-probe';
const client=path.join(directory,seatbelt?'SkillHelperSeatbeltProbe.app':'SkillHelperSandboxProbe.app','Contents/MacOS/SkillHelperPrototype');
const fixtures=path.resolve(__dirname,'../native/skill-helper-prototype/fixtures');
for(const format of ['docx','xlsx','pptx','pdf'])test(`native helper ${format} creation/editing roundtrip`,{skip:!enabled,timeout:45000},async()=>{
 const started=performance.now(),code=fs.readFileSync(path.join(fixtures,`${format}_workflow.py`),'utf8');
 const result=spawnSync(client,[],{input:JSON.stringify({code,files:[]}),encoding:'utf8',timeout:40000,maxBuffer:12*1024*1024});
 assert.equal(result.error,undefined,String(result.error));assert.equal(result.status,0,result.stderr);
 const response=JSON.parse(result.stdout);assert.equal(response.exitCode,0,JSON.stringify(response));
 const details=JSON.parse(response.stdout.trim());assert.equal(details.status,'passed');assert.equal(details.fixture,format);
 assert.equal(response.files.length,1);const file=response.files[0];assert.ok(!/[\\/\x00-\x1f\x7f]/.test(file.name));assert.equal(path.extname(file.name),'.'+format);
 assert.equal((await validateDocumentFile(file)).format,format);
 const bytes=Buffer.from(file.data,'base64');assert.equal(bytes.toString('base64'),file.data);assert.ok(bytes.length>100&&bytes.length<4*1024*1024);
 if(format==='pdf')assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
 // Dedicated prototype outputs; never added to the user's workspace or Artifacts.
 const output=path.join(directory,seatbelt?'verified-seatbelt-documents':'verified-documents');fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,file.name),bytes);
 fs.writeFileSync(path.join(output,format+'-result.json'),JSON.stringify({...details,...Object.fromEntries(Object.entries(response).filter(([key])=>!['files','stdout','stderr'].includes(key))),endToEndMs:Math.round(performance.now()-started),outputBytes:bytes.length},null,2)+'\n');
});
