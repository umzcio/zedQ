const {execFile} = require('node:child_process')
const path = require('node:path')
const {fail,text} = require('./service-storage.cjs')
const quote = value => "'"+value.replace(/'/g,"'\\''")+"'"
function shellCommand(launch) {
  if (!launch || !text(launch.file) || !path.isAbsolute(launch.file) || !text(launch.cwd)
    || !path.isAbsolute(launch.cwd) || !Array.isArray(launch.args) || launch.args.length > 128
    || launch.args.some(arg => typeof arg !== 'string' || arg.includes('\0') || arg.length > 8192)
    || JSON.stringify(launch).length > 32768) fail('INVALID_REQUEST')
  // One tmux shell-command, with every value shell-quoted exactly once. The only
  // executable syntax introduced here is exec. Never append raw user arguments.
  return 'exec '+[launch.file,...launch.args].map(quote).join(' ')
}
function createTmux({binary,socket,env = process.env}) {
  if (!text(binary) || !path.isAbsolute(binary)) fail('INVALID_TMUX_PATH')
  const childEnv = {...env}
  delete childEnv.TMUX
  function run(args) {
    return new Promise((resolve,reject) => execFile(binary,['-f','/dev/null','-S',socket,...args],
      {env:childEnv,encoding:'utf8',timeout:3000,maxBuffer:1024*1024},(error,stdout,stderr) => {
        if (!error) return resolve(stdout)
        const missing = error.code === 1 && /no server running|error connecting[^\n]*\((No such file or directory|Connection refused)\)|can't find (session|pane|window)/i.test(stderr)
        reject(Object.assign(new Error(missing ? 'TMUX_SESSION_MISSING' : 'TMUX_FAILED'),
          {code:missing ? 'TMUX_SESSION_MISSING' : 'TMUX_FAILED'}))
      }))
  }
  const pane = name => `=${name}:0.0`
  return {run,binary,
    async launch(name,launch,cols = 100,rows = 30,runAsNode = false) {
      const result = await run(['new-session','-d','-s',name,...(runAsNode ? ['-e','ELECTRON_RUN_AS_NODE=1'] : []),'-x',String(cols),
        '-y',String(rows),'-c',launch.cwd,shellCommand(launch)])
      // This adapter launches only owned sessions on the private zQ server.
      // Cosmetic setup must not change process ownership if a short CLI exits.
      try { await run(['set-option','-t',name,'status','off']) } catch {}
      return result
    },
    async inspect(name) {
      try {
        const result = await run(['list-panes','-t',`=${name}:0`,'-F',
          '#{pane_pid}\t#{pane_dead}\t#{pane_width}\t#{pane_height}'])
        if (result.trim().split('\n').length !== 1) fail('TMUX_FAILED')
        const [pid,dead,cols,rows] = result.trim().split('\t').map(Number)
        if (!Number.isSafeInteger(pid) || pid <= 0 || !cols || !rows) fail('TMUX_FAILED')
        return dead ? null : {pid,cols,rows}
      } catch (error) {if (error.code === 'TMUX_SESSION_MISSING') return null; throw error}
    },
    capture:async name => (await run(['capture-pane','-p','-t',pane(name),'-S','-200'])).slice(-65536),
    write:(name,data) => run(['send-keys','-t',pane(name),'-H',...Array.from(Buffer.from(data),byte => byte.toString(16).padStart(2,'0'))]),
    resize:(name,cols,rows) => run(['resize-window','-t',`=${name}:0`,'-x',String(cols),'-y',String(rows)]),
    async stop(name) {
      try {await run(['kill-session','-t',`=${name}`])}
      catch (error) {if (error.code !== 'TMUX_SESSION_MISSING') throw error}
    },
  }
}
module.exports = {createTmux,shellCommand}
