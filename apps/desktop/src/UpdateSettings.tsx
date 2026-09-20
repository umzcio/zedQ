import {useEffect,useRef,useState} from 'react'
import {unwrap,type AppUpdateState} from '@zq/module-api'
import {Button,Dialog,DialogContent,DialogTitle,DialogDescription,ContextMenu,ContextMenuTrigger,ContextMenuContent,ContextMenuItem} from '@zq/ui'
import {ArrowClockwise,DownloadSimple} from '@phosphor-icons/react'

export default function UpdateSettings({active,closing}:{active:boolean;closing:boolean}){
 const [state,setState]=useState<AppUpdateState|null>(null),[error,setError]=useState(''),[confirm,setConfirm]=useState(false),[pending,setPending]=useState(false)
 const operation=useRef(false)
 useEffect(()=>{if(!active||!window.zq.updates)return;let live=true,revision=0;const off=window.zq.updates.subscribe(next=>{revision++;if(live)setState(next)});void unwrap(window.zq.updates.status()).then(next=>{if(live&&!revision)setState(next)}).catch(e=>{if(live)setError(e.message)});return()=>{live=false;off()}},[active])
 async function run(action:'check'|'download'|'install'){
  if(!window.zq.updates||operation.current)return
  operation.current=true;setPending(true);setError('')
  try{const next=await unwrap(window.zq.updates[action]());if(next)setState(next);if(action==='install')setConfirm(false)}catch(e){setError((e as Error).message)}finally{operation.current=false;setPending(false)}
 }
 const status=state?.status,busy=closing||pending||status==='checking'||status==='downloading'||status==='restarting'
 const canCheck=!!state&&!busy&&!['unavailable','ready'].includes(status!)
 const heading=status==='current'?'You’re up to date':status==='available'?`zQ ${state?.availableVersion} is available`:status==='ready'?`zQ ${state?.availableVersion} is ready to install`:status==='checking'?'Checking for updates…':status==='downloading'?`Downloading update · ${Math.round(state?.percent??0)}%`:status==='restarting'?'Saving and restarting…':status==='unavailable'?'Local build':status==='error'?'Couldn’t update zQ':'Check for a new version'
 return <section className="app-updates-settings">
  <header className="settings-panel-header"><div><h2>Updates</h2><p>Keep zQ up to date.</p></div></header>
  {!window.zq.updates?<p className="settings-panel-note">Install a newer desktop build to manage app updates.</p>:<>
   <ContextMenu><ContextMenuTrigger asChild><div className="app-update-summary">
    <div><strong>zQ{state?` ${state.version}`:''}</strong><span>{heading}</span></div>
    <Button variant="outline" disabled={!canCheck} onClick={()=>void run('check')}><ArrowClockwise size={15}/>Check for updates</Button>
   </div></ContextMenuTrigger><ContextMenuContent>
    <ContextMenuItem disabled={!canCheck} onSelect={()=>void run('check')}>Check for updates</ContextMenuItem>
    <ContextMenuItem disabled={!state||closing} onSelect={()=>{if(state)void unwrap(window.zq.clipboard.writeText(`zQ ${state.version}`)).catch(e=>setError(e.message))}}>Copy version</ContextMenuItem>
   </ContextMenuContent></ContextMenu>
   <div className="app-update-details" role="status">
    {state?.message&&<p>{state.message}</p>}
    {status==='idle'&&<p>Updates download when you choose. You decide when to restart.</p>}
    {status==='available'&&<><p>Download the update, then restart when you’re ready.</p><Button variant="outline" disabled={busy} onClick={()=>void run('download')}><DownloadSimple size={15}/>Download update</Button></>}
    {status==='downloading'&&<progress aria-label="Update download" max={100} value={state?.percent}/>}
    {status==='ready'&&<><p>Your update is downloaded. Restart zQ to install it.</p><Button variant="outline" disabled={busy} onClick={()=>setConfirm(true)}><ArrowClockwise size={15}/>Restart and install</Button></>}
    {state?.checkedAt&&<p className="app-update-last-check">Last checked {new Date(state.checkedAt).toLocaleString()}</p>}
   </div>
  </>}
  {error&&<p className="app-update-error" role="alert">{error}</p>}
  <Dialog open={confirm} onOpenChange={setConfirm}><DialogContent><DialogTitle>Restart to install zQ {state?.availableVersion}?</DialogTitle><DialogDescription>Your drafts will be saved. Running chats and research will be interrupted by the restart.</DialogDescription><div className="dialog-actions"><Button variant="ghost" disabled={busy} onClick={()=>setConfirm(false)}>Later</Button><Button disabled={busy} onClick={()=>void run('install')}>Restart and install</Button></div></DialogContent></Dialog>
 </section>
}
