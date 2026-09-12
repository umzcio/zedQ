'use strict';

// Trusted, text-only document generation. Never interpret source as HTML, JS,
// Office formulas, URLs, images, templates, or filesystem paths.
const {checkTypography,fontFamily}=require('./artifact-typography.cjs');
const {pdfFont}=require('./artifact-fonts.cjs');
const MAX_SOURCE_BYTES = 100 * 1024;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const MAX_XML_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 2000;
const MAX_SLIDES = 80;
const MIME = Object.freeze({
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
});

function cleanText(value) {
  return value.toWellFormed().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\r\n?/g, '\n');
}

function inline(value) {
  return value.replace(/!?\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)').replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a, b) => a || b).replace(/`([^`]+)`/g, '$1');
}

function cells(line) {
  return line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map(cell => inline(cell.trim().replace(/\\\|/g, '|')));
}

function parseContent(content) {
  const lines = content.split('\n');
  if (lines.length > 4000) throw new Error('Artifact content exceeds the 4000 lines limit. Split it into smaller documents.');
  const blocks = [];
  let rowCount = 0;
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      const code = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith(fence[1])) code.push(lines[i++]);
      if (i < lines.length) i++;
      blocks.push({ type: 'code', text: code.join('\n') });
      continue;
    }
    const heading = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) { blocks.push({ type: 'heading', level: heading[1].length, text: inline(heading[2]) }); i++; continue; }
    if (i + 1 < lines.length && line.includes('|') && cells(lines[i + 1]).every(cell => /^:?-{3,}:?$/.test(cell))) {
      const rows = [cells(line)];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(cells(lines[i++]));
      const columns = Math.max(...rows.map(row => row.length));
      if (columns > 30) throw new Error('Artifact tables support at most 30 columns.');
      rowCount += rows.length;
      if (rowCount > MAX_ROWS) throw new Error('Artifact tables exceed the 2000 rows limit.');
      blocks.push({ type: 'table', rows: rows.map(row => Array.from({ length: columns }, (_, index) => row[index] || '')) });
      continue;
    }
    const list = /^\s*(?:([-+*])\s+|(\d+)[.)]\s+)(.*)$/.exec(line);
    if (list) { blocks.push({ type: 'list', ordered: !!list[2], marker: list[2] ? `${list[2]}.` : '•', text: inline(list[3]) }); i++; continue; }
    // Keep source line boundaries: this also gives text-only spreadsheets useful rows.
    blocks.push({ type: 'paragraph', text: inline(line) });
    i++;
  }
  return blocks;
}

function blockText(block) {
  return block.type === 'table' ? block.rows.map(row => row.join('\t')).join('\n') : `${block.type === 'list' ? `${block.marker} ` : ''}${block.text}`;
}

let pdfFonts;
function getPdfFonts() {
  if (!pdfFonts) {
    const fontkit = require('fontkit');
    pdfFonts = ['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext', 'greek', 'greek-ext', 'vietnamese', 'devanagari'].map(subset => {
      const path = require.resolve(`@fontsource/noto-sans/files/noto-sans-${subset}-400-normal.woff`);
      return { path, font: fontkit.openSync(path), name: subset };
    });
  }
  return pdfFonts;
}

