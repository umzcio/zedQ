import type {VoiceBridge,VoiceRecording,VoiceTranscript} from '@zq/module-api'
type Capture={stop:()=>Promise<ArrayBuffer>;cancel:()=>void}
type CaptureFactory=(deviceId:string)=>Promise<Capture>
export type VoiceRecorderState={phase:'idle'|'preparing'|'recording'|'recorded'|'transcribing';elapsed:number;originId:string|null;error:string}
async function value<T>(result:Promise<{ok:true;value:T}|{ok:false;error:{message:string}}>){const r=await result;if(!r.ok)throw Error(r.error.message);return r.value}
function microphoneError(error:unknown){const name=(error as Error)?.name;return name==='NotAllowedError'?'Microphone access was denied. Allow zQ in System Settings → Privacy & Security → Microphone.':name==='NotFoundError'||name==='OverconstrainedError'?'The selected microphone is unavailable. Choose another input in Voice settings.':(error as Error)?.message||'Recording failed. Try again.'}
export async function captureMicrophone(deviceId:string):Promise<Capture>{
 const stream=await navigator.mediaDevices.getUserMedia({audio:{deviceId:deviceId==='default'?undefined:{exact:deviceId},channelCount:1},video:false})
 let context:AudioContext|undefined,node:AudioWorkletNode|undefined,source:MediaStreamAudioSourceNode|undefined,closed=false
 const chunks:Float32Array[]=[],code=`class ZQVoice extends AudioWorkletProcessor { process(inputs) { const channel=inputs[0]?.[0]; if(channel) { const copy=new Float32Array(channel); this.port.postMessage(copy,[copy.buffer]); } return true; } } registerProcessor('zq-voice',ZQVoice);`,url=URL.createObjectURL(new Blob([code],{type:'application/javascript'}))
 function cleanup(){if(closed)return;closed=true;node?.disconnect();source?.disconnect();stream.getTracks().forEach(track=>track.stop());if(context)void context.close().catch(()=>{})}
 try{
  context=new AudioContext();await context.audioWorklet.addModule(url);node=new AudioWorkletNode(context,'zq-voice');source=context.createMediaStreamSource(stream)
  let samples=0;const max=context.sampleRate*60
  node.port.onmessage=event=>{if(closed||samples>=max)return;const chunk=event.data as Float32Array;const remaining=chunk.subarray(0,max-samples);chunks.push(remaining);samples+=remaining.length}
  source.connect(node);node.connect(context.destination);await context.resume()
  return {cancel:()=>{cleanup();chunks.length=0},stop:async()=>{
   const rate=context!.sampleRate;cleanup();const total=chunks.reduce((sum,c)=>sum+c.length,0),buffer=new ArrayBuffer(44+total*2),view=new DataView(buffer)
   const ascii=(offset:number,text:string)=>[...text].forEach((char,index)=>view.setUint8(offset+index,char.charCodeAt(0)))
   ascii(0,'RIFF');view.setUint32(4,buffer.byteLength-8,true);ascii(8,'WAVEfmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);ascii(36,'data');view.setUint32(40,total*2,true)
   let offset=44;for(const chunk of chunks)for(const sample of chunk){const n=Math.max(-1,Math.min(1,sample));view.setInt16(offset,n<0?n*32768:n*32767,true);offset+=2}chunks.length=0;return buffer
  }}
 }catch(error){cleanup();throw error}finally{URL.revokeObjectURL(url)}
}
// Retain one controller in the persistent module Root. View subscribers may
// unmount during navigation; the session and original delivery callback survive.
export class VoiceRecorderController{
 private bridge:VoiceBridge
 private captureFactory:CaptureFactory
 private state:VoiceRecorderState={phase:'idle',elapsed:0,originId:null,error:''}
 private listeners=new Set<()=>void>()
 private token=0
 private recording:VoiceRecording|null=null
 private capture:Capture|null=null
 private audio:Promise<ArrayBuffer>|null=null
 private timer:ReturnType<typeof setInterval>|null=null
 private deliver:((result:VoiceTranscript)=>void)|null=null
 constructor(bridge:VoiceBridge,captureFactory:CaptureFactory=captureMicrophone){this.bridge=bridge;this.captureFactory=captureFactory}
 snapshot=()=>this.state
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener)}}
 private update(next:Partial<VoiceRecorderState>){this.state={...this.state,...next};this.listeners.forEach(listener=>listener())}
 private clearTimer(){if(this.timer)clearInterval(this.timer);this.timer=null}
 async start(originId:string,deliver:(result:VoiceTranscript)=>void){
  if(this.state.phase!=='idle')return
  const token=++this.token;this.deliver=deliver;this.update({phase:'preparing',originId,elapsed:0,error:''})
  try{
   const recording=await value(this.bridge.begin({originId}));if(token!==this.token){await this.bridge.cancel(recording.id);return}this.recording=recording
   const capture=await this.captureFactory(recording.settings.deviceId);if(token!==this.token){capture.cancel();return}this.capture=capture;this.update({phase:'recording'});const started=Date.now()
   this.timer=setInterval(()=>{this.update({elapsed:Math.min(60,Math.floor((Date.now()-started)/1000))});if(this.state.elapsed>=60)void this.freeze()},250)
  }catch(error){if(token===this.token){await this.cancel();this.update({error:microphoneError(error)})}}
 }
 private async freeze(){if(this.state.phase!=='recording'||!this.capture)return;this.clearTimer();const token=this.token,capture=this.capture;this.capture=null;this.audio=capture.stop();this.update({phase:'recorded'});try{await this.audio}catch(error){if(token===this.token){await this.cancel();this.update({error:microphoneError(error)})}}}
 async stop(){
  if(!['recording','recorded'].includes(this.state.phase)||!this.recording)return
  const token=this.token,recording=this.recording,deliver=this.deliver;this.clearTimer();this.update({phase:'transcribing'})
  try{const capture=this.capture;this.capture=null;const audio=capture?await capture.stop():await this.audio;this.audio=null;if(token!==this.token)return;if(!audio)throw Error('No audio was recorded. Try again.');const transcript=await value(this.bridge.transcribe({id:recording.id,audio}));if(token!==this.token)return;this.recording=null;this.deliver=null;this.update({phase:'idle',originId:null,elapsed:0});deliver?.(transcript)}catch(error){if(token===this.token){await this.cancel();this.update({error:microphoneError(error)})}}
 }
 async cancel(){++this.token;this.clearTimer();this.capture?.cancel();this.capture=null;this.audio=null;this.deliver=null;const recording=this.recording;this.recording=null;this.update({phase:'idle',originId:null,elapsed:0,error:''});if(recording)await this.bridge.cancel(recording.id).catch(()=>{})}
}
