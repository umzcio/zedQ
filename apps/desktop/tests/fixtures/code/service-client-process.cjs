const path = require('node:path')
const {connectCodeService} = require('../../../electron/code/session-client.cjs')
async function main() {
  const [root,tmuxPath,id] = process.argv.slice(2)
  const client = await connectCodeService({root,tmuxPath})
  const created = await client.request('create',{id,launch:{file:process.execPath,
    args:[path.join(__dirname,'interactive-agent.cjs')],cwd:root}})
  await client.request('claim',{id})
  process.stdout.write(JSON.stringify(created)+'\n',() => process.exit(0))
  // Intentionally no client.close(): exercise whole-client exit and lease release.
}
main().catch(error => {process.stderr.write(error.code || 'TEST_CLIENT_FAILED'); process.exit(1)})
