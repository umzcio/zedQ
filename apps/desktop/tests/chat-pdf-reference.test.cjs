'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {pdfReference}=require('../electron/chat-pdf-reference.cjs');
const {extractPdf}=require('../electron/pdf-extractor.cjs');
async function pdf(text){const PDF=require('pdfkit'),doc=new PDF(),chunks=[];doc.on('data',chunk=>chunks.push(chunk));const done=new Promise(resolve=>doc.on('end',resolve));if(text)doc.text(text);doc.end();await done;return {name:'fixture.pdf',mime:'application/pdf',data:Buffer.concat(chunks).toString('base64')}}
test('PDF text excerpts fit a serialized budget and explicitly indicate omitted text',async()=>{
 const file=await pdf('Vehicle details. '.repeat(500)),result=await pdfReference(file,{maxBytes:200});assert.ok(result.text.startsWith('Vehicle details.'));assert.ok(Buffer.byteLength(JSON.stringify(result.text))<=200);assert.equal(result.truncated,true);assert.ok(result.pages>0);
});
test('empty text layers and invalid PDF bytes are reported without invented content',async()=>{
 await assert.rejects(pdfReference(await pdf()),/no readable text layer/);
 await assert.rejects(pdfReference({data:Buffer.from('not a PDF').toString('base64')}),/not a readable PDF/);
 await assert.rejects(pdfReference({data:Buffer.from('%PDF-invalid').toString('base64')}),/PDF/);
});
test('PDF extraction honors cancellation before and during worker processing',async()=>{
 const file=await pdf('Fixture'),bytes=Buffer.from(file.data,'base64'),controller=new AbortController();controller.abort(Error('Stopped before reading'));await assert.rejects(extractPdf(bytes,{signal:controller.signal}),/Stopped before/);
 const active=new AbortController(),pending=extractPdf(bytes,{signal:active.signal});active.abort(Error('Stopped during reading'));await assert.rejects(pending,/Stopped during/);
});
