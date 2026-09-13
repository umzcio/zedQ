// Isolated React fixtures; no reads or writes to the user's workspace.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http')
const { chromium } = require('playwright-core')
;(async () => {
 const { build } = await import('vite'), { default: react } = await import('@vitejs/plugin-react'), { default: tailwind } = await import('@tailwindcss/vite')
 const root = path.resolve('.local-data/chat-incomplete-browser'); fs.mkdirSync(root, { recursive: true })
 fs.writeFileSync(path.join(root, 'index.html'), '<html><body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>')
 fs.writeFileSync(path.join(root, 'main.tsx'), "import '../../apps/desktop/tests/fixtures/chat-flow'")
 await build({ root, configFile: false, logLevel: 'error', plugins: [react(), tailwind()], resolve: { dedupe: ['react', 'react-dom', 'radix-ui'] } })
 const dist = path.join(root, 'dist'), server = http.createServer((req, res) => { const p = new URL(req.url, 'http://localhost').pathname, file = path.join(dist, p === '/' ? 'index.html' : p); if (!file.startsWith(dist) || !fs.existsSync(file)) { res.writeHead(404).end(); return }; res.setHeader('Content-Type', /\.js$/.test(file) ? 'text/javascript' : /\.css$/.test(file) ? 'text/css' : 'text/html'); fs.createReadStream(file).pipe(res) })
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); let browser
 try {
  browser = await chromium.launch({ channel: 'chrome', headless: true }); const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, reducedMotion: 'reduce' }), errors = []
  page.setDefaultTimeout(5000);page.on('pageerror', error => errors.push(error.message)); await page.goto(`http://127.0.0.1:${server.address().port}`)
  const button=name=>page.getByRole('button',{name,exact:true}),menu=name=>page.getByRole('menuitem',{name,exact:true}),message=page.getByRole('textbox',{name:'Chat message',exact:true})
  await message.waitFor().catch(error=>{throw Error(error.message+' Page errors: '+JSON.stringify(errors))});await page.evaluate(()=>window.failRun());const alert=page.getByRole('alert').filter({hasText:'Response incomplete'});await alert.waitFor();assert.match(await alert.innerText(),/16 tool actions/);assert.match(await alert.innerText(),/content below is partial/);assert.equal(await page.getByRole('button',{name:'Stop response',exact:true}).count(),0);
  const banner=await alert.boundingBox(),thinking=await page.locator('.chat-thinking').boundingBox();assert.ok(banner.y+banner.height<=thinking.y);assert.equal(await page.getByText('Working on the document.',{exact:true}).isVisible(),true);await page.screenshot({path:'.local-data/chat-incomplete.png'});assert.deepEqual(errors,[]);console.log('PASS incomplete response: prominent alert above partial content, failed reason visible alongside successful tool steps, generation stopped.')
 } finally { await browser?.close(); server.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
