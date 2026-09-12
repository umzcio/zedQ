const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright-core');
const enabled=process.env.ZQ_TEST_NATIVE_HELPER_DOCUMENTS==='1';
if(![undefined,'app-sandbox-only-probe','seatbelt-only-probe'].includes(process.env.ZQ_NATIVE_HELPER_MODE))throw new Error('Invalid viewer test mode');
test('native helper documents open in the existing isolated artifact viewer',{skip:!enabled,timeout:120000},async()=>{
 const output=path.resolve(__dirname,'../../.local-data/skill-helper-prototype',process.env.ZQ_NATIVE_HELPER_MODE==='seatbelt-only-probe'?'verified-seatbelt-documents':'verified-documents');
 const cases=[['docx','document-edited.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document','Status: Reviewed'],['xlsx','workbook-formulas.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Quantity'],['pptx','presentation-edited.pptx','application/vnd.openxmlformats-officedocument.presentationml.presentation','Reviewed presentation'],['pdf','document-merged-filled.pdf','application/pdf',null]];
 const directory=fs.mkdtempSync(path.join(__dirname,'.helper-preview-test-'));let browser,server;
 try{
  const {build}=await import('vite');const {default:react}=await import('@vitejs/plugin-react');const {FRAME_BOOTSTRAP}=await import('./artifact-document-security.mjs');
  const hash=require('node:crypto').createHash('sha256').update(FRAME_BOOTSTRAP).digest('base64');
  fs.writeFileSync(path.join(directory,'index.html'),`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' blob: 'sha256-${hash}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data: blob:; worker-src 'self' blob:; frame-src 'self' blob:; connect-src 'self'; object-src 'none'"></head><body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>`);
  fs.writeFileSync(path.join(directory,'main.tsx'),`import {useState} from 'react';import {createRoot} from 'react-dom/client';import {ArtifactDocumentView} from '../artifact-document-view';function App(){const[file,setFile]=useState(null);window.helperViewer={setFile};return <div style={{width:1000,height:1200}}>{file&&<ArtifactDocumentView file={file} zoom="fit"/>}</div>}createRoot(document.getElementById('root')).render(<App/>);`);
  await build({root:directory,configFile:false,logLevel:'error',plugins:[react()],build:{outDir:'dist',chunkSizeWarningLimit:5000}});
  const dist=path.join(directory,'dist');
  server=http.createServer((req,res)=>{const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const file=path.join(dist,name==='/'?'index.html':name);if(!file.startsWith(dist+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return}res.setHeader('Content-Type',/\.m?js$/.test(file)?'text/javascript':/\.css$/.test(file)?'text/css':'text/html');fs.createReadStream(file).pipe(res)});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1050,height:1250}}),errors=[],external=[];
  page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>{const url=route.request().url();if(url.startsWith(origin+'/')||/^(blob:|data:)/.test(url))return route.continue();external.push(url);return route.abort()});
  await page.goto(origin);await page.waitForFunction(()=>!!window.helperViewer);
  for(const [format,name,mime,text] of cases){
   const bytes=fs.readFileSync(path.join(output,name));
   await page.evaluate(()=>window.helperViewer.setFile(null));await page.waitForFunction(()=>!document.querySelector('iframe,canvas'));
   await page.evaluate(file=>window.helperViewer.setFile(file),{format,name,mime,data:bytes.toString('base64')});
   if(format==='pdf')await page.waitForFunction(()=>document.querySelectorAll('canvas').length===2&&[...document.querySelectorAll('canvas')].every(c=>c.width>0&&c.height>0)&&!document.querySelector('[role="status"]'));
   else{await page.locator('iframe').waitFor();await page.waitForFunction(()=>!document.querySelector('.artifact-document-office > [role=status]'));const frame=page.frames().find(f=>f!==page.mainFrame());await frame.getByText(text,{exact:true}).first().waitFor();assert.equal(await page.locator('iframe').getAttribute('sandbox'),'allow-scripts')}
   await page.screenshot({path:path.join(output,format+'-preview.png'),fullPage:true});
   if(format==='pdf'){for(let index=0;index<2;index++)await page.locator('canvas').nth(index).screenshot({path:path.join(output,`pdf-page-${index+1}.png`)})}
   if(format==='pptx'){const frame=page.frames().find(f=>f!==page.mainFrame());await frame.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));await frame.getByText('Added third slide',{exact:true}).waitFor();await frame.getByText('Added third slide',{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,'pptx-last-preview.png')})}
   if(format==='xlsx'){const frame=page.frames().find(f=>f!==page.mainFrame());await frame.getByText('Unrelated',{exact:true}).click();await frame.getByText('Preserved second sheet',{exact:true}).waitFor();assert.equal(await frame.getByRole('tab',{name:'Unrelated',exact:true}).getAttribute('aria-selected'),'true');await frame.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await frame.getByRole('tabpanel',{name:'Unrelated',exact:true}).screenshot({path:path.join(output,'xlsx-second-preview.png')})}
  }
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 }finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));fs.rmSync(directory,{recursive:true,force:true})}
});
