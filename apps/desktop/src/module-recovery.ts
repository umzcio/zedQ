type RecoverableModule = {manifest:{id:string;version:string};source:string}

export async function loadWithRecovery<Record extends RecoverableModule, Component>(
 initial:Record,
 execute:(record:Record)=>Promise<Component>,
 recover:(failed:Record)=>Promise<Record>,
):Promise<{record:Record;component:Component}>{
 const attempted=new Set<string>()
 let record=initial
 for(let attempt=0;attempt<3;attempt++){
  attempted.add(JSON.stringify([record.manifest.id,record.manifest.version,record.source]))
  try{return {record,component:await execute(record)}}
  catch(error){
   // Native recovery has at most current, previous, and bundled candidates.
   if(attempt===2)throw error
   const next=await recover(record)
   if(attempted.has(JSON.stringify([next.manifest.id,next.manifest.version,next.source])))throw error
   record=next
  }
 }
 throw Error('Module recovery exhausted')
}
