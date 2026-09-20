const fs=require('node:fs'),path=require('node:path')
const {randomUUID}=require('node:crypto')
const {FileTransfers,workspaceRoot,CHUNK}=require('./file-transfers.cjs')
const {fail}=require('./service-storage.cjs')
const key=input=>input.projectId?'project:'+input.projectId:'session:'+input.sessionId
class TransferService {
  constructor(owner,pickers) {this.owner=owner;this.pickers=pickers;this.local=new FileTransfers();this.jobs=[];this.busy=false}
  close(){this.closed=true;this.local.close()}
  list(input){return this.jobs.filter(j=>j.target===key(input)).map(({target,...job})=>job)}
  async run(method,input) {
    if(this.busy)fail('TRANSFER_BUSY')
    this.busy=true
    try {return await this.perform(method,input)} finally {this.busy=false}
  }
  async perform(method,input) {
    const snapshot=await this.owner.snapshot(), row=workspaceRoot(snapshot,input)
    const target=input.projectId?{projectId:input.projectId}:{sessionId:input.sessionId}
    const client=row.hostId==='local'?null:this.owner.remotes.clients.get(row.hostId)
    if(row.hostId!=='local'&&!client)fail('HOST_DISCONNECTED')
    const call=async(action,params={})=>{
      if(this.closed)fail('SERVICE_CLOSED')
      return client?client.request('code:transfer',{action,...params,...target}):this.local.invoke(action,params,row.cwd)
    }
    const upload=method==='uploadFiles'
    if(!this.pickers.pickUpload||!this.pickers.pickDownload||!this.pickers.confirmReplace)fail('UNAVAILABLE')
    const sources=upload?await this.pickers.pickUpload():[input.path]
    if(!sources?.length)return {completed:0,canceled:true}
    let completed=0
    for(const source of sources) {
      const name=path.basename(source), job={id:randomUUID(),target:key(input),name,direction:upload?'upload':'download',bytes:0,total:0,state:'running'}
      let token,fd,tmp
      try {
        let destination
        if(!upload){destination=await this.pickers.pickDownload(name);if(!destination)continue}
        this.jobs=this.jobs.filter(j=>j.state==='running').concat(this.jobs.filter(j=>j.state!=='running').slice(-19),job)
        if(upload) {
          fd=fs.openSync(source,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW)
          const stat=fs.fstatSync(fd);if(!stat.isFile())fail('INVALID_FILE_TYPE')
          job.total=stat.size
          const opened=await call('beginWrite',{folder:input.path||'',name,size:stat.size});token=opened.id
          if(opened.exists&&!await this.pickers.confirmReplace(name)) {job.state='skipped';continue}
          const buffer=Buffer.alloc(CHUNK)
          while(job.bytes<stat.size) {
            const count=fs.readSync(fd,buffer,0,Math.min(CHUNK,stat.size-job.bytes),job.bytes)
            if(!count)fail('FILE_CONFLICT')
            await call('writeChunk',{token,data:buffer.subarray(0,count).toString('base64')});job.bytes+=count
          }
          const after=fs.fstatSync(fd)
          if(after.size!==stat.size||after.mtimeMs!==stat.mtimeMs||after.ctimeMs!==stat.ctimeMs)fail('FILE_CONFLICT')
          await call('finishWrite',{token});token=null
        } else {
          const opened=await call('beginRead',{path:input.path});token=opened.id;job.total=opened.size
          tmp=path.join(path.dirname(destination),'.zq-download-'+job.id+'.tmp');fd=fs.openSync(tmp,'wx',0o600)
          // Detect changes to an existing destination while the download is running.
          let before;try{before=fs.lstatSync(destination)}catch(e){if(e.code!=='ENOENT')throw e}
          if(before&&!before.isFile())fail('INVALID_FILE_TYPE')
          while(job.bytes<job.total) {
            const result=await call('readChunk',{token}), bytes=Buffer.from(result.data,'base64')
            if(!bytes.length||job.bytes+bytes.length>job.total)fail('TRANSFER_INCOMPLETE')
            let written=0;while(written<bytes.length)written+=fs.writeSync(fd,bytes,written,bytes.length-written)
            job.bytes+=written
          }
          await call('finishRead',{token});token=null
          fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined
          let after;try{after=fs.lstatSync(destination)}catch(e){if(e.code!=='ENOENT')throw e}
          if(before?(!after||before.ino!==after.ino||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs):!!after)fail('FILE_CONFLICT')
          if(before)fs.renameSync(tmp,destination);else {fs.linkSync(tmp,destination);fs.unlinkSync(tmp)}
          tmp=null
        }
        job.state='done';completed++
      } catch(error) {job.state='failed';job.error=error.code||'TRANSFER_FAILED';throw error}
      finally {
        if(fd!==undefined)try{fs.closeSync(fd)}catch{}
        if(tmp)try{fs.unlinkSync(tmp)}catch{}
        if(token)try{await call('abort',{token})}catch{}
      }
    }
    return {completed,canceled:completed===0}
  }
}
module.exports={TransferService}
