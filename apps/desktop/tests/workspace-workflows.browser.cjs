const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium}=require('playwright-core'),{WorkspaceStore}=require('../electron/storage.cjs');
const root=path.resolve(__dirname,'../../..');
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(root,'.local-data/workspace-browser-')),data=fs.mkdtempSync(path.join(os.tmpdir(),'zq-workflow-')),store=new WorkspaceStore(data);let server,browser;
 t.after(async()=>{await browser?.close();await server?.close();fs.rmSync(dir,{recursive:true,force:true});fs.rmSync(data,{recursive:true,force:true})});
 store.save({notes:[{id:'b',title:'Note B',body:'Second note',project:'',updated:'Just now',pinned:false},{id:'a',title:'Note A',body:'Selected next step',project:'',updated:'Just now',pinned:false}],tasks:[{id:'t',title:'Existing task',description:'Context',project:'',status:'Next',priority:'Normal'}],theme:'light',palette:'gunmetal',layout:{view:'Notes',selectedNote:'a',tabs:['a','b'],tabOrder:['note:a','note:b'],sidebar:true,split:false,quickCapture:'',activeFileId:null}});
 fs.writeFileSync(path.join(dir,'index.html'),'<div id="root"></div><script type="module" src="/main.tsx"></script>');
 fs.writeFileSync(path.join(dir,'main.tsx'),`import{createRoot}from'react-dom/client';import{TooltipProvider}from'@zq/ui';import DesktopRoot from '${root}/apps/desktop/src/DesktopRoot';import notes from '${root}/modules/notes';import tasks from '${root}/modules/tasks';import hq from '${root}/modules/hq';import notesManifest from '${root}/modules/notes/manifest.json';import tasksManifest from '${root}/modules/tasks/manifest.json';import hqManifest from '${root}/modules/hq/manifest.json';import'@zq/ui/styles.css';import'${root}/apps/desktop/src/shell.css';const noop=()=>()=>{};window.zq={platform:'darwin',workspace:{load:()=>window.loadFixture(),save:s=>window.saveFixture(s),saveDraftCopy:async x=>{window.savedCopy=x;return{ok:true,value:true}}},files:{list:async()=>({ok:true,value:[]})},onCommand:noop,onCloseCancelled:noop,onCloseRequested:f=>{window.requestClose=f;return()=>{}},finishClose:(id,error)=>window.closeResult={id,error},chat:{saveTextFile:async x=>{window.savedCopy=x;return{ok:true,value:true}}},artifacts:{},clipboard:{},voice:{},connectors:{}};createRoot(document.getElementById('root')).render(<TooltipProvider><DesktopRoot modules={[{...hq,manifest:hqManifest},{...notes,manifest:notesManifest},{...tasks,manifest:tasksManifest}]}/></TooltipProvider>);`);
 const{createServer}=await import('vite'),{default:react}=await import('@vitejs/plugin-react'),{default:tailwind}=await import('@tailwindcss/vite');server=await createServer({root:dir,configFile:false,logLevel:'error',plugins:[react(),tailwind()],resolve:{alias:{'@zq/module-api':path.join(root,'packages/module-api/index.ts'),'@zq/ui/styles.css':path.join(root,'packages/ui/styles.css'),'@zq/ui':path.join(root,'packages/ui/index.ts')},dedupe:['react','react-dom','radix-ui']},server:{host:'127.0.0.1',port:0,fs:{allow:[root]}}});await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1300,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.exposeFunction('loadFixture',()=>({ok:true,value:store.load()}));await page.exposeFunction('saveFixture',s=>{try{store.save(s);return{ok:true,value:null}}catch(e){return{ok:false,error:{code:e.code,message:e.message}}}});await page.goto(server.resolvedUrls.local[0]);await page.getByRole('textbox',{name:'Note content',exact:true}).waitFor({timeout:10000});return{page,store,errors};
}
test('task commands from Notes, HQ and search open once with context and cancellation', {timeout:40000},async t=>{
 const{page,store,errors}=await fixture(t);await page.getByRole('textbox',{name:'Note content',exact:true}).evaluate(el=>{el.focus();el.setSelectionRange(0,8)});await page.getByRole('button',{name:'Create a task linked to this note',exact:true}).click();await page.getByRole('dialog').waitFor({timeout:2000});assert.equal(await page.getByRole('textbox',{name:'Task title',exact:true}).inputValue(),'Selected');assert.equal(await page.locator('.linked-note').innerText().then(s=>s.trim()),'Note A');await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.waitForFunction(()=>document.activeElement?.textContent?.includes('New task'));assert.equal(store.load().tasks.length,1);
 await page.getByRole('button',{name:'zQ home',exact:true}).click();await page.getByRole('button',{name:'Add something to do',exact:true}).click();await page.getByRole('dialog').waitFor();await page.getByRole('textbox',{name:'Task title',exact:true}).fill('New task');await page.getByRole('button',{name:'Save task',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('[role=dialog]'));
 await page.getByRole('button',{name:'Notes module',exact:true}).click();await page.keyboard.press('Meta+k');await page.getByRole('textbox',{name:'Search workspace',exact:true}).fill('Existing task');await page.getByRole('button',{name:/Existing task.*Next/}).click();await page.getByRole('dialog').waitFor();assert.equal(await page.getByRole('textbox',{name:'Task description',exact:true}).inputValue(),'Context');await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.deepEqual(errors,[]);
});
test('HQ resumes real note activity across a reload and leaves note order intact', {timeout:40000},async t=>{
 const{page,store,errors}=await fixture(t);
 await page.getByRole('textbox',{name:'Note content',exact:true}).fill('Edited older note');
 await page.getByRole('button',{name:'zQ home',exact:true}).click();
 assert.equal(await page.locator('.resume-body h2').innerText(),'Note A');
 assert.equal(await page.locator('.recent-row strong').first().innerText(),'Note A');
 assert.equal(await page.locator('.recent-row').last().innerText().then(x=>x.includes('Saved note')),true);
 await page.reload();await page.locator('.resume-body').waitFor();
 assert.equal(await page.locator('.resume-body h2').innerText(),'Note A');
 await page.locator('.recent-row').filter({hasText:'Note B'}).click();
 await page.getByRole('button',{name:'zQ home',exact:true}).click();
 assert.equal(await page.locator('.resume-body h2').innerText(),'Note B');
 assert.deepEqual(store.load().notes.map(n=>n.id),['b','a']);assert.deepEqual(errors,[]);
});
test('invalid note drafts preserve full text, allow unrelated saves, and block closing', {timeout:40000},async t=>{
 const{page,store,errors}=await fixture(t),long='界'.repeat(1366);
 await page.getByRole('textbox',{name:'Note title',exact:true}).fill(long);
 await page.getByRole('button',{name:'Review edits',exact:true}).waitFor();
 assert.equal(await page.getByRole('textbox',{name:'Note title',exact:true}).inputValue(),long);
 await page.getByRole('button',{name:'Review edits',exact:true}).click();
 await page.getByRole('button',{name:'Save a copy…',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.savedCopy.text),long);
 await page.getByRole('button',{name:'Go to edit',exact:true}).click();
 await page.getByRole('button',{name:'zQ home',exact:true}).click();
 await page.getByRole('button',{name:'Add something to do',exact:true}).click();
 await page.getByRole('textbox',{name:'Task title',exact:true}).fill('Unrelated valid task');
 await page.getByRole('button',{name:'Save task',exact:true}).click();
 await page.evaluate(()=>window.requestClose('test-close'));
 await page.waitForFunction(()=>window.closeResult);
 assert.match(await page.evaluate(()=>window.closeResult.error),/title|edit/i);
 assert.equal(store.load().notes.find(n=>n.id==='a').title,'Note A');
 assert.ok(store.load().tasks.some(t=>t.title==='Unrelated valid task'));
 await page.getByRole('button',{name:'Notes module',exact:true}).click();
 assert.equal(await page.getByRole('textbox',{name:'Note title',exact:true}).inputValue(),long);
 await page.getByRole('textbox',{name:'Note title',exact:true}).fill('Corrected title');
 await page.getByRole('button',{name:'Review edits',exact:true}).waitFor({state:'hidden'});
 await page.evaluate(()=>{window.closeResult=null;window.requestClose('valid-close')});
 await page.waitForFunction(()=>window.closeResult);
 assert.equal(await page.evaluate(()=>window.closeResult.error),undefined);
 assert.equal(store.load().notes.find(n=>n.id==='a').title,'Corrected title');assert.deepEqual(errors,[]);
});
