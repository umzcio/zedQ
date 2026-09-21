import {useEffect,useRef,useState} from 'react'
import {unwrap,type AppUpdateState} from '@zq/module-api'
import {Button,Dialog,DialogContent,DialogTitle,DialogDescription,ContextMenu,ContextMenuTrigger,ContextMenuContent,ContextMenuItem} from '@zq/ui'
import {Switch} from '@zq/ui'
import {useAppPreferences} from './useAppPreferences'
import {PreferenceRow} from './GeneralSettings'
import {ArrowClockwise,DownloadSimple} from '@phosphor-icons/react'

export default function UpdateSettings({active,closing}:{active:boolean;closing:boolean}){
 const [state,setState]=useState<AppUpdateState|null>(null),[error,setError]=useState(''),[confirm,setConfirm]=useState(false),[pending,setPending]=useState(false)
 const operation=useRef(false)
 const preferences=useAppPreferences(active)
 useEffect(()=>{if(!active||!window.zq.updates)return;let live=true,revision=0;const off=window.zq.updates.subscribe(next=>{revision++;if(live)setState(next)});void unwrap(window.zq.updates.status()).then(next=>{if(live&&!revision)setState(next)}).catch(e=>{if(live)setError(e.message)});return()=>{live=false;off()}},[active])
 async function run(action:'check'|'download'|'install'){
  if(!window.zq.updates||operation.current)return
  operation.current=true;setPending(true);setError('')
  try{const next=await unwrap(window.zq.updates[action]());if(next)setState(next);if(action==='install')setConfirm(false)}catch(e){setError((e as Error).message)}finally{operation.current=false;setPending(false)}
 }
 const status=state?.status,busy=closing||pending||status==='checking'||status==='downloading'||status==='restarting'
 const canAct=!!state&&!busy&&status!=='unavailable'
 const actionLabel=status==='available'?'Download update':status==='ready'?'Restart and install':status==='checking'?'Checking…':status==='downloading'?'Downloading…':status==='restarting'?'Restarting…':'Check for updates'
 const ActionIcon=status==='available'||status==='downloading'?DownloadSimple:ArrowClockwise
 const act=()=>{if(status==='ready')setConfirm(true);else void run(status==='available'?'download':'check')}
 const heading=status==='current'?'You’re up to date':status==='available'?`zQ ${state?.availableVersion} is available`:status==='ready'?`zQ ${state?.availableVersion} is ready to install`:status==='checking'?'Checking for updates…':status==='downloading'?`Downloading update · ${Math.round(state?.percent??0)}%`:status==='restarting'?'Saving and restarting…':status==='unavailable'?'Local build':status==='error'?'Couldn’t update zQ':'Check for a new version'
 return <section className="app-updates-settings">
  <header className="settings-panel-header"><div><h2>Updates</h2><p>Keep zQ up to date.</p></div></header>
  {!window.zq.updates?<p className="settings-panel-note">Install a newer desktop build to manage app updates.</p>:<>
   <ContextMenu><ContextMenuTrigger asChild><div className="app-update-summary">
    <div><strong>zQ{state?` ${state.version}`:''}</strong><span>{heading}</span></div>
    <Button variant="outline" disabled={!canAct} onClick={act}><ActionIcon size={15}/>{actionLabel}</Button>
   </div></ContextMenuTrigger><ContextMenuContent>
    <ContextMenuItem disabled={!canAct} onSelect={act}>{actionLabel}</ContextMenuItem>
    <ContextMenuItem disabled={!state||closing} onSelect={()=>{if(state)void unwrap(window.zq.clipboard.writeText(`zQ ${state.version}`)).catch(e=>setError(e.message))}}>Copy version</ContextMenuItem>
   </ContextMenuContent></ContextMenu>
   <div className="app-update-details" role="status">
    {state?.message&&<p>{state.message}</p>}
    {status==='downloading'&&<progress aria-label="Update download" max={100} value={state?.percent}/>}
    {state?.checkedAt&&<p className="app-update-last-check">Last checked {new Date(state.checkedAt).toLocaleString()}</p>}
   </div>
  </>}
  {window.zq.preferences&&<div className="app-update-preferences"><PreferenceRow label="Automatically check for updates" description="Check on launch and every six hours. Downloads and restarts stay manual." disabled={closing||preferences.busy||!preferences.state} reset={()=>void preferences.save({automaticUpdates:false})}><Switch aria-label="Automatically check for updates" checked={preferences.state?.automaticUpdates??false} disabled={closing||preferences.busy||!preferences.state} onCheckedChange={automaticUpdates=>void preferences.save({automaticUpdates})}/></PreferenceRow>{preferences.error&&<p className="app-update-error" role="alert">{preferences.error}</p>}</div>}
  {error&&<p className="app-update-error" role="alert">{error}</p>}
  <Dialog open={confirm} onOpenChange={setConfirm}><DialogContent><DialogTitle>Restart to install zQ {state?.availableVersion}?</DialogTitle><DialogDescription>Your drafts will be saved. Running chats and research will be interrupted by the restart.</DialogDescription><div className="dialog-actions"><Button variant="ghost" disabled={busy} onClick={()=>setConfirm(false)}>Later</Button><Button disabled={busy} onClick={()=>void run('install')}>Restart and install</Button></div></DialogContent></Dialog>
 </section>
}