async function renderPdf(title, blocks, typography = {}) {
  const PDFDocument = require('pdfkit');
  const defaults = getPdfFonts();
  const families = Object.fromEntries(['title','heading','body'].map(role=>[role,fontFamily(typography,role,null)]));
  const selected = [...new Set(Object.values(families).filter(Boolean))].map(pdfFont);
  const fonts = [...selected,...defaults];
  const glyphs = new Map();
  const glyph = (character,family) => {
    const key = JSON.stringify([family,character]);
    if (!glyphs.has(key)) {
      const candidates=family?[pdfFont(family),...defaults]:defaults;
      const font = candidates.find(candidate => candidate.font.hasGlyphForCodePoint(character.codePointAt(0)));
      if (!font) throw new Error(`PDF font does not support “${character}” (U+${character.codePointAt(0).toString(16).toUpperCase()}). Use DOCX for this text.`);
      glyphs.set(key, { ...font, width: font.font.glyphForCodePoint(character.codePointAt(0)).advanceWidth / font.font.unitsPerEm });
    }
    return glyphs.get(key);
  };
  // Preflight all glyphs before starting the output stream; never silently lose text.
  for(const [text,family] of [[title,families.title],...blocks.map(block=>[blockText(block),block.type==='heading'?families.heading:families.body])])for(const character of text.replace(/[\n\t]/g,' '))glyph(character,family);
  const doc = new PDFDocument({ size: 'LETTER', margin: 48, info: { Title: title, Creator: 'zQ' }, compress: true });
  for (const font of fonts) doc.registerFont(font.name, font.path);
  const chunks = [];
  let size = 0;
  let pages = 1;
  const output = new Promise((resolve, reject) => {
    doc.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_OUTPUT_BYTES) doc.destroy(new Error('Rendered artifact exceeds the 10 MB output limit.'));
      else chunks.push(chunk);
    });
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });
  let y = 48;
  const bottom = 744;
  const ensure = height => {
    if (y + height > bottom) {
      if (++pages > 200) throw new Error('PDF exceeds the 200 pages limit. Split the content.');
      doc.addPage(); y = 48;
    }
  };
  const runs = (text, family) => {
    const result=[];
    for(const character of text){
      const selected=glyph(character,family),last=result.at(-1);
      if(last?.font.name===selected.name)last.text+=character;
      else result.push({font:selected,text:character});
    }
    return result;
  };
  const measure = (text,fontSize,family) => runs(text,family).reduce((sum,run)=>sum+doc.font(run.font.name).fontSize(fontSize).widthOfString(run.text),0);
  const graphemes = new Intl.Segmenter(undefined,{granularity:'grapheme'});
  const wrap = (text, width, fontSize, family=families.body) => {
    const result = [];
    for (const paragraph of text.replace(/\t/g, '    ').split('\n')) {
      let line = '';
      for (const word of paragraph.match(/\S+\s*|\s+/g) || ['']) {
        if (line && measure(line+word,fontSize,family)>width) { result.push(line.trimEnd()); line=''; }
        if(measure(word,fontSize,family)<=width){line+=word;continue;}
        for (const {segment} of graphemes.segment(word)) {
          if (line && measure(line+segment,fontSize,family)>width) { result.push(line.trimEnd()); line=''; }
          line+=segment;
        }
      }
      result.push(line.trimEnd());
    }
    return result;
  };
  const drawLine = (text, x, top, fontSize, family=families.body) => {
    const shaped=runs(text,family);
    const baseline=top+Math.max(0,...shaped.map(run=>run.font.font.ascent/run.font.font.unitsPerEm))*fontSize;
    for(const run of shaped){
      doc.font(run.font.name).fontSize(fontSize).fillColor('#202124');
      const width=doc.widthOfString(run.text);
      doc.text(run.text,x,baseline,{lineBreak:false,baseline:'alphabetic'});
      x+=width;
    }
  };
  const paragraph = (text, fontSize = 11, indent = 0, family=families.body) => {
    const leading = fontSize * 1.5;
    for (const line of wrap(text, 516 - indent, fontSize,family)) { ensure(leading); drawLine(line, 48 + indent, y, fontSize,family); y += leading; }
    y += 7;
  };
  try {
    paragraph(title, typography.titleSize ?? 23,0,families.title);
    for (const block of blocks) {
      if (block.type !== 'table') {
        if (block.type === 'heading') { ensure(65); y += 7; }
        paragraph(blockText(block), block.type === 'heading' ? (typography.headingSize ? Math.max(8, typography.headingSize - (block.level - 1) * 2) : Math.max(12, 20 - block.level * 2)) : block.type === 'code' ? 9 : (typography.bodySize ?? 11), block.type === 'list' ? 10 : 0,block.type==='heading'?families.heading:families.body);
        continue;
      }
      if (block.rows[0].length > 8) {
        // Wide tables remain readable as labeled records instead of microscopic cells.
        paragraph(block.rows[0].join(' | '), 10);
        for (const row of block.rows.slice(1)) paragraph(row.map((value, index) => `${block.rows[0][index]}: ${value}`).join('\n'), 10);
        continue;
      }
      const width = 516 / block.rows[0].length;
      for (let index = 0; index < block.rows.length; index++) {
        const wrapped = block.rows[index].map(cell => wrap(cell, width - 12, 9));
        const count = Math.max(...wrapped.map(cell => cell.length));
        for (let start = 0; start < count;) {
          ensure(26);
          const take = Math.min(count - start, Math.max(1, Math.floor((bottom - y - 10) / 14)));
          const height = take * 14 + 10;
          wrapped.forEach((cell, column) => {
            const x = 48 + column * width;
            doc.rect(x, y, width, height).fillAndStroke(index === 0 ? '#eceef0' : '#ffffff', '#c9cdd1');
            for (let line = 0; line < take; line++) drawLine(cell[start + line] || '', x + 6, y + 5 + line * 14, 9);
          });
          y += height; start += take;
        }
      }
      y += 12;
    }
    doc.end();
  } catch (error) { doc.destroy(error); }
  return output;
}

