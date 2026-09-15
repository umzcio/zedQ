// Synthetic process only: no account access, network, or real Claude state.
const fs = require('node:fs')
if (process.env.ZQ_TEST_FAULT === 'startup') process.exit(17)
const args = process.argv.slice(2)
const lockPath = process.env.ZQ_TEST_LOCK
const lock = fs.openSync(lockPath,'wx')
const nativeId = process.env.ZQ_TEST_FAULT === 'identity' ? 'wrong-conversation'
  : args[args.indexOf('--resume') + 1]
const timer = setInterval(() => {},1000)
process.on('SIGTERM',() => {
  clearInterval(timer)
  fs.closeSync(lock)
  fs.unlinkSync(lockPath)
  process.exit(0)
})
process.stdout.write(JSON.stringify({nativeId,profile:process.env.ZQ_TEST_PROFILE,
  cwd:process.cwd(),args}) + '\n')
