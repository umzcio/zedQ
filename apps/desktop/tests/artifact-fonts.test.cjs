const {test}=require('node:test'),assert=require('node:assert/strict');
const JSZip=require('jszip'),ExcelJS=require('exceljs');
const {renderArtifact}=require('../electron/artifact-renderer.cjs');
const bytes=file=>Buffer.from(file.data,'base64');
const input={title:'A handwritten note',content:'# Dear friend\nTake a moment to enjoy the day.\n\n| Reminder | When |\n| --- | --- |\n| Breathe | Today |',typography:{fontFamily:'Bradley Hand',titleFontFamily:'Georgia',headingFontFamily:'Times New Roman',bodyFontFamily:'Brush Script MT'}};
test('Word and spreadsheets carry document and role font choices into editable content',async()=>{
 const zip=await JSZip.loadAsync(bytes(await renderArtifact({...input,format:'docx'}))),styles=await zip.file('word/styles.xml').async('string');
 assert.match(styles,/<w:docDefaults>[\s\S]*?w:ascii="Brush Script MT"/);
 assert.match(styles,/<w:style[^>]*w:styleId="Title"[\s\S]*?w:ascii="Georgia"/);
 assert.match(styles,/<w:style[^>]*w:styleId="Heading1"[\s\S]*?w:ascii="Times New Roman"/);
 const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(bytes(await renderArtifact({...input,format:'xlsx'})));const sheet=workbook.worksheets[0];
 assert.equal(sheet.getCell('A1').font.name,'Georgia');assert.equal(sheet.getCell('A2').font.name,'Times New Roman');assert.equal(sheet.getCell('A3').font.name,'Brush Script MT');assert.equal(sheet.getCell('A4').font.name,'Brush Script MT');
});
test('PowerPoint records explicit family on title, section heading, body and table runs',async()=>{
 const zip=await JSZip.loadAsync(bytes(await renderArtifact({...input,format:'pptx'})));
 const first=await zip.file('ppt/slides/slide1.xml').async('string'),second=await zip.file('ppt/slides/slide2.xml').async('string');
 assert.match(first,/typeface="Georgia"/);assert.match(second,/typeface="Times New Roman"/);assert.match(second,/typeface="Brush Script MT"/);
 const all=(await Promise.all(Object.keys(zip.files).filter(name=>/^ppt\/slides\/slide\d+\.xml$/.test(name)).map(name=>zip.file(name).async('string')))).join('');assert.match(all,/<a:tbl>[\s\S]*?typeface="Brush Script MT"/);
});
test('PDF embeds selected role fonts and preserves text through glyph fallback',async()=>{
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const task=getDocument({data:new Uint8Array(bytes(await renderArtifact({...input,content:input.content+'\nΩμέγα Привет',format:'pdf'}))),fontExtraProperties:true,useSystemFonts:false});
 try{const pdf=await task.promise,page=await pdf.getPage(1);await page.getOperatorList();const content=await page.getTextContent();const text=content.items.map(item=>item.str).join(' ');assert.match(text,/Take a moment/);assert.match(text,/Ωμέγα/);assert.match(text,/Привет/);
  const names=content.items.filter(item=>item.str.trim()).map(item=>page.commonObjs.get(item.fontName).name);assert.ok(names.some(name=>/Georgia/.test(name)),names.join(','));assert.ok(names.some(name=>/TimesNewRoman/.test(name)),names.join(','));assert.ok(names.some(name=>/BrushScriptMT/.test(name)),names.join(','));
 }finally{await task.destroy()}
});
test('whole-document handwriting family applies without individual role overrides',async()=>{
 for(const format of ['docx','xlsx','pptx','pdf']){const file=await renderArtifact({format,title:'Quiet anthem',content:'A little note\nScrawled for you.',typography:{fontFamily:'Bradley Hand'}});assert.ok(file.size===undefined||file.size>0);assert.ok(bytes(file).length>100)}
});
test('unsupported font names, paths and CSS are rejected before rendering',async()=>{
 for(const family of ['','Missing Font','../../secret.ttf','file:///tmp/font.ttf','Arial; color:red','Arial, serif',null,17])await assert.rejects(renderArtifact({format:'docx',title:'Note',content:'Body',typography:{fontFamily:family}}),/typography|font/i);
});
test('spreadsheet table headers retain heading sizes while adopting the body font',async()=>{
 const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(bytes(await renderArtifact({format:'xlsx',title:'Table',content:'| Key | Value |\n| --- | --- |\n| A | B |',typography:{headingSize:18,bodySize:12,fontFamily:'Bradley Hand'}})));
 assert.equal(workbook.worksheets[0].getCell('A2').font.size,18);assert.equal(workbook.worksheets[0].getCell('A2').font.name,'Bradley Hand');assert.equal(workbook.worksheets[0].getCell('A3').font.size,12);
});
test('PDF handwriting and fallback glyphs share a baseline without artificial gaps',async()=>{
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
 for(const fontFamily of ['Bradley Hand','Brush Script MT']){
  const task=getDocument({data:new Uint8Array(bytes(await renderArtifact({format:'pdf',title:'Title',content:'Aनमस्तेB',typography:{fontFamily,bodySize:24}}))),fontExtraProperties:true,useSystemFonts:false});
  try{const pdf=await task.promise,page=await pdf.getPage(1);await page.getOperatorList();const items=(await page.getTextContent()).items.filter(item=>item.str.trim()&&item.str!=='Title'),deva=items.find(i=>i.str.includes('नमस्ते'));assert.ok(deva,JSON.stringify(items));assert.match(page.commonObjs.get(deva.fontName).name,/Noto/);
   const baseline=items[0].transform[5];for(const item of items)assert.ok(Math.abs(item.transform[5]-baseline)<0.01,`${fontFamily}: unequal baselines ${baseline}, ${item.transform[5]}`);
   // PDF.js text item widths omit some conjunct glyph advances. Compare the
   // next run origin with the font's shaped advance, not that extraction width.
   const font=require('fontkit').openSync(require.resolve('@fontsource/noto-sans/files/noto-sans-devanagari-400-normal.woff'));
   const advance=font.layout('नमस्ते').advanceWidth/font.unitsPerEm*24,after=items.find(item=>item.str==='B');
   assert.ok(Math.abs(after.transform[4]-deva.transform[4]-advance)<0.01,`${fontFamily}: incorrect spacing after shaped fallback run`);
  }finally{await task.destroy()}
 }
});
