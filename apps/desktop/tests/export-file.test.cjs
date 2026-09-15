const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

function fixture(t) {
 const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zq-export-'));
 t.after(() => fs.rmSync(directory, {recursive:true, force:true}));
 const destination = path.join(directory, 'report.txt');
 fs.writeFileSync(destination, 'original document', {mode:0o640});
 return {directory, destination};
}
const writer = () => require('../electron/export-file.cjs').exportFile;

test('artifact export preserves an approved existing destination when writing fails', async t => {
 const {destination} = fixture(t);
 const source = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8').split('\n').find(line => line.includes("handle('artifacts:save'"));
 let handler;
 const nativeFS = {...fs, writeFileSync(file, bytes, options) {
  const fd = fs.openSync(file, 'w', options.mode);
  try { fs.writeSync(fd, bytes, 0, 3); throw Object.assign(Error('Disk full'), {code:'ENOSPC'}); }
  finally { fs.closeSync(fd); }
 }};
 vm.runInNewContext(source, {handle:(channel, fn) => {handler=fn}, fs:nativeFS, Buffer, window:{}, exportFile:(...args)=>writer()(...args), artifactService:()=>({file:()=>({name:'report.txt',data:Buffer.from('replacement').toString('base64')})}), dialog:{showSaveDialog:async()=>({canceled:false,filePath:destination})}});
 // Inject the OS write failure below the shared writer as well as the old direct path.
 t.mock.method(fs, 'writeSync', () => {throw Object.assign(Error('Disk full'), {code:'ENOSPC'})});
 await assert.rejects(handler({}), {code:'ENOSPC'});
 assert.equal(fs.readFileSync(destination, 'utf8'), 'original document');
});

for (const operation of ['writeSync', 'fsyncSync', 'renameSync']) test(`${operation} failure leaves the old export and cleans staging files`, t => {
 const {directory,destination}=fixture(t);
 t.mock.method(fs, operation, () => {throw Object.assign(Error('Injected failure'), {code:'EIO'})});
 assert.throws(()=>writer()(destination, Buffer.from('replacement')), {code:'EIO'});
 assert.equal(fs.readFileSync(destination,'utf8'),'original document');
 assert.deepEqual(fs.readdirSync(directory),['report.txt']);
});

test('short writes finish completely and existing/new destination permissions are retained/private', t => {
 const {directory,destination}=fixture(t), originalWrite=fs.writeSync;
 t.mock.method(fs,'writeSync',(fd,bytes,offset,length,position)=>originalWrite(fd,bytes,offset,Math.min(length,2),position));
 writer()(destination,'new UTF-8 résumé');
 assert.equal(fs.readFileSync(destination,'utf8'),'new UTF-8 résumé');
 assert.equal(fs.statSync(destination).mode&0o777,0o640);
 const fresh=path.join(directory,'fresh.txt');writer()(fresh,Buffer.from('private'));
 assert.equal(fs.statSync(fresh).mode&0o777,0o600);
 assert.deepEqual(fs.readdirSync(directory).sort(),['fresh.txt','report.txt']);
});

test('zero-progress writes fail without replacing the destination', t => {
 const {destination}=fixture(t);t.mock.method(fs,'writeSync',()=>0);
 assert.throws(()=>writer()(destination,'replacement'),/write/i);
 assert.equal(fs.readFileSync(destination,'utf8'),'original document');
});

test('post-publication flush failures explicitly report that the new file was saved', t => {
 const {directory,destination}=fixture(t), sync=fs.fsyncSync;
 t.mock.method(fs,'fsyncSync',fd=>{if(fs.fstatSync(fd).isDirectory())throw Error('Directory flush failed');sync(fd)});
 assert.throws(()=>writer()(destination,'replacement'),error=>error.code==='EXPORT_COMMITTED'&&/saved/i.test(error.message)&&/durab|flush/i.test(error.message));
 assert.equal(fs.readFileSync(destination,'utf8'),'replacement');
 assert.deepEqual(fs.readdirSync(directory),['report.txt']);
});

test('cleanup preserves the write error and still removes staging files when closing also fails', t => {
 const {directory,destination}=fixture(t), close=fs.closeSync;
 t.mock.method(fs,'writeSync',()=>{throw Object.assign(Error('Disk full'),{code:'ENOSPC'})});
 t.mock.method(fs,'closeSync',fd=>{close(fd);throw Error('Close failed')});
 assert.throws(()=>writer()(destination,'replacement'),{code:'ENOSPC'});
 assert.equal(fs.readFileSync(destination,'utf8'),'original document');
 assert.deepEqual(fs.readdirSync(directory),['report.txt']);
});

test('exports preserve selected symlinks and reject nonregular or dangling destinations', t => {
 const {directory,destination}=fixture(t), link=path.join(directory,'link.txt');fs.symlinkSync(destination,link);
 writer()(link,'updated through link');
 assert.ok(fs.lstatSync(link).isSymbolicLink());assert.equal(fs.readFileSync(destination,'utf8'),'updated through link');
 assert.throws(()=>writer()(directory,'invalid'),/regular/i);
 fs.unlinkSync(destination);assert.throws(()=>writer()(link,'invalid'));
 assert.ok(fs.lstatSync(link).isSymbolicLink());assert.equal(fs.existsSync(destination),false);
});

test('a destination changed during staging is preserved', t => {
 const {directory,destination}=fixture(t), sync=fs.fsyncSync;
 t.mock.method(fs,'fsyncSync',fd=>{sync(fd);if(fs.fstatSync(fd).isFile())fs.writeFileSync(destination,'external edit')});
 assert.throws(()=>writer()(destination,'replacement'),{code:'EXPORT_CONFLICT'});
 assert.equal(fs.readFileSync(destination,'utf8'),'external edit');assert.deepEqual(fs.readdirSync(directory),['report.txt']);
});
test('recovery export accepts text beyond the workspace save limit',async t=>{
 const{destination}=fixture(t);let handler;
 const source=fs.readFileSync(path.join(__dirname,'../electron/main.cjs'),'utf8').split('\n').find(line=>line.includes("handle('workspace:saveDraftCopy'"));
 vm.runInNewContext(source,{handle:(_,fn)=>{handler=fn},require:()=>({text:(value,max)=>typeof value==='string'&&Buffer.byteLength(value)<=max}),path,window:{},exportFile:(...args)=>writer()(...args),dialog:{showSaveDialog:async()=>({canceled:false,filePath:destination})}});
 const text='x'.repeat(32*1024*1024+1);assert.equal(await handler({name:'draft.txt',text}),true);assert.equal(fs.statSync(destination).size,text.length);
});
