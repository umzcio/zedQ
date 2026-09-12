const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright-core');
const renderArtifact = process.env.ZQ_TEST_DOCUMENT_HELPER === '1'
  ? require('../../apps/desktop/electron/document-helper.cjs').createDocumentRenderer({helperPath:path.resolve(__dirname,'../../apps/desktop/native/bin/DocumentHelper.app/Contents/MacOS/DocumentHelperLauncher')})
  : require('../../apps/desktop/electron/artifact-renderer.cjs').renderArtifact;

test('native Office font choices survive the isolated browser preview', { timeout: 120000 }, async () => {
  const typography = { fontFamily: 'Arial', titleFontFamily: 'Brush Script MT', headingFontFamily: 'Georgia', bodyFontFamily: 'Bradley Hand', bodySize: 18 };
  const title = 'A handwritten field note';
  const heading = 'Notes from the garden';
  const body = 'The morning light fell softly across the leaves.';
  const artifacts = await Promise.all(['docx', 'xlsx', 'pptx'].map(format => renderArtifact({ format, title, content: `# ${heading}\n\n${body}`, typography })));
  const directory = fs.mkdtempSync(path.join(__dirname, '.artifact-font-test-'));
  let browser; let server;
  try {
    const { build } = await import('vite');
    const { default: react } = await import('@vitejs/plugin-react');
    const { FRAME_BOOTSTRAP } = await import('./artifact-document-security.mjs');
    const bootstrapHash = require('node:crypto').createHash('sha256').update(FRAME_BOOTSTRAP).digest('base64');
    fs.writeFileSync(path.join(directory, 'index.html'), `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' blob: 'sha256-${bootstrapHash}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data: blob:; worker-src 'self' blob:; frame-src 'self' blob:; connect-src 'self'; object-src 'none'"></head><body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>`);
    fs.writeFileSync(path.join(directory, 'main.tsx'), `import {useState} from 'react';import {createRoot} from 'react-dom/client';import {ArtifactDocumentView} from '../artifact-document-view';function App(){const[file,setFile]=useState(null);window.viewerTest={setFile};return <div style={{width:'900px',height:'900px'}}>{file&&<ArtifactDocumentView file={file} zoom="fit"/>}</div>}createRoot(document.getElementById('root')).render(<App/>);`);
    await build({ root: directory, configFile: false, logLevel: 'error', plugins: [react()], build: { outDir: 'dist', chunkSizeWarningLimit: 5000 } });
    const dist = path.join(directory, 'dist');
    server = http.createServer((request, response) => {
      const requested = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const file = path.join(dist, requested === '/' ? 'index.html' : requested);
      if (!file.startsWith(dist + path.sep) || !fs.existsSync(file)) { response.writeHead(404).end(); return; }
      response.setHeader('Content-Type', /\.m?js$/.test(file) ? 'text/javascript' : /\.css$/.test(file) ? 'text/css' : 'text/html');
      fs.createReadStream(file).pipe(response);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1050, height: 960 } });
    const errors = []; const external = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      if (route.request().url().startsWith(origin + '/') || /^(blob:|data:)/.test(route.request().url())) return route.continue();
      external.push(route.request().url()); return route.abort();
    });
    await page.goto(origin);
    await page.waitForFunction(() => !!window.viewerTest);
    const fontAt = async (frame, text) => frame.getByText(text, { exact: true }).first().evaluate(element => getComputedStyle(element).fontFamily.replace(/["']/g, ''));
    for (const [index, format] of ['docx', 'xlsx', 'pptx'].entries()) {
      await page.evaluate(() => window.viewerTest.setFile(null));
      await page.waitForFunction(() => !document.querySelector('iframe'));
      await page.evaluate(file => window.viewerTest.setFile(file), { ...artifacts[index], format, name: `Handwriting.${format}` });
      await page.locator('iframe').waitFor();
      await page.waitForFunction(() => !document.querySelector('.artifact-document-office > [role=status]'));
      const frame = page.frames().find(frame => frame !== page.mainFrame());
      await frame.getByText(title, { exact: true }).first().waitFor();
      assert.equal(await fontAt(frame, title), typography.titleFontFamily, `${format} title font`);
      assert.equal(await fontAt(frame, heading), typography.headingFontFamily, `${format} heading font`);
      assert.equal(await fontAt(frame, body), typography.bodyFontFamily, `${format} body font`);
      assert.equal(await page.locator('iframe').getAttribute('sandbox'), 'allow-scripts');
      if (format === 'docx') {
        // A computed family can exist even when the OS falls back. Distinct text
        // metrics also prove the installed handwriting face is actually used.
        const metrics = await frame.evaluate(text => {
          const context = document.createElement('canvas').getContext('2d');
          const measure = family => { context.font = `24px "${family}", Arial`; return context.measureText(text).width; };
          return { handwriting: measure('Bradley Hand'), baseline: measure('Arial') };
        }, body);
        assert.notEqual(metrics.handwriting, metrics.baseline, 'Handwriting must resolve to a distinct installed face.');
      }
      await page.screenshot({ path: `/private/tmp/zq-artifact-${format}-fonts.png` });
    }
    assert.deepEqual(external, [], 'Font choices must not fetch external resources.');
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
