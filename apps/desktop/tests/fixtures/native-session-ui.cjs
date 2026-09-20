const assert = require('node:assert/strict'), path = require('node:path')
const {execFileSync} = require('node:child_process')
const {_electron} = require('playwright-core')
// Use only the caller's disposable native configuration and workspace.
module.exports = async function nativeSessionUI({root, agent, nativeId, profile, historyText, replyText}) {
  let app
  try {
    app = await _electron.launch({executablePath:path.resolve('apps/desktop/release/mac-arm64/zQ.app/Contents/MacOS/zQ'),env:{...process.env,ZQ_DATA_DIR:path.join(root,'app'),TMUX_TMPDIR:root},timeout:30000})
    const page = await app.firstWindow(); page.setDefaultTimeout(20000)
    await page.getByRole('button',{name:'Code module',exact:true}).click()
    if(profile) await page.evaluate(async profile => {
      const snapshot = await window.zq.code.invoke('snapshot')
      const p = snapshot.profiles.find(p => p.functionName === 'claude')
      await window.zq.code.invoke('updateProfile',{id:p.id,patch:profile})
    },profile)
    await page.getByRole('button',{name:'Sessions',exact:true}).click()
    await page.getByRole('combobox',{name:'Filter by agent'}).click()
    await page.getByRole('option',{name:agent,exact:true}).click()
    const row = page.locator('.code-native-row').filter({hasText:root.replace(/^\/tmp\//,'/private/tmp/')})
    await row.waitFor().catch(async error=>{console.log(await page.getByRole('dialog').innerText());throw error})
    await row.locator('button').first().click({button:'right'})
    await page.getByRole('menuitem',{name:'Continue with profile…',exact:true}).waitFor()
    await page.keyboard.press('Escape')
    for (const theme of ['light','dark']) {
      await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme)
      await page.waitForTimeout(300)
      const colors = await page.getByRole('dialog').evaluate(el=>({background:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color}))
      assert.equal(colors.background,theme==='dark'?'rgb(32, 32, 32)':'rgb(255, 255, 255)')
      await page.screenshot({path:`.local-data/native-${agent.toLowerCase()}-browser-${theme}.png`})
    }
    await row.locator('button').first().click()
    const input = page.getByRole('textbox',{name:`Message ${agent}`,exact:true})
    await input.waitFor()
    await page.locator('.code-chat').getByText('CLI third fixture turn',{exact:true}).waitFor()
    await input.fill('Packaged native fourth turn')
    await page.getByRole('button',{name:'Send message',exact:true}).click()
    await page.getByText(replyText,{exact:true}).waitFor()
    const snapshot = await page.evaluate(()=>window.zq.code.invoke('snapshot'))
    assert.equal(snapshot.sessions[0].nativeId,nativeId)
    await page.getByRole('button',{name:'Session actions',exact:true}).click()
    await page.getByRole('menuitem',{name:'Stop session',exact:true}).click()
    await page.getByRole('button',{name:'Confirm',exact:true}).click()
    await page.getByRole('dialog').waitFor({state:'hidden'})
    console.log(`PASS: packaged ${agent} browser, native history, Chat turn, and stop`)
  } finally {
    if(app)await app.close().catch(()=>{})
    try {execFileSync('/opt/homebrew/bin/tmux',['-S',path.join(root,'app/code/tmux'),'kill-server'],{stdio:'ignore'})} catch {}
  }
}
