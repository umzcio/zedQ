'use strict';
const {extractPdf}=require('./pdf-extractor.cjs');
// Bound decoded files and serialized text separately so extraction cannot
// overflow provider tool results. File text remains untrusted reference data.
async function pdfReference(file,{signal,maxBytes=60000}={}){
 if(typeof file.data!=='string'||file.data.length>14*1024*1024)throw Error('PDF exceeds the 10 MB reading limit.');
 const data=Buffer.from(file.data,'base64');
 if(data.length>10*1024*1024)throw Error('PDF exceeds the 10 MB reading limit.');
 if(data.subarray(0,5).toString()!=='%PDF-')throw Error('This file is not a readable PDF.');
 const result=await extractPdf(data,{signal});
 if(!result.text.trim())throw Error('This PDF has no readable text layer. Scanned pages require OCR or image input.');
 const characters=Array.from(result.text);let low=0,high=characters.length;
 while(low<high){const mid=Math.ceil((low+high)/2);if(Buffer.byteLength(JSON.stringify(characters.slice(0,mid).join('')))<=maxBytes)low=mid;else high=mid-1;}
 return {text:characters.slice(0,low).join(''),pages:result.pages,truncated:low<characters.length};
}
module.exports={pdfReference};
