// All persistence and lifecycle tests use a disposable profile; OS login items are mocked.
const {_electron}=require('playwright-core'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
(async()=>{const directory=fs.mkdtempSync(path.join(os.tmpdir(),'zq-general-ui-'));let app;
 const launch=()=>_electron.launch({executablePath:require('electron'),args:[path.resolve(__dirname,'..')],env:{...process.env,ZQ_DATA_DIR:directory}});
 const waitHidden=async()=>{for(let i=0;i<100;i++){if(!await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()))return;await new Promise(r=>setTimeout(r,50))}throw Error('Window did not hide')};
 try{
  app=await launch();let page=await app.firstWindow();page.setDefaultTimeout(15000);
  await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('heading',{name:'General',exact:true}).waitFor();
  assert.equal(await page.getByRole('switch',{name:'Launch at login',exact:true}).isDisabled(),true);
  // Replace only the OS-facing preference service; persist through the real native implementation.
  await app.evaluate(({ipcMain,app:electronApp,BrowserWindow},directory)=>{
   const req=process.getBuiltinModule('module').createRequire(electronApp.getAppPath()+'/package.json');const {AppPreferences}=req('./electron/app-preferences.cjs');let login=false;
   const service=new AppPreferences({directory,platform:'darwin',notificationsSupported:true,app:{isPackaged:true,isInApplicationsFolder:()=>true,getLoginItemSettings:()=>({openAtLogin:login,status:login?'enabled':'not-registered',wasOpenedAtLogin:false}),setLoginItemSettings:value=>{login=value.openAtLogin}},onChange:value=>BrowserWindow.getAllWindows()[0].webContents.send('preferences:changed',value)});
   for(const method of ['load','save']){ipcMain.removeHandler('preferences:'+method);ipcMain.handle('preferences:'+method,(_,...args)=>({ok:true,value:method==='load'?service.snapshot():service.save(...args)}))}
   BrowserWindow.getAllWindows()[0].webContents.send('preferences:changed',service.snapshot());
  },directory);
  await page.getByRole('switch',{name:'Launch at login',exact:true}).click();await page.getByRole('switch',{name:'Start minimized',exact:true}).click();
  const choose=async(label,value)=>{await page.getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name:value,exact:true}).click()};
  await choose('On launch','Notes');await page.getByRole('switch',{name:'Research finished',exact:true}).click();await page.getByRole('switch',{name:'Agent needs review',exact:true}).click();await page.getByRole('switch',{name:'Task completed',exact:true}).click();
  await page.getByRole('switch',{name:'Task completed',exact:true}).click({button:'right'});await page.getByRole('menuitem',{name:'Reset to default'}).click();assert.equal(await page.getByRole('switch',{name:'Task completed',exact:true}).getAttribute('aria-checked'),'false');
  await page.getByRole('button',{name:'Updates',exact:true}).click();await page.getByRole('switch',{name:'Automatically check for updates',exact:true}).click();
  await page.getByRole('button',{name:'General',exact:true}).click();assert.equal(await page.getByRole('switch',{name:'Research finished',exact:true}).getAttribute('aria-checked'),'true');
  fs.mkdirSync('.local-data/general-settings-screens',{recursive:true});
  for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.screenshot({path:'.local-data/general-settings-screens/'+theme+'.png'})}
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(840,760));await page.screenshot({path:'.local-data/general-settings-screens/narrow.png'});
  // Close the window with the actual native preference service (default background).
  await app.evaluate(({BrowserWindow,app:electronApp})=>{const req=process.getBuiltinModule('module').createRequire(electronApp.getAppPath()+'/package.json');global.__shutdownCalls=0;const proto=req('./electron/chat-service.cjs').ChatService.prototype,original=proto.shutdown;proto.shutdown=function(...args){global.__shutdownCalls++;return original.apply(this,args)};BrowserWindow.getAllWindows()[0].close()});
  await waitHidden();assert.equal(await app.evaluate(()=>global.__shutdownCalls),0);
  await app.evaluate(({app:electronApp})=>electronApp.emit('activate'));assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),true);
  await app.close();app=null;
  const saved=JSON.parse(fs.readFileSync(path.join(directory,'app-preferences.json'))).settings;assert.equal(saved.startupView,'Notes');assert.equal(saved.startMinimized,true);assert.equal(saved.automaticUpdates,true);
  // A fresh launch reads the preferred destination despite the last saved view being Settings.
  app=await launch();page=await app.firstWindow();await page.getByRole('button',{name:'Notes module',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Notes module',exact:true}).getAttribute('aria-current'),'page');
  await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('combobox',{name:'Closing the window',exact:true}).click();await page.getByRole('option',{name:'Quit zQ',exact:true}).click();
  const exited=app.waitForEvent('close');await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await exited;app=null;
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'app-preferences.json'))).settings.closeBehavior,'quit');
  console.log('PASS: General controls, context resets, persistence, startup destination, background close without Chat shutdown, explicit quit, and light/dark/narrow layouts. No OS login items changed.');
 }finally{await app?.close();fs.rmSync(directory,{recursive:true,force:true})}
})().catch(error=>{console.error(error);process.exitCode=1});