async function renderDocx(title, blocks, typography = {}) {
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel, WidthType } = require('docx');
  const children = [new Paragraph({ text: title, heading: HeadingLevel.TITLE, spacing: { after: 240 } })];
  for (const block of blocks) {
    if (block.type === 'table') {
      children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: block.rows.map((row, index) => new TableRow({ tableHeader: index === 0, children: row.map(text => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, bold: index === 0 })] })], shading: index === 0 ? { fill: 'ECEEF0' } : undefined })) })) }));
      children.push(new Paragraph(''));
    } else {
      const options = { spacing: { after: 140 }, children: block.text.split('\n').map((text, index) => new TextRun({ text, break: index ? 1 : 0, font: block.type === 'code' ? 'Consolas' : undefined })) };
      if (block.type === 'heading') options.heading = HeadingLevel[`HEADING_${block.level}`];
      if (block.type === 'list') {
        if (block.ordered) options.numbering = { reference: 'ordered', level: 0 };
        else options.bullet = { level: 0 };
      }
      children.push(new Paragraph(options));
    }
  }
  return Packer.toBuffer(new Document({ creator: 'zQ', title,
    styles: { default: { document: { run: { font: fontFamily(typography,'body'), size: (typography.bodySize ?? 11) * 2, color: '202124' } }, title:{run:{font:fontFamily(typography,'title'),...(typography.titleSize?{size:typography.titleSize*2}:{})}}, ...Object.fromEntries(Array.from({length:6},(_,i)=>['heading'+(i+1),{run:{font:fontFamily(typography,'heading'),...(typography.headingSize?{size:Math.max(8,typography.headingSize-i*2)*2}:{})}}])) } },
    numbering: { config: [{ reference: 'ordered', levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: 'left', style: { paragraph: { indent: { left: 360, hanging: 180 } } } }] }] },
    sections: [{ properties: { page: { margin: { top: 960, bottom: 960, left: 960, right: 960 } } }, children }],
  }));
}

