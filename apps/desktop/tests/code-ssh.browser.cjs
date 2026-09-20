const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright-core');
(async()=>{const {build}=await import('vite'),{default:react}=await import('@vitejs/plugin-react'),{default:tailwind}=await import('@tailwindcss/vite');const root=path.resolve('.local-data/code-ssh-browser');fs.mkdirSync(root,{recursive:true});fs.writeFileSync(path.join(root,'index.html'),'<html><body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>');fs.writeFileSync(path.join(root,'main.tsx'),"import '../../apps/desktop/tests/fixtures/code-ssh'");await build({root,configFile:false,logLevel:'error',plugins:[react(),tailwind()],resolve:{dedupe:['react','react-dom','radix-ui']}});const dist=path.join(root,'dist'),server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname,file=path.join(dist,pathname==='/'?'index.html':pathname);if(!file.startsWith(dist)||!fs.existsSync(file)){res.writeHead(404).end();return}res.setHeader('Content-Type',/\.js$/.test(file)?'text/javascript':/\.css$/.test(file)?'text/css':'text/html');fs.createReadStream(file).pipe(res)});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{browser=await chromium.launch({channel:'chrome',headless:true});const p=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[];p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(6000);await p.goto(`http://127.0.0.1:${server.address().port}`);
const button=name=>p.getByRole('button',{name,exact:true}),menu=name=>p.getByRole('menuitem',{name,exact:true});
await button('SSH hosts').click();
for(const theme of ['light','dark']) {
 await p.evaluate(t=>document.documentElement.dataset.theme=t,theme);await p.waitForTimeout(350);
 assert.equal(await p.getByRole('textbox',{name:'Find SSH host'}).count(),0);
 const bounds=await p.locator('.code-ssh-layout').evaluate(e=>{const area=e.getBoundingClientRect(),empty=e.querySelector('.code-empty'),first=empty.firstElementChild.getBoundingClientRect(),last=empty.lastElementChild.getBoundingClientRect();return {dx:Math.abs((first.x+first.width/2)-(area.x+area.width/2)),dy:Math.abs((first.y+last.bottom)/2-(area.y+area.height/2))}});
 assert(bounds.dx<2&&bounds.dy<8,JSON.stringify(bounds));await p.screenshot({path:'.local-data/code-ssh-empty-'+theme+'.png'});
 await button('Choose hosts').click();
 const rows=p.locator('.code-ssh-picker-row');assert(await rows.count()>20);
 const row=rows.first();const geometry=await row.evaluate(e=>{const rects=[...e.children].map(n=>n.getBoundingClientRect());return {height:e.getBoundingClientRect().height,ys:rects.map(r=>r.y+r.height/2),xs:rects.map(r=>r.x)}});
 assert(geometry.height<=40);assert(Math.max(...geometry.ys)-Math.min(...geometry.ys)<2);assert(geometry.xs[0]<geometry.xs[1]&&geometry.xs[1]<geometry.xs[2]);
 await p.waitForTimeout(350);await p.screenshot({path:'.local-data/code-ssh-picker-'+theme+'.png'});await button('Cancel').click();
}
await p.evaluate(()=>document.documentElement.dataset.theme='light');await button('Choose hosts').click();await p.getByRole('checkbox',{name:'test-host',exact:true}).check();await button('Save selection').click();await button('Open host').waitFor();assert.equal(await p.evaluate(()=>window.sshCalls.filter(c=>c[0]==='connectHost').length),0);
// Primary controls must retain their own foreground instead of inheriting body text.
for(const theme of ['light','dark'])for(const palette of ['green','blue','red','gunmetal']){
 await p.evaluate(({theme,palette})=>{document.documentElement.dataset.theme=theme;document.documentElement.dataset.palette=palette},{theme,palette});
 await p.evaluate(()=>Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{}))));
 const contrast=await button('Open host').evaluate(e=>{const s=getComputedStyle(e);const luminance=color=>color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);const a=luminance(s.color),b=luminance(s.backgroundColor);return {fg:s.color,bg:s.backgroundColor,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)}});
 assert(contrast.ratio>=4.5,`${theme}/${palette}: ${JSON.stringify(contrast)}`);
 if(palette==='gunmetal')await p.screenshot({path:'.local-data/code-open-host-'+theme+'.png'});
}
await p.evaluate(()=>document.documentElement.dataset.theme='light');
await p.evaluate(()=>window.failConnect=true);await button('Open host').click();await p.getByRole('alert').filter({hasText:'Passwordless root access failed'}).waitFor();await p.evaluate(()=>window.failConnect=false);await button('Open host').click();await p.getByText('root-work',{exact:true}).waitFor();assert.equal(await p.locator('.code-ssh-host').count(),1);
await button('Add project folder').click();await p.getByRole('textbox',{name:'Name',exact:true}).fill('Remote project');await p.getByRole('textbox',{name:'Project folder'}).fill('/srv/project');await button('Save').click();await p.getByText('root-work',{exact:true}).click();await p.locator('.xterm').waitFor();assert.match(await p.locator('.code-session-host').getAttribute('aria-label'),/test-host · root/);assert.equal(await p.evaluate(()=>window.sshState.sessions[0].projectId),'');
const shortcut=p.locator('.code-session-navigation').getByRole('button',{name:'root-work · test-host · root',exact:true});
const heading=p.locator('.code-toolbar-title');
assert.match(await heading.innerText(),/test-host\s*\/\s*root-work\s*\/\s*srv\/work/);
assert.equal(await button('Session actions').count(),1);
assert.equal(await p.locator('.code-session-status').count(),0);
assert.equal(await heading.locator('.code-state-ready').count(),1);
await heading.locator('.code-session-host').hover();await p.getByRole('tooltip').filter({hasText:'Ready · test-host · root'}).waitFor();
await heading.locator('.code-session-path').click({button:'right'});await menu('Copy workspace path').waitFor();await p.keyboard.press('Escape');

