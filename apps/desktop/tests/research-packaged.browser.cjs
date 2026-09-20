// Packaged shell/preload/signed Chat module, real research/artifact services, simulated model.
// Uses a disposable profile and never reads provider keys or the normal workspace.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {_electron}=require('playwright-core');
(async()=>{
 const executablePath=path.resolve(process.argv[2]),moduleFile=process.argv[3],expectedVersion=moduleFile?JSON.parse(fs.readFileSync(moduleFile)).manifest.version:'1.19.0',directory=fs.mkdtempSync(path.join(os.tmpdir(),'zq-research-packaged-'));let app;
 try{
  if(moduleFile){const {ModuleStore}=require('../electron/module-store.cjs'),folder=path.resolve('apps/desktop/bundled-modules');const store=new ModuleStore({directory:path.join(directory,'modules'),bundles:['hq','notes','tasks','chat','code'].map(n=>JSON.parse(fs.readFileSync(path.join(folder,n+'.zqmodule')))),trustedKeys:JSON.parse(fs.readFileSync(path.join(folder,'trusted-keys.json')))});store.installFile(path.resolve(moduleFile));}
  app=await _electron.launch({executablePath,env:{...process.env,ZQ_DATA_DIR:directory}});
  const page=await app.firstWindow(),errors=[];page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
  await page.getByRole('button',{name:'Chat module',exact:true}).waitFor();
  const baseline=await page.evaluate(async()=>({modules:await window.zq.modules.list(),research:await window.zq.research.list(),artifacts:await window.zq.artifacts.list()}));
  assert.ok(baseline.modules.value.some(m=>m.id==='zq.chat'&&m.version===expectedVersion));assert.deepEqual(baseline.research,{ok:true,value:[]});assert.deepEqual(baseline.artifacts,{ok:true,value:[]});
  const fixtureSource=fs.readFileSync(path.join(__dirname,'fixtures/research-native.cjs'),'utf8').replaceAll("require('../../electron/", "require('./electron/");
  await app.evaluate(async({app,ipcMain,BrowserWindow},{fixtureSource})=>{
   const require=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json'),module={exports:{}};
   new Function('require','module',fixtureSource)(require,module);
   const mapping={chatChanged:'chat:changed',researchChanged:'research:changed',artifactsChanged:'artifacts:changed'};
   const fixture=await module.exports(app.getPath('userData')+'/fixture',(name,value)=>BrowserWindow.getAllWindows()[0]?.webContents.send(mapping[name],value));global.researchFixture=fixture;
   for(const [service,methods] of Object.entries({chat:['load','saveDraft','saveChatView','createConversation','renameConversation','send','listSkills'],research:['catalog','availability','create','list','get','acceptPlan','stop','finish','resume','retryStorage'],artifacts:['list','status','file','version','document','preview','researchView','reviseResearch']}))for(const method of methods){const channel=service+':'+method;ipcMain.removeHandler(channel);ipcMain.handle(channel,(_e,input)=>fixture.call(service,method,input))}
  },{fixtureSource});
  await page.reload();await page.getByRole('button',{name:'Chat module',exact:true}).click();
  // Exercise the installed module's actual Sources picker, not only native job IPC.
  const sources=page.getByRole('dialog',{name:'Research sources',exact:true});
  await page.getByRole('button',{name:'Choose provider tools',exact:true}).click();
  await page.getByRole('menuitemcheckbox',{name:'Research',exact:true}).click();
  await page.getByRole('button',{name:'Sources · 1',exact:true}).click();await sources.waitFor();
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});w.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'})});
  await sources.waitFor({state:'detached'});
  await page.getByRole('button',{name:'Sources · 1',exact:true}).click();await sources.waitFor();
  await sources.getByRole('button',{name:'Close dialog',exact:true}).hover();await page.waitForTimeout(600);await page.keyboard.press('Escape');await sources.waitFor({state:'detached'});
  await page.getByRole('button',{name:'Add attachments',exact:true}).click();
  assert.equal(await page.getByRole('menuitem',{name:'Choose sources',exact:true}).count(),0);
  await page.getByRole('menuitem',{name:'Upload files',exact:true}).waitFor();await page.keyboard.press('Escape');
  // macOS can return focus to the webview without a focused dialog control.
  await page.getByRole('button',{name:'Sources · 1',exact:true}).click();await sources.waitFor();
  await sources.getByRole('button',{name:'Close dialog',exact:true}).hover();await page.waitForTimeout(600);
  await page.evaluate(()=>document.activeElement?.blur());
  assert.deepEqual(await page.evaluate(()=>({tag:document.activeElement?.tagName,tooltip:!!document.querySelector('[role=tooltip]')})),{tag:'BODY',tooltip:true});
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});w.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'})});await sources.waitFor({state:'detached'});
  await page.waitForFunction(()=>document.activeElement?.textContent==='Sources · 1');
  const state=await app.evaluate(()=>global.researchFixture.chat.snapshot());const conversation=state.conversations.find(c=>c.title==='First chat');
  // Actual context-isolated renderer bridge crosses into the native runner.
  const job=await page.evaluate(async({conversation})=>window.zq.research.create({id:crypto.randomUUID(),conversationId:conversation.id,projectId:null,choice:{connectionId:conversation.connectionId,model:conversation.model},brief:'Compare measurements',sources:[{kind:'note',id:'measurements',scope:[]}]}),{conversation});assert.ok(job.ok,JSON.stringify(job));
  const waitFor=async predicate=>{for(let i=0;i<400;i++){if(await predicate())return;await new Promise(r=>setTimeout(r,25))}throw Error('Native research timed out')};
  await waitFor(()=>app.evaluate(()=>global.researchFixture.research.list()[0]?.status==='awaiting_plan'));
  const planned=await page.evaluate(id=>window.zq.research.get(id),job.value.id);const accepted=await page.evaluate(j=>window.zq.research.acceptPlan({id:j.id,expectedRevision:j.revision,plan:{...j.plan,questions:[],steps:[...j.plan.steps,'Audience: engineers']}}),planned.value);assert.ok(accepted.ok);
  await page.getByRole('button',{name:'Code module',exact:true}).click();await app.evaluate(()=>global.researchFixture.call('fixture','release'));
  await waitFor(()=>app.evaluate(()=>global.researchFixture.research.list()[0]?.status==='completed'));
  await page.getByRole('button',{name:'Open report',exact:true}).click();await page.getByRole('heading',{name:'Measurement report',exact:true}).waitFor();await page.getByRole('img',{name:'Measured values',exact:true}).waitFor();
  const report=await app.evaluate(()=>global.researchFixture.research.list()[0].report);
  assert.ok((await page.evaluate(target=>window.zq.artifacts.researchView(target),report)).ok);
  const result=await app.evaluate(async({app},target)=>{const f=global.researchFixture,fs=process.getBuiltinModule('fs');for(const format of ['pdf','markdown']){const file=await f.artifacts.researchExport({...target,format});fs.writeFileSync(app.getPath('userData')+'/'+file.name,file.bytes)}return{artifacts:f.artifacts.list().length,versions:f.artifacts.list()[0].versions.length}},report);assert.deepEqual(result,{artifacts:1,versions:1});
  fs.mkdirSync('.local-data/research-packaged-check',{recursive:true});await page.screenshot({path:'.local-data/research-packaged-check/report.png'});
  await app.evaluate(()=>global.researchFixture.close());assert.deepEqual(errors,[]);
  console.log('PASS packaged Research: signed Chat '+expectedVersion+', native Escape from Sources (direct opening, tooltip and lost focus), native preload IPC, background navigation, artifact preview/chart, immutable report and packaged PDF/Markdown exports.');
 }finally{await app?.close();fs.rmSync(directory,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
