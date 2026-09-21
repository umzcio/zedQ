import {useEffect,useRef,useState} from 'react'
import {unwrap,type AppPreferences,type AppPreferencesPatch} from '@zq/module-api'
export function useAppPreferences(active:boolean){
 const [state,setState]=useState<AppPreferences|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),flight=useRef(false)
 useEffect(()=>{if(!active||!window.zq.preferences)return;let live=true,revision=0;const off=window.zq.preferences.subscribe(value=>{revision++;if(live)setState(value)});void unwrap(window.zq.preferences.load()).then(value=>{if(live&&!revision)setState(value)}).catch(e=>{if(live)setError(e.message)});return()=>{live=false;off()}},[active])
 async function save(patch:AppPreferencesPatch){if(!window.zq.preferences||flight.current)return;flight.current=true;setBusy(true);setError('');try{setState(await unwrap(window.zq.preferences.save(patch)))}catch(e){setError((e as Error).message)}finally{flight.current=false;setBusy(false)}}
 return {state,error,busy,save}
}