await heading.getByRole('button',{name:'Session actions',exact:true}).focus();await p.keyboard.press('Enter');await menu('Rename').waitFor();await p.keyboard.press('Escape');
await heading.locator('.code-session-name').click({button:'right'});await menu('Link to project').waitFor();await p.keyboard.press('Escape');
await button('Workspace').click();await button('Folder docs').waitFor();
await button('Folder docs').click();await button('File docs/nested.txt').waitFor();
await button('File docs/nested.txt').click();await p.getByRole('textbox',{name:'Edit docs/nested.txt'}).waitFor();
assert.equal(await p.evaluate(()=>window.sshCalls.filter(c=>c[0]==='readFile').at(-1)[1].sessionId),await p.evaluate(()=>window.sshState.sessions[0].id));
await button('File archive.zip').click({button:'right'});await menu('Download…').click();
await p.getByText('Complete',{exact:true}).waitFor();
await button('Folder docs').click({button:'right'});await menu('Upload files…').click();
await p.waitForFunction(()=>window.sshCalls.some(c=>c[0]==='uploadFiles'&&c[1].path==='docs'));
await p.waitForTimeout(1100);
await button('File archive.zip').click();await p.getByRole('alert').filter({hasText:'Right-click it and choose Download'}).waitFor();
for(const theme of ['light','dark']){await p.evaluate(t=>document.documentElement.dataset.theme=t,theme);await p.waitForTimeout(100);await p.screenshot({path:'.local-data/code-files-'+theme+'.png'});}
await button('Close workspace panel').click();assert.equal(await p.getByRole('complementary',{name:'File workspace'}).count(),0);
await p.evaluate(()=>document.documentElement.dataset.theme='light');
await shortcut.waitFor();assert.equal(await shortcut.getAttribute('aria-current'),'page');
const originalSession=await p.evaluate(()=>window.sshState.sessions[0].id);
await button('Collapse Sessions').click();assert.equal(await shortcut.count(),0);await button('Expand Sessions').focus();await p.keyboard.press('Enter');await shortcut.waitFor();assert.equal(await p.evaluate(()=>window.sshState.sessions[0].id),originalSession);

