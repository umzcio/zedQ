const {execFile} = require('node:child_process')
const {fail} = require('./service-storage.cjs')
function externalTmux(binary='tmux',execute=execFile){
 function run(args){return new Promise((resolve,reject)=>{const env={...process.env};delete env.TMUX;execute(binary,args,{env,encoding:'utf8',timeout:3000,maxBuffer:65536},(e,out,err)=>{if(!e)resolve(out);else if(/no server running|No such file or directory/.test(err||''))resolve('');else reject(Object.assign(new Error('TMUX_FAILED'),{code:'TMUX_FAILED'}))})})}
 return {async discover(){const out=await run(['list-sessions','-F','#{session_id}\t#{session_name}\t#{session_attached}\t#{pid}\t#{session_created}']);return out.trim().split('\n').filter(Boolean).map(line=>{const [target,name,count,server,created]=line.split('\t');if(!/^\$\d+$/.test(target))fail('TMUX_FAILED');return {target,name,attached:Number(count)>0,ownership:'external',identity:server+':'+created}})},async inspect(target){return (await this.discover()).find(s=>s.target===target)||null},async write(target,data){if(!/^\$\d+$/.test(target))fail('INVALID_REQUEST');return run(['send-keys','-t',target,'-H',...Array.from(Buffer.from(data),v=>v.toString(16).padStart(2,'0'))])}}
}
module.exports={externalTmux}
