// Runs only on the execution host. The SSH channel never receives IPC secrets.
const {FileTransfers,workspaceRoot}=require('./file-transfers.cjs')
const readline = require('node:readline')
const os = require('node:os'), path = require('node:path')
const {execFileSync} = require('node:child_process')
const {sessionWorkspace,validateSessionWorkspace}=require('./session-workspace.cjs')
const {connectCodeService} = require('./session-client.cjs')
async function main() {
  const root = path.join(os.homedir(), '.local/share/zq/code/runtime')
  const tmuxPath = execFileSync('/bin/sh',['-c','command -v tmux'],{encoding:'utf8'}).trim()
  const client = await connectCodeService({root,tmuxPath})
  process.stdout.write(JSON.stringify({ready:true,root,tmuxPath,uid:process.getuid(),user:os.userInfo().username,home:os.homedir()})+'\n')
  const rl = readline.createInterface({input:process.stdin})
  const transfers=new FileTransfers()
  let active=0
  rl.on('line',async line=>{
    let message
    try {
      if (Buffer.byteLength(line)>65536 || active>=16) throw new Error('INVALID_REQUEST')
      message=JSON.parse(line); active++
      let result
      if(message.method==='code:transfer') {
        const action=message.params.action
        const row=['beginRead','beginWrite'].includes(action)?workspaceRoot(await client.request('code:snapshot',{}),message.params):null
        result=transfers.invoke(action,message.params,row?.cwd)
      } else if(message.params?.sessionId!==undefined) {
        const method=message.method?.startsWith('code:')?message.method.slice(5):''
        validateSessionWorkspace(method,message.params)
        result=await sessionWorkspace(await client.request('code:snapshot',{}),method,message.params)
      } else result=await client.request(message.method,message.params)
      process.stdout.write(JSON.stringify({id:message.id,result})+'\n')
    } catch(e) {process.stdout.write(JSON.stringify({id:message?.id,error:e.code||'REMOTE_REQUEST_FAILED'})+'\n')}
    finally {active--}
  })
  const close=()=>{transfers.close();client.close();process.exit(0)}
  rl.on('close',close)
  process.once('SIGTERM',close)
  process.once('SIGINT',close)
}
main().catch(()=>{process.stderr.write('Remote Code service could not start. Check node, tmux and the private zQ directory.\n'); process.exit(1)})
