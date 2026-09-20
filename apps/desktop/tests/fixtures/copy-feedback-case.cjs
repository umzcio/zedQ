const path=require('node:path');
module.exports=async function({page,assert,patch,sampleSlow,output}){
 await page.waitForFunction(()=>window.copyFeedbackFixture);
 const call=async(method,...args)=>{await page.evaluate(({method,args})=>window.copyFeedbackFixture[method](...args),{method,args});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)))};
 const snapshot=()=>page.evaluate(()=>window.copyFeedbackFixture.snapshot());
 const reset=async()=>{await call('reset');await page.emulateMedia({reducedMotion:'no-preference'});await page.getByTestId('copy-feedback').scrollIntoViewIfNeeded()};
 const appearance=icon=>icon.evaluate(element=>({animate:element.dataset.animate,copied:element.dataset.copied,children:[...element.children].map(glyph=>{const style=getComputedStyle(glyph);return {opacity:Number(style.opacity),duration:style.transitionDuration,property:style.transitionProperty,transform:style.transform,animations:glyph.getAnimations().length}})}));
 for(const kind of ['code','message']){
  const area=page.getByTestId('copy-'+kind),icon=area.locator('.chat-copy-feedback'),label=kind==='code'?'Copy code':'Copy message',success=kind==='code'?'Code copied':'Message copied';
  const button=()=>area.getByRole('button',{name:new RegExp(`^(${label}|${success})$`)});
  await reset();await area.hover();const bounds=await button().boundingBox();
  assert.equal((await appearance(icon)).children.every(child=>child.animations===0),true,'History starts static');
  await button().click();await sampleSlow('copy-'+kind,`[data-testid=copy-${kind}] .chat-copy-feedback>svg:last-child`);
  assert.equal(await button().getAttribute('aria-label'),success);assert.deepEqual(await button().boundingBox(),bounds,'Confirmation cannot shift button bounds');
  assert.equal(await area.getByRole('status').count(),1);assert.equal(await area.getByRole('status').textContent(),success);
  const pointer=await appearance(icon);assert.equal(pointer.animate,'true');assert(pointer.children.every(child=>child.duration==='0.12s'&&child.property==='opacity'&&child.transform==='none'));
  // Keyboard mode stays instant on success and on its later reset.
  await reset();await button().focus();await page.keyboard.press('Enter');const keyboard=await appearance(icon);assert.equal(keyboard.animate,'false');assert(keyboard.children.every(child=>child.animations===0));
  await page.waitForTimeout(1850);assert.equal((await appearance(icon)).copied,'false');assert((await appearance(icon)).children.every(child=>child.animations===0));
  await reset();await call('mode','failure');await button().click();assert.equal((await appearance(icon)).copied,'false');assert.equal((await snapshot()).notices.length,1);
  // A late pointer request cannot overwrite a more recent keyboard confirmation.
  await reset();await call('mode','hold');await button().click();await button().focus();await page.keyboard.press('Enter');let pending=(await snapshot()).pending;
  assert.equal(pending.length,2);await call('settle',pending[1]);assert.equal((await appearance(icon)).animate,'false');await call('settle',pending[0]);assert.equal((await appearance(icon)).animate,'false');
  // Repeated success extends lifetime without replaying entrance.
  await reset();await button().click();await page.waitForTimeout(1000);await button().click();assert((await appearance(icon)).children.every(child=>child.animations===0));await page.waitForTimeout(1000);assert.equal((await appearance(icon)).copied,'true');
  await page.waitForFunction(testId=>document.querySelector(`[data-testid="${testId}"] .chat-copy-feedback`)?.dataset.copied==='false','copy-'+kind);
  // Copy while the reset fade is reversing: nodes persist and retarget.
  const glyph=await icon.locator('svg').last().elementHandle();await button().click();assert.equal(await glyph.evaluate((node,testId)=>node===document.querySelector(`[data-testid="${testId}"] .chat-copy-feedback>svg:last-child`),'copy-'+kind),true);assert.equal((await appearance(icon)).copied,'true');
  // No completion notification/state after unmount, including failure.
  await reset();await call('mode','hold');await button().click();pending=(await snapshot()).pending;await call('patch',{[kind+'Mounted']:false});await call('settle',pending[0],false);assert.equal((await snapshot()).notices.length,0);await call('patch',{[kind+'Mounted']:true});assert.equal((await appearance(icon)).copied,'false');
  await reset();await page.emulateMedia({reducedMotion:'reduce'});await button().click();assert((await appearance(icon)).children.every(child=>child.duration==='0.08s'&&child.property==='opacity'&&child.transform==='none'));await page.waitForTimeout(100);
  await page.emulateMedia({reducedMotion:'no-preference'});assert((await appearance(icon)).children.every(child=>child.animations===0),'Preference change cannot replay success');
  await reset();await page.emulateMedia({reducedMotion:'reduce'});await button().focus();await page.keyboard.press('Enter');assert.equal((await appearance(icon)).animate,'false');assert((await appearance(icon)).children.every(child=>child.animations===0));
 }
 // The actual Radix menu follows its selected item's modality, not its opener.
 await reset();const message=page.getByTestId('copy-message'),messageIcon=message.locator('.chat-copy-feedback');
 await message.getByRole('button',{name:'Message actions',exact:true}).click();await page.getByRole('menuitem',{name:'Copy as Markdown',exact:true}).focus();await page.keyboard.press('Enter');assert.equal((await appearance(messageIcon)).animate,'false');assert.equal((await snapshot()).requests.at(-1).text,'A **fixture** response.');
 await reset();await message.getByRole('button',{name:'Message actions',exact:true}).click();await page.getByRole('menuitem',{name:'Copy as plain text',exact:true}).click();assert.equal((await appearance(messageIcon)).animate,'true');assert.equal((await snapshot()).requests.at(-1).text,'A fixture response.');
 await reset();const code=page.getByTestId('copy-code');await code.locator('pre').click({button:'right'});await page.getByRole('menuitem',{name:'Copy code',exact:true}).focus();await page.keyboard.press('Enter');assert.equal((await appearance(code.locator('.chat-copy-feedback'))).animate,'false');
 // Selected-text copying preserves its own action without activating the toolbar check.
 await reset();await message.locator('.chat-message-body p').evaluate(node=>{const range=document.createRange();range.selectNodeContents(node);const selection=getSelection();selection.removeAllRanges();selection.addRange(range)});await message.locator('.chat-message-body').click({button:'right'});await page.getByRole('menuitem',{name:'Copy selected text',exact:true}).click();assert.equal((await appearance(messageIcon)).copied,'false');
 for(const theme of ['light','dark']){await reset();await patch({theme});await message.hover();await message.getByRole('button',{name:'Copy message',exact:true}).click();await page.waitForTimeout(140);await page.getByTestId('copy-feedback').screenshot({path:path.join(output,`copy-feedback-${theme}.png`)})}
 await reset();
};
