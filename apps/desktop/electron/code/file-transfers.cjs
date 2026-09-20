// Binary transfers stay in the native host. Each SSH bridge owns its handles.
const fs = require('node:fs'), path = require('node:path')
const {randomUUID} = require('node:crypto')
const {resolveFile} = require('./workspace.cjs')
const {fail,uuid} = require('./service-storage.cjs')
const CHUNK = 32768
const stamp = s => s ? [s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs].join(':') : null
function workspaceRoot(snapshot, input) {
  if ((uuid(input.projectId) ? 1 : 0) + (uuid(input.sessionId) ? 1 : 0) !== 1 || input.hostId !== undefined || input.id !== undefined) fail('INVALID_REQUEST')
  if (input.projectId !== undefined && input.sessionId !== undefined) fail('INVALID_REQUEST')
  const row = input.projectId ? snapshot.projects.find(p=>p.id===input.projectId) : snapshot.sessions.find(s=>s.id===input.sessionId)
  if (!row) fail('NOT_FOUND')
  return row
}
function destination(root, folder, name) {
  if(typeof name!=='string'||!name||name==='.'||name==='..'||/[\\/\0]/.test(name)||name.length>255)fail('INVALID_PATH')
  const parent=resolveFile(root,folder,true).target, target=path.join(parent,name)
  let stat
  try {stat=fs.lstatSync(target)} catch(e) {if(e.code!=='ENOENT')throw e}
  if(stat && (!stat.isFile()||stat.isSymbolicLink()))fail('INVALID_FILE_TYPE')
  if(stat?.nlink!==undefined && stat.nlink!==1)fail('HARDLINK_NOT_SUPPORTED')
  return {parent,target,stat}
}
class FileTransfers {
  constructor() {
    this.handles=new Map()
    this.timer=setInterval(()=>{for(const [id,h] of this.handles)if(Date.now()-h.touched>300000)this.abort(id)},30000)
    this.timer.unref?.()
  }
  abort(id) {
    const h=this.handles.get(id);if(!h)return {ok:true}
    this.handles.delete(id)
    try{fs.closeSync(h.fd)}catch{}
    if(h.tmp)try{fs.unlinkSync(h.tmp)}catch{}
    return {ok:true}
  }
  close(){clearInterval(this.timer);for(const id of this.handles.keys())this.abort(id)}
  invoke(method,input,root) {
    if(method==='beginRead'||method==='beginWrite') {
      if(this.handles.size>=8)fail('TRANSFER_BUSY')
      const id=randomUUID(), h={touched:Date.now(),offset:0,kind:method}
      if(method==='beginRead') {
        const {target}=resolveFile(root,input.path)
        h.fd=fs.openSync(target,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW)
        const stat=fs.fstatSync(h.fd)
        if(!stat.isFile()){fs.closeSync(h.fd);fail('INVALID_FILE_TYPE')}
        Object.assign(h,{size:stat.size,stamp:stamp(stat)})
      } else {
        if(!Number.isSafeInteger(input.size)||input.size<0)fail('INVALID_REQUEST')
        const dest=destination(root,input.folder||'',input.name)
        Object.assign(h,{root,folder:input.folder||'',name:input.name,size:input.size,...dest,stamp:stamp(dest.stat)})
        h.tmp=path.join(dest.parent,'.zq-upload-'+id+'.tmp')
        h.fd=fs.openSync(h.tmp,'wx',0o600)
      }
      this.handles.set(id,h)
      return {id,size:h.size,exists:!!h.stat}
    }
    const h=this.handles.get(input.token)
    if(!h)fail('TRANSFER_EXPIRED')
    h.touched=Date.now()
    if(method==='abort')return this.abort(input.token)
    if(method==='finishRead'&&h.kind==='beginRead') {
      if(h.offset!==h.size||stamp(fs.fstatSync(h.fd))!==h.stamp)fail('FILE_CONFLICT')
      return this.abort(input.token)
    }
    if(method==='readChunk'&&h.kind==='beginRead') {
      if(stamp(fs.fstatSync(h.fd))!==h.stamp)fail('FILE_CONFLICT')
      const bytes=Buffer.alloc(Math.min(CHUNK,h.size-h.offset))
      const count=fs.readSync(h.fd,bytes,0,bytes.length,h.offset);h.offset+=count
      if(!count&&h.offset<h.size)fail('FILE_CONFLICT')
      return {data:bytes.subarray(0,count).toString('base64'),done:h.offset===h.size}
    }
    if(method==='writeChunk'&&h.kind==='beginWrite') {
      if(typeof input.data!=='string'||input.data.length>Math.ceil(CHUNK/3)*4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.data))fail('INVALID_REQUEST')
      const bytes=Buffer.from(input.data,'base64')
      if(h.offset+bytes.length>h.size)fail('INVALID_REQUEST')
      let written=0;while(written<bytes.length)written+=fs.writeSync(h.fd,bytes,written,bytes.length-written,h.offset+written)
      h.offset+=written;return {bytes:h.offset}
    }
    if(method==='finishWrite'&&h.kind==='beginWrite') {
      try {
        if(h.offset!==h.size)fail('TRANSFER_INCOMPLETE')
        const current=destination(h.root,h.folder,h.name)
        if(current.target!==h.target||stamp(current.stat)!==h.stamp)fail('FILE_CONFLICT')
        if(h.stat && process.getuid?.()===0)fs.fchownSync(h.fd,h.stat.uid,h.stat.gid)
        fs.fchmodSync(h.fd,h.stat?h.stat.mode&0o777:0o644);fs.fsyncSync(h.fd)
        fs.closeSync(h.fd);h.fd=undefined
        if(!h.stat) { // A competing creator must never be overwritten.
          fs.linkSync(h.tmp,h.target);fs.unlinkSync(h.tmp)
        } else fs.renameSync(h.tmp,h.target)
        h.tmp=null;this.handles.delete(input.token)
        return {ok:true}
      } catch(e){this.abort(input.token);throw e}
    }
    fail('INVALID_REQUEST')
  }
}
module.exports={FileTransfers,workspaceRoot,CHUNK}
