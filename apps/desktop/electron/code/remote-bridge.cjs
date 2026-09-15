// Runs only on the execution host. The SSH channel never receives IPC secrets.
const readline = require('node:readline')
const os = require('node:os'), path = require('node:path')
const {execFileSync} = require('node:child_process')
const {connectCodeService} = require('./session-client.cjs')
async function main() {
  const root = path.join(os.homedir(), '.local/share/zq/code/runtime')
  const tmuxPath = execFileSync('/bin/sh',['-c','command -v tmux'],{encoding:'utf8'}).trim()
  const client = await connectCodeService({root,tmuxPath})
  process.stdout.write(JSON.stringify({ready:true,root,tmuxPath})+'\n')
  const rl = readline.createInterface({input:process.stdin})
  let active=0
  rl.on('line',async line=>{
    let message
    try {
      if (Buffer.byteLength(line)>65536 || active>=16) throw new Error('INVALID_REQUEST')
      message=JSON.parse(line); active++
      const result=await client.request(message.method,message.params)
      process.stdout.write(JSON.stringify({id:message.id,result})+'\n')
    } catch(e) {process.stdout.write(JSON.stringify({id:message?.id,error:e.code||'REMOTE_REQUEST_FAILED'})+'\n')}
    finally {active--}
  })
  rl.on('close',()=>{client.close(); process.exit(0)})
}
main().catch(()=>{process.stderr.write('Remote Code service could not start. Check node, tmux, zsh and the private zQ directory.\n'); process.exit(1)})
