'use strict';
const path=require('node:path'),{Worker}=require('node:worker_threads');
function extractPdf(data,{signal}={}){return new Promise((resolve,reject)=>{
 if(signal?.aborted){reject(signal.reason??Error("PDF reading stopped."));return;}
 const worker=new Worker(path.join(__dirname,'pdf-worker.cjs'),{workerData:data,resourceLimits:{maxOldGenerationSizeMb:192}});let settled=false;
 const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);void worker.terminate();error?reject(error):resolve(value)};
 const timer=setTimeout(()=>finish(Error('This PDF took too long to read. Try a smaller document.')),15000);
 const abort=()=>finish(signal.reason??Error('PDF reading stopped.'));signal?.addEventListener('abort',abort,{once:true});
 worker.on('message',result=>finish(result.error?Error(result.error):null,result.value));worker.on('error',e=>finish(e));worker.on('exit',code=>{if(!settled)finish(Error(`PDF reader stopped (${code}).`))});
})}
module.exports={extractPdf};
