'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {execFile}=require('node:child_process');
const MODELS=['gpt-4o-mini-transcribe','gpt-4o-transcribe','whisper-1'];
const DEFAULTS={mode:'local',engine:'apple-speech',connectionId:null,model:MODELS[0],deviceId:'default',language:'en-US'};
const compatible=c=>c?.provider==='openai'&&c.baseUrl?.replace(/\/$/,'')==='https://api.openai.com/v1'&&!!(c.credentialRef||c.hasApiKey);
function secureDirectory(directory){fs.mkdirSync(directory,{recursive:true,mode:0o700});const stat=fs.lstatSync(directory);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Voice storage must be a regular directory, not a symbolic link.');}
function readSettings(file){const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.size>16384)throw Error('Voice settings must be a regular file up to 16 KB.');return fs.readFileSync(fd,'utf8')}finally{fs.closeSync(fd)}}
function transcriptText(text){if(typeof text!=='string'||!text.trim()||text.includes('\0')||Buffer.byteLength(text,'utf8')>65536||Buffer.from(text,'utf8').toString('utf8')!==text)throw Error('No usable transcript was returned. Try a shorter recording.');return text.trim()}
async function responseJSON(response){
 const reader=response.body?.getReader();if(!reader)throw Error('OpenAI returned an empty transcription response.');let size=0;const parts=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>262144)throw Error('OpenAI transcription response was too large. Try a shorter recording.');parts.push(value)}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)))}catch(error){if(error.message?.includes('too large'))throw error;throw Error('OpenAI returned an invalid transcription response. Try again.')}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
}
function settings(input){
 if(!input||!['local','provider'].includes(input.mode)||input.engine!=='apple-speech'||!MODELS.includes(input.model)||typeof input.deviceId!=='string'||input.deviceId.length>1024||typeof input.language!=='string'||!(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/.test(input.language)||input.language==='auto')||(input.connectionId!==null&&(typeof input.connectionId!=='string'||input.connectionId.length>256)))throw Error('Invalid Voice settings.');
 return Object.fromEntries(Object.keys(DEFAULTS).map(key=>[key,input[key]]));
}
function validateAudio(value){
 if(!(value instanceof ArrayBuffer)&&!ArrayBuffer.isView(value))throw Error('Invalid recorded audio.');
 const b=value instanceof ArrayBuffer?Buffer.from(value):Buffer.from(value.buffer,value.byteOffset,value.byteLength);
 if(b.length<46||b.length>12*1024*1024||b.toString('ascii',0,4)!=='RIFF'||b.toString('ascii',8,16)!=='WAVEfmt '||b.readUInt32LE(16)!==16||b.readUInt16LE(20)!==1||b.readUInt16LE(22)!==1||b.readUInt16LE(34)!==16||b.toString('ascii',36,40)!=='data'||b.readUInt32LE(40)!==b.length-44||b.readUInt32LE(4)!==b.length-8||b.length%2)throw Error('Invalid or empty recorded audio. Try recording again.');
 const rate=b.readUInt32LE(24);if(rate<8000||rate>96000||b.readUInt32LE(28)!==rate*2||b.readUInt16LE(32)!==2||(b.length-44)/(rate*2)>61)throw Error('Record up to 60 seconds of audio.');
 let audible=false;for(let i=44;i<b.length;i+=2)if(Math.abs(b.readInt16LE(i))>16){audible=true;break}if(!audible)throw Error('No audio was detected. Check your microphone and record again.');
 return b;
}
function helper(pathname,args,signal){return new Promise((resolve,reject)=>{
 if(!pathname||!fs.existsSync(pathname)){reject(Error('Apple Speech helper is unavailable. Install the current zQ desktop build.'));return}
 execFile(pathname,args,{signal,timeout:75000,maxBuffer:262144},(error,stdout)=>{if(signal?.aborted){reject(Error('Recording canceled.'));return}let result;try{result=JSON.parse(stdout)}catch{reject(Error('Apple Speech is unavailable or timed out. Check speech recognition permission and language support.'));return}if(!result.ok){reject(Error(result.error||'Apple Speech could not transcribe this recording.'));return}if(error){reject(Error('Apple Speech could not complete this recording.'));return}resolve(result.value)});
})}
async function transcribeOpenAI({audio,config,connection,resolveCredential,signal,fetchImpl=fetch}){
 if(!compatible(connection))throw Error('Choose a compatible saved OpenAI connection in Voice settings.');
 const key=await resolveCredential(connection);if(signal.aborted)throw Error('Recording canceled.');if(!key)throw Error('The saved OpenAI key is unavailable. Update the connection in Settings.');
 const body=new FormData();body.set('file',new Blob([audio],{type:'audio/wav'}),'recording.wav');body.set('model',config.model);body.set('response_format','json');if(config.language!=='auto')body.set('language',config.language.split('-')[0]);
 let response;try{response=await fetchImpl('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{Authorization:`Bearer ${key}`},body,signal,redirect:'error'})}catch{throw Error(signal.aborted?'Recording canceled.':'OpenAI transcription could not connect. Try again.');}
 if(!response.ok)throw Error(response.status===401?'OpenAI rejected the saved key. Update the connection in Settings.':response.status===429?'OpenAI transcription is rate limited or has no available quota. Try later.':`OpenAI transcription failed (HTTP ${response.status}). Try again.`);
 const result=await responseJSON(response);return transcriptText(result.text);
}
class VoiceService{
 constructor({directory,listConnections=()=>[],resolveCredential=async()=>null,helperPath,localAvailability,localTranscribe,providerTranscribe,fetchImpl}={}){
  this.directory=directory;this.file=path.join(directory,'voice.json');this.audioDirectory=path.join(directory,'voice-audio');this.listConnections=listConnections;this.resolveCredential=resolveCredential;this.helperPath=helperPath;this.active=null;
  this.localAvailability=localAvailability??(language=>process.platform==='darwin'?helper(helperPath,['availability',language]):Promise.resolve({available:false,engine:'Apple Speech',languages:[],message:'On-device transcription requires macOS 13 or later.'}));
  this.localTranscribe=localTranscribe??(({file,config,signal})=>helper(helperPath,['transcribe',file,config.language],signal));this.providerTranscribe=providerTranscribe??(args=>transcribeOpenAI({...args,resolveCredential,fetchImpl}));
  secureDirectory(directory);secureDirectory(this.audioDirectory);for(const name of fs.readdirSync(this.audioDirectory))if(/^recording-[a-f0-9-]+\.wav$/.test(name))fs.rmSync(path.join(this.audioDirectory,name),{force:true});
  this.config={...DEFAULTS};try{this.config=settings(JSON.parse(readSettings(this.file)))}catch(error){if(error.code!=='ENOENT')this.loadWarning='Saved Voice settings could not be read. Defaults are in use. Saving will preserve the original file as a recovery copy.'}
 }
 load(){return {...this.config}}
 save(input){const next=settings(input);if(next.mode==='provider'&&!this.listConnections().some(c=>c.id===next.connectionId&&compatible(c)))throw Error('Choose a compatible saved OpenAI connection.');secureDirectory(this.directory);try{const stat=fs.lstatSync(this.file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Voice settings must be a regular file, not a symbolic link.')}catch(error){if(error.code!=='ENOENT')throw error}const temporary=this.file+'.tmp-'+randomUUID();let fd;try{fd=fs.openSync(temporary,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(next));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;if(this.loadWarning&&fs.existsSync(this.file))fs.renameSync(this.file,this.file+'.corrupt-'+randomUUID());fs.renameSync(temporary,this.file);const directoryFd=fs.openSync(this.directory,'r');try{fs.fsyncSync(directoryFd)}finally{fs.closeSync(directoryFd)}this.config=next;this.loadWarning=null;return this.load()}finally{if(fd!==undefined)fs.closeSync(fd);fs.rmSync(temporary,{force:true})}}
 async availability(language=this.config.language){
  if(typeof language!=='string'||language.length>40)throw Error('Invalid transcription language.');
  let local;try{local=await this.localAvailability(language==='auto'?'en-US':language)}catch(e){local={available:false,engine:'Apple Speech',languages:[],message:e.message}}
  return {local,connections:this.listConnections().filter(compatible).map(c=>({id:c.id,name:c.name})),models:[...MODELS],warning:this.loadWarning??null};
 }
 async begin({originId}={}){
  if(this.active)throw Error('A recording is already active. Stop or cancel it first.');if(typeof originId!=='string'||!originId||originId.length>256)throw Error('Choose a chat before recording.');
  const config=Object.freeze(this.load()),connection=config.mode==='provider'?this.listConnections().find(c=>c.id===config.connectionId&&compatible(c)):null;
  if(config.mode==='provider'&&!connection)throw Error('Choose a compatible saved OpenAI connection in Voice settings.');
  const active={id:randomUUID(),originId,config,connection:connection?Object.freeze({...connection}):null,controller:new AbortController(),phase:'preparing'};this.active=active;
  try{if(config.mode==='local'){if(config.language==='auto')throw Error('Choose a language for on-device transcription.');const status=await this.localAvailability(config.language);if(!status.available)throw Error(status.message||'On-device transcription is unavailable for this language.')}if(this.active!==active)throw Error('Recording canceled.');active.phase='recording';active.timer=setTimeout(()=>this.cancel(active.id),5*60*1000);active.timer.unref?.();return {id:active.id,originId,settings:{...config}}}catch(e){if(this.active===active)this.active=null;throw e}
 }
 cancel(id){const active=this.active;if(active&&(!id||active.id===id)){active.controller.abort();clearTimeout(active.timer);this.active=null;}return null}
 async transcribe({id,audio}={}){
  const active=this.active;if(!active||active.id!==id)throw Error('This recording is no longer active.');if(active.phase!=='recording')throw Error('This recording is already transcribing.');active.phase='transcribing';const file=path.join(this.audioDirectory,`recording-${id}.wav`);
  clearTimeout(active.timer);active.timer=setTimeout(()=>active.controller.abort(),90000);active.timer.unref?.();
  try{const buffer=validateAudio(audio);if(active.controller.signal.aborted)throw Error('Recording canceled.');let text;if(active.config.mode==='local'){secureDirectory(this.audioDirectory);fs.writeFileSync(file,buffer,{mode:0o600,flag:'wx'});text=await this.localTranscribe({file,config:active.config,signal:active.controller.signal})}else{text=await this.providerTranscribe({audio:buffer,config:active.config,connection:active.connection,signal:active.controller.signal})}if(active.controller.signal.aborted||this.active!==active)throw Error('Recording canceled.');return{id,originId:active.originId,text:transcriptText(text)}}
  finally{clearTimeout(active.timer);fs.rmSync(file,{force:true});if(this.active===active)this.active=null}
 }
 close(){this.cancel();}
}
module.exports={VoiceService,transcribeOpenAI,validateAudio};
