const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {execFileSync} = require('node:child_process')
const {buildClaudeResume} = require('../electron/code/claude-launch.cjs')
const {buildTerminalLaunch} = require('../electron/code/terminal-launch.cjs')

test('Chat, Terminal and setup inherit login shell configuration without contaminating agent stdout', t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zq-profile-env-')))
  t.after(() => fs.rmSync(root, {recursive:true, force:true}))
  const work = path.join(root, `project ' $literal`), bin = path.join(root, 'bin')
  fs.mkdirSync(work); fs.mkdirSync(bin)
  fs.writeFileSync(path.join(root, '.zprofile'), 'export ZQ_TEST_LOGIN=loaded\nprint login-banner\n')
  fs.writeFileSync(path.join(root, '.zshrc'), 'export ZQ_TEST_INTERACTIVE=loaded\nexport PATH="$ZDOTDIR/bin:$PATH"\nprint interactive-banner\n')
  fs.writeFileSync(path.join(root, '.zlogin'), 'export ZQ_TEST_LAST=loaded\ncd /\n')
  const config = path.join(root, 'shared-config')
  fs.mkdirSync(config); fs.symlinkSync(config, path.join(root, 'profile-config'))
  const reader = path.join(root, 'reader.cjs')
  fs.writeFileSync(reader, `process.stdout.write(JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),login:process.env.ZQ_TEST_LOGIN,interactive:process.env.ZQ_TEST_INTERACTIVE,last:process.env.ZQ_TEST_LAST,config:require('fs').realpathSync(process.env.CLAUDE_CONFIG_DIR)}))`)
  fs.writeFileSync(path.join(bin, 'fixture-agent'), '#!/bin/sh\nexec "$ZQ_TEST_NODE" "$ZQ_TEST_READER" "$@"\n', {mode:0o700})
  const launcherFile = path.join(root, `profiles ' $(touch BAD).zsh`)
  fs.writeFileSync(launcherFile, 'print launcher-banner\nfixture-profile() { CLAUDE_CONFIG_DIR="$ZDOTDIR/profile-config" command fixture-agent "$@"; }\n')
  const profile = {id:'p',hostId:'local',launcherFile,functionName:'fixture-profile',modes:['chat','terminal']}
  const session = {id:'s',hostId:'local',cwd:work,nativeId:'4dab1c34-d7d7-4e77-8a6c-42d1bb5b8c59'}
  for (const mode of ['chat','terminal','setup']) {
    const launch = mode === 'setup'
      ? buildTerminalLaunch({profile:{...profile,adapter:'terminal'},session,mode:'terminal'})
      : buildClaudeResume({profile,session,mode})
    const output = execFileSync(launch.file,launch.args,{cwd:work,encoding:'utf8',stdio:['pipe','pipe','pipe'],
      env:{...process.env,ZDOTDIR:root,ZQ_TEST_NODE:process.execPath,ZQ_TEST_READER:reader}})
    const result = JSON.parse(output)
    assert.equal(result.cwd, work)
    assert.equal(result.login, 'loaded'); assert.equal(result.interactive, 'loaded'); assert.equal(result.last, 'loaded')
    assert.equal(result.config, config)
    assert.equal(result.args.includes(session.nativeId), mode !== 'setup')
    assert.equal(result.args.includes('stream-json'), mode === 'chat')
    assert.equal(fs.existsSync(path.join(root,'BAD')), false)
  }
})
