const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const defaults=()=>({startMinimized:false,startupView:'restore',closeBehavior:'background',automaticUpdates:false,notifications:{research:false,agents:false,tasks:false}});
const views=['restore','HQ','Notes','Tasks','Chat','Code'];
function validate(patch){
 if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(k=>!Object.keys(defaults()).includes(k)))throw Error('Invalid app settings.');
 for(const [key,value] of Object.entries(patch)){
  if(['startMinimized','automaticUpdates'].includes(key)&&typeof value!=='boolean'||key==='startupView'&&!views.includes(value)||key==='closeBehavior'&&!['background','quit'].includes(value))throw Error('Invalid app setting.');
  if(key==='notifications'&&(!value||typeof value!=='object'||Array.isArray(value)||Object.entries(value).some(([k,v])=>!['research','agents','tasks'].includes(k)||typeof v!=='boolean')))throw Error('Invalid notification settings.');
 }
}
class AppPreferences{
 constructor({directory,app,platform=process.platform,isolated=false,notificationsSupported=false,onChange=()=>{}}){
  Object.assign(this,{app,platform,isolated,notificationsSupported,onChange});this.file=path.join(directory,'app-preferences.json');this.state=defaults();
  let fd;try{fd=fs.openSync(this.file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);if(!fs.fstatSync(fd).isFile()||fs.fstatSync(fd).size>16384)throw Error();const stored=JSON.parse(fs.readFileSync(fd,'utf8'));if(stored.version!==1)throw Error();validate(stored.settings);this.state={...this.state,...stored.settings,notifications:{...this.state.notifications,...stored.settings.notifications}}}catch(error){if(error.code!=='ENOENT')this.error='App settings could not be read. The original file has been preserved.'}finally{if(fd!==undefined)fs.closeSync(fd)}
 }
 startHidden(){try{return this.state.startMinimized&&this.login().openedAtLogin}catch{return false}}
 login(){
  const supported=this.platform==='darwin'&&this.app.isPackaged&&!this.isolated&&this.app.isInApplicationsFolder();
  if(!supported)return {loginSupported:false,launchAtLogin:false,loginStatus:'unavailable',openedAtLogin:false};
  let value;try{value=this.app.getLoginItemSettings()}catch{return {loginSupported:false,launchAtLogin:false,loginStatus:'error',openedAtLogin:false}}return {loginSupported:true,launchAtLogin:value.openAtLogin||value.status==='requires-approval',loginStatus:value.status??(value.openAtLogin?'enabled':'not-registered'),openedAtLogin:value.wasOpenedAtLogin};
 }
 snapshot(){if(this.error)throw Error(this.error);return {...structuredClone(this.state),...this.login(),notificationsSupported:this.notificationsSupported&&!this.isolated}}
 save(patch){
  if(this.error)throw Error(this.error);
  if(patch&&Object.hasOwn(patch,'launchAtLogin')){
   if(Object.keys(patch).length!==1||typeof patch.launchAtLogin!=='boolean')throw Error('Invalid login setting.');
   if(!this.login().loginSupported)throw Error('Install zQ in Applications to enable launch at login.');
   this.app.setLoginItemSettings({openAtLogin:patch.launchAtLogin});const snapshot=this.snapshot();this.onChange(snapshot);return snapshot;
  }
  validate(patch);const next={...this.state,...patch,notifications:{...this.state.notifications,...patch.notifications}};
  fs.mkdirSync(path.dirname(this.file),{recursive:true,mode:0o700});const temporary=this.file+'.'+randomUUID()+'.tmp';let fd;
  try{fd=fs.openSync(temporary,'wx',0o600);fs.writeFileSync(fd,JSON.stringify({version:1,settings:next}));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(temporary,this.file)}finally{if(fd!==undefined)fs.closeSync(fd);fs.rmSync(temporary,{force:true})}
  this.state=next;const snapshot=this.snapshot();this.onChange(snapshot);return snapshot;
 }
}
class AutomaticUpdateChecks{
 constructor({updates,enabled,setTimer=setTimeout,clearTimer=clearTimeout,interval=6*60*60*1000}){Object.assign(this,{updates,enabled,setTimer,clearTimer,interval});this.timer=null;this.closed=false;this.generation=0}
 configure(){this.generation++;this.clearTimer(this.timer);this.timer=null;if(!this.closed&&this.enabled())this.schedule(30000,this.generation)}
 schedule(delay,generation){this.timer=this.setTimer(async()=>{this.timer=null;try{if(this.enabled()&&generation===this.generation&&!['unavailable','checking','downloading','ready','restarting','available'].includes(this.updates.snapshot().status))await this.updates.check()}catch{/* Automatic checks must not interrupt the app. */}finally{if(!this.closed&&this.enabled()&&generation===this.generation)this.schedule(this.interval,generation)}},delay);this.timer?.unref?.()}
 close(){this.closed=true;this.generation++;this.clearTimer(this.timer);this.timer=null}
}
module.exports={AppPreferences,AutomaticUpdateChecks,defaults};
