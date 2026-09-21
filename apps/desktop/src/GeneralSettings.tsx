import {useState,type ReactNode} from 'react'
import {Button,Switch,SelectField,ContextMenu,ContextMenuTrigger,ContextMenuContent,ContextMenuItem} from '@zq/ui'
import {unwrap,type AppPreferences} from '@zq/module-api'
import {useAppPreferences} from './useAppPreferences'
export function PreferenceRow({label,description,children,reset,disabled=false}:{label:string;description?:string;children:ReactNode;reset:()=>void;disabled?:boolean}){
 return <ContextMenu><ContextMenuTrigger asChild><div className="app-preference-row"><div><strong>{label}</strong>{description&&<p>{description}</p>}</div>{children}</div></ContextMenuTrigger><ContextMenuContent><ContextMenuItem disabled={disabled} onSelect={reset}>Reset to default</ContextMenuItem></ContextMenuContent></ContextMenu>
}
export default function GeneralSettings({active,closing}:{active:boolean;closing:boolean}){
 const {state,error,busy,save}=useAppPreferences(active),[testError,setTestError]=useState('')
 const disabled=closing||busy||!state
 const startupOptions=[{value:'restore',label:'Last view'},{value:'HQ',label:'Home'},...['Notes','Tasks','Chat','Code'].map(value=>({value,label:value}))]
 return <section className="general-settings">
  <header className="settings-panel-header"><div><h2>General</h2><p>Manage startup, window behavior, and notifications.</p></div></header>
  {!window.zq.preferences?<p className="settings-panel-note">Update the desktop app to manage these settings.</p>:<>
   <section className="app-preference-group" aria-label="Startup and window behavior">
    <PreferenceRow label="Launch at login" description={state?.loginStatus==='error'?'macOS login settings could not be read. Reopen Settings to retry.':!state?.loginSupported?'Available when zQ is installed in Applications.':state.loginStatus==='requires-approval'?'Allow zQ in macOS System Settings → General → Login Items.':'Open zQ when you sign in to your Mac.'} reset={()=>void save({launchAtLogin:false})} disabled={disabled||!state?.loginSupported}><Switch aria-label="Launch at login" checked={state?.launchAtLogin??false} disabled={disabled||!state?.loginSupported} onCheckedChange={launchAtLogin=>void save({launchAtLogin})}/></PreferenceRow>
    <PreferenceRow label="Start minimized" description="Launch at login without opening a window." reset={()=>void save({startMinimized:false})} disabled={disabled}><Switch aria-label="Start minimized" checked={state?.startMinimized??false} disabled={disabled||!state?.launchAtLogin} onCheckedChange={startMinimized=>void save({startMinimized})}/></PreferenceRow>
    <PreferenceRow label="On launch" reset={()=>void save({startupView:'restore'})} disabled={disabled}><SelectField label="On launch" value={state?.startupView??'restore'} disabled={disabled} options={startupOptions} onValueChange={value=>void save({startupView:value as AppPreferences['startupView']})}/></PreferenceRow>
    <PreferenceRow label="Closing the window" description="Keep running lets research and agents continue." reset={()=>void save({closeBehavior:'background'})} disabled={disabled}><SelectField label="Closing the window" value={state?.closeBehavior??'background'} disabled={disabled} options={[{value:'background',label:'Keep running'},{value:'quit',label:'Quit zQ'}]} onValueChange={value=>void save({closeBehavior:value as AppPreferences['closeBehavior']})}/></PreferenceRow>
   </section>
   <section className="app-preference-group" aria-labelledby="notifications-heading"><h3 id="notifications-heading">Notifications</h3><p className="settings-panel-note">When zQ is in the background. Delivery follows your macOS notification settings.</p>
    {([{key:'research',label:'Research finished'},{key:'agents',label:'Agent needs review'},{key:'tasks',label:'Task completed'}] as const).map(({key,label})=><PreferenceRow key={key} label={label} reset={()=>void save({notifications:{[key]:false}})} disabled={disabled}><Switch aria-label={label} checked={state?.notifications[key]??false} disabled={disabled||!state?.notificationsSupported} onCheckedChange={value=>void save({notifications:{[key]:value}})}/></PreferenceRow>)}
    {state&&!state.notificationsSupported&&<p className="settings-panel-note">Notifications are available in the installed app.</p>}
    <div className="app-preference-actions"><Button variant="outline" disabled={disabled||!state?.notificationsSupported} onClick={()=>{setTestError('');void unwrap(window.zq.preferences!.testNotification()).catch(e=>setTestError(e.message))}}>Send test notification</Button></div>
   </section>
  </>}
  {(error||testError)&&<p className="app-update-error" role="alert">{error||testError}</p>}
 </section>
}
