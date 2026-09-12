const {parentPort,workerData}=require('node:worker_threads');
(async()=>{
 let loading;
 try{
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  loading=getDocument({data:new Uint8Array(workerData),isEvalSupported:false,useSystemFonts:false,disableFontFace:true,verbosity:0});
  const doc=await loading.promise;if(doc.numPages>100)throw Error('PDFs can contain up to 100 pages.');let text='';
  for(let i=1;i<=doc.numPages;i++){const page=await doc.getPage(i);const content=await page.getTextContent();text+=content.items.map(item=>item.str??'').join(' ')+'\n';page.cleanup();if(Buffer.byteLength(text)>100000)throw Error('PDF text exceeds 100 KB. Attach a shorter document.');}
  parentPort.postMessage({value:{text:text.trim(),pages:doc.numPages}});
 }catch(e){parentPort.postMessage({error:e.name==='PasswordException'?'Password-protected PDFs are not supported.':e.message||'Could not read this PDF.'})}
 finally{await loading?.destroy()}
})().finally(()=>parentPort.close());
