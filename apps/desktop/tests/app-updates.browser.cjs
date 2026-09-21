// Run after building the shell: node apps/desktop/tests/app-updates.browser.cjs
// Optional ZQ_TEST_APP points to a packaged executable. All data is isolated.
const {_electron}=require('playwright-core'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'zq-app-updates-'));let app;
 try{
  app=await _electron.launch({executablePath:process.env.ZQ_TEST_APP||require('electron'),args:process.env.ZQ_TEST_APP?[]:[path.resolve(__dirname,'..')],env:{...process.env,ZQ_DATA_DIR:directory}});
  const page=await app.firstWindow();page.setDefaultTimeout(15000);
  await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Updates',exact:true}).click();
  await page.getByText(process.env.ZQ_TEST_APP?'This local build doesn’t receive app updates. Install a signed release to enable them.':'Updates are available in installed release builds.').waitFor();
  assert.equal(await page.getByRole('button',{name:'Check for updates',exact:true}).isDisabled(),true);
  const fixtures=async status=>app.evaluate(({ipcMain,BrowserWindow,app:electronApp},status)=>{
   const require=process.getBuiltinModule('module').createRequire(electronApp.getAppPath()+'/package.json');
   const {EventEmitter}=require('node:events');const {AppUpdates}=require(require('node:path').join(require('electron').app.getAppPath(),'electron/app-updates.cjs'));
   const engine=new EventEmitter();engine.checkForUpdates=async()=>engine.emit('update-available',{version:'0.2.0'});engine.downloadUpdate=async()=>{engine.emit('download-progress',{percent:45});await new Promise(r=>setTimeout(r,800));engine.emit('update-downloaded',{version:'0.2.0'})};engine.quitAndInstall=()=>{throw Error('Tests must not install')};
   const service=new AppUpdates({version:'0.1.0',createUpdater:async()=>engine,onChange:value=>BrowserWindow.getAllWindows()[0].webContents.send('updates:changed',value)});
   for(const method of ['status','check','download']){ipcMain.removeHandler('updates:'+method);ipcMain.handle('updates:'+method,async()=>({ok:true,value:method==='status'?service.snapshot():await service[method]()}))}
   service.set({status});
  },status);
  await fixtures('idle');await page.getByRole('button',{name:'Check for updates',exact:true}).click();await page.getByText('zQ 0.2.0 is available').waitFor();
  const summary=page.locator('.app-update-summary');
  assert.equal(await page.getByRole('button',{name:'Check for updates',exact:true}).count(),0);
  assert.equal(await summary.getByRole('button',{name:'Download update',exact:true}).count(),1);
  assert.equal(await page.locator('.app-update-details button').count(),0);
  await summary.click({button:'right'});await page.getByRole('menuitem',{name:'Download update',exact:true}).waitFor();await page.keyboard.press('Escape');
  await page.screenshot({path:path.join(directory,'updates-available.png')});
  await summary.getByRole('button',{name:'Download update',exact:true}).click();await summary.getByRole('button',{name:'Downloading…',exact:true}).waitFor();assert.equal(await summary.getByRole('button').isDisabled(),true);
  await page.getByRole('navigation',{name:'Settings sections'}).getByRole('button',{name:'Appearance',exact:true}).click();await page.getByRole('button',{name:'Updates',exact:true}).click();await page.getByText('zQ 0.2.0 is ready to install').waitFor();
  assert.equal(await summary.getByRole('button',{name:'Restart and install',exact:true}).count(),1);
  assert.equal(await page.locator('.app-update-details button').count(),0);
  await summary.getByRole('button',{name:'Restart and install',exact:true}).click();await page.getByRole('dialog').waitFor();await page.getByRole('button',{name:'Later',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
  await page.locator('.app-update-summary').click({button:'right'});await page.getByRole('menuitem',{name:'Copy version',exact:true}).waitFor();await page.keyboard.press('Escape');await page.getByRole('menu').waitFor({state:'hidden'});
  await page.evaluate(()=>document.documentElement.dataset.theme='light');await page.waitForTimeout(250);await page.screenshot({path:path.join(directory,'updates-light.png')});
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');await page.waitForTimeout(250);await page.screenshot({path:path.join(directory,'updates-dark.png')});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(840,700));await page.screenshot({path:path.join(directory,'updates-narrow.png')});
  if(process.env.ZQ_SCREENSHOT_DIR){fs.mkdirSync(process.env.ZQ_SCREENSHOT_DIR,{recursive:true});for(const name of ['updates-available.png','updates-light.png','updates-dark.png','updates-narrow.png'])fs.copyFileSync(path.join(directory,name),path.join(process.env.ZQ_SCREENSHOT_DIR,name))}
  // Native menu entry opens the right settings section and starts a check.
  await page.getByRole('navigation',{name:'Settings sections'}).getByRole('button',{name:'Appearance',exact:true}).click();await app.evaluate(({Menu})=>Menu.getApplicationMenu().items[0].submenu.items.find(item=>item.label==='Check for Updates…').click());await page.getByRole('heading',{name:'Updates',exact:true}).waitFor();
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());
  for(let i=0;i<100&&await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible());i++)await new Promise(r=>setTimeout(r,50));
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);
  await app.evaluate(({Menu})=>Menu.getApplicationMenu().items[0].submenu.items.find(item=>item.label==='Check for Updates…').click());await page.getByRole('heading',{name:'Updates',exact:true}).waitFor();assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),true);
  console.log('PASS: local-build gate, check/download states, navigation persistence, restart cancellation, context menu, native menu, light/dark/narrow layouts. No release installed.');
 }finally{await app?.close();fs.rmSync(directory,{recursive:true,force:true})}
})().catch(error=>{console.error(error);process.exitCode=1});
