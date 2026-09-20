const fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {AppUpdates,updateAvailability}=require('./app-updates.cjs');
function createAppUpdates({app,onChange}){
 const configPath=path.join(process.resourcesPath,'app-update.yml');
 let signed=false;
 if(app.isPackaged&&process.platform==='darwin'&&fs.existsSync(configPath))try{
  const bundle=path.resolve(process.execPath,'../../..');
  execFileSync('/usr/bin/codesign',['--verify','--strict',bundle],{stdio:'pipe',timeout:10000});
  const result=require('node:child_process').spawnSync('/usr/bin/codesign',['-d','--verbose=2',path.resolve(process.execPath,'../../..')],{encoding:'utf8',timeout:10000});
  signed=result.status===0&&/^Authority=Developer ID Application:/m.test(result.stderr)&&/^TeamIdentifier=[A-Z0-9]+$/m.test(result.stderr);
 }catch{signed=false}
 const unavailable=updateAvailability({packaged:app.isPackaged,platform:process.platform,configured:fs.existsSync(configPath),signed});
 return new AppUpdates({version:app.getVersion(),unavailable,onChange,createUpdater:async()=>{
  const config=require('js-yaml').load(fs.readFileSync(configPath,'utf8'));
  if(config.provider!=='github'||config.owner!=='umzcio'||config.repo!=='zedQ'||config.private!==true)throw new Error('Unsupported update feed');
  // Use this Mac's existing GitHub login. The token stays in the main process and is never packaged or logged.
  const token=(await new (require('./github/client.cjs').GitHubClient)().execute(['auth','token','--hostname','github.com'],{json:false})).trim();
  if(!token)throw new Error('GitHub sign-in is required');
  return new (require('electron-updater').MacUpdater)({...config,token});
 }});
}
module.exports={createAppUpdates};
