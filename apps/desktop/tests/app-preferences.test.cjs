const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {AppPreferences,AutomaticUpdateChecks}=require('../electron/app-preferences.cjs');
function fixture(t,extra={}){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'zq-preferences-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));let login={openAtLogin:false,status:'not-registered',wasOpenedAtLogin:false};const calls=[];const app={isPackaged:true,isInApplicationsFolder:()=>true,getLoginItemSettings:()=>login,setLoginItemSettings:value=>{calls.push(value);login={...login,openAtLogin:value.openAtLogin,status:value.openAtLogin?'enabled':'not-registered'}}};const service=new AppPreferences({directory,app,platform:'darwin',notificationsSupported:true,...extra});return {directory,app,service,calls,setLogin:value=>login=value}}
test('settings persist, invalid input preserves the file, and login state is read from macOS',t=>{
 const f=fixture(t);assert.equal(f.service.snapshot().launchAtLogin,false);f.service.save({startupView:'Code',startMinimized:true,notifications:{agents:true},automaticUpdates:true});
 const restored=new AppPreferences({directory:f.directory,app:f.app,platform:'darwin'});assert.equal(restored.state.startupView,'Code');assert.deepEqual(restored.state.notifications,{agents:true,research:false,tasks:false});
 const before=fs.readFileSync(f.service.file);for(const bad of [{startupView:'bogus'},{automaticUpdates:'yes'},{notifications:{unknown:true}},{launchAtLogin:true,closeBehavior:'quit'},null])assert.throws(()=>f.service.save(bad));assert.deepEqual(fs.readFileSync(f.service.file),before);
 f.service.save({launchAtLogin:true});assert.deepEqual(f.calls,[{openAtLogin:true}]);assert.equal(f.service.snapshot().launchAtLogin,true);
 f.setLogin({openAtLogin:false,status:'not-registered',wasOpenedAtLogin:false});assert.equal(f.service.snapshot().launchAtLogin,false);assert.equal(f.service.startHidden(),false);
 f.setLogin({openAtLogin:true,status:'enabled',wasOpenedAtLogin:true});assert.equal(f.service.startHidden(),true);
 f.setLogin({openAtLogin:false,status:'requires-approval',wasOpenedAtLogin:false});assert.equal(f.service.snapshot().loginStatus,'requires-approval');assert.equal(f.service.snapshot().launchAtLogin,true);
});
test('isolated and development builds cannot change OS login items',t=>{
 const f=fixture(t,{isolated:true});assert.equal(f.service.snapshot().loginSupported,false);assert.throws(()=>f.service.save({launchAtLogin:true}),/Applications/);assert.equal(f.calls.length,0);assert.equal(f.service.snapshot().notificationsSupported,false);
 f.service.isolated=false;f.app.isPackaged=false;assert.throws(()=>f.service.save({launchAtLogin:true}));assert.equal(f.calls.length,0);
});
test('corrupt preferences remain intact and are never silently overwritten',t=>{const f=fixture(t);fs.writeFileSync(f.service.file,'broken');const reopened=new AppPreferences({directory:f.directory,app:f.app});assert.throws(()=>reopened.snapshot(),/preserved/);assert.throws(()=>reopened.save({closeBehavior:'quit'}));assert.equal(fs.readFileSync(f.service.file,'utf8'),'broken')});
test('automatic update checks are opt-in, never download, avoid active updates, and stop when disabled',async()=>{
 let enabled=false,status='idle',checks=0;const timers=new Map();let id=0;const clock={setTimer:(fn,delay)=>{timers.set(++id,{fn,delay});return id},clearTimer:id=>timers.delete(id)};
 const service=new AutomaticUpdateChecks({updates:{snapshot:()=>({status}),check:async()=>{checks++}},enabled:()=>enabled,...clock});
 const tick=async()=>{const [id,{fn}]=timers.entries().next().value;timers.delete(id);await fn()};
 service.configure();assert.equal(timers.size,0);enabled=true;service.configure();assert.equal([...timers.values()][0].delay,30000);await tick();assert.equal(checks,1);assert.equal([...timers.values()][0].delay,21600000);
 for(const state of ['available','downloading','ready','restarting','unavailable']){status=state;await tick();assert.equal(checks,1)}
 enabled=false;service.configure();assert.equal(timers.size,0);service.close();
});
const {AppNotifications}=require('../electron/app-notifications.cjs'),{EventEmitter}=require('node:events');
test('notifications use live transitions, obey preferences and foreground suppression, and open the right work',()=>{
 const delivered=[],opened=[];let visible=false,enabled=true;
 class Notification extends EventEmitter{static isSupported(){return true}constructor(value){super();this.value=value}show(){delivered.push(this)}close(){this.emit('close')}}
 const service=new AppNotifications({Notification,enabled:()=>enabled,visible:()=>visible,open:target=>opened.push(target)});
 service.research({id:'old',status:'completed'});assert.equal(delivered.length,0);
 service.research({id:'new',status:'running'});service.research({id:'new',status:'completed',conversationId:'chat'});service.research({id:'new',status:'completed'});assert.equal(delivered.length,1);delivered[0].emit('click');assert.deepEqual(opened,[{view:'Chat',id:'chat'}]);
 const snapshot=state=>({sessions:[{id:'agent',adapter:'claude',state}]});service.code(snapshot('ready'));service.code(snapshot('busy'));service.code(snapshot('approval'));service.code(snapshot('approval'));assert.equal(delivered.length,2);
 visible=true;service.code(snapshot('busy'));service.code(snapshot('ready'));assert.equal(delivered.length,2);
 visible=false;enabled=false;service.tasks([{id:'task',status:'Doing'}]);service.tasks([{id:'task',status:'Done'}]);assert.equal(delivered.length,2);
 enabled=true;service.tasks([{id:'task',status:'Doing'}]);service.tasks([{id:'task',status:'Done'}]);assert.equal(delivered.length,3);service.close();assert.equal(service.live.size,0);
});
