/* Trusted iframe runtime. This file is bundled as text and runs only in an
 * opaque-origin sandbox. No document-provided script, URL or formula is run. */
(() => {
  'use strict';
  const token = document.body.dataset.token;
  const container = document.getElementById('document');
  const status = document.getElementById('status');
  const notice = document.getElementById('notice');
  const send = (type, detail = {}) => parent.postMessage({ zqDocument: token, type, ...detail }, '*');
  let zoom = 'fit'; let format; let viewer; let started = false; let sheetWidth = 800; let complexSpreadsheet = false;
  const warn = message => { if (!notice.textContent.includes(message)) notice.textContent += (notice.textContent ? ' ' : '') + message; };
  const fail = error => { status.textContent = error?.message || 'This document could not be rendered.'; send('error', { message: status.textContent }); };
  addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); send('escape'); }
  }, true);
  document.addEventListener('click', event => {
    if (event.target.closest?.('a')) { event.preventDefault(); event.stopPropagation(); }
  }, true);
  document.addEventListener('submit', event => event.preventDefault(), true);

  function applyZoom() {
    const scale = typeof zoom === 'number' ? Math.max(0.25, Math.min(3, zoom / 100)) : null;
    if (viewer) {
      void (async () => { await viewer.setFitMode(scale === null ? 'contain' : 'none'); await viewer.setZoom(scale === null ? 100 : scale * 100); })().catch(fail);
      return;
    }
    const pages = format === 'docx' ? [...container.querySelectorAll('section.docx')] : [container.querySelector('.sheet-grid')].filter(Boolean);
    for (const page of pages) page.style.zoom = '1';
    const width = Math.max(1, ...pages.map(page => page.offsetWidth), format === 'xlsx' ? sheetWidth : 0);
    const actual = scale ?? Math.min(format === 'xlsx' ? 1 : 3, Math.max(0.1, (document.documentElement.clientWidth - 40) / width));
    for (const page of pages) page.style.zoom = String(actual);
  }
  let observedWidth = 0;
  new ResizeObserver(() => {
    const width = document.documentElement.clientWidth;
    if (width === observedWidth) return;
    observedWidth = width;
    if (zoom === 'fit') applyZoom();
  }).observe(document.documentElement);

  async function safeOfficeBytes(bytes) {
    const entries = validateZipDirectory(bytes);
    complexSpreadsheet = format === 'xlsx' && entries.some(entry => /^xl\/(?:drawings|charts)\//i.test(entry.name));
    const zip = await JSZip.loadAsync(bytes);
    const safe = new JSZip();
    let actual = 0; let nodes = 0; let removed = false;
    for (const entry of entries) {
      const file = zip.file(entry.name);
      if (!file) continue;
      if (/vbaProject|activeX|embeddings\/|\.html?$/i.test(entry.name)) { removed = true; continue; }
      const chunks = [];
      const value = await new Promise((resolve, reject) => {
        let size = 0;
        const stream = file.internalStream('uint8array');
        stream.on('data', chunk => {
          size += chunk.length; actual += chunk.length;
          if (size > entry.size || actual > 40 * 1024 * 1024) { stream.pause(); reject(new Error('Document exceeds its expanded size limit.')); }
          else chunks.push(chunk);
        });
        stream.on('error', reject);
        stream.on('end', () => {
          const result = new Uint8Array(size); let offset = 0;
          for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
          resolve(result);
        });
        stream.resume();
      });
      if (/\.(?:xml|rels|svg)$/i.test(entry.name)) {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(value);
        if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('Document entity declarations are not supported.');
        const xml = new DOMParser().parseFromString(text, 'application/xml');
        if (xml.querySelector('parsererror')) throw new Error('The document contains invalid XML.');
        for (const element of [...xml.getElementsByTagName('*')]) {
          if (++nodes > 100000) throw new Error('Document structure exceeds the preview limit.');
          const local = element.localName.toLowerCase();
          if (format === 'xlsx' && local === 'conditionalformatting') complexSpreadsheet = true;
          if (['script', 'foreignobject', 'iframe', 'object', 'embed', 'altchunk'].includes(local)) { element.remove(); removed = true; continue; }
          if (local === 'relationship') {
            const target = element.getAttribute('Target') || '';
            const type = element.getAttribute('Type') || '';
            if (element.getAttribute('TargetMode')?.toLowerCase() === 'external' || /^[a-z][\w+.-]*:|^\/\//i.test(target) || /hyperlink|aFChunk|oleObject|video|audio/i.test(type)) { element.remove(); removed = true; continue; }
          }
          for (const attribute of [...element.attributes]) {
            if (/^on/i.test(attribute.localName) || (/^(?:href|src)$/i.test(attribute.localName) && !attribute.value.startsWith('#'))) { element.removeAttributeNode(attribute); removed = true; }
          }
        }
        safe.file(entry.name, new XMLSerializer().serializeToString(xml));
      } else safe.file(entry.name, value);
    }
    if (removed) warn('External links and active or embedded content are disabled in this preview.');
    return safe.generateAsync({ type: 'arraybuffer', compression: 'STORE' });
  }

  function color(value, fallback = '#222222') {
    if (value?.argb && /^[a-f\d]{6,8}$/i.test(value.argb)) return `#${value.argb.slice(-6)}`;
    const theme = ['#ffffff', '#000000', '#e7e6e6', '#44546a', '#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47'];
    return theme[value?.theme] || fallback;
  }
  function styleCell(element, style) {
    const font = style.font || {}; const alignment = style.alignment || {};
    element.style.fontFamily = font.name || 'Calibri, Arial, sans-serif';
    element.style.fontSize = `${Math.max(6, Math.min(96, Number(font.size) || 11))}pt`;
    element.style.fontWeight = font.bold ? '700' : '400';
    element.style.fontStyle = font.italic ? 'italic' : 'normal';
    element.style.color = color(font.color);
    if (font.underline || font.strike) element.style.textDecoration = [font.underline ? 'underline' : '', font.strike ? 'line-through' : ''].filter(Boolean).join(' ');
    if (style.fill?.type === 'pattern' && style.fill.pattern === 'solid') element.style.backgroundColor = color(style.fill.fgColor, '#ffffff');
    element.style.textAlign = ['left', 'center', 'right', 'justify'].includes(alignment.horizontal) ? alignment.horizontal : 'left';
    element.style.verticalAlign = ['top', 'middle', 'bottom'].includes(alignment.vertical) ? alignment.vertical : 'middle';
    element.style.whiteSpace = alignment.wrapText ? 'pre-wrap' : 'pre';
    for (const edge of ['top', 'right', 'bottom', 'left']) if (style.border?.[edge]?.style) {
      const border = style.border[edge];
      element.style[`border${edge[0].toUpperCase()}${edge.slice(1)}`] = `${/thick/.test(border.style) ? 3 : /medium/.test(border.style) ? 2 : 1}px ${/dash|dot/.test(border.style) ? 'dashed' : /double/.test(border.style) ? 'double' : 'solid'} ${color(border.color, '#888888')}`;
    }
  }
  function cellText(cell) {
    const value = cell.value;
    if (value == null) return '';
    if (typeof value === 'object' && 'formula' in value && value.result === undefined) return `=${value.formula}`;
    let result = typeof value === 'object' && 'result' in value ? value.result : value;
    if (result instanceof Date) return result.toLocaleDateString();
    if (typeof result === 'number') {
      const format = cell.numFmt || '';
      const decimals = format.match(/\.(0+)/)?.[1].length;
      if (format.includes('%')) return `${(result * 100).toFixed(Math.min(10, decimals || 0))}%`;
      if (decimals != null || format.includes('#,##')) {
        const number = result.toLocaleString(undefined, { minimumFractionDigits: Math.min(10, decimals || 0), maximumFractionDigits: Math.min(10, decimals || 0), useGrouping: format.includes('#,##') });
        return `${format.includes('$') ? '$' : ''}${number}`;
      }
    }
    return cell.text;
  }
  async function renderSheets(bytes) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes);
    const sheets = workbook.worksheets.filter(sheet => sheet.state === 'visible');
    if (!sheets.length) throw new Error('This workbook has no visible worksheets.');
    if (sheets.length > 50) throw new Error('Workbook exceeds the 50 sheets preview limit.');
    const tabs = document.createElement('div'); tabs.className = 'sheet-tabs'; tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Worksheets'); container.append(tabs);
    let grid;
    const show = index => {
      const sheet = sheets[index];
      for (const [i, button] of [...tabs.children].entries()) { button.setAttribute('aria-selected', String(i === index)); button.tabIndex = i === index ? 0 : -1; }
      grid?.remove(); grid = document.createElement('table'); grid.className = 'sheet-grid'; grid.setAttribute('aria-label', sheet.name); grid.setAttribute('role', 'tabpanel');
      const rowCount = Math.min(sheet.rowCount, 2000); const columnCount = Math.min(sheet.columnCount, 100);
      if (sheet.rowCount > rowCount || sheet.columnCount > columnCount || rowCount * columnCount > 50000) warn('Large worksheet preview is limited to 2,000 rows, 100 columns and 50,000 cells.');
      const rows = Math.min(rowCount, Math.floor(50000 / Math.max(1, columnCount)));
      const colgroup = document.createElement('colgroup'); const numbers = document.createElement('col'); numbers.style.width = '42px'; colgroup.append(numbers);
      const head = document.createElement('tr'); head.append(document.createElement('th')); sheetWidth = 42;
      for (let column = 1; column <= columnCount; column++) {
        const info = sheet.getColumn(column); const col = document.createElement('col');
        const width = info.hidden ? 0 : Math.max(20, Math.min(800, (info.width || 9) * 7 + 5));
        col.style.width = `${width}px`; if (info.hidden) col.style.visibility = 'collapse';
        colgroup.append(col); sheetWidth += width;
        const th = document.createElement('th'); th.textContent = info.letter; if (info.hidden) th.style.display = 'none'; head.append(th);
      }
      grid.append(colgroup, head); grid.style.width = `${sheetWidth}px`;
      const merges = (sheet.model.merges || []).map(range => {
        const [from, to = from] = range.split(':');
        const a = sheet.getCell(from); const b = sheet.getCell(to);
        return { firstRow: a.row, firstCol: a.col, lastRow: b.row, lastCol: b.col };
      });
      const mergedCells = new Uint32Array(rows * columnCount);
      for (let index = 0; index < merges.length; index++) {
        const merge = merges[index];
        for (let row = merge.firstRow; row <= Math.min(rows, merge.lastRow); row++) {
          for (let column = merge.firstCol; column <= Math.min(columnCount, merge.lastCol); column++) {
            const cellIndex = (row - 1) * columnCount + column - 1;
            if (mergedCells[cellIndex]) throw new Error('Overlapping worksheet merges cannot be previewed.');
            mergedCells[cellIndex] = index + 1;
          }
        }
      }
      for (let row = 1; row <= rows; row++) {
        const source = sheet.getRow(row); if (source.hidden) continue;
        const tr = document.createElement('tr');
        if (source.height) tr.style.height = `${Math.min(600, source.height)}pt`;
        const number = document.createElement('th'); number.textContent = String(row); tr.append(number);
        for (let column = 1; column <= columnCount; column++) {
          if (sheet.getColumn(column).hidden) continue;
          const merged = merges[mergedCells[(row - 1) * columnCount + column - 1] - 1];
          if (merged && (row !== merged.firstRow || column !== merged.firstCol)) continue;
          const cell = source.getCell(column); const td = document.createElement('td'); td.dataset.cell = cell.address;
          if (merged) { td.rowSpan = Math.min(rows, merged.lastRow) - row + 1; td.colSpan = Math.min(columnCount, merged.lastCol) - column + 1; }
          styleCell(td, cell.style);
          if (cell.value?.richText) for (const run of cell.value.richText) { const span = document.createElement('span'); span.textContent = run.text; styleCell(span, { font: { ...cell.font, ...run.font } }); td.append(span); }
          else td.textContent = cellText(cell);
          tr.append(td);
        }
        grid.append(tr);
      }
      container.append(grid); applyZoom();
    };
    sheets.forEach((sheet, index) => {
      const button = document.createElement('button'); button.textContent = sheet.name; button.setAttribute('role', 'tab');
      button.onclick = () => show(index);
      button.onkeydown = event => {
        const next = event.key === 'ArrowRight' ? (index + 1) % sheets.length : event.key === 'ArrowLeft' ? (index + sheets.length - 1) % sheets.length : event.key === 'Home' ? 0 : event.key === 'End' ? sheets.length - 1 : null;
        if (next != null) { event.preventDefault(); show(next); tabs.children[next].focus(); }
      };
      tabs.append(button);
    });
    if (complexSpreadsheet) warn('This workbook contains charts, drawings or conditional formatting that are not shown in the grid preview.');
    show(0);
  }

  addEventListener('message', async event => {
    if (event.source !== parent || event.data?.zqDocument !== token) return;
    if (event.data.type === 'zoom') { zoom = event.data.zoom; applyZoom(); return; }
    if (event.data.type !== 'render' || started) return;
    started = true; format = event.data.format; zoom = event.data.zoom;
    try {
      const bytes = await safeOfficeBytes(new Uint8Array(event.data.bytes));
      if (format === 'docx') {
        await docx.renderAsync(bytes, container, undefined, { inWrapper: true, ignoreWidth: false, ignoreHeight: false, ignoreFonts: false, breakPages: true, ignoreLastRenderedPageBreak: false, renderHeaders: true, renderFooters: true, renderFootnotes: true, renderEndnotes: true, useBase64URL: true, renderAltChunks: false, renderComments: false });
        if (!container.querySelector('section.docx')) throw new Error('No document pages could be rendered.');
      } else if (format === 'xlsx') await renderSheets(bytes);
      else if (format === 'pptx') {
        viewer = await zqPptx.PptxViewer.open(bytes, container, { pdfjs: false, fitMode: 'contain', lazyMedia: true, lazySlides: true, zipLimits: { maxEntries: 2000, maxEntryUncompressedBytes: 20 * 1024 * 1024, maxTotalUncompressedBytes: 40 * 1024 * 1024, maxMediaBytes: 30 * 1024 * 1024, maxConcurrency: 2 }, listOptions: { windowed: true, initialSlides: 4, batchSize: 4, showSlideLabels: true }, onNodeError: () => warn('Some PowerPoint objects could not be rendered. Download to view them in PowerPoint.'), onSlideError: () => warn('Some PowerPoint slides could not be rendered. Download to view them in PowerPoint.') });
      } else throw new Error('Unsupported document format.');
      // Embedded fonts and the host pane can still be settling when renderAsync
      // resolves. Publish readiness only after the final scale has laid out.
      await document.fonts.ready;
      await new Promise(requestAnimationFrame);
      status.hidden = true;
      applyZoom();
      await new Promise(requestAnimationFrame);
      send('ready');
    } catch (error) { fail(error); }
  });
  send('boot');
})();
