const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {AppUpdates,updateAvailability}=require('../electron/app-updates.cjs');
function fixture(options={}){
 const engine=new EventEmitter(),calls={check:0,download:0,install:0},states=[];
 engine.checkForUpdates=async()=>{calls.check++;engine.emit('update-available',{version:'0.2.0'})};
 engine.downloadUpdate=async()=>{calls.download++;engine.emit('download-progress',{percent:54});engine.emit('update-downloaded',{version:'0.2.0'})};
 engine.quitAndInstall=()=>{calls.install++};
 const service=new AppUpdates({version:'0.1.0',createUpdater:async()=>engine,onChange:state=>states.push(state),...options});
 return {engine,calls,states,service};
}
test('local, unsigned and unsupported builds never contact an update server',async()=>{
 for(const input of [{packaged:false},{packaged:true,platform:'linux'},{packaged:true,platform:'darwin',configured:false,signed:true},{packaged:true,platform:'darwin',configured:true,signed:false}]){
  const reason=updateAvailability(input);assert.ok(reason);
  const {service,calls}=fixture({unavailable:reason});assert.equal((await service.check()).status,'unavailable');assert.equal(calls.check,0);
 }
 assert.equal(updateAvailability({packaged:true,platform:'darwin',configured:true,signed:true}),null);
});
test('checks coalesce and do not download or quit; install only happens after close',async()=>{
 const {service,engine,calls,states}=fixture();
 const a=service.check(),b=service.check();assert.equal(a,b);await a;
 assert.deepEqual(calls,{check:1,download:0,install:0});assert.equal(engine.autoDownload,false);assert.equal(engine.autoInstallOnAppQuit,false);assert.equal(engine.allowDowngrade,false);assert.equal(engine.allowPrerelease,false);
 await service.download();assert.ok(states.some(s=>s.percent===54));assert.equal(service.snapshot().status,'ready');
 await service.check();assert.equal(calls.check,1);
 service.requestInstall();assert.equal(calls.install,0);
 service.cancelInstall();assert.equal(service.snapshot().status,'ready');assert.equal(service.installAfterClose(),false);
 service.requestInstall();assert.equal(service.installAfterClose(),true);assert.equal(calls.install,1);
});
test('download failures are sanitized, retryable, and never install',async()=>{
 const {service,engine,calls}=fixture();await service.check();
 engine.downloadUpdate=async()=>{engine.emit('error',Error('https://secret-token@example.com'));throw Error('secret-token')};
 await service.download();assert.equal(service.snapshot().status,'error');assert.doesNotMatch(JSON.stringify(service.snapshot()),/secret-token/);assert.equal(calls.install,0);
 assert.throws(()=>service.requestInstall(),/Download/);await service.check();assert.equal(service.snapshot().status,'available');
});
test('authentication/check failures allow another check and do not claim to be current',async()=>{
 let attempts=0;const {service,engine}=fixture({createUpdater:async()=>{if(!attempts++)throw Error('credential secret');return engine}});
 await service.check();assert.equal(service.snapshot().status,'error');assert.equal(service.snapshot().checkedAt,null);
 await service.check();assert.equal(service.snapshot().status,'available');
});
test('a current release is recorded only after a successful response',async()=>{
 const {service,engine}=fixture();engine.checkForUpdates=async()=>engine.emit('update-not-available',{version:'0.1.0'});
 await service.check();assert.equal(service.snapshot().status,'current');assert.ok(service.snapshot().checkedAt);assert.equal(service.snapshot().availableVersion,null);
});
test('checking while downloading cannot replace the pending update',async()=>{
 const {service,engine}=fixture();await service.check();let resolve;
 engine.downloadUpdate=()=>new Promise(done=>{resolve=done});const download=service.download();await Promise.resolve();assert.equal(service.snapshot().status,'downloading');assert.equal(service.check(),download);engine.emit('update-downloaded',{version:'0.2.0'});resolve();await download;assert.equal(service.snapshot().status,'ready');
});
test('synchronous install failure becomes a recoverable error',async()=>{
 const {service,engine}=fixture();await service.check();await service.download();service.requestInstall();engine.quitAndInstall=()=>{throw Error('secret')};assert.equal(service.installAfterClose(),false);assert.equal(service.snapshot().status,'error');
});

test('public update feeds work without GitHub authentication; private builds retain native authentication',async()=>{
 const {updaterOptions}=require('../electron/update-runtime.cjs');
 const config={provider:'github',owner:'umzcio',repo:'zedQ'};let reads=0;
 const readToken=async()=>{reads++;return ' fixture-native-token \n'};
 for(const setting of [{},{private:false}]){
  const options=await updaterOptions({...config,...setting},readToken);
  assert.equal(options.private,false);assert.equal(options.token,undefined);
 }
 assert.equal(reads,0);
 const legacy=await updaterOptions({...config,private:true},readToken);
 assert.equal(reads,1);assert.equal(legacy.token,'fixture-native-token');
 await assert.rejects(updaterOptions({...config,private:true},async()=>''),/sign-in/);
 for(const change of [{owner:'someone-else'},{repo:'other'},{provider:'generic'},{private:'false'},{token:'embedded-token'}]){
  await assert.rejects(updaterOptions({...config,...change},readToken),/Unsupported/);
 }
 assert.equal(reads,1);
});
