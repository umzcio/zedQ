const {test}=require('node:test');
const assert=require('node:assert/strict');
const zlib=require('node:zlib');
const {validateDocumentFile}=require('../electron/artifact-document-validation.cjs');
const MIME={docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation'};
// Build fixtures directly so declared lengths, flags and duplicate names can be corrupted.
function zip(files){let offset=0;const chunks=[],central=[];for(const file of files){const name=Buffer.from(file.name),data=Buffer.from(file.data??''),compressed=zlib.deflateRawSync(data),local=Buffer.alloc(30),entry=Buffer.alloc(46);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(file.flags??0,6);local.writeUInt16LE(8,8);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(file.declared??data.length,22);local.writeUInt16LE(name.length,26);entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);entry.writeUInt16LE(file.flags??0,8);entry.writeUInt16LE(8,10);entry.writeUInt32LE(compressed.length,20);entry.writeUInt32LE(file.declared??data.length,24);entry.writeUInt16LE(name.length,28);entry.writeUInt32LE(file.attributes??0,38);entry.writeUInt32LE(offset,42);chunks.push(local,name,compressed);central.push(entry,name);offset+=local.length+name.length+compressed.length}const cd=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...chunks,cd,end]).toString('base64')}
const office=(files,patch={})=>({name:'document.docx',mime:MIME.docx,data:zip(files),...patch});
const doc={name:'word/document.xml',data:'<document><p>Safe text</p></document>'};
test('validates every member including skipped styles with forged expansion sizes',async()=>{
 await assert.rejects(validateDocumentFile(office([doc,{name:'word/styles.xml',data:Buffer.alloc(41*1024*1024,32),declared:1}])));
 await assert.rejects(validateDocumentFile(office([doc,{name:'word/media/image.png',data:'oversized compared with declaration',declared:1}])));
});
test('Office MIME with a .bin name still gets ZIP validation and normalized format',async()=>{
 assert.deepEqual(await validateDocumentFile(office([doc],{name:'download.bin'})),{format:'docx'});
 await assert.rejects(validateDocumentFile(office([doc,{name:'word/media/image.png',data:'bad',declared:1}],{name:'download.bin'})));
});
test('Office extension with generic MIME gets ZIP validation and mismatched Office types reject',async()=>{
 assert.deepEqual(await validateDocumentFile(office([doc],{mime:'application/octet-stream'})),{format:'docx'});
 await assert.rejects(validateDocumentFile(office([doc],{name:'document.xlsx'})),/format|type/i);
});
test('image-only and empty-text Office documents do not require readable text',async()=>{
 for(const format of ['docx','xlsx','pptx'])assert.deepEqual(await validateDocumentFile({name:`blank.${format}`,mime:MIME[format],data:zip([{name:'[Content_Types].xml',data:'<Types/>'},{name:format==='docx'?'word/document.xml':format==='xlsx'?'xl/worksheets/sheet1.xml':'ppt/slides/slide1.xml',data:'<document/>'},{name:'media/image.png',data:Buffer.from([137,80,78,71])}])}),{format});
});
test('bounded non-Office data is returned without interpreting content',async()=>{assert.deepEqual(await validateDocumentFile({name:'report.pdf',mime:'application/pdf',data:Buffer.from('%PDF-fixture').toString('base64')}),{format:'pdf'});});
test('rejects duplicate or ambiguous members, traversal paths, encryption and symlinks',async()=>{
 for(const name of ['../outside.xml','/absolute.xml','C:/outside.xml','word/../outside.xml','word\\document.xml','word/./document.xml'])await assert.rejects(validateDocumentFile(office([{name,data:'x'}])));
 for(const pair of [['word/styles.xml','word/styles.xml'],['word/styles.xml','WORD/STYLES.XML']])await assert.rejects(validateDocumentFile(office(pair.map(name=>({name,data:'x'})))),/duplicate|ambiguous/i);
 await assert.rejects(validateDocumentFile(office([{name:'word/document.xml',data:'x',flags:1}])),/encrypt/i);
 await assert.rejects(validateDocumentFile(office([{name:'word/document.xml',data:'x',attributes:0xa0000000}])),/symbolic|symlink/i);
});
test('enforces entry, declared expansion, compressed data and canonical base64 limits',async()=>{
 await assert.rejects(validateDocumentFile(office(Array.from({length:2001},(_,i)=>({name:`part${i}.xml`,data:''})))),/entry|entries/i);
 await assert.rejects(validateDocumentFile(office([{name:'word/document.xml',data:'x',declared:41*1024*1024}])),/size|expand/i);
 await assert.rejects(validateDocumentFile({name:'x.docx',mime:MIME.docx,data:Buffer.alloc(10*1024*1024+1).toString('base64')}),/10 MB|size/i);
 for(const data of ['invalid','Zg=','Zg==\n'])await assert.rejects(validateDocumentFile({name:'x.docx',mime:MIME.docx,data}));
});
test('active relationships remain inert bytes for the sandbox to handle, not native fetches',async()=>{
 assert.deepEqual(await validateDocumentFile(office([doc,{name:'word/_rels/document.xml.rels',data:'<Relationships><Relationship Target="https://example.com/active" TargetMode="External"/></Relationships>'}])),{format:'docx'});
});
test('accepts real generated DOCX, XLSX and PPTX archives',async()=>{
 const {renderArtifact}=require('../electron/artifact-renderer.cjs');
 for(const format of ['docx','xlsx','pptx']){
  const file=await renderArtifact({format,title:'Validated document',content:'# Heading\n\nBody\n\n| Name | Value |\n| --- | --- |\n| One | Two |'});
  assert.deepEqual(await validateDocumentFile(file),{format});
 }
});
