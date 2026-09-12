import { TooltipButton, ControlTooltip } from '@zq/ui'
import ChatSkillActivity from './ChatSkillActivity'
import SkillDraftHighlights from './SkillDraftHighlights'
import ChatSources from './ChatSources'
import {messageSources,withoutSourceAppendix} from './chat-sources'
import { useHost } from '@zq/module-api'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowUp, ArrowDown, CaretUp, CaretDown, X, CaretRight, MagnifyingGlass, Stop, UploadSimple, ListPlus } from '@phosphor-icons/react'
import { Button, VoiceControls } from '@zq/ui'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@zq/ui'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@zq/ui'
import { useChatMotion } from './useChatMotion'
import { AttachmentCard } from './AttachmentTray'
import AttachmentPreview from './AttachmentPreview'
import { ProjectIcon } from './ProjectIcon'
import { ChatProjectView } from './ChatProjects'
import ThinkingMark from './ThinkingMark'
import {ChatToolPicker,ChatToolOutput,useToolOptions} from './ChatTools'
import ChatQueue from './ChatQueue'
import ChatInteraction from './ChatInteraction'
import './chat-flow.css'
import ComposerAddMenu from './ComposerAddMenu'
import {SkillSlashMenu,useSkillSlash} from './SkillSlashMenu'
import {requestSkillSettingsPage} from './skills-navigation'
import {SkillMenus,useSkillActions} from './SkillActions'
import ModelPicker from './ModelPicker'
import { preferredModel } from './model-presentation'
import ChatMarkdown from './ChatMarkdown'
import ChatMessageActions from './ChatMessageActions'
import {messageMatches} from './message-text'
import './chat-reading.css'
import { unwrap } from '@zq/module-api'
import type { ChatController } from './useChat'
import type { Note } from '@zq/module-api'