async function renderXlsx(title, blocks, typography = {}) {
  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'zQ'; workbook.title = title;
  const sheet = workbook.addWorksheet('Content');
  const addRow = (values, heading = false, size = heading ? typography.headingSize ?? 11 : typography.bodySize ?? 11, role = heading ? 'heading' : 'body') => {
    if (sheet.rowCount >= MAX_ROWS) throw new Error('Spreadsheet exceeds the 2000 rows limit. Split the content.');
    if (values.some(value => value.length > 32767)) throw new Error('Spreadsheet cells support at most 32767 characters. Split the long paragraph.');
    const row = sheet.addRow(values); // Strings stay strings, including =, +, -, @ prefixes.
    row.eachCell(cell => {
      cell.numFmt = '@';
      cell.font = { name: fontFamily(typography,role), size, bold: heading };
      cell.alignment = { vertical: 'top', wrapText: true };
      if (heading) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECEEF0' } };
    });
    return row;
  };
  addRow([title], true, typography.titleSize ?? 11,'title');
  for (const block of blocks) {
    if (block.type === 'table') block.rows.forEach((row, index) => addRow(row, index === 0,index===0?typography.headingSize??11:typography.bodySize??11,'body'));
    else blockText(block).split('\n').forEach(line => addRow(line.split('\t'), block.type === 'heading'));
  }
  sheet.columns.forEach(column => { column.width = sheet.columnCount > 1 ? 28 : 95; });
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function wrapCharacters(text, limit) {
  const lines = [];
  for (let rest of text.split('\n')) {
    while ([...rest].length > limit) {
      const prefix = [...rest].slice(0, limit).join('');
      const boundary = prefix.lastIndexOf(' ');
      const count = boundary > limit / 2 ? boundary : prefix.length;
      lines.push(rest.slice(0, count)); rest = rest.slice(count).trimStart();
    }
    lines.push(rest);
  }
  return lines;
}

async function renderPptx(title, blocks, typography = {}) {
  const PptxGenJS = require('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; pptx.author = 'zQ'; pptx.subject = title; pptx.title = title; pptx.lang = 'en-US';
  pptx.theme = { headFontFace: fontFamily(typography,'heading'), bodyFontFace: fontFamily(typography,'body'), lang: 'en-US' };
  let slideCount = 0;
  let heading = title;
  let titleSlide = true;
  const bodySize = typography.bodySize ?? 18;
  const lineBudget = Math.max(9, Math.floor(14 * 18 / bodySize));
  let continuation = 0;
  let pending = [];
  let sectionUsed = false;
  const newSlide = () => {
    if (++slideCount > MAX_SLIDES) throw new Error('Presentation exceeds the 80 slides limit. Split the content.');
    const slide = pptx.addSlide();
    sectionUsed = true;
    slide.background = { color: 'FFFFFF' };
    slide.addText(heading + (continuation++ ? ' (continued)' : ''), { x: 0.6, y: 0.4, w: 12.1, h: 1, fontFace:fontFamily(typography,titleSlide?'title':'heading'), fontSize: (titleSlide ? typography.titleSize : typography.headingSize) ?? 26, bold: true, color: '202124', margin: 0, breakLine: false, fit: 'shrink' });
    slide.addText(String(slideCount), { x: 12, y: 7.05, w: 0.6, h: 0.2, fontSize: 10, color: '777777', align: 'right', margin: 0 });
    return slide;
  };
  const flush = (all = true) => {
    while (pending.length >= lineBudget || (all && pending.length)) newSlide().addText(pending.splice(0, lineBudget).join('\n'), { x: 0.65, y: 1.6, w: 12, h: 5.15, fontFace:fontFamily(typography,'body'), fontSize: bodySize, color: '202124', margin: 0, valign: 'top', breakLine: false, lineSpacingMultiple: 1.1, fit: 'shrink' });
  };
  for (const block of blocks) {
    if (block.type === 'heading') {
      flush();
      if (!sectionUsed) newSlide();
      heading = block.text;
      titleSlide = false;
      if (heading.length > 160) throw new Error('Presentation section headings must be at most 160 characters.');
      continuation = 0;
      sectionUsed = false;
    } else if (block.type === 'table' && block.rows[0].length <= 6) {
      flush();
      const width = 12 / block.rows[0].length;
      const charLimit = Math.floor(width * 8);
      const rows = [];
      // Split tall cells into successive rows so no original cell is clipped.
      for (const row of block.rows) {
        const wrapped = row.map(cell => wrapCharacters(cell, charLimit));
        const count = Math.max(...wrapped.map(cell => cell.length));
        for (let start = 0; start < count; start += 3) rows.push(wrapped.map(cell => cell.slice(start, start + 3).join('\n')));
      }
      while (rows.length) {
        const group = []; let lines = 0;
        while (rows.length && lines + Math.max(...rows[0].map(cell => cell.split('\n').length)) + 1 <= 15) {
          const row = rows.shift(); lines += Math.max(...row.map(cell => cell.split('\n').length)) + 1; group.push(row);
        }
        newSlide().addTable(group, { x: 0.65, y: 1.6, w: 12, h: 4.9, colW: width, fontFace:fontFamily(typography,'body'), fontSize: 16, margin: 0.08, border: { type: 'solid', color: 'CCD0D4', pt: 0.5 }, color: '202124', fill: 'FFFFFF', valign: 'top', autoPage: false });
      }
    } else {
      const text = block.type === 'table' ? block.rows.slice(1).map(row => row.map((value, index) => `${block.rows[0][index]}: ${value}`).join('\n')).join('\n\n') : blockText(block);
      pending.push(...wrapCharacters(text, Math.floor(85 * 18 / bodySize)), '');
      if (pending.length >= lineBudget) flush(false);
    }
  }
  flush();
  if (!sectionUsed) newSlide();
  return Buffer.from(await pptx.write({ outputType: 'nodebuffer', compression: true }));
}

async function renderArtifact(input) {
  checkTypography(input?.typography);
  if (!input || !Object.hasOwn(MIME, input.format)) throw new Error('Unsupported artifact format. Choose PDF, DOCX, XLSX, or PPTX.');
  if (typeof input.title !== 'string' || input.title.length > 160) throw new Error('Artifact title must be a string of at most 160 characters.');
  if (typeof input.content !== 'string' || !input.content.trim()) throw new Error('Artifact content is required.');
  if (Buffer.byteLength(input.content, 'utf8') > MAX_SOURCE_BYTES) throw new Error('Artifact content exceeds the 100 KB source limit.');
  const title = cleanText(input.title).replace(/\s+/g, ' ').trim() || 'Untitled artifact';
  const content = cleanText(input.content);
  const blocks = parseContent(content);
  if (!blocks.length) throw new Error('Artifact content is required.');
  const renderers = { pdf: renderPdf, docx: renderDocx, xlsx: renderXlsx, pptx: renderPptx };
  const data = await renderers[input.format](title, blocks, input.typography);
  if (!data.length || data.length > MAX_OUTPUT_BYTES) throw new Error('Rendered artifact exceeds the 10 MB output limit. Split the content.');
  const base = title.replace(/[<>:"/\\|?*\u202a-\u202e\u2066-\u2069]/g, '-').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 140) || 'artifact';
  return { name: `${base}.${input.format}`, mime: MIME[input.format], data: data.toString('base64'), previewText: `${title}\n\n${blocks.map(blockText).join('\n\n')}`.slice(0, MAX_SOURCE_BYTES) };
}

// Read only the XML needed for an inert content preview. yauzl does not extract
// files, resolves no relationships, and validates declared vs actual byte counts.
function readPreviewXml(data, format) {
  const yauzl = require('yauzl');
  const wanted = name => format === 'docx' ? name === 'word/document.xml' : format === 'pptx' ? /^ppt\/slides\/slide\d+\.xml$/.test(name) : name === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(name);
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(data, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error) return reject(new Error(`Invalid Office ZIP: ${error.message}`));
      let count = 0; let expanded = 0; let selected = 0; let actual = 0; let finished = false;
      const files = new Map();
      const fail = error => { if (!finished) { finished = true; zip.close(); reject(error); } };
      zip.on('error', fail);
      zip.on('entry', entry => {
        expanded += entry.uncompressedSize;
        if (++count > 2000 || expanded > 40 * 1024 * 1024) return fail(new Error('Office ZIP exceeds the expanded size or entry limit.'));
        if (!wanted(entry.fileName)) { zip.readEntry(); return; }
        selected += entry.uncompressedSize;
        if (selected > MAX_XML_BYTES) return fail(new Error('Office preview XML exceeds the 5 MB expanded size limit.'));
        if (files.has(entry.fileName)) return fail(new Error('Office ZIP contains duplicate XML entries.'));
        zip.openReadStream(entry, (error, stream) => {
          if (error) return fail(error);
          const chunks = [];
          stream.on('error', fail);
          stream.on('data', chunk => {
            actual += chunk.length;
            if (actual > MAX_XML_BYTES) { stream.destroy(); fail(new Error('Office preview XML exceeds the expanded size limit.')); }
            else chunks.push(chunk);
          });
          stream.on('end', () => { if (!finished) { files.set(entry.fileName, Buffer.concat(chunks).toString('utf8')); zip.readEntry(); } });
        });
      });
      zip.on('end', () => { if (!finished) { finished = true; resolve(files); } });
      zip.readEntry();
    });
  });
}