await button('SSH hosts').click();assert.equal(await shortcut.getAttribute('aria-current'),null);
await shortcut.focus();await p.keyboard.press('Enter');await p.locator('.xterm').waitFor();
assert.equal(await p.evaluate(()=>window.sshState.sessions[0].id),originalSession);assert.equal(await p.evaluate(()=>window.sshState.sessions.length),1);
await shortcut.click({button:'right'});await menu('Rename').waitFor();await menu('Link to project').waitFor();await p.keyboard.press('Escape');
await button('Terminals').click();await p.evaluate(()=>window.disconnectSSH());await p.waitForTimeout(50);
assert.equal(await shortcut.locator('[aria-label="Disconnected"]').count(),1);
const connections=await p.evaluate(()=>window.sshCalls.filter(c=>c[0]==='connectHost').length);
await p.evaluate(()=>window.failConnect=true);await shortcut.click();await p.getByRole('alert').filter({hasText:'Passwordless root access failed'}).waitFor();assert.equal(await shortcut.count(),1);
await p.evaluate(()=>window.failConnect=false);await shortcut.click();await p.locator('.xterm').waitFor();assert.equal(await p.evaluate(()=>window.sshCalls.filter(c=>c[0]==='connectHost').length),connections+2);
assert.equal(await p.evaluate(()=>window.sshState.sessions.length),1);
for(const theme of ['light','dark']){await p.evaluate(t=>document.documentElement.dataset.theme=t,theme);await p.waitForTimeout(350);await p.screenshot({path:'.local-data/code-session-sidebar-'+theme+'.png'});}
const terminalBefore=await p.locator('.xterm').elementHandle(),attachmentsBefore=await p.evaluate(()=>window.sshCalls.filter(c=>['attachTerminal','detachTerminal'].includes(c[0])).length);
for(const [theme,background] of [['light','rgb(255, 255, 255)'],['dark','rgb(25, 25, 25)'],['light','rgb(255, 255, 255)']]){
 await p.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await p.waitForTimeout(350);
 assert.equal(await p.locator('.code-terminal-wrap').evaluate(e=>getComputedStyle(e).backgroundColor),background);assert.equal(await p.locator('.xterm').evaluate(e=>getComputedStyle(e).backgroundColor),background);
 assert.equal(await p.locator('.xterm-scrollable-element').evaluate(e=>getComputedStyle(e).backgroundColor),background);
 assert(await terminalBefore.evaluate(e=>e.isConnected));
 await p.screenshot({path:'.local-data/code-terminal-'+theme+'.png'});
}
assert.equal(await p.evaluate(()=>window.sshCalls.filter(c=>['attachTerminal','detachTerminal'].includes(c[0])).length),attachmentsBefore,'Theme changes must not reconnect the terminal');

await p.evaluate(()=>window.exitTerminal());await p.getByRole('alert').filter({hasText:'Terminal connection failed'}).waitFor();
await p.evaluate(()=>window.exitOnAttach=true);await button('Reconnect').click();await p.getByRole('alert').filter({hasText:'Terminal connection failed'}).waitFor();
await p.evaluate(()=>window.exitOnAttach=false);await button('Reconnect').click();await p.locator('.code-terminal-reconnect').waitFor({state:'hidden'});
await button('Session actions').click();await menu('Link to project').click();await p.getByRole('combobox',{name:'Linked project'}).click();await p.getByRole('option',{name:'Remote project',exact:true}).click();await button('Save link').click();assert.equal(await p.evaluate(()=>window.sshState.sessions[0].cwd),'/srv/work');
await button('Session actions').click();await menu('Close view (detach)').click();await p.getByText('Terminals & sessions',{exact:true}).waitFor();await p.locator('.code-terminal-list .code-profile-row button').filter({hasText:'root-work'}).click();await p.locator('.xterm').waitFor();assert.equal(await p.evaluate(()=>window.sshState.sessions.length),1);
await button('SSH hosts').click();await p.getByRole('combobox',{name:'SSH session user'}).click();await p.getByRole('option',{name:'SSH login user',exact:true}).click();await button('Open host').click();await p.getByText('login-work',{exact:true}).waitFor();assert.equal(await p.evaluate(()=>window.sshState.hosts.filter(h=>h.kind==='ssh').length),2);assert.equal(await p.locator('.code-ssh-host').count(),1);
await button('New tmux session').click();await p.getByRole('textbox',{name:'Session name'}).fill('work-two');await button('Create session').click();await p.locator('.xterm').waitFor();assert.match(await p.locator('.code-session-host').getAttribute('aria-label'),/SSH login user/);
await button('Session actions').click();await menu('Link to project').click();await p.getByRole('combobox',{name:'Linked project'}).click();assert.equal(await p.getByRole('option').count(),1);await p.keyboard.press('Escape');await button('Cancel').click();
await button('SSH hosts').click();await p.screenshot({path:'.local-data/code-ssh-light.png'});await p.evaluate(()=>document.documentElement.dataset.theme='dark');await p.waitForTimeout(350);await p.screenshot({path:'.local-data/code-ssh-dark.png'});await button('Choose hosts').click();await p.getByRole('checkbox',{name:'test-host',exact:true}).uncheck();await button('Save selection').click();await p.getByRole('heading',{name:'Choose the servers you use'}).waitFor();await button('Terminals').click();assert.equal(await p.locator('.code-terminal-list .code-profile-row').count(),2);assert.equal(await p.evaluate(()=>window.sshCalls.filter(c=>c[0]==='disconnectHost').length),0);await p.screenshot({path:'.local-data/code-ssh-terminals.png'});assert.deepEqual(errors,[]);console.log('PASS: native Code UI host picker, no eager connections, sudo failure/retry, standalone attach, project association, detach/reopen, root/login isolation, new tmux, hide preserves sessions, and context menus.');
}finally{await browser?.close();server.close()}})().catch(e=>{console.error(e);process.exitCode=1});
