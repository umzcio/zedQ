// Isolated React fixtures; no reads or writes to the user's workspace.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http')
const { chromium } = require('playwright-core')
;(async () => {
 const { build } = await import('vite'), { default: react } = await import('@vitejs/plugin-react'), { default: tailwind } = await import('@tailwindcss/vite')
 const root = path.resolve('.local-data/skill-activity-browser'); fs.mkdirSync(root, { recursive: true })
 fs.writeFileSync(path.join(root, 'index.html'), '<html><body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>')
 fs.writeFileSync(path.join(root, 'main.tsx'), "import '../../apps/desktop/tests/fixtures/skills-chat'")
 await build({ root, configFile: false, logLevel: 'error', plugins: [react(), tailwind()], resolve: { dedupe: ['react', 'react-dom', 'radix-ui'] } })
 const dist = path.join(root, 'dist'), server = http.createServer((req, res) => { const p = new URL(req.url, 'http://localhost').pathname, file = path.join(dist, p === '/' ? 'index.html' : p); if (!file.startsWith(dist) || !fs.existsSync(file)) { res.writeHead(404).end(); return }; res.setHeader('Content-Type', /\.js$/.test(file) ? 'text/javascript' : /\.css$/.test(file) ? 'text/css' : 'text/html'); fs.createReadStream(file).pipe(res) })
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); let browser
 try {
  browser = await chromium.launch({ channel: 'chrome', headless: true }); const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, reducedMotion: 'reduce' }), errors = []
  page.setDefaultTimeout(5000); page.on('pageerror', error => errors.push(error.message)); await page.goto(`http://127.0.0.1:${server.address().port}`)
  const button = name => page.getByRole('button', {name, exact:true})
  await page.getByRole('textbox',{name:'Chat message',exact:true}).waitFor()
  await page.evaluate(()=>window.loadSkillActivity()); await button('Open first chat').click()
  const activity = button('Using docx'); await activity.waitFor(); assert.equal(await activity.getAttribute('aria-expanded'),'false')
  assert.equal(await page.locator('.chat-skill-activity').count(),2)
  await activity.focus(); await page.keyboard.press('Enter'); assert.equal(await activity.getAttribute('aria-expanded'),'true')
  const details=page.locator('.chat-skill-activity').first()
  await details.getByText('Instructions loaded',{exact:true}).waitFor(); await details.getByText('Selected automatically',{exact:true}).waitFor(); await details.getByText('guide.md',{exact:true}).waitFor(); await details.getByText('Package resources are preserved. Loaded instructions can guide supported document tools; packaged scripts are not executed and missing dependencies are not installed.',{exact:true}).waitFor()
  await details.getByRole('button',{name:'Copy skill name',exact:true}).click(); assert.equal(await page.evaluate(()=>window.events.filter(e=>e[0]==='clipboard').at(-1)[1]),'docx')
  await details.getByRole('button',{name:'Copy details',exact:true}).click(); const copied=await page.evaluate(()=>window.events.filter(e=>e[0]==='clipboard').at(-1)[1]); assert.match(copied,/docx/); assert.match(copied,/Selected automatically/); assert.match(copied,/guide.md/)
  await activity.click({button:'right'}); const actions=page.getByRole('menu',{name:'Skill usage actions for docx',exact:true}); assert.deepEqual(await actions.getByRole('menuitem').allTextContents(),['Copy skill name','Copy details']); await actions.getByRole('menuitem',{name:'Copy details',exact:true}).click(); assert.equal(await page.evaluate(()=>window.events.filter(e=>e[0]==='clipboard').at(-1)[1]),copied)
  await button('Using Writing style').click(); const selected=page.locator('.chat-skill-activity').nth(1); await selected.getByText('From your selection',{exact:true}).waitFor(); assert.equal(await selected.getByText(/packaged scripts/).count(),0)
  await page.screenshot({path:'.local-data/skill-activity-expanded.png'})
  const openSkills=async()=>{await button('Add attachments').click();await page.getByRole('menuitem',{name:/^Skills/}).click()}, closeSkills=async()=>{await page.keyboard.press('Escape');await page.keyboard.press('Escape')}
  await openSkills(); const automatic=page.getByRole('menuitemcheckbox',{name:/^Automatic/}); assert.equal(await automatic.getAttribute('aria-checked'),'true'); await page.getByRole('menuitem',{name:'No skills',exact:true}).click(); await closeSkills(); assert.deepEqual(await page.evaluate(()=>window.chatState.skillChoices['chat-1']),[])
  await openSkills(); assert.equal(await automatic.getAttribute('aria-checked'),'false'); await automatic.click(); await closeSkills(); assert.equal(await page.evaluate(()=>window.chatState.skillChoices['chat-1']),null)
  await button('Open project draft').click(); await button('New chat').click(); await openSkills(); await page.getByRole('menuitemcheckbox',{name:/^Use project skills/}).waitFor(); await closeSkills()
  await page.evaluate(()=>window.setProjectSkills([])); await openSkills(); await page.getByRole('menuitemcheckbox',{name:/^Use project skills/}).waitFor(); await page.getByText('No skills enabled by this project',{exact:true}).waitFor(); await closeSkills()
  await page.evaluate(()=>window.setProjectSkills(undefined)); await openSkills(); await automatic.waitFor(); assert.equal(await automatic.getAttribute('aria-checked'),'true'); await closeSkills()
  await button('Open project draft').click(); await button('Skills').click(); assert.equal(await button('No skills').isDisabled(),false); await button('No skills').click(); await page.waitForFunction(()=>window.events.some(event=>event[0]==='updateProject')); assert.deepEqual(await page.evaluate(()=>window.events.filter(event=>event[0]==='updateProject').at(-1)[1]),{id:'project',skillIds:[]}); await page.waitForFunction(()=>JSON.stringify(window.chatState.state.projects[0].skillIds)==='[]'); assert.equal(await button('No skills').isDisabled(),true); await page.keyboard.press('Escape'); await button('New chat').click(); await openSkills(); await page.getByText('No skills enabled by this project',{exact:true}).waitFor(); await closeSkills()
  await page.screenshot({path:'.local-data/skill-activity.png'}); assert.deepEqual(errors,[]); console.log('PASS skill usage expansion, source/reference/resource details, clipboard/context parity, legacy omission, automatic/default/project-off selection semantics.')
 } finally { await browser?.close(); server.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