export default function ChatView({chat,notes,closing,settings,prepareNotes}:{prepareNotes:()=>Promise<void>;chat:ChatController;notes:Note[];closing:boolean;settings:()=>void}){
 const {services,openSettings}=useHost()
 const c=chat.conversation, draftId=chat.draftId
 const activeProject=chat.state.projects.find(p=>p.id===(c?c.projectId:chat.project?.id))
 const skillSelection=chat.skillChoices[draftId]===undefined?c?.skillIds??null:chat.skillChoices[draftId]
 const enabledSkills=(skillSelection??activeProject?.skillIds??[]).flatMap(id=>chat.state.skills?.find(s=>s.id===id)??[])
 const readOnly=!!(c?.archivedAt||c?.deletedAt)
 const choice=c?(c.model&&c.connectionId?{connectionId:c.connectionId,model:c.model}:null):preferredModel(chat.state.connections,chat.state.defaultModel)
 const {options:toolOptions,ready:toolsReady,error:toolError}=useToolOptions(choice)
 const selectedTools=(chat.toolChoices[draftId]??c?.messages.slice().reverse().find(m=>m.role==='user')?.tools??chat.project?.defaultTools??[]).filter(kind=>toolOptions.some(t=>t.kind===kind))
 const connection=chat.state.connections.find(x=>x.id===choice?.connectionId)
 const [error,setError]=useState(''),[pending,setPending]=useState(false),[stopping,setStopping]=useState(false),[approvalPending,setApprovalPending]=useState(false),[attaching,setAttaching]=useState(false)
 const [noteQuery,setNoteQuery]=useState(''),[viewingContext,setViewingContext]=useState(false)
 const lock=useRef(false),scroller=useRef<HTMLDivElement>(null),input=useRef<HTMLTextAreaElement>(null),follow=useRef(true)
 const busy=!!c?.messages.some(m=>m.status==='streaming'),draft=chat.drafts[draftId]??'',ids=chat.attachments[draftId]??[]
 const waiting=!!c?.messages.some(message=>message.interactions?.some(interaction=>interaction.status==='waiting')),queueMode=busy||waiting||!!c?.queue?.items.length
 const activeOwner=useRef(draftId);activeOwner.current=draftId
 const stopLock=useRef(false),approvalLock=useRef(false)
 const skillActions=useSkillActions(pending||closing||readOnly)
 const files=chat.files[draftId]??[],importing=chat.fileBusy[draftId]??false
 const [addMenu,setAddMenu]=useState(false),[dragging,setDragging]=useState(false),[preview,setPreview]=useState<{id:string;name:string;text?:string}|null>(null)
 const skillDisabled=pending||closing||importing||readOnly
 const slash=useSkillSlash({text:draft,draftId,input,skills:chat.state.skills??[],active:enabledSkills.map(skill=>skill.id),disabled:skillDisabled,onText:text=>chat.setDraft(draftId,text),onEnable:ids=>chat.setSkillChoices(draftId,ids)})
 function skillSettings(page:'library'|'browse'){requestSkillSettingsPage(page);openSettings?.('skills')}
 const dragDepth=useRef(0)
 const [finding,setFinding]=useState(false),[findQuery,setFindQuery]=useState(''),[matchIndex,setMatchIndex]=useState(0),[atLatest,setAtLatest]=useState(true)
 const findInput=useRef<HTMLInputElement>(null),restored=useRef<string|undefined>(undefined)
 const matches=c?.messages.filter(m=>messageMatches(m.content,findQuery)).map(m=>m.id)??[]
 const currentMatch=matches.length?matches[matchIndex%matches.length]:undefined
 const [contextInfo,setContextInfo]=useState<{key:string;referenceBytes:number;conversationBytes:number;error:string}|null>(null)
 const contextRequest={conversationId:c?.id,projectId:activeProject?.id??null,text:draft,noteIds:ids,attachmentIds:files.map(f=>f.id),tools:selectedTools,skillIds:skillSelection},contextKey=JSON.stringify([contextRequest,enabledSkills,c?.updatedAt,activeProject?.instructions,activeProject?.files.map(f=>f.id),notes.filter(n=>ids.includes(n.id)).map(n=>n.body)])
 useEffect(()=>{let live=true;const timer=setTimeout(()=>{void unwrap(services.chat.inspectContext(contextRequest)).then(info=>{if(live)setContextInfo({key:contextKey,...info})}).catch(e=>{if(live)setContextInfo({key:contextKey,referenceBytes:0,conversationBytes:0,error:e.message})})},300);return()=>{live=false;clearTimeout(timer)}},[contextKey])
 const contextError=contextInfo?.key===contextKey?contextInfo.error:''
 const empty=!c?.messages.length
 const motion=useChatMotion(c?.id,empty,c?.messages.map(m=>m.id)??[])

 useEffect(()=>{setError('');setFinding(false);setFindQuery('');setMatchIndex(0);setAttaching(false);setAddMenu(false);setViewingContext(false);input.current?.focus({preventScroll:true})},[c?.id])
 useLayoutEffect(()=>{const el=input.current;if(el){el.style.height='0px';el.style.height=`${Math.min(Math.max(el.scrollHeight,52),220)}px`}},[draft,draftId,empty,chat.loading])
 useLayoutEffect(()=>{
  const el=scroller.current;if(!el||!c)return
  if(restored.current!==c.id){restored.current=c.id;const saved=chat.readingPositions[c.id];el.scrollTop=saved??el.scrollHeight;follow.current=saved===undefined||el.scrollHeight-el.scrollTop-el.clientHeight<80;setAtLatest(follow.current)}
  else if(follow.current)el.scrollTop=el.scrollHeight
 },[c?.id,c?.messages,chat.loading])
 useEffect(()=>{if(finding)findInput.current?.focus()},[finding])
 useEffect(()=>{if(!currentMatch||!finding)return;jump(currentMatch)},[currentMatch,finding])
 useEffect(()=>{if(chat.jumpToMessage&&c){jump(chat.jumpToMessage,true);chat.acknowledgeJump()}},[chat.jumpToMessage,c?.id,c?.messages])
 function jump(id:string,focus=false){const target=Array.from(scroller.current?.querySelectorAll<HTMLElement>('[data-message-id]')??[]).find(el=>el.dataset.messageId===id);if(target){follow.current=false;setAtLatest(false);target.scrollIntoView({block:'center'});const el=scroller.current;if(el){follow.current=el.scrollHeight-el.scrollTop-el.clientHeight<80;setAtLatest(follow.current)}if(focus)target.focus({preventScroll:true})}}
 function scrollChanged(){const el=scroller.current;if(el&&c){follow.current=el.scrollHeight-el.scrollTop-el.clientHeight<80;setAtLatest(follow.current);chat.saveReadingPosition(c.id,el.scrollTop)}}
 function latest(){const el=scroller.current;if(el){follow.current=true;setAtLatest(true);el.scrollTop=el.scrollHeight;scrollChanged()}}
 function findNext(direction:number){if(matches.length)setMatchIndex(old=>(old+direction+matches.length)%matches.length)}
 async function configure(connectionId:string,model:string){
  if(lock.current||closing||importing)return false;lock.current=true;setPending(true);setError('')
  try{if(c)await unwrap(services.chat.configureConversation({id:c.id,connectionId,model}));else if(!await chat.create({connectionId,model}))return false;return true}
  catch(e){setError((e as Error).message);return false}finally{lock.current=false;setPending(false)}
 }
 async function send(){
  if(lock.current||slash.blockBareSlash||contextError||readOnly||closing||importing||!toolsReady||toolError||(!draft.trim()&&!ids.length&&!files.length)||!choice)return
  lock.current=true;setPending(true);setError('');if(!queueMode)motion.prepareSend()
  try{
   const target=c??await chat.create(choice)
   if(!target){motion.cancelSend();return}
   if(target.connectionId!==choice.connectionId||target.model!==choice.model)await unwrap(services.chat.configureConversation({id:target.id,...choice}))
   if(ids.length)await prepareNotes()
   await chat.flushDrafts()
   await unwrap((queueMode?services.chat.enqueueMessage:services.chat.send)({conversationId:target.id,text:draft,noteIds:ids,attachmentIds:files.map(a=>a.id),tools:selectedTools,skillIds:skillSelection,...(chat.artifactTarget?{artifactContext:chat.artifactTarget}:{})}))
   chat.setDraft(target.id,'');chat.setAttachments(target.id,[]);chat.clearFiles(target.id);follow.current=true
  }catch(e){if(!queueMode)motion.cancelSend();if(activeOwner.current===draftId)setError((e as Error).message)}finally{lock.current=false;setPending(false);requestAnimationFrame(()=>{if(activeOwner.current===draftId)input.current?.focus()})}
 }
 async function stop(){if(!c||stopLock.current||closing)return;stopLock.current=true;setStopping(true);try{await unwrap(services.chat.stop(c.id))}catch(e){if(activeOwner.current===draftId)setError((e as Error).message)}finally{stopLock.current=false;setStopping(false)}}
 async function approvalMode(mode:'auto'|'ask'){if(busy||waiting||pending||closing||readOnly||approvalLock.current||lock.current)return;approvalLock.current=true;lock.current=true;setAddMenu(false);setApprovalPending(true);setPending(true);setError('');let target=c;try{target=target??await chat.create(choice??undefined,{cancelOnNavigation:true});if(!target)return;await unwrap(services.chat.setApprovalMode({conversationId:target.id,mode}))}catch(e){if(activeOwner.current===draftId||activeOwner.current===target?.id)setError((e as Error).message)}finally{approvalLock.current=false;lock.current=false;setApprovalPending(false);setPending(false);requestAnimationFrame(()=>{if(activeOwner.current===draftId||activeOwner.current===target?.id)input.current?.focus()})}}
 if(chat.loading)return <div className="chat-loading" role="status">Opening your chats…</div>
 if(chat.error)return <div className="empty-state" role="alert"><p>{chat.error}</p><p>Your Notes and Tasks are still available.</p></div>
 if(chat.projectHome&&chat.project)return <ChatProjectView key={chat.project.id} chat={chat} closing={closing}/>

 return <div className={`chat-view ${empty?'chat-is-empty':''}`} onKeyDown={e=>{if((e.metaKey||e.ctrlKey)&&e.key==='f'&&!empty){e.preventDefault();setFinding(true);findInput.current?.focus()}if(e.key==='Escape'&&finding){e.preventDefault();setFinding(false);input.current?.focus()}}} onDragEnter={e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();dragDepth.current++;setDragging(true)}}} onDragOver={e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();e.dataTransfer.dropEffect=closing||pending||importing?'none':'copy'}}} onDragLeave={e=>{e.preventDefault();if(--dragDepth.current<=0){dragDepth.current=0;setDragging(false)}}} onDrop={e=>{e.preventDefault();dragDepth.current=0;setDragging(false);if(!closing&&!pending&&!importing&&e.dataTransfer.files.length)void chat.addFiles(draftId,Array.from(e.dataTransfer.files))}}>
  {readOnly&&<div className="chat-restoration"><span>{c?.deletedAt?'This chat is in Trash.':'This chat is archived.'}</span><Button tooltip="Move this chat back to active chats so you can continue the conversation" variant="ghost" size="sm" onClick={()=>void chat.updateConversation({id:c!.id,deleted:false,archived:false}).catch(e=>setError(e.message))}>Restore chat</Button></div>}
  {activeProject&&<TooltipButton tooltip={`Open ${activeProject.name} project instructions, files, and chats`} className="chat-project-link" onClick={()=>chat.openProject(activeProject.id)}><ProjectIcon project={activeProject} size={16}/>{activeProject.name}</TooltipButton>}
  {dragging&&<div className="attachment-drop-overlay"><UploadSimple size={30}/><strong>Drop files into this chat</strong><span>Images, PDFs, and text files</span></div>}
  {!empty&&<div className="chat-reading-tools">{finding?<div className="chat-find"><MagnifyingGlass size={14}/><input ref={findInput} aria-label="Find in conversation" placeholder="Find in conversation…" value={findQuery} onChange={e=>{setFindQuery(e.target.value);setMatchIndex(0)}} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();findNext(e.shiftKey?-1:1)}}}/><span role="status">{findQuery.trim()?matches.length?`${matchIndex%matches.length+1} / ${matches.length}`:'No matches':''}</span><TooltipButton type="button" aria-label="Previous match" tooltip="Go to the previous matching message (Shift+Enter)" disabled={!matches.length} onClick={()=>findNext(-1)}><CaretUp size={14}/></TooltipButton><TooltipButton type="button" aria-label="Next match" tooltip="Go to the next matching message (Enter)" disabled={!matches.length} onClick={()=>findNext(1)}><CaretDown size={14}/></TooltipButton><TooltipButton type="button" aria-label="Close find" onClick={()=>{setFinding(false);input.current?.focus()}}><X size={14}/></TooltipButton></div>:<TooltipButton type="button" className="chat-find-trigger" title="Find in conversation (⌘F)" aria-label="Find in conversation" onClick={()=>setFinding(true)}><MagnifyingGlass size={14}/></TooltipButton>}</div>}
  {!empty&&<div className="chat-messages" ref={scroller} onScroll={scrollChanged}>
   <div className="chat-thread" ref={motion.thread}>{c!.messages.map(m=><ChatMessageActions key={m.id} message={m} chat={chat} choice={choice} disabled={busy||pending||closing||readOnly} notes={notes} settings={settings} matched={finding&&matches.includes(m.id)} currentMatch={finding&&currentMatch===m.id}>
    {m.role==='assistant'&&m.status==='streaming'&&!m.content&&<ThinkingMark/>}
    {m.role==='assistant'&&['stopped','interrupted','error'].includes(m.status)&&<ControlTooltip content={m.status==='stopped'?'Generation was stopped before completion. Use the message actions to generate another response.':m.status==='interrupted'?'The response was interrupted before it finished. Use the message actions to retry.':'The response could not finish. Review the error details and use the message actions to retry.'}><div className="chat-response-status" tabIndex={0}>{m.status==='stopped'?'Stopped':m.status==='interrupted'?'Interrupted':'Couldn’t finish'}</div></ControlTooltip>}
    {(!!m.attachments?.length||m.context.length>0)&&<div className="attachment-tray sent-attachments">{m.attachments?.map(a=><AttachmentCard key={a.id} item={a} onPreview={()=>setPreview({id:a.id,name:a.name})}/>)}{m.context.map(n=><AttachmentCard key={n.id} item={{id:n.id,name:n.title||'Untitled',kind:'note',size:0,preview:''}} onPreview={()=>setPreview({id:`${m.id}:${n.id}`,name:n.title||'Untitled',text:n.body})}/>)}</div>}
    {m.thinking&&<Collapsible className="chat-thinking"><CollapsibleTrigger tooltip="Show or hide the model’s thinking details" className="chat-thinking-trigger"><CaretRight size={12}/><span className={m.status==='streaming'&&!m.content?'chat-thinking-active':''}>{m.status==='streaming'&&!m.content?'Thinking…':'Thinking'}</span></CollapsibleTrigger><CollapsibleContent><ChatMarkdown content={m.thinking}/></CollapsibleContent></Collapsible>}
    {m.role==='assistant'&&<ChatSkillActivity skills={m.skillUsage} closing={closing}/>}
    {m.role==='assistant'&&<ChatToolOutput message={m} conversationId={c!.id} closing={closing} chat={chat}/>}
    {m.role==='user'?<div className="chat-user-text">{m.content}</div>:m.content?<ChatMarkdown content={withoutSourceAppendix(m.content,messageSources(m).sources)} sources={messageSources(m).sources} onSourceOpen={(source,origin)=>chat.openSources(c!.id,m,source.url,origin)}/>:null}
    {m.role==='assistant'&&<ChatSources message={m} closing={closing} onOpen={()=>chat.openSources(c!.id,m)}/>}
    {m.interactions?.map(interaction=><ChatInteraction key={`${c!.id}:${interaction.id}`} interaction={interaction} conversationId={c!.id} disabled={closing||readOnly}/>)}
    {m.error&&<p className="chat-error" role="alert">{m.error}</p>}
   </ChatMessageActions>)}</div>
  </div>}
  <div className="chat-compose-region">
   {!empty&&!atLatest&&<div className="chat-jump-latest"><TooltipButton tooltip="Scroll to the newest message and follow new responses" type="button" onClick={latest}><ArrowDown size={13}/>Jump to latest</TooltipButton></div>}
   {empty&&<div className="chat-welcome"><h1>What’s on your mind, zach?</h1></div>}
   <div className="chat-composer-area" ref={motion.composer}>
    {(error||chat.state.error||chat.recoveryError)&&<p className="chat-error" role="alert">{error||chat.state.error||chat.recoveryError}</p>}
    {contextError&&<p className="chat-context-limit" role="alert">{contextError}</p>}
    {c&&<ChatQueue key={c.id} conversation={c} disabled={pending||closing||readOnly} waiting={waiting}/>}
    <form className="chat-composer" onSubmit={e=>{e.preventDefault();void send()}}>
     {(ids.length>0||files.length>0)&&<div className="attachment-tray">{files.map(a=><AttachmentCard key={a.id} item={a} disabled={pending||closing||importing} onPreview={()=>setPreview({id:a.id,name:a.name})} onRemove={()=>chat.removeFile(draftId,a.id)}/>)}{ids.map(id=>{const note=notes.find(n=>n.id===id);return <AttachmentCard key={id} item={{id,name:note?.title||'Untitled',kind:'note',size:0,preview:''}} disabled={pending||closing||importing} onPreview={()=>setPreview({id,name:note?.title||'Untitled',text:note?.body??''})} onRemove={()=>chat.setAttachments(draftId,ids.filter(x=>x!==id))}/>})}</div>}
     {importing&&<div className="attachment-preparing" role="status"><span/>Preparing attachments…</div>}
     {chat.fileError[draftId]&&<p className="attachment-file-error" role="alert">{chat.fileError[draftId]}</p>}
     <SkillSlashMenu slash={slash} active={enabledSkills.map(skill=>skill.id)} disabled={skillDisabled} onAction={(action,skill)=>{input.current?.focus();void skillActions.act(action,skill)}}/>
     {slash.status&&<span className="skill-picker-status" role="status">{slash.status}</span>}
     <div className={`skill-draft-editor${slash.ranges.length?' has-skill-commands':''}`}>
     {slash.ranges.length>0&&<SkillDraftHighlights text={draft} ranges={slash.ranges} input={input}/>}
     <textarea aria-autocomplete="list" aria-controls={slash.open?slash.listId:undefined} aria-expanded={slash.open} aria-activedescendant={slash.activeDescendant} onFocus={e=>{slash.setFocused(true);slash.setCaret(e.currentTarget.selectionStart)}} onBlur={e=>{if(!(e.relatedTarget instanceof Element)||!e.relatedTarget.closest('.skill-slash-menu,[role=menu]'))slash.setFocused(false)}} onSelect={e=>slash.setCaret(e.currentTarget.selectionStart)} onPaste={e=>{const pasted=Array.from(e.clipboardData.files);if(pasted.length){e.preventDefault();if(!closing&&!pending&&!importing)void chat.addFiles(draftId,pasted)}}} ref={input} aria-label="Chat message" placeholder="How can I help?" value={draft} disabled={pending||closing||readOnly} onChange={e=>slash.edit(e.target.value,e.target.selectionStart)} onKeyDown={e=>{if(slash.keyDown(e))return;if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send()}}}/>
     </div>
     <div className="composer-actions">
      <ComposerAddMenu open={addMenu} onOpenChange={setAddMenu} approvalMode={c?.approvalMode??'auto'} approvalDisabled={busy||waiting||pending||closing||readOnly||approvalPending} onApprovalMode={mode=>void approvalMode(mode)} disabled={pending||closing||importing||readOnly} skillDisabled={skillDisabled} skills={chat.state.skills??[]} selected={skillSelection} inherited={activeProject?.skillIds??[]} inheritedConfigured={Array.isArray(activeProject?.skillIds)} onChange={ids=>chat.setSkillChoices(draftId,ids)} onUpload={()=>void chat.addFiles(draftId)} onNotes={()=>{setNoteQuery('');setAttaching(true)}} onContext={()=>setViewingContext(true)} onManage={()=>skillSettings('library')} onBrowse={()=>skillSettings('browse')} onSkillAction={(action,skill)=>{input.current?.focus();void skillActions.act(action,skill)}}/>
      <ChatToolPicker options={toolOptions} selected={selectedTools} onChange={tools=>chat.setToolChoices(draftId,tools)} disabled={pending||closing||importing}/>

      <div className="composer-model">
       <ModelPicker state={chat.state} choice={choice} disabled={busy||pending||closing||importing} settings={settings} onPick={configure} onPicked={()=>input.current?.focus({preventScroll:true})}/>
      </div>
      <VoiceControls controller={chat.voiceRecorder} originId={draftId} disabled={pending||closing||readOnly} onTranscript={chat.receiveTranscript}/>
      {busy&&<TooltipButton type="button" className="chat-stop" aria-label="Stop response" tooltip={stopping ? 'Stopping the response…' : 'Stop generating this response'} disabled={closing||stopping} onClick={()=>void stop()}><Stop size={15} weight="fill"/></TooltipButton>}
      <TooltipButton className={`chat-send${queueMode?' chat-enqueue':''}`} type="submit" tooltip={readOnly ? 'Restore this chat to send messages' : !connection || !choice ? 'Choose a connected model to send a message' : importing ? 'Wait for attachments to finish preparing' : contextError || toolError || (slash.blockBareSlash ? 'Choose a skill or continue typing your message' : pending ? 'Sending message…' : !toolsReady ? 'Loading tools for this model…' : !draft.trim() && !ids.length && !files.length ? 'Write a message or attach context to send' : queueMode ? 'Add this message to the queue to send in order' : 'Send message (Enter); add a new line with Shift+Enter')} disabled={slash.blockBareSlash||!!contextError||readOnly||pending||closing||importing||!toolsReady||!!toolError||(!draft.trim()&&!ids.length&&!files.length)||!connection||!choice} aria-label={queueMode?'Queue message':'Send message'}><span key={queueMode?'queue':'send'} className="chat-send-glyph animate-in fade-in-0 zoom-in-95">{queueMode?<ListPlus size={19}/>:<ArrowUp size={19} weight="bold"/>}</span></TooltipButton>
     </div>
    </form>
    {!chat.state.connections.length&&<TooltipButton tooltip="Open provider settings to connect a chat model" className="chat-setup-link" onClick={settings}>Connect a model to start chatting</TooltipButton>}
   </div>
  </div>
  <Dialog open={viewingContext&&!closing} onOpenChange={setViewingContext}><DialogContent inert={closing} className="chat-context-dialog" onCloseAutoFocus={e=>{e.preventDefault();input.current?.focus({preventScroll:true})}}><DialogTitle>Message context</DialogTitle><DialogDescription>The conversation and these references are included with your next message.</DialogDescription>
   {activeProject&&<p className="chat-context-project">{activeProject.name}</p>}
   {activeProject?.instructions&&<section><h3>Project instructions</h3><pre>{activeProject.instructions}</pre></section>}
   {enabledSkills.length>0&&<section><h3>Skills</h3>{enabledSkills.map(skill=><div key={skill.id}><SkillMenus skill={skill} disabled={busy||pending||closing||readOnly} onAction={(action,target)=>{setViewingContext(false);void skillActions.act(action,target)}}><h4>{skill.name}</h4></SkillMenus><pre>{skill.instructions}</pre>{skill.files.map(f=><TooltipButton tooltip={`Preview ${f.name}`} key={f.id} type="button" className="quiet-add" onClick={()=>{setViewingContext(false);setPreview({id:f.id,name:f.name})}}>{f.name}</TooltipButton>)}</div>)}</section>}
   <section><h3>References</h3>{ids.length+files.length+(activeProject?.files.length??0)===0?<p>No files or notes attached.</p>:<div className="chat-context-files">{[...(activeProject?.files??[]),...files].map(f=><TooltipButton tooltip={`Preview ${f.name}`} key={f.id} type="button" className="quiet-add" onClick={()=>{setViewingContext(false);setPreview({id:f.id,name:f.name})}}>{f.name}</TooltipButton>)}{ids.map(id=><div key={id}>{notes.find(n=>n.id===id)?.title??'Unavailable note'}</div>)}</div>}</section>
   {contextInfo?.key===contextKey&&<p className="chat-context-usage">{(contextInfo.referenceBytes/1000).toFixed(1)} / 100 KB references · {(contextInfo.conversationBytes/1000).toFixed(1)} / 512 KB conversation</p>}
  </DialogContent></Dialog>
  {skillActions.dialogs}
  {skillActions.error&&<p role="alert" className="chat-action-error">{skillActions.error}</p>}
  {preview&&<AttachmentPreview key={preview.id} target={preview} closing={closing} onClose={()=>setPreview(null)}/>}
  <Dialog open={attaching&&!closing} onOpenChange={setAttaching}><DialogContent inert={closing} className="attach-dialog"><DialogTitle>Attach notes</DialogTitle><DialogDescription>Choose notes to include with your message. Up to 10 files and notes total, with 100 KB of text.</DialogDescription><div className="model-search"><MagnifyingGlass size={15}/><input aria-label="Search notes to attach" placeholder="Find a note…" value={noteQuery} onChange={e=>setNoteQuery(e.target.value)}/></div><div className="attach-note-list">{notes.filter(n=>n.title.toLowerCase().includes(noteQuery.toLowerCase())).map(n=><label key={n.id}><ControlTooltip content={ids.includes(n.id) ? `Remove ${n.title || 'Untitled'} from your next message` : ids.length + files.length >= 10 ? 'Remove an attachment before adding another (10 maximum)' : `Include ${n.title || 'Untitled'} in your next message`}><input type="checkbox" checked={ids.includes(n.id)} disabled={!ids.includes(n.id)&&ids.length+files.length>=10} onChange={e=>chat.setAttachments(draftId,e.target.checked?[...ids,n.id]:ids.filter(id=>id!==n.id))}/></ControlTooltip><span>{n.title||'Untitled'}</span></label>)}</div><Button tooltip="Keep the selected notes attached to your next message" className="primary-button" onClick={()=>setAttaching(false)}>Done</Button></DialogContent></Dialog>
 </div>
}
