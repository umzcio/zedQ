const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const React = require('react');
const jsx = require('react/jsx-runtime');
const {renderToStaticMarkup} = require('react-dom/server');

let compiled;
async function loaderCode() {
 if (!compiled) compiled = (async () => {
  const {build} = await import('vite');
  const result = await build({configFile:false,logLevel:'silent',build:{write:false,minify:false,lib:{entry:path.join(__dirname,'../src/module-loader.tsx'),name:'ModuleLoader',formats:['iife']},rolldownOptions:{external:['react','react/jsx-runtime','@zq/module-api'],output:{globals:{react:'React','react/jsx-runtime':'JSX','@zq/module-api':'SDK'}}}}});
  return (Array.isArray(result)?result:[result]).flatMap(item=>item.output).find(item=>item.type==='chunk').code;
 })();
 return compiled;
}
function record(name, code, version='1.0.0', source='bundled') {
 return {manifest:{id:`zq.${name.toLowerCase()}`,version,apiVersion:1,title:name,view:name,icon:name.toLowerCase(),capabilities:[]},code,css:'.fixture {color:red}',source};
}
const working = "globalThis.__zqLatestModule={Root:function Healthy(){return React.createElement('p',null,'Healthy Notes')}}";
async function fixture(records, recover) {
 const blobs=new Map(),listeners=new Set(),styles=[],attempts=[],settings=[];
 let context,serial=0;
 // Only native IPC and DOM script transport are fixtures; run the production
 // aggregate loader, recovery loop, module code and React components.
 const host={openSettings:section=>settings.push(section),navigate:view=>settings.push(view),commands:{register(){throw Error('An unavailable module registered a command')}}};
 context=vm.createContext({React,JSX:jsx,SDK:{unwrap:async response=>{const result=await response;if(!result.ok)throw Error(result.error.message);return result.value},ModuleSurface:({children})=>React.createElement(React.Fragment,null,children),useHost:()=>host},Blob,setTimeout,clearTimeout,URL:{createObjectURL(blob){const url=`blob:module-${++serial}`;blobs.set(url,blob);return url},revokeObjectURL(url){blobs.delete(url)}},document:{createElement(type){return {type,dataset:{},remove(){}}},head:{append(script){void blobs.get(script.src).text().then(code=>{attempts.push(code);try{vm.runInContext(code,context)}catch(error){for(const listener of listeners)listener({filename:script.src,message:error.message});return}script.onload()})},insertBefore(style){styles.push(style)},querySelector(){return null}}}});
 context.window=context;
 context.zq={modules:{runtime:async()=>({ok:true,value:records}),recover:async(id,version)=>({ok:true,value:await recover(id,version)})}};
 context.addEventListener=(type,listener)=>listeners.add(listener);context.removeEventListener=(type,listener)=>listeners.delete(listener);
 vm.runInContext(await loaderCode(),context);
 return {load:()=>context.ModuleLoader.loadModules(),attempts,styles,settings};
}
function findButton(element) {
 if (!element || typeof element!=='object') return null;
 if (element.type==='button') return element;
 for (const child of React.Children.toArray(element.props?.children)) {const found=findButton(child);if(found)return found}
 return null;
}

test('an exhausted module import leaves healthy modules and a Settings repair action available', async () => {
 const broken=record('Chat',"throw Error('Broken bundled module')"),healthy=record('Notes',working);
 const f=await fixture([broken,healthy],async()=>broken);
 const modules=await f.load();
 assert.equal(modules.length,2);assert.equal(modules[0].manifest.id,'zq.chat');assert.equal(modules[1].manifest.id,'zq.notes');
 assert.equal(f.attempts.length,2);assert.equal(f.styles.length,1,'Failed CSS must not be installed');
 assert.match(renderToStaticMarkup(React.createElement(modules[1].Root)),/Healthy Notes/);
 const unavailable=modules[0].Root();
 assert.match(renderToStaticMarkup(unavailable),/Chat could not open/);
 const action=findButton(unavailable);assert.ok(action,'Unavailable module offers a native shell Settings action');action.props.onClick();
 assert.deepEqual(f.settings,['modules']);
});

test('aggregate startup continues when recovery IPC fails, without mounting failed exports', async () => {
 const f=await fixture([record('Chat',"throw Error('Import failure')"),record('Notes',working)],async()=>{throw Error('Recovery unavailable')});
 const modules=await f.load();
 assert.equal(modules.length,2);assert.match(renderToStaticMarkup(React.createElement(modules[0].Root)),/Recovery unavailable/);
 assert.match(renderToStaticMarkup(React.createElement(modules[1].Root)),/Healthy Notes/);
});

test('successful recovery uses the verified fallback component and its metadata', async () => {
 const fallback=record('Notes',working),f=await fixture([record('Notes',"throw Error('Bad update')",'1.1.0','installed')],async()=>fallback);
 const modules=await f.load();
 assert.equal(modules[0].manifest.version,'1.0.0');assert.equal(modules[0].source,'bundled');assert.equal(modules[0].error,undefined);
 assert.match(renderToStaticMarkup(React.createElement(modules[0].Root)),/Healthy Notes/);
 assert.equal(f.styles.length,1);
});

test('terminal fallback failure retains the final attempted verified identity', async () => {
 const fallback=record('Chat',"throw Error('Broken fallback')"),f=await fixture([record('Chat',"throw Error('Bad update')",'1.1.0','installed')],async()=>fallback);
 const [module]=await f.load();
 assert.equal(module.manifest.version,'1.0.0');assert.equal(module.source,'bundled');
 assert.match(renderToStaticMarkup(React.createElement(module.Root)),/Broken fallback/);
 assert.equal(f.styles.length,0);
});
