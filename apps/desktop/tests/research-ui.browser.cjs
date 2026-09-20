// Real native runner and disk checkpoints, simulated provider, isolated workspace.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const { chromium } = require('playwright-core');
const setup = require('./fixtures/research-native.cjs');
(async () => {
 const { build } = await import('vite'), { default: react } = await import('@vitejs/plugin-react'), { default: tailwind } = await import('@tailwindcss/vite');
 const root = path.resolve('.local-data/research-ui-browser'); fs.mkdirSync(root, { recursive: true });
 fs.writeFileSync(path.join(root, 'index.html'), '<html><body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>');
 fs.writeFileSync(path.join(root, 'main.tsx'), "import '../../apps/desktop/tests/fixtures/research-ui'");
 await build({ root, configFile: false, logLevel: 'error', plugins: [react(), tailwind()], resolve: { dedupe: ['react', 'react-dom', 'radix-ui'] } });
 const dist = path.join(root, 'dist'), server = http.createServer((req, res) => { const file = path.join(dist, new URL(req.url, 'http://localhost').pathname === '/' ? 'index.html' : req.url); if (!file.startsWith(dist) || !fs.existsSync(file)) return res.writeHead(404).end(); res.setHeader('Content-Type', /\.js$/.test(file) ? 'text/javascript' : /\.css$/.test(file) ? 'text/css' : 'text/html'); fs.createReadStream(file).pipe(res); });
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
 const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zq-research-ui-')); let browser, native, page;
 try {
  browser = await chromium.launch({ channel: 'chrome', headless: true }); page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'no-preference' });
  const errors = []; page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(7000);
  native = await setup(directory, (name, value) => { if (page && !page.isClosed()) void page.evaluate(({ name, value }) => window[name]?.(value), { name, value }).catch(() => {}); });
  await page.exposeFunction('researchFixtureCall', (service, method, input) => native.call(service, method, input));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const button = name => page.getByRole('button', { name, exact: true }), menu = name => page.getByRole('menuitem', { name, exact: true });
  const message = page.getByRole('textbox', { name: 'Chat message', exact: true }); await message.waitFor();
  await page.waitForFunction(() => !!window.chatState?.conversation); await page.waitForTimeout(150);
  const tool=name=>page.getByRole('menuitemcheckbox',{name,exact:true});
  assert.equal(await button('Chat mode').count(),0);await button('Choose provider tools').click();await tool('Research').waitFor();
  assert.deepEqual((await page.locator('.chat-tools-menu').innerText()).split('\n').filter(Boolean),['Research','Web search','Run code']);
  await tool('Web search').click();await button('Choose provider tools').click();assert.equal(await tool('Web search').getAttribute('aria-checked'),'true');
  await page.screenshot({path:path.join(root,'tools-menu-light.png')});await page.keyboard.press('Escape');await button('Toggle theme').click();await button('Choose provider tools').click();await page.screenshot({path:path.join(root,'tools-menu-dark.png')});await page.keyboard.press('Escape');await button('Toggle theme').click();
  await button('Choose provider tools').click();await tool('Research').click();await button('Research tools').click();assert.equal(await tool('Research').getAttribute('aria-checked'),'true');assert.equal(await tool('Web search').getAttribute('aria-checked'),'false');await tool('Research').click();
  await button('Choose provider tools').click();assert.equal(await tool('Web search').getAttribute('aria-checked'),'true');await tool('Research').click();await button('Add attachments').click();assert.equal(await menu('Upload files').count(),1);assert.equal(await menu('Choose sources').count(),0);await menu('Upload files').click();await page.getByRole('checkbox',{name:'Use Upload fixture.txt',exact:true}).waitFor();assert.equal(await page.getByRole('checkbox',{name:'Use Upload fixture.txt',exact:true}).isDisabled(),false);

  const sourceDialog = page.getByRole('dialog', { name: 'Research sources', exact: true }); await sourceDialog.waitFor();
  await sourceDialog.getByRole('button',{name:'Close dialog',exact:true}).hover();await page.waitForTimeout(600);await page.keyboard.press('Escape');await sourceDialog.waitFor({state:'detached'});await button('Sources · 1').click();
  const domains = page.getByRole('textbox', { name: 'Allowed domains for Web', exact: true }); await domains.fill('example.org, another.org'); await domains.press('Escape');
  await sourceDialog.waitFor({ state: 'detached' }); await page.waitForFunction(() => document.activeElement?.textContent === 'Sources · 1');
  await button('Sources · 1').click(); assert.equal(await domains.inputValue(), 'example.org, another.org');
  await page.getByRole('tab',{name:'Web',exact:true}).click();await page.getByRole('checkbox', { name: 'Use Web', exact: true }).uncheck(); await page.getByRole('tab',{name:'Notes',exact:true}).click();assert.equal(await sourceDialog.locator('.research-source-row').count(),25);await button('Next sources page').click();assert.equal(await sourceDialog.locator('.research-source-row').count(),25);await page.getByRole('textbox',{name:'Find research sources',exact:true}).fill('Reference 080');await page.getByRole('checkbox',{name:'Use Reference 080',exact:true}).waitFor();assert.equal(await sourceDialog.locator('.research-source-row').count(),1);await page.getByRole('textbox',{name:'Find research sources',exact:true}).fill('Measurements');await page.getByRole('checkbox', { name: 'Use Measurements', exact: true }).check();
  await sourceDialog.locator('.research-source-row').filter({ hasText: 'Measurements' }).click({ button: 'right' });await page.keyboard.press('Escape');assert.equal(await sourceDialog.isVisible(),true);await sourceDialog.locator('.research-source-row').filter({ hasText: 'Measurements' }).click({ button: 'right' }); await menu('Copy source name').click(); assert.deepEqual(await page.evaluate(() => window.events.filter(e => e[0] === 'copy').at(-1)), ['copy', 'Measurements']);
  await page.getByRole('tab',{name:'Selected',exact:true}).click();await page.waitForTimeout(220);assert.equal(await page.getByRole('tab',{name:'Selected',exact:true}).getAttribute('aria-selected'),'true');await page.screenshot({ path: path.join(root, 'sources-light.png') });await page.keyboard.press('Escape');await sourceDialog.waitFor({state:'detached'});await button('Toggle theme').click();await button('Sources · 1').click();await sourceDialog.waitFor();await page.waitForTimeout(220);await page.screenshot({path:path.join(root,'source-picker-dark.png')}); await button('Done').click(); await message.fill('Compare the selected measurements.');
  // Persist draft/source choices across renderer reload without launching research.
  await page.waitForFunction(() => window.chatState.state.drafts?.[window.chatState.conversation.id]?.research?.sources[0]?.id === 'measurements' && window.chatState.state.drafts?.[window.chatState.conversation.id]?.text === 'Compare the selected measurements.');
  await page.reload(); await message.waitFor(); await page.waitForFunction(() => window.chatState?.researchDrafts[window.chatState.draftId]?.mode); assert.equal(await message.inputValue(), 'Compare the selected measurements.'); assert.equal(native.calls.length, 0);
  await button('Prepare research plan').click(); await button('Review plan').waitFor(); assert.equal(native.calls.length, 1);
  await button('Review plan').click(); const dialog = page.getByRole('dialog', { name: 'Compare measurements', exact: true }); await dialog.waitFor();
  assert.equal(await button('Accept plan and research').isDisabled(), true); await page.getByRole('textbox', { name: 'Answer: Who is the audience?', exact: true }).fill('Engineers');
  await page.getByRole('textbox', { name: 'Research plan title', exact: true }).fill('Compare saved measurements'); await page.getByRole('tab', {name:'Sources',exact:true}).click(); await page.getByRole('tab', {name:'Plan',exact:true}).click(); assert.equal(await page.getByRole('textbox', {name:'Answer: Who is the audience?',exact:true}).inputValue(), 'Engineers'); assert.equal(await page.getByRole('textbox', {name:'Research plan title',exact:true}).inputValue(), 'Compare saved measurements'); await page.screenshot({ path: path.join(root, 'plan-light.png') });
  await button('Accept plan and research').click(); await page.getByRole('tab', { name: 'Progress', exact: true }).waitFor();
  await page.waitForFunction(() => window.chatState.research.jobs[0]?.phase === 'researching'); assert.equal(native.research.list()[0].status, 'running');
  await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'detached' }); await button('Second chat').first().click(); await message.fill('A separate request'); await button('Send message').click(); await page.getByText('Other chat remains usable.', { exact: true }).waitFor();
  await button('Code module').click(); await page.locator('#other-module').focus(); assert.equal(native.research.list()[0].status, 'running');
  // Research is owned by native service, not ChatView mount or selected chat.
  await button('Chat module').click(); await page.locator('.research-sidebar-row').click({ button: 'right' }); await menu('Stop research').click();
  await page.waitForFunction(() => window.chatState.research.jobs[0]?.status === 'stopped'); assert.equal(native.research.list()[0].status, 'stopped');
  await button('First chat').first().click(); await page.locator('.research-card').click({ button: 'right' }); await menu('Resume research').click(); await page.waitForFunction(() => window.chatState.research.jobs[0]?.status === 'running');
  await native.call('fixture','failDetail'); await page.locator('.research-card').click({ button: 'right' }); await menu('View sources').click(); await button('Retry loading research').click(); await page.getByRole('tab', { name: 'Sources', exact: true }).waitFor();
  await page.getByRole('tab', { name: 'Sources', exact: true }).focus(); await page.keyboard.press('ArrowLeft'); await page.getByRole('tab', { name: 'Plan', exact: true }).waitFor(); await page.waitForFunction(() => [...document.querySelectorAll('[role=tab]')].some(el=>el.textContent==='Plan'&&el.getAttribute('aria-selected')==='true'));
  await page.keyboard.press('Escape'); await button('Toggle theme').click(); await page.locator('.research-card').click({ button: 'right' }); await menu('View sources').click(); await page.getByRole('heading',{name:'Selected sources',exact:true}).waitFor(); await page.screenshot({ path: path.join(root, 'sources-dark.png') }); await page.keyboard.press('Escape');
  await button('Code module').click(); await page.locator('#other-module').focus(); await native.call('fixture', 'release');
  await button('Open report').waitFor(); assert.equal(native.research.list()[0].status, 'completed'); assert.equal(await page.locator('#other-module').isVisible(), true); assert.equal(await page.locator('#other-module').evaluate(el => el === document.activeElement), true);
  await button('Open report').click(); await message.waitFor(); await page.waitForFunction(() => !!window.chatState.artifactTarget);
  assert.equal(await page.evaluate(() => window.chatState.conversation.title), 'First chat'); assert.deepEqual(await page.evaluate(() => window.chatState.artifactTarget), native.research.list()[0].report);
  assert.match(native.research.get(native.research.list()[0].id).plan.steps.join('\n'), /Engineers/);
  assert.equal(native.research.list()[0].evidenceCount, 1);
  // The saved report is a real immutable artifact, with inspectable evidence/data.
  const pane=page.getByRole('complementary',{name:'Artifact preview',exact:true});
  await pane.getByRole('heading',{name:'Measurement report',exact:true}).waitFor();
  await pane.getByRole('img',{name:'Measured values',exact:true}).waitFor();
  await page.screenshot({path:path.join(root,'report-dark.png')}); await button('Toggle theme').click();
  await button('View data').click(); await page.getByRole('dialog',{name:'Measurement data',exact:true}).waitFor();
  await button('Download CSV…').click(); await page.waitForFunction(()=>true); await page.keyboard.press('Escape');
  await page.waitForFunction(()=>document.activeElement?.textContent==='View data');
  await pane.getByRole('button',{name:'View source 1',exact:true}).first().click();
  await page.getByRole('dialog',{name:'Measurements',exact:true}).waitFor(); assert.match(await page.locator('.research-report-excerpt').innerText(),/A is 12/); await page.keyboard.press('Escape');
  await pane.locator('.research-report-chart').click({button:'right'}); await menu('Save chart…').click();
  for(const name of ['Export Markdown and assets…','Export PDF…']){await button('Artifact actions').click();await menu(name).click();await page.waitForTimeout(200)}
  assert.deepEqual(native.exports.map(f=>f.name.split('.').at(-1)).sort(),['csv','pdf','svg','zip']);
  await page.screenshot({path:path.join(root,'report-light.png')});
  await button('Artifact actions').click();await menu('Edit report…').click();await page.getByRole('textbox',{name:'Report title',exact:true}).fill('Edited measurement report');await page.getByRole('textbox',{name:'Report Markdown',exact:true}).fill('My revised interpretation [1].');await button('Save new version').click();
  await pane.getByRole('heading',{name:'Edited measurement report',exact:true}).waitFor();
  const original=native.research.list()[0].report;assert.equal(native.artifacts.list()[0].versions.length,2);assert.match(native.artifacts.researchReport(original).markdown,/B exceeds A/);
  await button('Artifact actions').click();await menu('Follow up with research…').click();await pane.waitFor({state:'detached'});assert.ok(await page.evaluate(()=>window.chatState.researchDrafts[window.chatState.draftId].previousReport));
  await message.fill('Check the comparison again');await button('Prepare research plan').click();await button('Review plan').click();await page.getByRole('textbox',{name:'Answer: Who is the audience?',exact:true}).fill('Engineers');await button('Accept plan and research').click();await page.waitForFunction(()=>window.chatState.research.jobs[0]?.status==='completed');
  assert.equal(native.artifacts.list().length,1);assert.equal(native.artifacts.list()[0].versions.length,3);await page.keyboard.press('Escape');
  // Explicit finish stops collection and produces a bounded report from saved evidence.
  await native.call('fixture','hold'); await message.fill('A shorter follow-up'); await button('Prepare research plan').click(); await button('Review plan').click(); await page.getByRole('textbox',{name:'Answer: Who is the audience?',exact:true}).fill('Engineers'); await button('Accept plan and research').click(); await page.waitForFunction(()=>window.chatState.research.jobs[0]?.phase==='researching'); await button('Finish with saved evidence').click(); await page.waitForFunction(()=>window.chatState.research.jobs[0]?.status==='completed'); assert.equal(native.research.list().filter(j=>j.finishRequested&&j.status==='completed').length,1); await page.keyboard.press('Escape');
  assert.deepEqual(errors, []);
  console.log('PASS native-backed Research UI: source scopes/context menus, persisted draft/reload, editable plan/clarifications, keyboard tabs, navigation, other-chat send, stop/resume, completion without focus theft, and report action routing.');
 } catch (error) { if (page) { await page.screenshot({ path: path.join(root, 'failure.png') }); console.error((await page.locator('body').innerText()).slice(-4000)); } throw error; }
 finally { await browser?.close(); native?.close(); server.close(); fs.rmSync(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
