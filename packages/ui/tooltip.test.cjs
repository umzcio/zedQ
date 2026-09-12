const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright-core');
test('shared tooltips preserve hover, keyboard, disabled and menu interactions', {timeout:60000}, async()=>{
 const dir=fs.mkdtempSync(path.join(__dirname,'.tooltip-test-'));let browser,server;
 try{
  fs.writeFileSync(path.join(dir,'index.html'),'<div id="root"></div><script type="module" src="./main.tsx"></script>');
  fs.writeFileSync(path.join(dir,'main.tsx'),`import {useState} from 'react';import{createRoot}from'react-dom/client';import{TooltipProvider,TooltipButton,TooltipLink,ControlTooltip}from'../components/tooltip';import{DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem}from'../components/dropdown-menu';import{Button}from'../components/button';import{Checkbox}from'../components/checkbox';import{SelectField}from'../components/select-field';import{Collapsible,CollapsibleTrigger,CollapsibleContent}from'../components/collapsible';import'../tooltip.css';function App(){const[on,setOn]=useState(false);return <TooltipProvider><div><TooltipButton>Cancel</TooltipButton><Button aria-label="Save changes">Save changes</Button><TooltipLink href="#help">Help</TooltipLink><TooltipButton aria-label="Expand panel"><svg/></TooltipButton></div><div style={{padding:60,display:'flex',gap:20}}><TooltipButton aria-label="Toggle panel" tooltip={on?'Hide panel':'Show panel'} onClick={()=>setOn(!on)}>Panel</TooltipButton><TooltipButton aria-label="Save" disabled tooltip="Add a title before saving">Save</TooltipButton><DropdownMenu><DropdownMenuTrigger asChild><TooltipButton aria-label="More actions" tooltip="More actions">More</TooltipButton></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem>Rename</DropdownMenuItem></DropdownMenuContent></DropdownMenu><TooltipLink href="#details" tooltip="Read the details">Details</TooltipLink><ControlTooltip content="Stored on this Mac"><span tabIndex={0}>Saved</span></ControlTooltip><Checkbox checked aria-label="Selected item"/><Collapsible defaultOpen><CollapsibleTrigger tooltip="Collapse details">Details toggle</CollapsibleTrigger><CollapsibleContent>Expanded content</CollapsibleContent></Collapsible><SelectField label="Priority" value="Normal" onValueChange={()=>{}} options={['Normal','High']} tooltip="Choose task priority"/></div></TooltipProvider>}createRoot(document.getElementById('root')).render(<App/>);`);
  const {createServer}=await import('vite');const{default:react}=await import('@vitejs/plugin-react');
  server=await createServer({root:dir,configFile:false,logLevel:'error',plugins:[react()],server:{host:'127.0.0.1',port:0}});await server.listen();
  browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:900,height:500}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(server.resolvedUrls.local[0]);const button=page.getByRole('button',{name:'Toggle panel'});
  // Obvious text controls need no duplicate help; icon-only controls still do.
  for(const control of [page.getByRole('button',{name:'Cancel',exact:true}),page.getByRole('button',{name:'Save changes',exact:true}),page.getByRole('link',{name:'Help',exact:true})]){
   await control.hover();await page.waitForTimeout(550);assert.equal(await page.getByRole('tooltip').count(),0);
  }
  await page.getByRole('button',{name:'Expand panel',exact:true}).hover();await page.getByRole('tooltip',{name:'Expand panel'}).waitFor();
  await page.mouse.move(850,450);await page.getByRole('tooltip').waitFor({state:'hidden'});
  await button.hover();await page.getByRole('tooltip',{name:'Show panel'}).waitFor();
  // Stopping in the small gap above a trigger must not leave help open indefinitely.
  const triggerBox=await button.boundingBox();
  await page.mouse.move(triggerBox.x+triggerBox.width/2,triggerBox.y-2);
  await page.getByRole('tooltip').waitFor({state:'hidden',timeout:400});
  await button.hover();await page.getByRole('tooltip',{name:'Show panel'}).waitFor();
  // Hovering the tooltip itself is still supported for reading / magnification.
  await page.getByRole('tooltip',{name:'Show panel'}).hover();
  await page.waitForTimeout(200);
  assert.equal(await page.getByRole('tooltip',{name:'Show panel'}).isVisible(),true);
  await page.mouse.move(850,450);await page.getByRole('tooltip').waitFor({state:'hidden',timeout:400});
  await button.hover();await page.getByRole('tooltip',{name:'Show panel'}).waitFor();
  assert.equal(await button.getAttribute('title'),null,'native title must not duplicate the shared tooltip');
  await page.keyboard.press('Escape');await page.getByRole('tooltip').waitFor({state:'hidden'});
  await button.click();await page.mouse.move(850,450);await page.keyboard.press('Tab');
  await page.getByRole('tooltip',{name:'Add a title before saving'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Save',exact:true}).isDisabled(),true);
  await page.keyboard.press('Escape');await page.keyboard.press('Tab');await page.getByRole('tooltip',{name:'More actions'}).waitFor();
  await page.keyboard.press('Enter');await page.getByRole('menuitem',{name:'Rename'}).waitFor();assert.equal(await page.getByRole('tooltip').count(),0);
  await page.keyboard.press('Escape');await page.mouse.move(850,450);await button.hover();await page.getByRole('tooltip',{name:'Hide panel'}).waitFor();
  await page.keyboard.press('Escape');await page.getByRole('link',{name:'Details'}).focus();await page.getByRole('tooltip',{name:'Read the details'}).waitFor();
  await page.getByRole('link',{name:'Details'}).click();assert.ok(page.url().endsWith('#details'));
  assert.equal(await page.getByRole('checkbox',{name:'Selected item'}).getAttribute('data-state'),'checked');
  assert.equal(await page.getByRole('button',{name:'Details toggle'}).getAttribute('data-state'),'open');
  await page.getByRole('button',{name:'Details toggle'}).hover();await page.getByRole('tooltip',{name:'Collapse details'}).waitFor();
  await page.mouse.move(850,450);const select=page.getByRole('combobox',{name:'Priority'}),rect=await select.boundingBox();
  await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2,{steps:8});await page.getByRole('tooltip',{name:'Choose task priority'}).waitFor({timeout:2000});
  await page.getByRole('combobox',{name:'Priority'}).click();await page.getByRole('option',{name:'High',exact:true}).waitFor();
  assert.equal(await page.getByRole('combobox',{name:'Priority',includeHidden:true}).getAttribute('data-state'),'open');assert.equal(await page.getByRole('tooltip').count(),0);
  await page.keyboard.press('Escape');assert.equal(await page.getByRole('combobox',{name:'Priority',includeHidden:true}).getAttribute('data-state'),'closed');
  // Returning focus after a pointer selection must not reopen a help bubble.
  await select.click();await page.getByRole('option',{name:'High',exact:true}).click();
  await page.mouse.move(850,450);await page.waitForTimeout(200);
  assert.equal(await page.getByRole('tooltip').count(),0,'pointer selection must not reopen tooltip on restored focus');
  await button.hover();await page.getByRole('tooltip').waitFor();
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  await page.getByRole('tooltip').waitFor({state:'hidden',timeout:400});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.mouse.move(850,450);await button.hover();await page.getByRole('tooltip').waitFor();
  assert.equal(await page.getByRole('tooltip').evaluate(el=>getComputedStyle(el).animationName),'none');
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await server?.close();fs.rmSync(dir,{recursive:true,force:true});}
});
