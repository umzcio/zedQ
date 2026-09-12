const { test } = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const ExcelJS = require('exceljs');
const { renderArtifact, previewArtifact } = require('../electron/artifact-renderer.cjs');

const fixture = '# Overview\n\nA café report with **clear** paragraphs.\n\n- First action\n- Second action\n\n## Results\n\n| Item | Value |\n| --- | --- |\n| Apples | 42 |\n| Literal | =HYPERLINK("https://example.com") |\n\nFinal observation.';
const render = (format, content = fixture, title = 'Quarterly report') => renderArtifact({ format, content, title });
const bytes = result => Buffer.from(result.data, 'base64');

test('document typography changes actual PDF, Word, spreadsheet and slide text sizes', async () => {
  const input={title:'Plan',content:'# Heading\nBody text',typography:{titleSize:22,headingSize:14,bodySize:10}};
  const word=await JSZip.loadAsync(bytes(await renderArtifact({...input,format:'docx'})));
  const styles=await word.file('word/styles.xml').async('string');
  assert.match(styles, /w:styleId="Heading1"[\s\S]*?<w:sz w:val="28"/);
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(bytes(await renderArtifact({...input,format:'xlsx'})));
  assert.equal(workbook.worksheets[0].getCell('A1').font.size,22);
  assert.equal(workbook.worksheets[0].getCell('A2').font.size,14);
  assert.equal(workbook.worksheets[0].getCell('A3').font.size,10);
  const slides=await JSZip.loadAsync(bytes(await renderArtifact({...input,format:'pptx'})));
  assert.match(await slides.file('ppt/slides/slide2.xml').async('string'), /sz="1400"/);
  assert.match(await slides.file('ppt/slides/slide2.xml').async('string'), /sz="1000"/);
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task=getDocument({data:new Uint8Array(bytes(await renderArtifact({...input,format:'pdf'})))});
  const pdf=await task.promise,items=(await (await pdf.getPage(1)).getTextContent()).items;
  assert.equal(items.find(i=>i.str==='Plan').transform[0],22);
  assert.equal(items.find(i=>i.str==='Heading').transform[0],14);
  assert.equal(items.find(i=>i.str==='Body text').transform[0],10);
  await task.destroy();
});

test('typography rejects invalid sizes and unknown executable or layout options', async () => {
  for(const typography of [{headingSize:0},{bodySize:NaN},{titleSize:200},{bodySize:'12'},{css:'url(file:///tmp)'},null])
    await assert.rejects(renderArtifact({format:'docx',title:'Plan',content:'Body',typography}),/typography|size/i);
});

test('rejects unsupported formats, empty content and bounded UTF-8 source before rendering', async () => {
  await assert.rejects(render('exe'), /format/i);
  await assert.rejects(render('pdf', '  '), /content/i);
  await assert.rejects(render('pdf', 'é'.repeat(52_000)), /100 KB/);
  await assert.rejects(render('docx', 'ok', 'x'.repeat(161)), /title.*160/i);
  await assert.rejects(render('docx', 'ok', ' '.repeat(1000)), /title.*160/i);
  await assert.rejects(render('docx', 'x\n'.repeat(4_001)), /lines/i);
});

test('presentations retain the document title and adjacent empty section headings', async () => {
  const result = await render('pptx', '# First heading\n# Second heading\n\nBody text', 'Actual document title');
  const { text } = await previewArtifact(result);
  for (const value of ['Actual document title', 'First heading', 'Second heading', 'Body text']) assert.ok(text.includes(value), value);
});

test('long single paragraph creates bounded slides and tables preserve escaped pipes', async () => {
  const content = '# Detail\n\n' + 'An extended explanation of the product. '.repeat(700) + 'ENDLONG';
  const result = await render('pptx', content);
  assert.match((await previewArtifact(result)).text, /ENDLONG/);
  const sheet = await render('xlsx', '| A | B |\n| --- | --- |\n| x\\|y | z |');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes(sheet));
  assert.equal(workbook.worksheets[0].getCell('A3').value, 'x|y');
  assert.equal(workbook.worksheets[0].getCell('B3').value, 'z');
});

test('rejects content that would exceed slide, spreadsheet row and table column limits', async () => {
  await assert.rejects(render('pptx', Array.from({ length: 81 }, (_, index) => `# Section ${index}\n\nText`).join('\n\n')), /80 slides/);
  await assert.rejects(render('xlsx', 'row\n'.repeat(2000)), /2000 rows/);
  await assert.rejects(render('xlsx', `|${' col |'.repeat(31)}\n|${' --- |'.repeat(31)}\n|${' value |'.repeat(31)}`), /30 columns/);
});

test('PDF supports multiple bundled scripts and rejects unsupported glyphs explicitly', async () => {
  const result = await render('pdf', 'Café Ωμέγα Привет');
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(bytes(result)) });
  const pdf = await task.promise;
  const text = (await (await pdf.getPage(1)).getTextContent()).items.map(item => item.str).join(' ');
  assert.match(text, /Ωμέγα/);
  assert.match(text, /Привет/);
  await task.destroy();
  await assert.rejects(render('pdf', '中文'), /font does not support.*Use DOCX/);
});