function parseXml(xml, handlers) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Office preview rejects DOCTYPE and entity declarations.');
  const parser = require('sax').parser(true, { xmlns: true, trim: false });
  let depth = 0;
  parser.onopentag = node => {
    if (++depth > 100) throw new Error('Office XML nesting exceeds the preview limit.');
    handlers.open?.(node.local, Object.fromEntries(Object.entries(node.attributes).map(([key, value]) => [key, value.value])));
  };
  parser.onclosetag = name => { handlers.close?.(name.split(':').pop()); depth--; };
  parser.ontext = text => handlers.text?.(text);
  parser.oncdata = text => handlers.text?.(text);
  parser.write(xml).close();
}

async function previewArtifact({ name, mime, data } = {}) {
  const format = Object.keys(MIME).find(format => format !== 'pdf' && MIME[format] === mime) || String(name || '').split('.').pop().toLowerCase();
  if (!['docx', 'xlsx', 'pptx'].includes(format)) throw new Error('Text preview supports DOCX, XLSX, and PPTX files.');
  if (typeof data !== 'string' || data.length > Math.ceil(MAX_OUTPUT_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new Error('Invalid or oversized artifact data; the preview limit is 10 MB.');
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length > MAX_OUTPUT_BYTES) throw new Error('Artifact exceeds the 10 MB preview limit.');
  const files = await readPreviewXml(bytes, format);
  const parts = [];
  let length = 0;
  const append = text => {
    const available = MAX_SOURCE_BYTES - length;
    if (available > 0) { parts.push(text.slice(0, available)); length += Math.min(available, text.length); }
  };
  if (format === 'xlsx') {
    const strings = [];
    let current = ''; let inText = false;
    if (files.has('xl/sharedStrings.xml')) parseXml(files.get('xl/sharedStrings.xml'), {
      open: tag => { if (tag === 'si') current = ''; if (tag === 't') inText = true; },
      text: text => { if (inText) current += text; },
      close: tag => { if (tag === 't') inText = false; if (tag === 'si') strings.push(current); },
    });
    const sheets = [...files.keys()].filter(name => name.includes('/worksheets/')).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    for (const sheet of sheets) {
      append(`${sheet.split('/').pop().replace('.xml', '')}\n`);
      let type = ''; let value = ''; let capture = false;
      parseXml(files.get(sheet), {
        open: (tag, attributes) => { if (tag === 'c') { type = attributes.t; value = ''; } if (tag === 'v' || tag === 't') capture = true; },
        text: text => { if (capture) value += text; },
        close: tag => { if (tag === 'v' || tag === 't') capture = false; if (tag === 'c') append(`${type === 's' ? strings[Number(value)] || '' : value}\t`); if (tag === 'row') append('\n'); },
      });
      append('\n');
    }
  } else {
    const names = [...files.keys()].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    for (const file of names) {
      if (format === 'pptx') append(`${file.split('/').pop().replace('.xml', '')}\n`);
      let capture = false;
      parseXml(files.get(file), {
        open: tag => { if (tag === 't') capture = true; if (tag === 'tab') append('\t'); if (tag === 'br') append('\n'); },
        text: text => { if (capture) append(text); },
        close: tag => { if (tag === 't') capture = false; if (tag === 'p' || tag === 'tr') append('\n'); if (tag === 'tc') append('\t'); },
      });
      append('\n');
    }
  }
  const text = cleanText(parts.join('')).trim();
  if (!text) throw new Error('No readable document text was found in this Office file.');
  return { text: text + (length >= MAX_SOURCE_BYTES ? '\n[Preview limited to 100 KB of text]' : '') };
}

module.exports = { renderArtifact, previewArtifact };
