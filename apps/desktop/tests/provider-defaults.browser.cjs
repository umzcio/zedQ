// Disposable profile; all provider requests are intercepted before network access.
const {_electron}=require('playwright-core'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
(async()=>{const directory=fs.mkdtempSync(path.join(os.tmpdir(),'zq-provider-defaults-'));let app;
 try{
  app=await _electron.launch({executablePath:require('electron'),args:[path.resolve(__dirname,'..')],env:{...process.env,ZQ_DATA_DIR:directory}});
  const page=await app.firstWindow();page.setDefaultTimeout(10000);
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  const initial=await page.evaluate(()=>window.zq.chat.load());assert.equal(initial.ok,true);assert.deepEqual(initial.value.connections,[]);
  await app.evaluate(({ipcMain})=>{global.__providerRequests=[];ipcMain.removeHandler('chat:testConnection');ipcMain.handle('chat:testConnection',(_,input)=>{global.__providerRequests.push(input);return {ok:true,value:['fixture-model']}})});
  await page.getByRole('button',{name:'AI providers',exact:true}).click();await page.getByRole('button',{name:'Add provider',exact:true}).click();
  const endpoint=page.locator('#connection-endpoint');assert.equal(await endpoint.inputValue(),'http://127.0.0.1:11434');
  await endpoint.fill('https://custom-model.example');await page.getByRole('button',{name:'vLLM',exact:true}).click();assert.equal(await endpoint.inputValue(),'http://127.0.0.1:8000/v1');
  await page.getByRole('button',{name:'Ollama',exact:true}).click();assert.equal(await endpoint.inputValue(),'http://127.0.0.1:11434');
  assert.deepEqual(await app.evaluate(()=>global.__providerRequests),[]);
  await page.getByRole('button',{name:'Connect & choose models',exact:true}).click();await page.getByRole('heading',{name:'Choose your models',exact:true}).waitFor();
  assert.equal((await app.evaluate(()=>global.__providerRequests))[0].baseUrl,'http://127.0.0.1:11434');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('button',{name:'Add provider',exact:true}).click();await page.getByRole('button',{name:'vLLM',exact:true}).click();
  await page.getByRole('button',{name:'Connect & choose models',exact:true}).click();await page.getByRole('heading',{name:'Choose your models',exact:true}).waitFor();
  assert.equal((await app.evaluate(()=>global.__providerRequests))[1].baseUrl,'http://127.0.0.1:8000/v1');await page.getByRole('button',{name:'Cancel',exact:true}).click();
  const saved=await page.evaluate(()=>window.zq.chat.saveConnection({name:'Custom fixture',provider:'ollama',baseUrl:'http://custom-model.example:11434',enabledModels:[]}));assert.equal(saved.ok,true);
  const loaded=await page.evaluate(()=>window.zq.chat.load());assert.equal(loaded.value.connections[0].baseUrl,'http://custom-model.example:11434');
  console.log('PASS: clean profile has no providers; Ollama/vLLM defaults and submitted requests use loopback; switching clears previous endpoints; explicit custom endpoints remain saved. No provider network requests.');
 }finally{await app?.close();fs.rmSync(directory,{recursive:true,force:true})}
})().catch(error=>{console.error(error);process.exitCode=1});
