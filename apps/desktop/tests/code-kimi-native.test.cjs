const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http')
const { execFile, execFileSync } = require('node:child_process')
const { promisify } = require('node:util')
const { CodeService } = require('../electron/code/code-service.cjs')
const exec = promisify(execFile), tmux = '/opt/homebrew/bin/tmux'
const kimi = path.join(os.homedir(), '.kimi-code/bin/kimi')
const delay = ms => new Promise(r => setTimeout(r, ms))
async function until(fn) { for (let n = 0; n < 200; n++) { const result = await fn(); if (result) return result; await delay(100) } throw Error('timed out') }
test('installed Kimi: CLI → zQ Chat → native Terminal → Chat → CLI retains one native conversation', { skip: !process.env.ZQ_TEST_KIMI_NATIVE, timeout: 120000 }, async t => {
  const root = fs.mkdtempSync('/tmp/zqk-'), home = path.join(root, 'kimi'), runtime = path.join(root, 'runtime')
  fs.mkdirSync(home, { mode: 0o700 })
  let app, longHistory = false
  const prompts = []
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', c => body += c); req.on('end', () => {
      const data = JSON.parse(body || '{}'); prompts.push(data.messages || [])
      const user = data.messages?.filter(m => m.role === 'user' && !JSON.stringify(m.content).includes('<system-reminder>')).at(-1)?.content
      const text = typeof user === 'string' ? user : user?.filter(c => c.type === 'text').map(c => c.text).join(' ') || 'test'
      const content = `Native reply: ${text}` + (longHistory ? "\n\n## History fixture\n\n" + Array.from({length:120}, (_, n) => `- **Item ${n}**: retained history with [a link](https://example.com) and ` + "`code`.").join("\n") : "")
      if (data.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        for (const delta of [{ role: 'assistant', content }, {}]) res.write('data: ' + JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', model: 'mock', choices: [{ index: 0, delta, finish_reason: delta.content ? null : 'stop' }] }) + '\n\n')
        res.end('data: [DONE]\n\n')
      } else { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ id: 'mock', object: 'chat.completion', model: 'mock', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } })) }
    })
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  fs.writeFileSync(path.join(home, 'config.toml'), `default_model = "mock"\n[providers.local]\ntype = "openai"\nbase_url = "http://127.0.0.1:${server.address().port}/v1"\napi_key = "isolated-test"\n[models.mock]\nprovider = "local"\nmodel = "mock"\nmax_context_size = 32768\n`)
  const oldNativeEnv = Object.fromEntries(['CLAUDE_CONFIG_DIR','CODEX_HOME','ZQ_NATIVE_PROFILE_SEED'].map(k=>[k,process.env[k]]))
  process.env.CLAUDE_CONFIG_DIR=path.join(root,'claude');process.env.CODEX_HOME=path.join(root,'codex');process.env.ZQ_NATIVE_PROFILE_SEED=path.join(root,'absent')
  const oldHome = process.env.KIMI_CODE_HOME, oldBinary = process.env.ZQ_KIMI_BINARY
  process.env.KIMI_CODE_HOME = home; process.env.ZQ_KIMI_BINARY = kimi
  const service = new CodeService({ directory: runtime, tmuxPath: tmux })
  t.after(async () => {
    if (app) await app.close().catch(() => {})
    service.close(); server.close()
    try { execFileSync(tmux, ['-S', path.join(root, 'app/code/tmux'), 'kill-server'], {stdio:'ignore'}) } catch {}
    try { execFileSync(tmux, ['-S', path.join(runtime, 'tmux'), 'kill-server'], { stdio: 'ignore' }) } catch {}
    if (oldHome === undefined) delete process.env.KIMI_CODE_HOME; else process.env.KIMI_CODE_HOME = oldHome
    if (oldBinary === undefined) delete process.env.ZQ_KIMI_BINARY; else process.env.ZQ_KIMI_BINARY = oldBinary
    for(const [key,value] of Object.entries(oldNativeEnv)){if(value===undefined)delete process.env[key];else process.env[key]=value}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  const cli = args => exec(kimi, args, { cwd: root, env: { ...process.env }, timeout: 30000, maxBuffer: 2 * 1024 * 1024 })
  await cli(['-p', 'CLI first turn'])
  const list = await service.invoke('listKimiSessions')
  assert.equal(list.sessions.length, 1)
  const nativeId = list.sessions[0].nativeId
  let s = await service.invoke('openKimiSession', { nativeId })
  assert.equal(s.state, 'ready', JSON.stringify(s))
  assert.equal(s.nativeId, nativeId)
  let events = (await service.invoke('events', { id: s.id, after: 0 })).events
  assert.ok(events.some(e => e.kind === 'user' && e.text.includes('CLI first turn')), JSON.stringify(events))
  assert.ok(events.some(e => e.kind === 'assistant' && e.text.includes('CLI first turn')), JSON.stringify(events))
  await service.invoke('sendMessage', { id: s.id, text: 'Chat second turn' })
  await until(async () => (await service.invoke('events', { id: s.id, after: 0 })).events.some(e => e.kind === 'assistant' && e.text.includes('Chat second turn')))
  await until(async () => (await service.invoke('snapshot')).sessions[0].state === 'ready')
  s = await service.invoke('switchSession', { id: s.id, expectedRevision: s.revision, profileId: '', mode: 'terminal' })
  assert.equal(s.state, 'ready', JSON.stringify(s)); assert.equal(s.nativeId, nativeId)
  const capture = () => execFileSync(tmux, ['-S', path.join(runtime, 'tmux'), 'capture-pane', '-p', '-t', '=zqc-' + s.id + ':0.0'], {encoding:'utf8'})
  // This folder exists only in the isolated fixture. Honor native trust rather
  // than bypassing it in the product launcher.
  if (capture().includes('Trust this folder?')) await service.request('writeTerminal', {id:s.id, data:'\r'})
  await until(() => capture().includes('Session:') && capture().includes(nativeId))
  await service.request('writeTerminal', { id: s.id, data: 'Terminal third turn' })
  await delay(150)
  await service.request('writeTerminal', {id:s.id, data:'\r'})
  await until(() => capture().includes('Native reply: Terminal third turn')).catch(e => { console.log(capture()); throw e })
  s = await service.invoke('switchSession', { id: s.id, expectedRevision: s.revision, profileId: '', mode: 'chat' })
  assert.equal(s.state, 'ready', JSON.stringify(s))
  events = (await service.invoke('events', { id: s.id, after: 0 })).events
  assert.ok(events.some(e => e.kind === 'user' && e.text.includes('Terminal third turn')), JSON.stringify(events))
  assert.equal(events.filter(e => e.kind === 'user' && e.text.includes('CLI first turn')).length, 1)
  assert.equal((await service.invoke('listKimiSessions')).sessions.length, 1)
  s = await service.invoke('stopSession', { id: s.id, expectedRevision: s.revision })
  assert.equal(s.state, 'stopped', JSON.stringify(s))
  await cli(['--session', nativeId, '-p', 'CLI fourth turn'])
  const last = prompts.at(-1)
  assert.ok(JSON.stringify(last).includes('Chat second turn'))
  assert.ok(JSON.stringify(last).includes('Terminal third turn'))
  assert.equal((await service.invoke('listKimiSessions')).sessions[0].nativeId, nativeId)
  if (process.env.ZQ_TEST_KIMI_APP) {
    longHistory = !!process.env.ZQ_TEST_KIMI_PERF
    if (longHistory) await cli(['--session', nativeId, '-p', 'UI performance history'])
    const {_electron} = require('playwright-core')
    const launch = () => _electron.launch({executablePath:path.resolve('apps/desktop/release/mac-arm64/zQ.app/Contents/MacOS/zQ'), env:{...process.env, ZQ_DATA_DIR:path.join(root,'app'), TMUX_TMPDIR:root}, timeout:30000})
    app = await launch()
    let page = await app.firstWindow(); page.setDefaultTimeout(20000)
    await page.getByRole('button',{name:'Code module',exact:true}).click()
    await page.getByRole('button',{name:'Sessions',exact:true}).click()
    await page.getByRole('combobox',{name:'Filter by agent'}).click()
    await page.getByRole('option',{name:'Kimi',exact:true}).click()
    await page.locator('.code-native-row').first().waitFor()
    await page.locator('.code-native-row > button').first().click({button:'right'})
    await page.getByRole('menuitem',{name:'Copy resume command',exact:true}).waitFor()
    await page.keyboard.press('Escape')
    await page.screenshot({path:'.local-data/kimi-picker.png'})
    await page.locator('.code-native-row > button').first().click()
    await page.getByRole('textbox',{name:'Message Kimi',exact:true}).waitFor()
    await page.getByText('CLI fourth turn',{exact:true}).waitFor()
    if (process.env.ZQ_TEST_KIMI_PERF) {
      const cdp=await page.context().newCDPSession(page)
      await cdp.send('Performance.enable')
      const sample=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]))
      await page.waitForTimeout(700)
      const before=await sample()
      await page.waitForTimeout(2000)
      const idle=await sample(), started=performance.now()
      await page.getByRole('textbox',{name:'Message Kimi',exact:true}).pressSequentially('Typing while a long native history is open')
      const typed=await sample()
      console.log(JSON.stringify({uiIdleScriptMs:Math.round((idle.ScriptDuration-before.ScriptDuration)*1000),uiTypingScriptMs:Math.round((typed.ScriptDuration-idle.ScriptDuration)*1000),uiTypingWallMs:Math.round(performance.now()-started)}))
      await cdp.detach()
    }
    await page.getByRole('textbox',{name:'Message Kimi',exact:true}).fill('Packaged UI fifth turn')
    await page.getByRole('button',{name:'Send message',exact:true}).click()
    await page.getByText('Native reply: Packaged UI fifth turn',{exact:true}).waitFor()
    for (const theme of ['light','dark']) {
      await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme)
      await page.waitForTimeout(200)
      await page.screenshot({path:'.local-data/kimi-chat-'+theme+'.png'})
    }
    await app.close(); app = await launch()
    page = await app.firstWindow(); page.setDefaultTimeout(20000)
    await page.getByRole('button',{name:'Code module',exact:true}).click()
    await page.getByText('Native reply: Packaged UI fifth turn',{exact:true}).waitFor()
    await page.locator('.code-mode-switch').getByRole('button',{name:'Terminal',exact:true}).click()
    await page.locator('.xterm').waitFor()
    await page.locator('.code-terminal-reconnect').waitFor({state:'hidden'})
    await page.locator('.code-mode-switch').getByRole('button',{name:'Chat',exact:true}).click()
    await page.getByText('Native reply: Packaged UI fifth turn',{exact:true}).waitFor()
    await page.getByRole('button',{name:'Session actions',exact:true}).click()
    await page.getByRole('menuitem',{name:'Stop session',exact:true}).click()
    await page.getByRole('button',{name:'Confirm',exact:true}).click()
    await page.getByRole('dialog').waitFor({state:'hidden'}).catch(async e => { console.log('Stop dialog:', await page.getByRole('dialog').innerText()); console.log('State:', await page.evaluate(()=>window.zq.code.invoke('snapshot'))); await page.screenshot({path:'.local-data/kimi-stop-failure.png'}); throw e })
    await cli(['--session',nativeId,'-p','CLI after packaged UI'])
    assert.ok(JSON.stringify(prompts.at(-1)).includes('Packaged UI fifth turn'))
    console.log('PASS: packaged native history picker, context menu, Chat prompt, app restart, Terminal/Chat roundtrip, native CLI continuation')
  }
  await require('./fixtures/native-pr-review.cjs')({service,root,agent:'kimi',profileId:'',expected:'Native reply:'})
})
