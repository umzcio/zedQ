const readline = require('node:readline')
console.log('agent-ready '+JSON.stringify({pid:process.pid,args:process.argv.slice(2)}))
readline.createInterface({input:process.stdin}).on('line',line => console.log('echo:'+line))
