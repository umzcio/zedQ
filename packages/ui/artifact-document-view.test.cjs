const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright-core');
const JSZip = require('jszip');

test('browser renders actual styled Office/PDF bytes in isolated, zoomable document views', { timeout: 120000 }, async () => {
  const directory = fs.mkdtempSync(path.join(__dirname, '.artifact-document-test-'));
  let browser; let server;
  try {
    const { build } = await import('vite');
    const { default: react } = await import('@vitejs/plugin-react');
    const { FRAME_BOOTSTRAP } = await import('./artifact-document-security.mjs');
    const bootstrapHash = require('node:crypto').createHash('sha256').update(FRAME_BOOTSTRAP).digest('base64');
    fs.writeFileSync(path.join(directory, 'index.html'), `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' blob: 'sha256-${bootstrapHash}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data: blob:; worker-src 'self' blob:; frame-src 'self' blob:; connect-src 'self'; object-src 'none'"></head><body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>`);
    fs.writeFileSync(path.join(directory, 'main.tsx'), `import {useState} from 'react';import {createRoot} from 'react-dom/client';import {ArtifactDocumentView} from '../artifact-document-view';function App(){const[file,setFile]=useState(null);const[zoom,setZoom]=useState('fit');window.viewerTest={setFile,setZoom};return <div style={{width:'900px',height:'900px'}}>{file&&<ArtifactDocumentView file={file} zoom={zoom} onEscape={()=>{window.viewerEscaped=true}}/>}</div>}createRoot(document.getElementById('root')).render(<App/>);`);
    await build({ root: directory, configFile: false, logLevel: 'error', plugins: [react()], build: { outDir: 'dist', chunkSizeWarningLimit: 5000 } });
    const dist = path.join(directory, 'dist');
    server = http.createServer((request, response) => {
      const requested = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const file = path.join(dist, requested === '/' ? 'index.html' : requested);
      if (!file.startsWith(dist) || !fs.existsSync(file)) { response.writeHead(404).end(); return; }
      response.setHeader('Content-Type', /\.m?js$/.test(file) ? 'text/javascript' : /\.css$/.test(file) ? 'text/css' : 'text/html');
      fs.createReadStream(file).pipe(response);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1050, height: 960 } });
    await page.addInitScript(() => {
      if (window.parent === window) return;
      window.testDocumentFontsReady = false;
      const ready = document.fonts.ready.then(() => new Promise(resolve => setTimeout(() => { window.testDocumentFontsReady = true; resolve(document.fonts); }, 300)));
      Object.defineProperty(document.fonts, 'ready', { get: () => ready });
    });
    const errors = []; const external = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') { errors.push(message.text()); console.error(message.text()); } });
    await page.route('**/*', route => {
      if (route.request().url().startsWith(origin) || /^(blob:|data:)/.test(route.request().url())) return route.continue();
      external.push(route.request().url()); return route.abort();
    });
    await page.goto(origin); await page.waitForFunction(() => !!window.viewerTest, null, { timeout: 10000 }).catch(error => { throw new Error(`${error.message}\n${errors.join('\n')}\n${external.join('\n')}`); });
    const setFile = async (format, bytes) => {
      const oldSource = await page.locator('iframe').count() ? await page.locator('iframe').getAttribute('srcdoc') : null;
      await page.evaluate(file => window.viewerTest.setFile(file), { name: `Styled.${format}`, mime: '', format, data: Buffer.from(bytes).toString('base64') });
      if (format !== 'pdf') await page.waitForFunction(oldSource => { const iframe = document.querySelector('iframe'); return iframe && iframe.getAttribute('srcdoc') !== oldSource; }, oldSource);
    };
    const { Document, Paragraph, TextRun, Packer, ExternalHyperlink } = require('docx');
    const word = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun({ text: 'Styled document title', font: 'Georgia', size: 48, color: 'B91C1C', bold: true })] }), new Paragraph({ children: [new TextRun({ text: 'Actual paragraph formatting', size: 26, color: '1D4ED8' })] }), new Paragraph({ children: [new ExternalHyperlink({ link: 'https://example.invalid/never-fetch', children: [new TextRun('External link stays inert')] })] })] }] }));
    await setFile('docx', word);
    const frame = () => page.frames().find(frame => frame !== page.mainFrame());
    await page.waitForFunction(() => !document.querySelector('.artifact-document-office > [role=status]'), null, { timeout: 10000 }).catch(async error => { throw new Error(`${error.message}\n${errors.join('\n')}\n${await page.locator('body').innerText()}`); });
    assert.ok(frame(), errors.join('\n'));
    await frame().getByText('Styled document title', { exact: true }).waitFor();
    assert.equal(await frame().evaluate(() => window.testDocumentFontsReady), true, 'Ready must wait for document fonts and layout.');
    const style = await frame().getByText('Styled document title', { exact: true }).evaluate(element => ({ color: getComputedStyle(element).color, font: getComputedStyle(element).fontFamily, size: getComputedStyle(element).fontSize }));
    assert.equal(style.color, 'rgb(185, 28, 28)'); assert.match(style.font, /Georgia/); assert.equal(style.size, '32px');
    assert.equal(await page.locator('iframe').getAttribute('sandbox'), 'allow-scripts');
    assert.equal(await frame().evaluate(() => { try { return parent.document.title; } catch { return 'isolated'; } }), 'isolated');
    await frame().getByText('External link stays inert').click();
    assert.equal(page.url(), origin + '/');
    const beforeZoom = await frame().locator('section.docx').evaluate(element => element.getBoundingClientRect().width);
    await page.evaluate(() => window.viewerTest.setZoom(150));
    await frame().waitForFunction(() => Number(document.querySelector('section.docx').style.zoom) === 1.5);
    assert.ok(await frame().locator('section.docx').evaluate(element => element.getBoundingClientRect().width) > beforeZoom);
    assert.ok(await frame().locator('section.docx').evaluate(element => element.getBoundingClientRect().left) >= 0, 'Oversized pages must expose their left edge without negative overflow.');
    await frame().getByText('Styled document title').press('Escape');
    await page.waitForFunction(() => window.viewerEscaped === true);
    await page.evaluate(() => window.viewerTest.setZoom('fit'));
    await page.screenshot({ path: '/private/tmp/zq-artifact-docx-view.png' });
    await page.evaluate(() => window.viewerTest.setFile(null));
    await page.waitForFunction(() => !document.querySelector('iframe'));
    await setFile('docx', word);
    await page.waitForFunction(() => !document.querySelector('.artifact-document-office > [role=status]'));
    assert.equal(await frame().evaluate(() => window.testDocumentFontsReady), true, 'Warm reopen must also wait for layout.');
    assert.ok(await frame().getByText('Styled document title', { exact: true }).isVisible());

    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet('Budget');
    sheet.getCell('A1').value = 'Styled budget'; sheet.getCell('A1').font = { bold: true, size: 20, color: { argb: 'FFFFFFFF' } }; sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF15803D' } }; sheet.mergeCells('A1:C1');
    sheet.getCell('A2').value = 'Revenue'; sheet.getCell('B2').value = 1234.5; sheet.getCell('B2').numFmt = '$#,##0.00'; sheet.getCell('C2').value = '=HYPERLINK("https://example.invalid")';
    workbook.addWorksheet('Details').getCell('A1').value = 'Second sheet content';
    await setFile('xlsx', await workbook.xlsx.writeBuffer());
    await page.waitForFunction(() => !document.querySelector('.artifact-document-office > [role=status]'));
    await frame().getByText('Styled budget', { exact: true }).waitFor();
    assert.equal(await frame().locator('[data-cell=A1]').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(21, 128, 61)');
    assert.equal(await frame().locator('[data-cell=A1]').getAttribute('colspan'), '3');
    assert.equal(await frame().locator('[data-cell=B2]').textContent(), '$1,234.50');
    await page.screenshot({ path: '/private/tmp/zq-artifact-xlsx-view.png' });
    await frame().getByRole('tab', { name: 'Details' }).click(); await frame().getByText('Second sheet content').waitFor();

    const PptxGenJS = require('pptxgenjs'); const slides = new PptxGenJS(); slides.layout = 'LAYOUT_WIDE';
    const slide = slides.addSlide(); slide.background = { color: '123456' }; slide.addText('Actual slide title', { x: 1, y: 1, w: 10, h: 1, fontSize: 36, color: 'FFFF00', bold: true }); slide.addShape(slides.ShapeType.rect, { x: 1, y: 3, w: 4, h: 2, fill: { color: 'E63946' }, line: { color: 'E63946' } });
    await setFile('pptx', await slides.write({ outputType: 'nodebuffer' }));
    await page.waitForFunction(() => !document.querySelector('.artifact-document-office > [role=status]'));
    await frame().getByText('Actual slide title', { exact: true }).waitFor();
    assert.equal(await frame().getByText('Actual slide title', { exact: true }).evaluate(element => getComputedStyle(element).color), 'rgb(255, 255, 0)');
    await page.screenshot({ path: '/private/tmp/zq-artifact-pptx-view.png' });

    const { renderArtifact } = require('../../apps/desktop/electron/artifact-renderer.cjs');
    const pdf = await renderArtifact({ format: 'pdf', title: 'Actual PDF document', content: '# Rendered page\n\nA real PDF body.' });
    await setFile('pdf', Buffer.from(pdf.data, 'base64'));
    await page.waitForFunction(() => { const canvas = document.querySelector('canvas'); return canvas && canvas.width > 0 && canvas.height > 0; });
    await page.waitForTimeout(200);
    assert.ok(await page.locator('canvas').evaluate(canvas => { const context = canvas.getContext('2d'); const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data; return pixels.some((value, index) => index % 4 !== 3 && value < 100); }));
    await page.screenshot({ path: '/private/tmp/zq-artifact-pdf-view.png' });
    await page.evaluate(file => window.viewerTest.setFile(file), { name: 'Literal.html', mime: 'text/html', data: Buffer.from('<script>fetch("https://example.invalid")</script>').toString('base64') });
    await page.locator('pre').waitFor();
    assert.equal(await page.locator('pre').textContent(), '<script>fetch("https://example.invalid")</script>');
    await page.evaluate(file => window.viewerTest.setFile(file), { name: 'Pixel.png', mime: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6WQAAAAASUVORK5CYII=' });
    await page.waitForFunction(() => document.querySelector('img')?.naturalWidth === 1);
    assert.deepEqual(external, [], 'No external document resource request may leave the viewer.');
    assert.deepEqual(errors.filter(message => !/favicon|404/.test(message)), []);
  } finally {
    await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true });
  }
});
