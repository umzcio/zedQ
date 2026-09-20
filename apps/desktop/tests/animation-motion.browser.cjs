const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os');
const {_electron:electron}=require('playwright-core');

(async()=>{
 const {build}=await import('vite'),{default:react}=await import('@vitejs/plugin-react'),{default:tailwind}=await import('@tailwindcss/vite');
 const repo=process.cwd(),output=path.join(repo,'.local-data');fs.mkdirSync(output,{recursive:true});
 const fixtureRoot=fs.mkdtempSync(path.join(output,'animation-motion-')),data=fs.mkdtempSync(path.join(os.tmpdir(),'zq-motion-'));
 let app,server,page;
 try{
  fs.writeFileSync(path.join(fixtureRoot,'index.html'),'<html><body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>');
  const entry=path.relative(fixtureRoot,path.join(repo,'apps/desktop/tests/fixtures/animation-motion.tsx')).split(path.sep).join('/');
  fs.writeFileSync(path.join(fixtureRoot,'main.tsx'),`import ${JSON.stringify(entry)};`);
  await build({root:fixtureRoot,configFile:false,logLevel:'error',plugins:[react(),tailwind()],resolve:{dedupe:['react','react-dom','radix-ui']}});
  const dist=path.join(fixtureRoot,'dist');server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname,file=path.resolve(dist,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(dist+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return}res.setHeader('Content-Type',/\.js$/.test(file)?'text/javascript':/\.css$/.test(file)?'text/css':'text/html');fs.createReadStream(file).pipe(res)});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}`;
  const main=path.join(fixtureRoot,'main.cjs');fs.writeFileSync(main,`const {app,BrowserWindow}=require('electron');app.setPath('userData',process.env.ZQ_DATA_DIR);app.whenReady().then(()=>{const win=new BrowserWindow({width:1280,height:940,webPreferences:{contextIsolation:true,sandbox:true}});win.loadURL(${JSON.stringify(url)});});app.on('window-all-closed',()=>app.quit());`);
  const env={...process.env,ZQ_DATA_DIR:data};delete env.ELECTRON_RUN_AS_NODE;
  app=await electron.launch({executablePath:require('electron'),args:[main],env});page=await app.firstWindow();await page.waitForFunction(()=>window.motionFixture);await page.bringToFront();page.setDefaultTimeout(6000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const patch=async value=>{await page.evaluate(value=>window.motionFixture.patch(value),value);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>r())))};
  const settle=()=>page.evaluate(()=>Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{}))));
  const style=selector=>page.locator(selector).evaluate(e=>{const s=getComputedStyle(e);return {duration:s.animationDuration,easing:s.animationTimingFunction,animation:s.animationName,transition:s.transitionProperty,transitionDuration:s.transitionDuration,opacity:Number(s.opacity),origin:s.transformOrigin,animations:e.getAnimations().map(a=>({state:a.playState,frames:a.effect.getKeyframes()}))}});
  const none=async selector=>assert.equal((await style(selector)).animations.length,0,`${selector} must not animate`);
  const reset=async()=>{await page.emulateMedia({reducedMotion:'no-preference'});await patch({search:false,dialog:false,popover:false,hover:false,saveStatus:'Saved on this Mac',notice:'',noticeMounted:true,chatCSS:'after',theme:'light',tabsMounted:true,tabsDisabled:false});await page.waitForTimeout(230)};
  const slowSamples=[];
  const sampleSlow=async(name,selector)=>{
   const locator=page.locator(selector);
   await locator.evaluate(async e=>{for(let i=0;i<4&&!e.getAnimations().length;i++)await new Promise(r=>requestAnimationFrame(r));const animations=e.getAnimations();if(!animations.length)throw Error('No animation to sample');for(const a of animations){a.currentTime=0;a.playbackRate=.1;a.play()}});
   await page.waitForTimeout(60);
   const sample=await locator.evaluate(e=>{const s=getComputedStyle(e);return {opacity:s.opacity,transform:s.transform,origin:s.transformOrigin,animations:e.getAnimations().map(a=>({rate:a.playbackRate,time:a.currentTime,progress:a.effect.getComputedTiming().progress,frames:a.effect.getKeyframes()}))}});
   assert(sample.animations.length>0,`${name}: slow playback must remain active`);assert(sample.animations.every(a=>a.rate===.1&&a.time>0&&a.progress<.5),`${name}: ${JSON.stringify(sample)}`);
   slowSamples.push({name,...sample});await locator.evaluate(e=>{for(const a of e.getAnimations()){a.playbackRate=1;a.finish()}});
  };
  const cases={
   'transfer-completion':()=>require('./fixtures/transfer-completion-case.cjs')({page,assert,sampleSlow,output}),
   'module-update-ready':()=>require('./fixtures/module-update-case.cjs')({page,assert,patch,sampleSlow,output}),
   'copy-feedback':()=>require('./fixtures/copy-feedback-case.cjs')({page,assert,patch,sampleSlow,output}),
   async search(){
    for(const reducedMotion of ['no-preference','reduce']){
     await page.emulateMedia({reducedMotion});await page.locator('#search-trigger').focus();await page.keyboard.press('Meta+k');
     await page.getByRole('textbox',{name:'Search workspace'}).waitFor();await none('[data-slot=dialog-content]');await none('[data-slot=dialog-overlay]');
     assert.equal(await page.getByRole('textbox',{name:'Search workspace'}).evaluate(e=>e===document.activeElement),true);
     const geometry=await page.locator('[data-slot=dialog-content]').evaluate(e=>{const r=e.getBoundingClientRect();return {x:r.x+r.width/2-innerWidth/2,y:r.y+r.height/2-innerHeight/2}});assert(Math.abs(geometry.x)<1&&Math.abs(geometry.y)<1,JSON.stringify(geometry));
     await page.keyboard.type('instant');await page.keyboard.press('Escape');assert.equal(await page.locator('[data-slot=dialog-content]').count(),0);assert.equal(await page.locator('[data-slot=dialog-overlay]').count(),0);assert.equal(await page.locator('#search-trigger').evaluate(e=>e===document.activeElement),true);
    }
   },
   async 'shared-timing'(){
    for(const chatCSS of ['absent','before','after']){
     await patch({chatCSS,dialog:true});const dialog=await style('[data-slot=dialog-content]'),overlay=await style('[data-slot=dialog-overlay]');
     assert.equal(dialog.duration,'0.2s');assert.equal(overlay.duration,'0.2s');assert.equal(dialog.easing,'cubic-bezier(0.23, 1, 0.32, 1)');if(chatCSS==='absent')await sampleSlow('dialog','[data-slot=dialog-content]');
     await patch({dialog:false});assert.equal((await style('[data-slot=dialog-content][data-state=closed]')).duration,'0.15s');await page.locator('[data-slot=dialog-content]').waitFor({state:'detached'});
     await patch({popover:true});assert.equal((await style('[data-slot=popover-content]')).duration,'0.15s');await patch({popover:false});assert.equal((await style('[data-slot=popover-content][data-state=closed]')).duration,'0.125s');await page.locator('[data-slot=popover-content]').waitFor({state:'detached'});
    }
    await page.emulateMedia({reducedMotion:'reduce'});await patch({dialog:true});await none('[data-slot=dialog-content]');await none('[data-slot=dialog-overlay]');await patch({dialog:false,popover:true});await none('[data-slot=popover-content]');
   },
   async 'hover-origin'(){
    const sides=new Set();
    for(const hoverPosition of ['center','top-left','top-right','bottom-left','bottom-right']){
     await patch({hoverPosition,hover:true});await page.waitForTimeout(40);
     const origin=await page.locator('[data-slot=hover-card-content]').evaluate(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return {actual:s.transformOrigin,expected:s.getPropertyValue('--radix-hover-card-content-transform-origin').trim().split(' ').map((v,i)=>v.endsWith('%')?(parseFloat(v)/100*(i===0?e.offsetWidth:e.offsetHeight))+'px':v).join(' '),side:e.dataset.side,rect:{left:r.left,top:r.top,right:r.right,bottom:r.bottom},width:innerWidth,height:innerHeight}});
     assert.equal(origin.actual,origin.expected,JSON.stringify(origin));sides.add(origin.side);assert(origin.rect.left>=-1&&origin.rect.right<=origin.width+1);assert(origin.rect.top>=-1&&origin.rect.bottom<=origin.height+1);
     assert.equal((await style('[data-slot=hover-card-content]')).duration,'0.15s');if(hoverPosition==='center')await sampleSlow('hover-card','[data-slot=hover-card-content]');await patch({hover:false});await page.locator('[data-slot=hover-card-content]').waitFor({state:'detached'});
    }
    assert(sides.has('top')&&sides.has('bottom'),'Viewport edges must exercise Radix side flips');
   },
   async attachments(){
    await patch({owner:'draft-history',attachments:['old-a','old-b'],ready:true});await none('[data-testid=historical] .attachment-card');assert.equal(await page.locator('[data-testid=attachments] [data-animate-entry=true]').count(),0);
    await patch({attachments:['old-a','old-b','new-one']});const added=page.locator('[data-testid=attachments] .attachment-card').filter({hasText:'new-one.txt'});assert.equal(await added.getAttribute('data-animate-entry'),'true');assert.equal(await added.evaluate(e=>getComputedStyle(e).animationDuration),'0.15s');await sampleSlow('attachment','[data-testid=attachments] [data-animate-entry=true]');
    await page.waitForTimeout(220);assert.equal(await added.getAttribute('data-animate-entry'),'false');await patch({attachments:['old-a','old-b','new-one']});assert.equal(await added.getAttribute('data-animate-entry'),'false');
    await patch({attachments:['old-a','old-b']});await patch({attachments:['old-a','old-b','new-one']});assert.equal(await added.getAttribute('data-animate-entry'),'true');await page.waitForTimeout(200);
    await patch({owner:'draft-second',attachments:['new-one','saved-two'],ready:true});assert.equal(await page.locator('[data-testid=attachments] [data-animate-entry=true]').count(),0);
    await patch({owner:'draft-history',attachments:['old-a','old-b','new-one']});assert.equal(await page.locator('[data-testid=attachments] [data-animate-entry=true]').count(),0);
    await patch({owner:'hydrating',attachments:[],ready:false});await patch({attachments:['loaded'],ready:true});assert.equal(await page.locator('[data-testid=attachments] [data-animate-entry=true]').count(),0);
    await page.emulateMedia({reducedMotion:'reduce'});await patch({attachments:['loaded','reduced']});assert.equal(await page.locator('[data-testid=attachments] [data-animate-entry=true]').count(),0);
    await page.emulateMedia({reducedMotion:'no-preference'});await patch({attachments:['loaded','reduced']});assert.equal(await page.locator('[data-testid=attachments] [data-animate-entry=true]').count(),0);
   },
   async disclosures(){
    const trigger=page.getByRole('button',{name:'Thought process',exact:true});await trigger.click();await none('[data-testid=disclosure]');assert.equal(await trigger.getAttribute('aria-expanded'),'true');
    const firstHeight=await page.locator('[data-testid=disclosure]').evaluate(e=>e.getBoundingClientRect().height);await patch({disclosureText:Array(35).fill('New streamed thought').join('\n')});await none('[data-testid=disclosure]');assert(await page.locator('[data-testid=disclosure]').evaluate(e=>e.getBoundingClientRect().height)>firstHeight);
    await patch({disclosure:false});assert.equal(await page.locator('[data-testid=disclosure]').isVisible(),false);await patch({disclosure:true});await page.waitForTimeout(25);
    const before=await trigger.locator('svg').evaluate(e=>getComputedStyle(e).transform);await patch({disclosure:false});const after=await trigger.locator('svg').evaluate(e=>getComputedStyle(e).transform);assert.notEqual(before,'none');assert.notEqual(after,'none');
    assert.equal(await trigger.locator('svg').evaluate(e=>getComputedStyle(e).transitionDuration),'0.16s');
    await page.emulateMedia({reducedMotion:'reduce'});await patch({disclosure:true});assert.equal(await trigger.locator('svg').evaluate(e=>e.getAnimations().length),0);await none('[data-testid=disclosure]');
    await page.emulateMedia({reducedMotion:'no-preference'});await patch({projectOpen:true});await none('[data-testid=project-disclosure]');assert.equal(await page.locator('.project-expand-caret').evaluate(e=>getComputedStyle(e).transitionProperty),'opacity');await patch({projectOpen:false});assert.equal(await page.locator('[data-testid=project-disclosure]').isVisible(),false);
   },
   async 'tab-edge-scroll'(){
    await page.evaluate(()=>window.motionFixture.resetTabs());await page.locator('.workspace-tabs').scrollIntoViewIfNeeded();const strip=page.locator('.workspace-tabs'),first=page.getByRole('tab',{name:'Document 1',exact:true});
    async function start(){await strip.evaluate(e=>e.scrollLeft=0);const tab=await first.boundingBox(),bounds=await strip.boundingBox();await page.mouse.move(tab.x+40,tab.y+tab.height/2);await page.mouse.down();await page.mouse.move(bounds.x+bounds.width-3,bounds.y+bounds.height/2);return bounds}
    const bounds=await start();await page.waitForTimeout(220);const s1=await strip.evaluate(e=>e.scrollLeft);await page.waitForTimeout(220);const s2=await strip.evaluate(e=>e.scrollLeft);assert(s1>30&&s2>s1+30,`Held pointer must scroll continuously: ${s1},${s2}`);
    await page.mouse.move(bounds.x+bounds.width-3,bounds.y+bounds.height+60);await page.waitForTimeout(40);const away=await strip.evaluate(e=>e.scrollLeft);await page.waitForTimeout(100);assert.equal(await strip.evaluate(e=>e.scrollLeft),away);
    await page.keyboard.press('Escape');await page.mouse.up();assert.deepEqual(await page.evaluate(()=>window.motionFixture.snapshot().tabs.order),Array.from({length:24},(_,i)=>`note:${i}`));
    await start();await page.waitForTimeout(120);await patch({tabsDisabled:true});const disabled=await strip.evaluate(e=>e.scrollLeft);await page.waitForTimeout(120);assert.equal(await strip.evaluate(e=>e.scrollLeft),disabled);await page.mouse.up();await patch({tabsDisabled:false});
    await page.emulateMedia({reducedMotion:'reduce'});await start();await page.waitForTimeout(150);assert(await strip.evaluate(e=>e.scrollLeft)>20);await page.keyboard.press('Escape');await page.mouse.up();
    await first.focus();await page.keyboard.press('Alt+Shift+ArrowRight');assert.equal((await page.evaluate(()=>window.motionFixture.snapshot().tabs.order))[1],'note:0');
    await start();await patch({tabsMounted:false});await page.mouse.up();await patch({tabsMounted:true});await strip.waitFor();
   },
   async 'kanban-arrival'(){
    await page.waitForFunction(()=>window.codeArrivalFixture);
    const invoke=async(method,value)=>{await page.evaluate(({method,value})=>window.codeArrivalFixture[method](value),{method,value});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(r)))};
    const board=page.getByTestId('kanban-arrival'),cue=board.locator('.pr-card-arrival');
    const empty=async()=>{assert.equal(await cue.count(),0);assert.deepEqual(await page.evaluate(()=>window.codeArrivalFixture.snapshot().arrivals),{})};
    await invoke('reset','complete');await board.scrollIntoViewIfNeeded();await empty();
    await invoke('reset','running');await board.scrollIntoViewIfNeeded();await invoke('send',{state:'complete'});assert.equal(await cue.count(),1);
    const cueStyle=await cue.evaluate(e=>{const s=getComputedStyle(e);return {transition:s.transitionProperty,duration:s.transitionDuration,hidden:e.getAttribute('aria-hidden'),pointer:s.pointerEvents}});assert.deepEqual(cueStyle,{transition:'opacity',duration:'0.2s',hidden:'true',pointer:'none'});await sampleSlow('kanban-completion','[data-testid=kanban-arrival] .pr-card-arrival');
    await page.waitForTimeout(330);await empty();await invoke('send',{state:'complete'});await empty();
    await invoke('send',{state:'running',runId:'run-2',automatic:false});await invoke('send',{state:'complete'});assert.equal(await cue.count(),1);await invoke('send',{stage:'Ready to merge',automatic:false});await empty();
    await invoke('reset','running');const ticket=await page.evaluate(()=>window.codeArrivalFixture.begin());await invoke('patch',{scope:'new-filter'});await invoke('send',{state:'complete',ticket});await empty();
    await invoke('reset','running');await invoke('patch',{active:false});await invoke('send',{state:'complete'});await invoke('patch',{active:true});await empty();
    await invoke('reset','running');await invoke('patch',{shown:false});await invoke('send',{state:'complete'});await invoke('patch',{shown:true});await empty();
    await invoke('reset','running');await invoke('patch',{offscreen:true});await invoke('send',{state:'complete'});await empty();await invoke('patch',{offscreen:false});await empty();
    await page.emulateMedia({reducedMotion:'reduce'});await invoke('reset','running');await invoke('send',{state:'complete'});await empty();await page.emulateMedia({reducedMotion:'no-preference'});await invoke('send',{state:'complete'});await empty();
    for(const theme of ['light','dark']){await patch({theme});await board.screenshot({path:path.join(output,`animation-kanban-${theme}.png`)})}
   },
   async 'save-notices'(){
    const toast=page.locator('.shell-notice');await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await toast.count(),0,'No saved notification at startup');
    await patch({saveStatus:'Saving…'});await page.waitForTimeout(100);await patch({saveStatus:'Saved on this Mac'});await page.waitForTimeout(850);assert.equal(await toast.count(),0,'Fast autosaves stay silent and cancel the delay');
    await patch({saveStatus:'Saving…'});await toast.filter({hasText:'Saving workspace…'}).waitFor();
    await patch({saveStatus:'Saved on this Mac'});assert.equal(await toast.innerText(),'Workspace saved on this Mac');await toast.waitFor({state:'detached'});
    await patch({saveStatus:'Unable to save — keep zQ open'});assert.equal(await toast.innerText(),'Workspace could not be saved. Keep zQ open.');await page.waitForTimeout(2600);assert.equal(await toast.count(),1,'Save failures do not expire');
    await patch({saveStatus:'Saving…',notice:'An ordinary action'});await page.waitForTimeout(850);assert.equal(await toast.innerText(),'Workspace could not be saved. Keep zQ open.','Retry and ordinary notices cannot hide an unresolved failure');
    await patch({saveStatus:'Saved on this Mac',notice:''});assert.equal(await toast.innerText(),'Workspace saved on this Mac');
    await patch({saveStatus:'Saving…'});await patch({saveStatus:'Saved on this Mac'});await toast.waitFor({state:'detached'});
    await patch({saveStatus:'Valid changes saved · drafts need attention'});assert.equal(await toast.count(),0,'Draft issues use their existing actionable banner');
   },
   async notices(){
    await patch({notice:'First notice'});const notice=page.locator('.shell-notice');await notice.waitFor();const handle=await notice.elementHandle();await page.waitForTimeout(45);const entering=await notice.evaluate(e=>Number(getComputedStyle(e).opacity));assert(entering>0&&entering<=1);
    await patch({notice:'Replacement during entry'});assert.equal(await handle.evaluate(e=>e===document.querySelector('.shell-notice')),true);await page.waitForTimeout(170);assert.equal(await notice.evaluate(e=>Number(getComputedStyle(e).opacity)),1);
    await patch({notice:''});await page.waitForTimeout(45);const leaving=await notice.evaluate(e=>Number(getComputedStyle(e).opacity));assert(leaving>=0&&leaving<1);
    await patch({notice:'Replacement during exit'});assert.equal(await handle.evaluate(e=>e===document.querySelector('.shell-notice')),true);await page.waitForTimeout(260);assert.equal(await notice.innerText(),'Replacement during exit');assert.equal(await notice.evaluate(e=>Number(getComputedStyle(e).opacity)),1);
    await patch({notice:''});await page.emulateMedia({reducedMotion:'reduce'});await notice.waitFor({state:'detached'});await patch({notice:'Reduced notice'});assert.equal(await notice.evaluate(e=>Number(getComputedStyle(e).opacity)),1);await none('.shell-notice');await patch({notice:''});assert.equal(await notice.count(),0);
    await page.emulateMedia({reducedMotion:'no-preference'});await patch({notice:'Unmount during entry'});await patch({noticeMounted:false});await page.waitForTimeout(230);assert.equal(await notice.count(),0);await patch({noticeMounted:true,notice:'Latest mounted notice'});await page.waitForTimeout(220);assert.equal(await notice.innerText(),'Latest mounted notice');
   }
  };
  const selected=process.env.ZQ_MOTION_CASES?process.env.ZQ_MOTION_CASES.split(',').map(s=>s.trim()).filter(Boolean):Object.keys(cases);
  for(const name of selected){assert(cases[name],`Unknown motion case: ${name}`);await reset();await cases[name]();console.log(`PASS: ${name}`)}
  await reset();await patch({disclosure:true,disclosureText:'Immediate disclosure layout',notice:'Motion checks complete'});await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(220);await settle();
  for(const theme of ['light','dark']){await patch({theme});await page.screenshot({path:path.join(output,`animation-motion-${theme}.png`)});}
  fs.writeFileSync(path.join(output,'animation-slow-motion.json'),JSON.stringify(slowSamples,null,2));
  assert.deepEqual(errors,[]);console.log('PASS: isolated Electron motion regression fixture; no native services or user data accessed.');
 }catch(error){if(page){await page.screenshot({path:path.join(output,'animation-motion-failure.png')}).catch(()=>{});console.error(await page.locator('body').innerText().catch(()=>''))}throw error}
 finally{await app?.close();await new Promise(resolve=>server?server.close(resolve):resolve());fs.rmSync(fixtureRoot,{recursive:true,force:true});fs.rmSync(data,{recursive:true,force:true})}
})().catch(error=>{console.error(error);process.exitCode=1});
