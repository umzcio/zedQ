import {useEffect,useRef,useState,useSyncExternalStore} from 'react'
import {unwrap,type VoiceSettings as Config,type VoiceAvailability} from '@zq/module-api'
import {Button,SelectField,Textarea,VoiceControls,VoiceRecorderController,ContextMenu,ContextMenuTrigger,ContextMenuContent,ContextMenuItem} from '@zq/ui'

export default function VoiceSettings({active,closing}:{active:boolean;closing:boolean}){
 const [config,setConfig]=useState<Config|null>(null),[availability,setAvailability]=useState<VoiceAvailability|null>(null),[devices,setDevices]=useState<{value:string;label:string}[]>([{value:'default',label:'System default microphone'}]),[error,setError]=useState(''),[status,setStatus]=useState(''),[busy,setBusy]=useState(false),[dirty,setDirty]=useState(false),[transcript,setTranscript]=useState('')
 const [recorder]=useState(()=>new VoiceRecorderController(window.zq.voice)),recording=useSyncExternalStore(recorder.subscribe,recorder.snapshot),busyRef=useRef(false),probe=useRef(0)
 async function refreshDevices(){try{const rows=await navigator.mediaDevices.enumerateDevices();setDevices([{value:'default',label:'System default microphone'},...rows.filter(row=>row.kind==='audioinput'&&row.deviceId&&row.deviceId!=='default').map((row,index)=>({value:row.deviceId,label:row.label||`Microphone ${index+1}`}))])}catch{setError('Microphone devices could not be listed. Check system permissions.')}}
 async function inspect(language:string){const sequence=++probe.current;try{const next=await unwrap(window.zq.voice.availability(language));if(sequence===probe.current)setAvailability(next)}catch(e){if(sequence===probe.current)setError((e as Error).message)}}
 useEffect(()=>{if(!active)return;let live=true;void unwrap(window.zq.voice.load()).then(next=>{if(live){setConfig(next);setDirty(false);void inspect(next.language)}}).catch(e=>{if(live)setError(e.message)});void refreshDevices();return()=>{live=false}},[active])
 useEffect(()=>{if(closing)void recorder.cancel()},[closing,recorder])
 useEffect(()=>()=>{void recorder.cancel()},[recorder])
 function change(patch:Partial<Config>){if(!config)return;const next={...config,...patch};if(next.mode==='local'&&next.language==='auto')next.language='en-US';setConfig(next);setDirty(true);setStatus('');if(next.language!==config.language)void inspect(next.language)}
 async function save(){if(!config||busyRef.current)return;busyRef.current=true;setBusy(true);setError('');try{setConfig(await unwrap(window.zq.voice.save(config)));setDirty(false);setStatus('Voice settings saved. New recordings use these choices.')}catch(e){setError((e as Error).message)}finally{busyRef.current=false;setBusy(false)}}
 const disabled=closing||busy,localLanguages=availability?.local.languages??[],languageOptions=[...(config?.mode==='provider'?[{value:'auto',label:'Detect language'}]:[]),...Array.from(new Set(['en-US',config?.language??'en-US',...localLanguages])).filter(language=>language!=='auto').map(language=>({value:language,label:language}))]
 return <section id="voice" className="voice-settings">
  <div className="settings-panel-header"><div><h2>Voice</h2><p>Dictate into an editable draft. Recordings never send a chat message.</p></div></div>
  {config&&<>
   <div className="voice-setting-row"><label>Transcription</label><SelectField label="Transcription mode" value={config.mode} disabled={disabled} onValueChange={mode=>change({mode:mode as Config['mode']})} options={[{value:'local',label:'On-device'},{value:'provider',label:'Provider'}]}/></div>
   {config.mode==='local'?<div className="voice-engine-status"><strong>{availability?.local.engine??'Apple Speech (on-device)'}</strong><p>{availability?.local.message??'Checking local speech availability…'}</p><p>No automatic provider fallback. Audio stays on this Mac.</p></div>:<>
    <div className="voice-setting-row"><label>Connection</label><SelectField label="Transcription connection" value={config.connectionId??''} disabled={disabled} onValueChange={connectionId=>change({connectionId:connectionId||null})} options={[{value:'',label:'Choose a saved OpenAI connection'},...(availability?.connections??[]).map(connection=>({value:connection.id,label:connection.name}))]}/></div>
    <div className="voice-setting-row"><label>Model</label><SelectField label="Transcription model" value={config.model} disabled={disabled} onValueChange={model=>change({model})} options={availability?.models??['gpt-4o-mini-transcribe','gpt-4o-transcribe','whisper-1']}/></div>
    <p className="settings-muted">Stop &amp; transcribe uploads audio to your saved OpenAI connection. Provider usage may incur charges. Credentials remain in the native credential store.</p>
    {!availability?.connections.length&&<p>Add an OpenAI connection in Settings → Connections. Other providers and custom endpoints are not supported for transcription.</p>}
   </>}
   <div className="voice-setting-row"><label>Microphone</label><SelectField label="Microphone" value={config.deviceId} disabled={disabled} onValueChange={deviceId=>change({deviceId})} options={devices.some(device=>device.value===config.deviceId)?devices:[...devices,{value:config.deviceId,label:'Saved microphone (unavailable)'}]}/><Button variant="ghost" size="sm" disabled={disabled} onClick={()=>void refreshDevices()}>Refresh</Button></div>
   <p className="settings-muted">Microphone names become available after you allow recording.</p>
   <div className="voice-setting-row"><label>Language</label><SelectField label="Transcription language" value={config.language} disabled={disabled} onValueChange={language=>change({language})} options={languageOptions}/></div>
   <Button variant="outline" disabled={disabled||!dirty} onClick={()=>void save()}>{busy?'Saving…':'Save Voice settings'}</Button>
   <section className="voice-test"><h3>Test dictation</h3><p>Up to 60 seconds. Review and edit the result below. Temporary audio is discarded after transcription or cancellation.</p>
    {dirty&&<p>Save your choices before starting a test.</p>}
    <VoiceControls controller={recorder} originId="settings-voice-test" disabled={disabled||dirty||(config.mode==='local'&&!availability?.local.available)} onTranscript={result=>{setTranscript(previous=>previous?`${previous}\n${result.text}`:result.text);void refreshDevices()}}/>
    <ContextMenu><ContextMenuTrigger asChild><Textarea aria-label="Test transcript" placeholder="Your editable test transcript appears here." value={transcript} onChange={event=>setTranscript(event.target.value)} rows={5}/></ContextMenuTrigger><ContextMenuContent><ContextMenuItem disabled={!transcript} onSelect={()=>void unwrap(window.zq.clipboard.writeText(transcript)).catch(()=>setError('The transcript could not be copied.'))}>Copy transcript</ContextMenuItem><ContextMenuItem disabled={!transcript} onSelect={()=>setTranscript('')}>Clear transcript</ContextMenuItem></ContextMenuContent></ContextMenu>
    <div className="voice-test-actions"><Button variant="ghost" disabled={!transcript||closing} onClick={()=>void unwrap(window.zq.clipboard.writeText(transcript)).catch(()=>setError('The transcript could not be copied.'))}>Copy transcript</Button><Button variant="ghost" disabled={!transcript||closing} onClick={()=>setTranscript('')}>Clear transcript</Button></div>
    {recording.phase!=='idle'&&!active&&<span role="status">Voice test is still active.</span>}
   </section>
  </>}
  {availability?.warning&&<p role="alert">{availability.warning}</p>}{status&&<p role="status">{status}</p>}{error&&<p role="alert" className="voice-error">{error}</p>}
 </section>
}
