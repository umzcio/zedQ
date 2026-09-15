const readline = require('node:readline')
require('node:fs').writeFileSync('agent-args.json',JSON.stringify(process.argv.slice(2)))
if (process.argv.includes('--ignore-hup')) {
  process.on('SIGHUP',() => {})
  setInterval(() => {},1000)
}
console.log('agent-ready '+JSON.stringify({pid:process.pid,args:process.argv.slice(2),runAsNode:process.env.ELECTRON_RUN_AS_NODE ?? null}))
readline.createInterface({input:process.stdin}).on('line',line => console.log('echo:'+line))
