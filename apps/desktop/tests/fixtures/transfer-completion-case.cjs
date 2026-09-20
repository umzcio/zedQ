module.exports=async function({page,assert,sampleSlow,output}){
 const root=page.locator('[data-testid=transfer-completion]');await root.scrollIntoViewIfNeeded();
 const api=async(method,value)=>{const result=await page.evaluate(({method,value})=>window.transferCompletionFixture[method](value),{method,value});if(method==='patch'||method==='reset')await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>resolve())));return result};
 const idle=async()=>{await page.waitForFunction(()=>![...document.querySelectorAll('[data-testid=transfer-completion] .code-transfer-check')].some(e=>e.dataset.entry!=='idle'));};
 const reset=async()=>{await api('reset');await root.getByText('Saved transfer.txt',{exact:false}).waitFor();await root.scrollIntoViewIfNeeded()};
 const start=async(keyboard=false)=>{const button=root.getByRole('button',{name:'Upload files',exact:true});if(keyboard){await button.focus();await page.keyboard.press('Enter')}else await button.click();await page.waitForFunction(()=>window.transferCompletionFixture.snapshot().pending)};
 const complete=async(options={})=>api('complete',options);
 const cue=()=>root.locator('.code-transfer-check[data-entry=end]');
 const inspect=async()=>cue().evaluate(e=>{const s=getComputedStyle(e);return {duration:s.transitionDuration,properties:s.transitionProperty,transform:s.transform,count:document.querySelectorAll('[data-testid=transfer-completion] .code-transfer-check[data-entry=end]').length}});
 await reset();assert.equal(await root.locator('.code-transfer-check[data-entry=idle][data-complete=true]').count(),1);
 // Production invocation, including a multi-file native result, grants one cue.
 await start();await complete({states:['done','done','done'],completed:3});await cue().waitFor();
 assert.equal((await inspect()).count,1);assert.equal((await inspect()).duration,'0.16s, 0.16s');
 await sampleSlow('transfer-completion','[data-testid=transfer-completion] .code-transfer-check[data-entry=end]');await idle();
 await page.waitForTimeout(780);assert.equal(await root.locator('.code-transfer-check:not([data-entry=idle])').count(),0);
 // A done row between files is not a batch boundary while the native call is pending.
 await reset();await start();await api('setRows',[{id:'history',name:'Saved transfer.txt',direction:'upload',bytes:100,total:100,state:'done'},{id:'early-done',name:'Early done.txt',direction:'upload',bytes:100,total:100,state:'done'}]);
 await page.waitForTimeout(800);assert.equal(await root.locator('.code-transfer-check:not([data-entry=idle])').count(),0);assert.equal((await api('snapshot')).pending,true);
 await complete({states:[],completed:1});await cue().waitFor();await idle();
 // Fast native success may finish before any running poll.
 await reset();await api('fast',true);await root.getByRole('button',{name:'Upload files',exact:true}).click();await cue().waitFor();await idle();
 // A missing observation baseline must not block the transfer or animate history.
 await reset();await api('failBaseline');await start();await complete();await page.waitForTimeout(65);assert.equal(await root.locator('.code-transfer-check:not([data-entry=idle])').count(),0);assert.equal(await root.locator('.code-transfer.done').count(),2);
 // Native keyboard initiation and keyboard menu selection stay static.
 await reset();await start(true);await complete();await page.waitForTimeout(65);assert.equal(await root.locator('.code-transfer-check:not([data-entry=idle])').count(),0);
 await reset();await root.getByRole('button',{name:'Folder actions',exact:true}).click();await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await page.waitForFunction(()=>window.transferCompletionFixture.snapshot().pending);await complete();await page.waitForTimeout(65);assert.equal(await root.locator('.code-transfer-check:not([data-entry=idle])').count(),0);
 // Pointer menu selection retains pointer modality through Radix onSelect.
 await reset();await root.getByRole('button',{name:'Folder actions',exact:true}).click();await page.getByRole('menuitem',{name:'Upload files…',exact:true}).click();await page.waitForFunction(()=>window.transferCompletionFixture.snapshot().pending);await complete();await cue().waitFor();await idle();
 for(const result of [{completed:0,canceled:true,states:[]},{completed:0,canceled:false,states:['skipped']}]){
  await reset();await start();await complete(result);await page.waitForTimeout(65);assert.equal(await root.locator('.code-transfer-check:not([data-entry=idle])').count(),0);
 }
 await reset();await start();await api('fail');await page.waitForTimeout(65);assert.equal(await root.locator('.code-transfer-check:not([data-entry=idle])').count(),0);
 // Hiding and returning before completion consumes eligibility, as does changing target.
 await reset();await start();await api('patch',{active:false});await api('patch',{active:true});await complete();await page.waitForTimeout(65);assert.equal(await root.locator('.code-transfer-check:not([data-entry=idle])').count(),0);
 await reset();await start();await api('patch',{target:'transfer-b'});await complete();await page.waitForTimeout(65);assert.equal(await root.locator('.code-transfer').count(),0);
 await reset();await start();await api('patch',{offscreen:true});await complete();await page.waitForTimeout(65);await api('patch',{offscreen:false});await page.waitForTimeout(30);assert.equal(await root.locator('.code-transfer-check:not([data-entry=idle])').count(),0);
 // Reopening completed history must not replay an earlier successful invocation.
 await reset();await start();await complete();await cue().waitFor();await api('patch',{mounted:false});await api('patch',{mounted:true});await page.waitForTimeout(65);assert.equal(await root.locator('.code-transfer-check:not([data-entry=idle])').count(),0);
 await page.emulateMedia({reducedMotion:'reduce'});await reset();await start();await complete();await cue().waitFor();const reduced=await inspect();assert.equal(reduced.duration,'0.08s');assert.equal(reduced.properties,'opacity');assert.equal(reduced.transform,'none');await idle();
 await page.emulateMedia({reducedMotion:'no-preference'});assert.equal(await root.locator('.code-transfer-check:not([data-entry=idle])').count(),0);
 await reset();await start();await complete();await cue().waitFor();await page.emulateMedia({reducedMotion:'reduce'});await idle();await page.emulateMedia({reducedMotion:'no-preference'});assert.equal(await root.locator('.code-transfer-check:not([data-entry=idle])').count(),0);
 // The row's existing context action remains available after completion.
 await root.locator('.code-transfer').last().click({button:'right'});await page.getByRole('menuitem',{name:'Copy file name',exact:true}).waitFor();await page.keyboard.press('Escape');
 await root.screenshot({path:require('node:path').join(output,'transfer-completion-light.png')});
 await page.evaluate(()=>document.documentElement.dataset.theme='dark');await root.screenshot({path:require('node:path').join(output,'transfer-completion-dark.png')});await page.evaluate(()=>document.documentElement.dataset.theme='light');
};
