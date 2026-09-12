const {test}=require('node:test');const assert=require('node:assert/strict');
const {AttachmentService}=require('../electron/chat-attachments.cjs');
const bytes=s=>new Uint8Array(Buffer.from(s));
test('text imports return metadata while keeping a private immutable snapshot',async()=>{
 const service=new AttachmentService();const raw=bytes('original');const result=await service.importFiles([{name:'readme.md',bytes:raw}]);
 assert.equal(result.errors.length,0);assert.equal(result.items[0].kind,'text');assert.equal(result.items[0].text,undefined);
 raw[0]=88;const full=service.resolve([result.items[0].id]);assert.equal(full[0].text,'original');full[0].text='changed';assert.equal(service.resolve([result.items[0].id])[0].text,'original');
 service.discard(result.items[0].id);assert.throws(()=>service.resolve([result.items[0].id]),/no longer/);
});
test('mixed imports retain good files and report specific failures',async()=>{
 const service=new AttachmentService();const r=await service.importFiles([{name:'ok.py',bytes:bytes('print(1)')},{name:'app.exe',bytes:bytes('MZ\0binary')},{name:'bad.txt',bytes:new Uint8Array([255])},{name:'big.txt',bytes:bytes('x'.repeat(100001))}]);
 assert.equal(r.items.length,1);assert.equal(r.errors.length,3);assert.match(r.errors.map(x=>x.message).join(' '),/text|UTF|100 KB/i);
});
test('PDF imports preserve extracted text and reject empty/scanned PDFs',async()=>{
 const service=new AttachmentService({extractPdf:async()=>({text:'PDF contents',pages:2})});const r=await service.importFiles([{name:'report.pdf',bytes:bytes('%PDF-1.7\nfixture')}]);assert.equal(service.resolve([r.items[0].id])[0].text,'PDF contents');assert.equal(r.items[0].pages,2);
 const blank=new AttachmentService({extractPdf:async()=>({text:'',pages:1})});const rejected=await blank.importFiles([{name:'scan.pdf',bytes:bytes('%PDF-1.7\nfixture')}]);assert.equal(rejected.items.length,0);assert.match(rejected.errors[0].message,/scanned|text/i);
});
test('file imports enforce count, size and name limits before decoding',async()=>{
 const service=new AttachmentService();await assert.rejects(service.importFiles(Array.from({length:11},()=>({name:'a.txt',bytes:bytes('x')}))),/10/);
 const r=await service.importFiles([{name:'bad\0.txt',bytes:bytes('x')},{name:'large.pdf',bytes:new Uint8Array(10*1024*1024+1)}]);assert.equal(r.errors.length,2);
});
test('real PDF worker extracts readable content without returning PDF bytes',async()=>{
 const {pdfFixture}=require('./attachment-fixtures.cjs');const service=new AttachmentService();const r=await service.importFiles([{name:'brief.pdf',bytes:pdfFixture()}]);assert.deepEqual(r.errors,[]);const a=service.resolve([r.items[0].id])[0];assert.equal(a.pages,1);assert.match(a.text,/BLUEBIRD/);assert.doesNotMatch(a.text,/%PDF|endobj/);
});
test('image header validation rejects truncated and non-progressing inputs',()=>{
 const {imageDimensions}=require('../electron/image-dimensions.cjs');
 for(const b of [Buffer.alloc(0),Buffer.from([255,216,255,224,0,0]),Buffer.from([255,216,255,255,255]),Buffer.from('RIFFbadWEBP')])assert.throws(()=>imageDimensions(b),/dimensions/);
 const png=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.write('IHDR',12);png.writeUInt32BE(100,16);png.writeUInt32BE(50,20);assert.deepEqual(imageDimensions(png),{width:100,height:50});
});
