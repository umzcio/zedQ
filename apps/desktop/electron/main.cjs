const { app, BrowserWindow, ipcMain, dialog, Menu, session, nativeImage, shell, clipboard } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { exportFile } = require('./export-file.cjs');
const {ModuleStore,downloadPackage}=require('./module-store.cjs');
const { pathToFileURL } = require('node:url');
const { WorkspaceStore } = require('./storage.cjs');
const { FileService } = require('./files.cjs');
const {AttachmentService,imageNormalizer}=require('./chat-attachments.cjs');
const { CloseRequests } = require('./close-requests.cjs');
const closeRequests = new CloseRequests();
app.setName('zQ');
if (process.env.ZQ_DATA_DIR) app.setPath('userData', path.resolve(process.env.ZQ_DATA_DIR));
let updates, installingUpdate=false, commandsReady=false, pendingCommand=null;
let window, workspace, files, code, codeFactory, codeError, chat, research, voice, connectors, attachments, chatError, connectorError, quitting = false, closeTimer;
const index = path.resolve(__dirname, '../dist/index.html');
const allowedURL = pathToFileURL(index).href;
const runtimeCheck = process.argv.includes('--runtime-check');
const ownsLock = app.requestSingleInstanceLock();
if (!ownsLock) app.quit();
function trusted(event) { return window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === allowedURL; }
function handle(channel, fn) {
 ipcMain.handle(channel, async (event, ...args) => {
  if (!trusted(event)) return { ok: false, error: { code: 'DENIED', message: 'This window cannot access desktop services.' } };
  try { return { ok: true, value: await fn(...args) }; }
  catch (error) { return { ok: false, error: { code: error.code || 'IO_ERROR', message: error.message || 'The operation failed.' } }; }
 });
}
function command(name) { if(commandsReady&&window&&!window.isDestroyed())window.webContents.send('app:command',name);else pendingCommand=name; }
ipcMain.on('app:commands-ready',event=>{if(!trusted(event))return;commandsReady=true;if(pendingCommand){const name=pendingCommand;pendingCommand=null;command(name)}});
async function closeFailed(id, message) {
 if (!closeRequests.fail(id)) return;
 clearTimeout(closeTimer);
 if (!window || window.isDestroyed()) return;
 const { response } = await dialog.showMessageBox(window, { type: 'warning', message: 'Your latest changes could not be saved.', detail: message, buttons: ['Keep zQ open', 'Quit without saving'], defaultId: 0, cancelId: 0, noLink: true });
 if (response === 1) { window.destroy(); app.exit(0); }
 else { updates?.cancelInstall(); quitting = false; chat?.resumeAfterWindowClose(); research?.reopen(); closeRequests.cancel(id); window?.webContents.send('window:close-cancelled', id); }
}
function createWindow() {
 commandsReady=false;
 if(!code&&codeFactory){try{code=codeFactory();codeError=null}catch(error){codeError=error}}
 chat?.resumeAfterWindowClose();
 research?.reopen();
 window = new BrowserWindow({ width: 1380, height: 900, minWidth: 840, minHeight: 640, title: 'zQ', backgroundColor: '#ffffff', show: false,
  ...(process.platform==='darwin'?{titleBarStyle:'hidden',trafficLightPosition:{x:18,y:24}}:{}),
  webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: false } });
 window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
 window.webContents.on('will-navigate', event => event.preventDefault());
 window.webContents.on('will-attach-webview', event => event.preventDefault());
 window.once('ready-to-show', () => window.show());
 window.on('close', event => {
  event.preventDefault();
  const id = closeRequests.begin();
  if (!id) return;
  window.webContents.send('window:close-request', id);
  closeTimer = setTimeout(() => closeFailed(id, 'The editor did not respond. Keep zQ open to retry saving.'), 10000);
 });
 window.on('closed', () => { code?.close(); code=null; window = null; clearTimeout(closeTimer); closeRequests.reset(); });
 window.webContents.on('render-process-gone', () => { code?.close(); code=null; closeRequests.reset(); voice?.close(); chat?.stopAll('interrupted','The app window closed unexpectedly.'); });
 window.loadFile(index);
 void connectors?.restoreConnections().catch(()=>{});
}
app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
app.on('before-quit', event => { if (window && !window.isDestroyed()) { event.preventDefault(); quitting = true; window.close(); } });
app.on('window-all-closed', () => { if (!installingUpdate && (process.platform !== 'darwin' || quitting)) app.quit(); });
app.whenReady().then(async () => {
 if (!ownsLock) return;
 if (runtimeCheck) {
  try { const result = await require('./runtime-check.cjs').runRuntimeCheck(); console.log(JSON.stringify(result, null, 2)); app.exit(0); }
  catch (error) { console.error('Runtime check failed:', error.message); app.exit(1); }
  return;
 }
 updates=require('./update-runtime.cjs').createAppUpdates({app,onChange:state=>{if(window&&!window.isDestroyed())window.webContents.send('updates:changed',state);if(installingUpdate&&state.status==='error'){installingUpdate=false;quitting=false;if(!window)createWindow();command('updates')}}});
 handle('updates:status',()=>updates.snapshot());
 handle('updates:check',()=>updates.check());
 handle('updates:download',()=>updates.download());
 handle('updates:install',()=>{if(closeRequests.active)throw new Error('Wait for the current close request to finish.');updates.requestInstall();setImmediate(()=>app.quit());return null});
 const clipboardService=require('./clipboard.cjs').createClipboardService(clipboard);
 handle('clipboard:writeText',text=>clipboardService.writeText(text));
 const directory = app.getPath('userData');
 const sendCode=(channel,value)=>{if(window&&!window.isDestroyed())window.webContents.send(channel,value)};
 codeFactory=()=>new (require('./code/code-service.cjs').CodeService)({directory:path.join(directory,'code'),onChange:value=>sendCode('code:changed',value),onTerminal:value=>sendCode('code:terminal',value),pickDirectory:async()=>{const selected=await dialog.showOpenDialog(window,{title:'Choose Code project folder',properties:['openDirectory','createDirectory']});return selected.canceled?null:selected.filePaths[0]},pickUpload:async()=>{const result=await dialog.showOpenDialog(window,{title:'Upload files',properties:['openFile','multiSelections','showHiddenFiles']});return result.canceled?null:result.filePaths},pickDownload:async name=>{const result=await dialog.showSaveDialog(window,{title:'Download file',defaultPath:name,properties:['showOverwriteConfirmation','createDirectory']});return result.canceled?null:result.filePath},confirmReplace:async name=>(await dialog.showMessageBox(window,{type:'question',message:'Replace '+name+'?',detail:'A file with this name already exists in the destination folder.',buttons:['Cancel','Replace'],defaultId:0,cancelId:0})).response===1,openExternal:url=>shell.openExternal(url),reveal:folder=>shell.openPath(folder)});
 try{code=codeFactory()}catch(error){codeError=error}
 const invokeCode=(method,input)=>{if(!code&&codeFactory){try{code=codeFactory();codeError=null}catch(error){codeError=error}}if(!code)throw codeError||new Error('Code service unavailable');return code.invoke(method,input)};
 handle('code:invoke',invokeCode);
 let github;
 handle('github:invoke',(method,input)=>{github ||= new (require('./github/board.cjs').GitHubBoard)({directory:path.join(directory,'github'),code:invokeCode,openExternal:url=>shell.openExternal(url)});return github.invoke(method,input)});
 const bundled=path.resolve(__dirname,'../bundled-modules');
 const moduleStore=new ModuleStore({directory:path.join(directory,'modules'),bundles:['hq','notes','tasks','chat','code'].map(name=>JSON.parse(fs.readFileSync(path.join(bundled,`${name}.zqmodule`),'utf8'))),trustedKeys:JSON.parse(fs.readFileSync(path.join(bundled,'trusted-keys.json'),'utf8')),apiVersion:1});
 handle('modules:runtime',()=>moduleStore.getRuntime());
 handle('modules:list',()=>moduleStore.list());
 handle('modules:install',async()=>{const selected=await dialog.showOpenDialog(window,{title:'Install module update',properties:['openFile'],filters:[{name:'zQ module',extensions:['zqmodule']}]});if(selected.canceled)return null;return moduleStore.installFile(selected.filePaths[0])});
 handle('modules:download',async url=>moduleStore.install(await downloadPackage(url)));
 handle('modules:rollback',id=>moduleStore.rollback(id));
 handle('modules:recover',(id,version)=>moduleStore.recover(id,version));
 workspace = new WorkspaceStore(directory); files = new FileService(directory); attachments=new AttachmentService({normalizeImage:imageNormalizer(nativeImage)});
 const renderDocument=require('./document-helper.cjs').createDocumentRenderer({helperPath:app.isPackaged?path.join(process.resourcesPath,'native','DocumentHelper.app','Contents','MacOS','DocumentHelperLauncher'):path.join(__dirname,'../native/bin/DocumentHelper.app/Contents/MacOS/DocumentHelperLauncher')});
 let artifacts,artifactError,artifactWarning='';try{artifacts=new (require('./artifact-service.cjs').ArtifactService)({directory,render:renderDocument,onChange:items=>{if(window&&!window.isDestroyed())window.webContents.send('artifacts:changed',items)}})}catch(e){artifactError=e}
 const artifactService=()=>{if(!artifacts)throw artifactError;return artifacts};
 const credentials=require('./provider-keychain.cjs').createCredentialStore({directory,helperPath:app.isPackaged?path.join(process.resourcesPath,'native','provider-keychain'):undefined});
 try { connectors=new (require('./mcp/service.cjs').ConnectorService)({directory,credentials,allowLoopbackHttp:true,openExternal:url=>shell.openExternal(url),onChange:rows=>{if(window&&!window.isDestroyed())window.webContents.send('connectors:changed',rows)}}); } catch(error) { connectorError=error; }
 handle('connectors:catalog',()=>require('./mcp/catalog.cjs').getCatalog());
 handle('connectors:list',()=>{if(connectorError)throw connectorError;return connectors.list()});
 for(const method of ['save','connect','disconnect','remove','setTools'])handle(`connectors:${method}`,async input=>{if(connectorError)throw connectorError;await connectors[method](input);return connectors.list()});
 try { chat = new (require('./chat-service.cjs').ChatService)({directory, artifacts, credentials, connectors, attachments, getNotes:()=>workspace.load()?.notes??[], onChange:state=>{if(window&&!window.isDestroyed())window.webContents.send('chat:changed',state)}}); } catch(error) { chatError=error; }
 if(chat)void chat.connections.cleanup();
 voice=new (require('./voice-service.cjs').VoiceService)({directory,listConnections:()=>chat?.state.connections??[],resolveCredential:connection=>{if(!chat?.connections.isCurrent(connection))throw Error('The transcription connection changed. Record again.');return chat.connections.credentials.get(connection.credentialRef)},helperPath:app.isPackaged?path.join(process.resourcesPath,'native','voice-transcribe'):path.join(__dirname,'../native/bin/voice-transcribe')});
 for(const method of ['load','save','availability','begin','transcribe','cancel'])handle(`voice:${method}`,input=>voice[method](input));
 const chatService=()=>{if(!chat)throw chatError;return chat};
 // Native research survives renderer navigation and publishes immutable artifacts.
 const researchService=()=>research??=new (require('./research/service.cjs').ResearchService)({directory:path.join(directory,'research'),adapter:new (require('./research/adapter.cjs').ResearchAdapter)({chat:chatService(),publish:input=>artifactService().publishResearch(input)}),onChange:change=>{if(window&&!window.isDestroyed())window.webContents.send('research:changed',change)}});
 if(chat)chat.researchBusy=id=>research?.busy(id)??false;
 for(const method of ['catalog','availability','create','list','get','acceptPlan','stop','finish','resume','retryStorage'])handle(`research:${method}`,input=>researchService()[method](input));
 handle('chat:load',()=>chatService().snapshot());
 handle('artifacts:list',()=>{const service=artifactService();try{if(chat)chat.syncArtifacts();artifactWarning=chat?'':'Chat is unavailable; existing artifacts remain accessible.'}catch(e){artifactWarning='Some generated files could not be added to the library: '+e.message}return service.list()});
 handle('artifacts:status',()=>({warning:artifactWarning}));
 for(const method of ['create','update','version','preview','document','researchView','reviseResearch'])handle(`artifacts:${method}`,input=>artifactService()[method](input));
 handle('artifacts:importGenerated',input=>{const c=chatService().conversation(input.conversationId);const m=require('./chat-lifecycle.cjs').allMessages(c).find(m=>m.id===input.messageId&&(m.generatedFiles??[]).some(f=>f.id===input.fileId));if(!m)throw Error('Generated file not found.');return artifactService().importFile(chatService().generatedFile(input),{conversationId:c.id,messageId:m.id,versionId:require('./chat-lifecycle.cjs').versionId(m),conversationTitle:c.title,generatedFileId:input.fileId})});
 handle('artifacts:exportResearch',async input=>saveResearch(input));
 async function saveResearch(input){const file=await artifactService().researchExport(input);const result=await dialog.showSaveDialog(window,{title:'Export research report',defaultPath:file.name,properties:['showOverwriteConfirmation']});if(result.canceled||!result.filePath)return false;exportFile(result.filePath,file.bytes);return true}
 handle('artifacts:save',async input=>{if(artifactService().artifact(input.artifactId).format==='research')return saveResearch({...input,format:'markdown'});const file=artifactService().file(input);const result=await dialog.showSaveDialog(window,{title:'Download artifact',defaultPath:file.name,properties:['showOverwriteConfirmation']});if(result.canceled||!result.filePath)return false;exportFile(result.filePath,Buffer.from(file.data,'base64'));return true});
 for(const method of ['setConversationConnectors','enqueueMessage','updateQueuedMessage','setQueuePaused','respondToInteraction','setApprovalMode','previewSkillResource','importSkill','saveSkill','duplicateSkill','deleteSkill','addSkillFiles','removeSkillFile','searchProjectFiles','searchConversations','inspectContext','reviseMessage','branchConversation','selectMessageVersion','updateConversation','updateProject','saveDraft','saveChatView','previewGeneratedFile','reuseGeneratedFile','generatedFileToProject','saveConnection','saveModelPreferences','deleteConnection','createConversation','configureConversation','renameConversation','deleteConversation','saveProject','deleteProject','moveConversation','addProjectFiles','removeProjectFile','models','testConnection','stop'])handle(`chat:${method}`, input=>chatService()[method](input));
 async function saveText({name,text}){if(!require('./chat-store.cjs').text(name,512)||!require('./chat-store.cjs').text(text,32*1024*1024))throw Error('Invalid text file.');const result=await dialog.showSaveDialog(window,{title:'Save text file',defaultPath:path.basename(name),properties:['showOverwriteConfirmation']});if(result.canceled||!result.filePath)return false;exportFile(result.filePath,text);return true}
 handle('chat:saveTextFile',saveText);
 const skillCatalog=new (require('./skill-catalog.cjs').SkillCatalog)();
 handle('chat:browseSkills',input=>{chatService().reconcileSkillSources();return skillCatalog.list(input)});
 handle('chat:checkSkillUpdates',()=>skillCatalog.check());
 handle('chat:previewSkillUpdate',async id=>{const service=chatService(),review=service.prepareSkillUpdate(id),candidate=await skillCatalog.preview(review.catalogId);return{id:review.id,expectedHash:review.expectedHash,modified:review.modified,candidate:{...candidate,name:review.name}}});
 handle('chat:updateCatalogSkill',input=>{skillCatalog.entry(input?.candidate?.source?.catalogId);return chatService().updateCatalogSkill(input)});
 handle('chat:previewCatalogSkill',id=>skillCatalog.preview(id));
 handle('chat:pickSkillImport',async input=>{const folder=input?.directory===true;const selected=await dialog.showOpenDialog(window,{title:folder?'Import skill folder':'Import skill',properties:[folder?'openDirectory':'openFile'],...(!folder?{filters:[{name:'Agent Skills',extensions:['md','zip','skill','json']}]}:{})});if(selected.canceled||!selected.filePaths.length)return null;const file=selected.filePaths[0],reader=require('./skill-import-file.cjs');return folder?reader.readSkillDirectory(file):require('./skill-package.cjs').parseSkillPackage({name:path.basename(file),bytes:reader.readSkillFile(file)})});
 handle('chat:exportSkill',async id=>{const file=await chatService().exportSkillPackage(id);const result=await dialog.showSaveDialog(window,{title:'Export skill',defaultPath:file.name,properties:['showOverwriteConfirmation']});if(result.canceled||!result.filePath)return false;exportFile(result.filePath,file.bytes);return true});
 handle('chat:saveSkillResource',async input=>{const file=chatService().skillResource(input);const result=await dialog.showSaveDialog(window,{title:'Save skill file',defaultPath:path.basename(file.name),properties:['showOverwriteConfirmation']});if(result.canceled||!result.filePath)return false;exportFile(result.filePath,file.bytes);return true});
 handle('chat:exportConversation',id=>saveText(chatService().exportMarkdown(id)));
 handle('chat:send',input=>chatService().sendMessage(input));
 handle('chat:toolOptions',input=>chatService().toolOptions(input));
 const sourceIcons=require('./source-icons.cjs');
 const sourceIcon=sourceIcons.createSourceIconService({normalize:bytes=>sourceIcons.normalizeIcon(nativeImage,bytes)});
 handle('chat:sourceIcon',sourceIcon);
 handle('chat:openLink',async url=>{await shell.openExternal(require('./chat-tools.cjs').externalURL(url));return null});
 handle('chat:saveGeneratedFile',async input=>{
  const file=chatService().generatedFile(input);
  const result=await dialog.showSaveDialog(window,{title:'Save generated file',defaultPath:file.name,properties:['showOverwriteConfirmation']});
  if(result.canceled||!result.filePath)return false;
  exportFile(result.filePath,Buffer.from(file.data,'base64'));return true;
 });
 handle('attachments:import',input=>attachments.importFiles(input));
 handle('attachments:discard',id=>{attachments.discard(id);return null});
 handle('attachments:preview',id=>attachments.preview(id,chatService().savedAttachments()));
 handle('attachments:pick',async()=>{const result=await dialog.showOpenDialog(window,{title:'Attach files to chat',properties:['openFile','multiSelections','showHiddenFiles'],filters:[{name:'Files',extensions:['*']}]});if(result.canceled)return{items:[],errors:[]};if(result.filePaths.length>10)throw Error('Choose up to 10 files.');return attachments.fromPaths(result.filePaths)});
 const permit=(webContents,permission,details,kind)=>require('./voice-permissions.cjs').allowVoicePermission({webContents,trustedWebContents:window?.webContents,trustedUrl:allowedURL,active:voice?.active,permission,details,kind});
 session.defaultSession.setPermissionRequestHandler((webContents,permission,callback,details)=>callback(permit(webContents,permission,details,'request')));
 session.defaultSession.setPermissionCheckHandler((webContents,permission,origin,details)=>permit(webContents,permission,details,'check'));
 handle('workspace:load', () => workspace.load());
 handle('workspace:save', state => { workspace.save(state); return null; });
 handle('workspace:saveDraftCopy',async input=>{if(!input||typeof input.text!=='string'||!require('./chat-store.cjs').text(input.name,512))throw Error('Invalid recovery file.');const result=await dialog.showSaveDialog(window,{title:'Save unsaved edit',defaultPath:path.basename(input.name),properties:['showOverwriteConfirmation']});if(result.canceled||!result.filePath)return false;exportFile(result.filePath,input.text);return true});
 handle('files:list', () => files.list());
 handle('files:open', async () => {
  const result = await dialog.showOpenDialog(window, { title: 'Open a text file', filters: [{ name: 'All files', extensions: ['*'] }], properties: ['openFile', 'showHiddenFiles'] });
  return result.canceled ? null : files.open(result.filePaths[0]);
 });
 handle('files:edit', (id, body) => files.edit(id, body));
 handle('files:save', id => files.save(id));
 handle('files:save-as', async id => {
  const doc = files.list().find(f => f.id === id);
  if (!doc) throw new Error('Unknown file.');
  const result = await dialog.showSaveDialog(window, { title: 'Save file as', defaultPath: doc.path, properties: ['showHiddenFiles', 'showOverwriteConfirmation'] });
  return result.canceled ? null : files.saveAs(id, result.filePath);
 });
 handle('files:reload', async id => {
  const result = await dialog.showMessageBox(window, { type: 'question', message: 'Reload this file from disk?', detail: 'This replaces the current recovery draft with the file on disk.', buttons: ['Cancel', 'Reload'], defaultId: 0, cancelId: 0 });
  return result.response === 1 ? files.reload(id) : null;
 });
 ipcMain.on('window:close-ready', async (event, id, error) => {
  if (!trusted(event)||closeRequests.active?.id!==id||closeRequests.active.phase!=='waiting') return;
  if (typeof error === 'string') { closeFailed(id, error); return; }
  clearTimeout(closeTimer);
  try { voice?.close(); research?.shutdown(); chat?.shutdown(); await connectors?.suspend(); } catch(error) { closeFailed(id,error.message); return; }
  if (!closeRequests.complete(id)) return;
  clearTimeout(closeTimer);
  const shouldQuit = quitting;
  installingUpdate=updates?.snapshot().status==='restarting';
  window.destroy();
  if(installingUpdate){
   if(!updates.installAfterClose()){installingUpdate=false;quitting=false;if(!window)createWindow()}
  }else if (shouldQuit) app.quit();
 });
 Menu.setApplicationMenu(Menu.buildFromTemplate([
  { label: 'zQ', submenu: [{ role: 'about' }, { label:'Check for Updates…', click:()=>{if(!window)createWindow();command('updates');window.show();window.focus();void updates.check()} }, { type: 'separator' }, { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => command('settings') }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
  { label: 'File', submenu: [{ label: 'New Note', accelerator: 'CmdOrCtrl+N', click: () => command('new-note') }, { label: 'Open File…', accelerator: 'CmdOrCtrl+O', click: () => command('open-file') }, { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => command('save') }, { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => command('save-as') }, { type: 'separator' }, { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => command('close-tab') }, { role: 'close', label: 'Close Window', accelerator: 'CmdOrCtrl+Shift+W' }] },
  { role: 'editMenu' }, { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] }, { role: 'windowMenu' },
 ]));
 createWindow();
 app.on('activate', () => { if (!window) createWindow(); else window.show(); });
}).catch(error => { dialog.showErrorBox('zQ could not start', error.message); app.exit(1); });
