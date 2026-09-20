import { TooltipButton } from '@zq/ui'
import {memo,useState} from 'react'
import {DownloadSimple,TextAlignLeft} from '@phosphor-icons/react'
import {useHost,unwrap} from '@zq/module-api'
import {ContextMenu,ContextMenuContent,ContextMenuItem,ContextMenuTrigger} from '@zq/ui'
import {codeFilename,codeTokens} from './message-text'
import './chat-code.css'
import CopyFeedbackIcon from './CopyFeedbackIcon'
import {useCopyFeedback} from './useCopyFeedback'
export default memo(function ChatCode({code,language}:{code:string;language:string}){
 const {services,notify,closing}=useHost(),[wrap,setWrap]=useState(false),[saving,setSaving]=useState(false)
 const feedback=useCopyFeedback(code),{copied}=feedback
 const copy=(animate=false)=>feedback.run(()=>unwrap(services.clipboard.writeText(code)),animate,()=>notify('Couldn’t copy code. Try selecting it and pressing ⌘C.'))
 async function save(){if(saving||closing)return;setSaving(true);try{if(await unwrap(services.chat.saveTextFile({name:codeFilename(language),text:code})))notify('Code saved')}catch(e){notify((e as Error).message)}finally{setSaving(false)}}
 return <ContextMenu onOpenChange={feedback.menu.reset}><ContextMenuTrigger asChild><div className={`chat-code-block ${wrap?'is-wrapped':''}`}>
  <div className="chat-code-toolbar"><span>{language||'text'}</span><div><TooltipButton type="button" title={wrap?'Scroll long lines':'Wrap long lines'} aria-label={wrap?'Scroll long code lines':'Wrap long code lines'} aria-pressed={wrap} onClick={()=>setWrap(!wrap)}><TextAlignLeft size={14}/></TooltipButton><TooltipButton type="button" title="Save code as file" aria-label="Save code as file" disabled={saving||closing} onClick={()=>void save()}><DownloadSimple size={14}/></TooltipButton><TooltipButton type="button" title={copied?'Copied':'Copy code'} aria-label={copied?'Code copied':'Copy code'} onClick={event=>void copy(event.detail>0)}><CopyFeedbackIcon copied={copied} animate={feedback.animate}/></TooltipButton></div></div>
  <pre tabIndex={0} aria-label={`${language||'Plain text'} code`}><code>{codeTokens(code,language).map((token,i)=>token.kind?<span key={i} className={`code-${token.kind}`}>{token.text}</span>:token.text)}</code></pre>
  <span className="sr-only" role="status">{copied?'Code copied':''}</span>
 </div></ContextMenuTrigger><ContextMenuContent onKeyDownCapture={feedback.menu.reset}><ContextMenuItem onClickCapture={feedback.menu.onClickCapture} onSelect={()=>void copy(feedback.menu.consume())}>Copy code</ContextMenuItem><ContextMenuItem onSelect={()=>setWrap(!wrap)}>{wrap?'Scroll long lines':'Wrap long lines'}</ContextMenuItem><ContextMenuItem disabled={saving||closing} onSelect={()=>void save()}>Save code as file…</ContextMenuItem></ContextMenuContent></ContextMenu>
})
