// Development prototype only. No changes to system Python or the normal zQ workspace.
import {createHash} from 'node:crypto'
import {spawn} from 'node:child_process'
import {mkdir,readFile,writeFile,rm,mkdtemp,rename,stat} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const sources=path.join(root,'apps/desktop/native/skill-helper-prototype')
const source=JSON.parse(await readFile(path.join(sources,'runtime-source.json'),'utf8'))
if(`${process.platform}-${process.arch}`!==source.platform)throw Error('This prototype runtime currently targets Apple silicon macOS only.')
const output=path.join(root,'.local-data/skill-helper-prototype'),target=path.join(output,'runtime')
const lock=await readFile(path.join(sources,'requirements.lock'))
const fingerprint=createHash('sha256').update(JSON.stringify(source)).update(lock).digest('hex')
try{if((await readFile(path.join(target,'source-hash'),'utf8')).trim()===fingerprint){await stat(path.join(target,'python/bin/python3.12'));console.log('Prototype runtime already prepared.');process.exit(0)}}catch{}
const command=(exe,args)=>new Promise((resolve,reject)=>{const child=spawn(exe,args,{stdio:['ignore','inherit','inherit']});child.once('error',reject);child.once('close',code=>code===0?resolve():reject(Error(`${exe} exited ${code}`)))})
await mkdir(output,{recursive:true});const stage=await mkdtemp(path.join(output,'runtime-stage-'))
try{
 const response=await fetch(source.url,{signal:AbortSignal.timeout(120000)});if(!response.ok)throw Error(`Python download failed: ${response.status}`)
 const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>source.bytes)throw Error('Python archive exceeds pinned size.');chunks.push(chunk)}
 const archive=Buffer.concat(chunks)
 if(size!==source.bytes||createHash('sha256').update(archive).digest('hex')!==source.sha256)throw Error('Python archive failed its pinned integrity check.')
 const tar=path.join(stage,'python.tar.gz');await writeFile(tar,archive);await command('/usr/bin/tar',['-xzf',tar,'-C',stage]);await rm(tar)
 const python=path.join(stage,'python/bin/python3.12')
 await command('uv',['pip','install','--no-config','--no-cache','--python',python,'--target',path.join(stage,'python/lib/python3.12/site-packages'),'--require-hashes','--only-binary',':all:','-r',path.join(sources,'requirements.lock')])
 await writeFile(path.join(stage,'source-hash'),fingerprint+'\n')
 await writeFile(path.join(stage,'runtime-provenance.json'),JSON.stringify({...source,requirementsSHA256:createHash('sha256').update(lock).digest('hex')},null,2)+'\n')
 await rm(target,{recursive:true,force:true});await rename(stage,target)
 console.log('Prepared pinned CPython and document libraries in '+target)
}finally{await rm(stage,{recursive:true,force:true})}
