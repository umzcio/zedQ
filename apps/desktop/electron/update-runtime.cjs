const fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {AppUpdates,updateAvailability}=require('./app-updates.cjs');
async function updaterOptions(config,readToken){
 if(!config||config.provider!=='github'||config.owner!=='umzcio'||config.repo!=='zedQ'||![undefined,false,true].includes(config.private)||config.token)throw new Error('Unsupported update feed');
 if(config.private!==true)return {...config,private:false};
 // Compatibility for private builds. Public releases never request GitHub credentials.
 const token=(await readToken()).trim();
 if(!token)throw new Error('GitHub sign-in is required');
 return {...config,token};
}
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
  const options=await updaterOptions(config,()=>new (require('./github/client.cjs').GitHubClient)().execute(['auth','token','--hostname','github.com'],{json:false}));
  return new (require('electron-updater').MacUpdater)(options);
 }});
}
module.exports={createAppUpdates,updaterOptions};
