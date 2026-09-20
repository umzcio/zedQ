// The shell owns updates. Downloads survive navigation; installation uses the normal save/close handshake.
class AppUpdates {
 constructor({version,unavailable=null,createUpdater,onChange=()=>{}}){
  this.createUpdater=createUpdater;this.onChange=onChange;this.operation=null;
  this.state={version,status:unavailable?'unavailable':'idle',message:unavailable||'',availableVersion:null,percent:0,checkedAt:null};
 }
 snapshot(){return {...this.state}}
 set(patch){Object.assign(this.state,patch);this.onChange(this.snapshot())}
 async engine(){
  if(this.updater)return this.updater;
  const updater=await this.createUpdater();
  updater.autoDownload=false;updater.autoInstallOnAppQuit=false;updater.allowPrerelease=false;updater.allowDowngrade=false;updater.logger=null;
  updater.on('error',()=>this.failed());
  updater.on('update-available',info=>this.set({status:'available',availableVersion:info.version,message:'',checkedAt:Date.now()}));
  updater.on('update-not-available',()=>this.set({status:'current',availableVersion:null,message:'',checkedAt:Date.now()}));
  updater.on('download-progress',progress=>this.set({percent:Math.max(0,Math.min(100,Number(progress.percent)||0))}));
  updater.on('update-downloaded',info=>this.set({status:'ready',availableVersion:info.version,percent:100,message:''}));
  this.updater=updater;return updater;
 }
 failed(){this.set({status:'error',message:'The update could not finish. Check your connection and GitHub access, then try again.'})}
 run(action){
  if(this.operation)return this.operation;
  this.operation=Promise.resolve().then(action).catch(()=>this.failed()).then(()=>this.snapshot()).finally(()=>{this.operation=null});
  return this.operation;
 }
 check(){
  if(['unavailable','ready','restarting'].includes(this.state.status))return Promise.resolve(this.snapshot());
  return this.run(async()=>{this.set({status:'checking',message:'',percent:0,availableVersion:null});const updater=await this.engine();await updater.checkForUpdates()});
 }
 download(){
  if(this.operation)return this.operation;
  if(this.state.status!=='available')throw new Error('Check for an available update first.');
  return this.run(async()=>{this.set({status:'downloading',message:'',percent:0});await this.updater.downloadUpdate()});
 }
 requestInstall(){
  if(this.state.status!=='ready')throw new Error('Download an update before restarting.');
  this.set({status:'restarting',message:''});
 }
 cancelInstall(){if(this.state.status==='restarting')this.set({status:'ready'})}
 installAfterClose(){
  if(this.state.status!=='restarting')return false;
  try{this.updater.quitAndInstall();return true}catch{this.failed();return false}
 }
}
function updateAvailability({packaged,platform,configured,signed}){
 if(!packaged)return 'Updates are available in installed release builds.';
 if(platform!=='darwin')return 'App updates are not available on this platform yet.';
 if(!configured||!signed)return 'This local build doesn’t receive app updates. Install a signed release to enable them.';
 return null;
}
module.exports={AppUpdates,updateAvailability};