test('PDF is parseable and contains headings, paragraphs, lists, table values and Unicode', async () => {
  const result = await render('pdf');
  assert.equal(result.name, 'Quarterly report.pdf');
  assert.equal(result.mime, 'application/pdf');
  assert.equal(bytes(result).subarray(0, 5).toString(), '%PDF-');
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(bytes(result)), useSystemFonts: false });
  const pdf = await task.promise;
  let text = '';
  for (let page = 1; page <= pdf.numPages; page++) text += (await (await pdf.getPage(page)).getTextContent()).items.map(item => item.str).join(' ');
  assert.match(text, /café/);
  for (const value of ['Overview', 'First action', 'Results', 'Apples', '42', 'Final observation']) assert.ok(text.includes(value), value);
  assert.match(result.previewText, /Final observation/);
  await task.destroy();
});

test('DOCX uses native heading, list and table elements and escapes literal markup', async () => {
  const result = await render('docx', `${fixture}\n\n<script>alert(1)</script>`);
  const zip = await JSZip.loadAsync(bytes(result));
  const document = await zip.file('word/document.xml').async('string');
  assert.match(document, /w:pStyle w:val="Heading1"/);
  assert.match(document, /w:numPr/);
  assert.match(document, /<w:tbl>/);
  assert.match(document, /&lt;script&gt;alert/);
  assert.match(document, /café/);
  assert.ok(zip.file('[Content_Types].xml'));
  assert.ok(!Object.keys(zip.files).some(name => /vbaProject|externalLinks/.test(name)));
});

test('XLSX retains context and table structure while every value including formulas remains text', async () => {
  const result = await render('xlsx', `${fixture}\n\n@SUM(A1:A2)\n+1\n-1`);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes(result));
  const values = [];
  workbook.eachSheet(sheet => sheet.eachRow(row => row.eachCell(cell => {
    assert.equal(typeof cell.value, 'string');
    values.push(cell.value);
  })));
  assert.ok(values.includes('=HYPERLINK("https://example.com")'));
  assert.ok(values.includes('Final observation.'));
  assert.ok(values.includes('Apples'));
  const zip = await JSZip.loadAsync(bytes(result));
  assert.doesNotMatch(await zip.file('xl/worksheets/sheet1.xml').async('string'), /<f[ >]/);
});

test('PPTX splits sections and paginates long content without losing final paragraphs', async () => {
  const content = `${fixture}\n\n## Long section\n\n${Array.from({ length: 70 }, (_, index) => `Paragraph ${index} with meaningful detail that must remain visible.`).join('\n\n')}\n\nENDMARKER`;
  const result = await render('pptx', content);
  const zip = await JSZip.loadAsync(bytes(result));
  const slides = Object.keys(zip.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  assert.ok(slides.length >= 6);
  assert.ok(slides.length <= 80);
  const xml = (await Promise.all(slides.map(name => zip.file(name).async('string')))).join('\n');
  for (const value of ['Overview', 'First action', 'Apples', 'Paragraph 69', 'ENDMARKER']) assert.ok(xml.includes(value), value);
  assert.match(xml, /<a:tbl>/);
  assert.ok(!Object.keys(zip.files).some(name => !zip.files[name].dir && /vbaProject|media\//.test(name)));
});

test('filenames cannot contain path traversal and code fences are inert literal content', async () => {
  const result = await render('xlsx', '```js\nrequire("fs").writeFileSync("/tmp/DO-NOT-CREATE", "bad")\n```', '../../report:bad');
  assert.doesNotMatch(result.name, /[\\/:]/);
  assert.doesNotMatch(result.name, /^\./);
  assert.match(result.previewText, /writeFileSync/);
});

test('Office previews extract meaningful content from each generated format', async () => {
  for (const format of ['docx', 'xlsx', 'pptx']) {
    const result = await render(format);
    const preview = await previewArtifact(result);
    for (const value of ['café', 'Apples', 'Final observation']) assert.ok(preview.text.includes(value), `${format}: ${value}`);
  }
});

test('Office previews reject oversized ZIP expansions and XML entity declarations', async () => {
  const bomb = new JSZip();
  bomb.file('word/document.xml', 'x'.repeat(6 * 1024 * 1024));
  await assert.rejects(previewArtifact({ name: 'bomb.docx', data: await bomb.generateAsync({ type: 'base64', compression: 'DEFLATE' }) }), /expanded|XML|large|limit/i);
  const entity = new JSZip();
  entity.file('word/document.xml', '<!DOCTYPE x [<!ENTITY x SYSTEM "file:///etc/passwd">]><w:document xmlns:w="w"><w:p><w:t>&x;</w:t></w:p></w:document>');
  await assert.rejects(previewArtifact({ name: 'entity.docx', data: await entity.generateAsync({ type: 'base64' }) }), /entity|declaration|DOCTYPE/i);
  await assert.rejects(previewArtifact({ name: 'bad.docx', data: Buffer.from('not zip').toString('base64') }), /ZIP|zip|invalid|signature/i);
});
