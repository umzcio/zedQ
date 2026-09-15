const net = require('node:net')
const {spawn} = require('node:child_process')
const {randomUUID} = require('node:crypto')
const {fail} = require('./service-storage.cjs')
function previewURL(value) {
  let url
  try {url=new URL(value)}catch{fail('INVALID_PREVIEW_URL')}
  if(!['http:','https:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)
    ||url.username||url.password||url.href.length>4096)fail('INVALID_PREVIEW_URL')
  const port=Number(url.port||(url.protocol==='https:'?443:80))
  if(!Number.isInteger(port)||port<1||port>65535)fail('INVALID_PREVIEW_URL')
  return {url,port}
}
function allocate(){return new Promise((resolve,reject)=>{const server=net.createServer();server.on('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(e=>e?reject(e):resolve(port))})})}
function reachable(port){return new Promise(resolve=>{const s=net.connect({port,host:'127.0.0.1'});s.setTimeout(200);s.on('connect',()=>{s.destroy();resolve(true)});s.on('error',()=>resolve(false));s.on('timeout',()=>{s.destroy();resolve(false)})})}
class Previews {
 constructor({spawnProcess=spawn,allocatePort=allocate,probe=reachable}={}){this.spawn=spawnProcess;this.allocate=allocatePort;this.probe=probe;this.items=new Map();this.processes=new Map()}
 list(){return [...this.items.values()]}
 async open(project,value,host){const {url,port}=previewURL(value)
  const item={id:randomUUID(),projectId:project.id,sourceUrl:url.href,url:url.href,forwarded:!!host,state:'ready'}
  if(host){const local=await this.allocate(),remote=url.hostname==='[::1]'?'[::1]':'127.0.0.1'
   const args=['-N','-T','-o','BatchMode=yes','-o','ConnectTimeout=10','-o','ExitOnForwardFailure=yes','-o','ControlMaster=no','-o','ControlPath=none','-o','PermitLocalCommand=yes','-o','LocalCommand=printf zq-forward-ready','-L',`127.0.0.1:${local}:${remote}:${port}`,'--',host.sshAlias]
   const child=this.spawn('/usr/bin/ssh',args,{stdio:['ignore','pipe','ignore']});this.processes.set(item.id,child)
   let handshake=''
   child.stdout.on('data',chunk=>{handshake=(handshake+chunk.toString()).slice(-256)})
   child.on('error',()=>{item.state='stopped';item.error='SSH_FORWARD_FAILED';this.processes.delete(item.id)})
   child.on('exit',()=>{if(item.state!=='stopped')item.error ||= 'SSH_FORWARD_CLOSED';item.state='stopped';this.processes.delete(item.id)})
   let connected=false
   const deadline=Date.now()+12000
   while(Date.now()<deadline&&item.state==='ready'){if(handshake.includes('zq-forward-ready') && await this.probe(local)){connected=true;break}await new Promise(r=>setTimeout(r,50))}
   if(!connected){child.kill();this.processes.delete(item.id);fail('SSH_FORWARD_FAILED')}
   url.hostname='127.0.0.1';url.port=String(local);item.url=url.href
  }
  this.items.set(item.id,item);return item
 }
 stop(id){const item=this.items.get(id);if(!item)fail('NOT_FOUND');item.state='stopped';delete item.error;this.processes.get(id)?.kill();this.processes.delete(id);return {ok:true}}
 close(){for(const id of this.processes.keys())this.stop(id)}
}
module.exports={Previews,previewURL}
