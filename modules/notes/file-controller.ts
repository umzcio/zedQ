import type { FileDocument } from '@zq/module-api'

type Action = 'save'|'saveAs'|'reload'
type NativeFiles = {
 open:()=>Promise<FileDocument|null>
 edit:(id:string,body:string)=>Promise<FileDocument>
 save:(id:string)=>Promise<FileDocument|null>
 saveAs:(id:string)=>Promise<FileDocument|null>
 reload:(id:string)=>Promise<FileDocument|null>
}
type Snapshot = {files:FileDocument[];error:string;status:string;busy:boolean}

/** A single queue owns recovery writes and explicit disk actions, including close. */
export class FileController {
 private native:NativeFiles
 private listeners=new Set<()=>void>()
 private pending:Promise<void>=Promise.resolve()
 private exclusive=0
 private unsaved=new Set<string>()
 snapshot:Snapshot
 constructor(initial:FileDocument[],native:NativeFiles){
  this.native=native
  this.snapshot={files:initial.map(file=>({...file})),error:'',status:'',busy:false}
 }
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return ()=>{this.listeners.delete(listener)}}
 getSnapshot=()=>this.snapshot
 private publish(change:Partial<Snapshot>){this.snapshot={...this.snapshot,...change};this.listeners.forEach(listener=>listener())}
 private update(doc:FileDocument){
  const files=this.snapshot.files.some(file=>file.id===doc.id)?this.snapshot.files.map(file=>file.id===doc.id?doc:file):[...this.snapshot.files,doc]
  this.publish({files})
 }
 private enqueue<T>(operation:()=>Promise<T>,failure:string):Promise<T>{
  const result=this.pending.then(async()=>{
   try{return await operation()}
   catch(error){this.publish({error:error instanceof Error?error.message:String(error),status:failure});throw error}
  })
  // Failed work cannot poison the queue; the returned promise still rejects for close.
  this.pending=result.then(()=>{},()=>{})
  return result
 }
 private exclusiveOperation<T>(operation:()=>Promise<T>,failure:string):Promise<T>{
  this.exclusive++;this.publish({busy:true})
  return this.enqueue(async()=>{
   try{return await operation()}
   finally{this.exclusive--;this.publish({busy:this.exclusive>0})}
  },failure)
 }
 private async persistDraft(id:string,body:string){
  await this.native.edit(id,body)
  // An older response must never replace newer optimistic text.
  if(this.snapshot.files.find(file=>file.id===id)?.body===body)this.unsaved.delete(id)
 }
 edit=(id:string,body:string)=>{
  if(this.exclusive)return
  const doc=this.snapshot.files.find(file=>file.id===id);if(!doc)return
  this.unsaved.add(id);this.update({...doc,body});this.publish({status:'Saving recovery draft…'})
  void this.enqueue(async()=>{
   await this.persistDraft(id,body)
   if(!this.unsaved.size)this.publish({status:'Recovery draft saved',error:''})
  },'Recovery draft not saved')
 }
 open=()=>this.exclusiveOperation(async()=>{
  const doc=await this.native.open()
  if(!doc)return null
  const current=this.snapshot.files.find(file=>file.id===doc.id)
  const result=current?{...doc,body:current.body}:doc
  this.update(result)
  if(!this.unsaved.size)this.publish({error:'',status:''})
  return result
 },'File could not be opened')
 action=(id:string,kind:Action)=>this.exclusiveOperation(async()=>{
  const doc=this.snapshot.files.find(file=>file.id===id);if(!doc)return null
  await this.persistDraft(id,doc.body)
  const result=await this.native[kind](id)
  if(result){this.update(result);this.publish({error:'',status:kind==='reload'?'Reloaded from disk':'Saved to file'})}
  return result
 },'File action failed')
 // Stable arrow function: parent close handlers can register it once.
 flush=():Promise<void>=>this.exclusiveOperation(async()=>{
  // This snapshot is taken inside the queue, after prior save/reload responses.
  for(const doc of this.snapshot.files)await this.persistDraft(doc.id,doc.body)
  this.publish({error:'',status:'Recovery draft saved'})
 },'Recovery draft not saved')
}
