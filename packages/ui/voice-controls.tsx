import {useSyncExternalStore} from 'react'
import {Microphone,Stop,X} from '@phosphor-icons/react'
import {Button} from './components/button'
import type {VoiceTranscript} from '@zq/module-api'
import {VoiceRecorderController} from './voice-recorder'
export function VoiceControls({controller,originId,onTranscript,disabled=false,disabledReason}:{controller:VoiceRecorderController;originId:string;onTranscript:(result:VoiceTranscript)=>void;disabled?:boolean;disabledReason?:string}){
 const state=useSyncExternalStore(controller.subscribe,controller.snapshot)
 return <div className="voice-controls" onKeyDown={event=>{if(event.key==='Escape'&&state.phase!=='idle'){event.preventDefault();void controller.cancel()}}}>
  {state.phase==='idle'?<Button type="button" variant="ghost" size="icon" tooltip={disabled?(disabledReason??"Dictation is unavailable while this action is in progress"):"Dictate into your draft without sending a message"} aria-label="Record dictation" disabled={disabled} onClick={()=>void controller.start(originId,onTranscript)}><Microphone size={18}/></Button>:<>
   <span role="status">{state.phase==='preparing'?'Preparing microphone…':state.phase==='transcribing'?'Transcribing…':state.phase==='recorded'?'60-second limit · Ready to transcribe':`Recording · 0:${String(state.elapsed).padStart(2,'0')}`}{state.originId!==originId?' · Original chat':''}</span>
   {(state.phase==='recording'||state.phase==='recorded')&&<Button tooltip="Stop recording and convert the audio into editable text" type="button" variant="ghost" size="sm" onClick={()=>void controller.stop()}><Stop size={15}/>Stop & transcribe</Button>}
   <Button tooltip="Discard this recording without adding text (Esc)" type="button" variant="ghost" size="sm" onClick={()=>void controller.cancel()}><X size={15}/>Cancel</Button>
  </>}
  {state.error&&<span role="alert" className="voice-error">{state.error}</span>}
 </div>
}
