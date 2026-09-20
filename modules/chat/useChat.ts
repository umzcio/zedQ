import { useResearch } from './useResearch'
import { useHost, useCommand } from '@zq/module-api'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { unwrap } from '@zq/module-api'
import { VoiceRecorderController } from '@zq/ui'
import { preferredModel } from './model-presentation'
import type { Attachment, ChatSnapshot, ChatToolKind, Connector, ConnectorCatalogEntry } from '@zq/module-api'
export function useChat(){
 const host=useHost(),{services}=host
 const research=useResearch()
 const [researchDrafts,setResearchDrafts]=useState<Record<string,import('@zq/module-api').ResearchDraft>>({})
 const [artifactsView,setArtifactsView]=useState(false),[artifactTarget,setArtifactTarget]=useState<import('@zq/module-api').ArtifactTarget|null>(null)
 const [sourceTarget,setSourceTarget]=useState<{conversationId:string;message:import('@zq/module-api').ChatMessage;sourceUrl?:string}|null>(null)
 const artifactOwner=useRef<string|undefined>(undefined)
 const artifactFocus=useRef<HTMLElement|null>(null),artifactEpoch=useRef(0),artifactFocusRequest=useRef<object|null>(null),manualArtifactRequest=useRef<number|null>(null),automaticArtifactRequest=useRef(0)
 function invalidateArtifactRequests(){manualArtifactRequest.current=null;artifactFocusRequest.current=null;return ++artifactEpoch.current}
 function rememberArtifactFocus(origin:HTMLElement|null=document.activeElement instanceof HTMLElement?document.activeElement:null){if(origin&&!origin.closest('.artifact-pane')&&origin.getAttribute('role')!=='menuitem')artifactFocus.current=origin}
 function automaticPaneAvailable(){const workspace=document.querySelector<HTMLElement>('.artifact-workspace');return !sourceTarget&&!!workspace&&workspace.getBoundingClientRect().width>=800}
 function openArtifact(target:import('@zq/module-api').ArtifactTarget,automatic=false,options:{origin?:HTMLElement|null;focus?:boolean;conversationId?:string}={}){if(automatic&&(!automaticPaneAvailable()||artifactFocusRequest.current))return;const origin=options.origin===undefined?(document.activeElement instanceof HTMLElement?document.activeElement:null):options.origin;invalidateArtifactRequests();if(!automatic&&options.focus!==false&&!origin?.closest('.artifact-pane')){rememberArtifactFocus(origin);artifactFocusRequest.current={}}artifactOwner.current=options.conversationId??conversation?.id;setSourceTarget(null);setArtifactTarget(target)}
 function closeArtifact(){const epoch=invalidateArtifactRequests();setArtifactTarget(null);setSourceTarget(null);requestAnimationFrame(()=>{if(epoch!==artifactEpoch.current)return;const previous=artifactFocus.current;if(previous?.isConnected&&previous.getClientRects().length)previous.focus();else (document.querySelector<HTMLTextAreaElement>('[aria-label="Chat message"]')??document.querySelector<HTMLButtonElement>(`[data-artifact-id="${artifactTarget?.artifactId}"] .artifact-row-open`)??document.querySelector<HTMLButtonElement>('.artifact-row-open'))?.focus()})}
 function openSources(conversationId:string,message:import('@zq/module-api').ChatMessage,sourceUrl?:string,origin?:HTMLElement|null){invalidateArtifactRequests();rememberArtifactFocus(origin);artifactFocusRequest.current={};setArtifactTarget(null);setSourceTarget({conversationId,message,sourceUrl})}
 function dismissArtifactForNavigation(){if(!artifactTarget)return;invalidateArtifactRequests();setArtifactTarget(null);artifactFocus.current=null}
 function dismissSourcesForNavigation(){if(!sourceTarget)return;invalidateArtifactRequests();setSourceTarget(null);artifactFocus.current=null}
 function openArtifacts(target?:{artifactId?:string;versionId?:string}){dismissSourcesForNavigation();invalidateArtifactRequests();if(target?.artifactId&&target.versionId)openArtifact({artifactId:target.artifactId,versionId:target.versionId});setArtifactsView(true)}
 useLayoutEffect(()=>{const request=artifactFocusRequest.current;invalidateArtifactRequests();if(host.workspace.layout.view==='Chat'&&!host.closing)artifactFocusRequest.current=request},[host.workspace.layout.view,host.closing])
 useLayoutEffect(()=>{const request=artifactFocusRequest.current;if(!request||(!artifactTarget&&!sourceTarget)||host.workspace.layout.view!=='Chat'||host.closing)return;const epoch=artifactEpoch.current;const frame=requestAnimationFrame(()=>{if(artifactFocusRequest.current!==request||epoch!==artifactEpoch.current)return;artifactFocusRequest.current=null;const row=sourceTarget?.sourceUrl?[...document.querySelectorAll<HTMLElement>('.sources-pane [data-source-url]')].find(row=>row.dataset.sourceUrl===sourceTarget.sourceUrl):null;(row?.querySelector<HTMLAnchorElement>('a')??document.querySelector<HTMLButtonElement>('.artifact-pane [data-pane-close]'))?.focus({preventScroll:true})});return()=>cancelAnimationFrame(frame)},[artifactTarget,sourceTarget,host.workspace.layout.view,host.closing])
 useEffect(()=>()=>{invalidateArtifactRequests();artifactFocusRequest.current=null},[])
 useCommand('artifacts.open',target=>{if(target?.artifactId&&target.versionId)openArtifact({artifactId:target.artifactId,versionId:target.versionId});else openArtifacts();host.navigate('Chat')})
 const [voiceRecorder]=useState(()=>new VoiceRecorderController(services.voice))
 useEffect(()=>()=>{void voiceRecorder.cancel()},[voiceRecorder])
 useEffect(()=>{if(host.closing)void voiceRecorder.cancel()},[host.closing,voiceRecorder])
 const [state,setState]=useState<ChatSnapshot>({projects:[],connections:[],conversations:[],defaultModel:null,revision:-1,error:''})
 const [error,setError]=useState(''),[loading,setLoading]=useState(true),[selected,setSelected]=useState('')
 const [projectId,setProjectId]=useState<string|null>(null),[projectHome,setProjectHome]=useState(false)
 const [connectors,setConnectors]=useState<Connector[]>([]),[connectorsLoading,setConnectorsLoading]=useState(true),[connectorsError,setConnectorsError]=useState('')
 useEffect(()=>{let live=true;const apply=(items:Connector[])=>{if(live){setConnectors(items);setConnectorsError('')}};const unsubscribe=services.connectors.subscribe(apply);unwrap(services.connectors.list()).then(apply).catch(e=>{if(live)setConnectorsError(e.message)}).finally(()=>{if(live)setConnectorsLoading(false)});return()=>{live=false;unsubscribe()}},[])
 const [connectorCatalog,setConnectorCatalog]=useState<ConnectorCatalogEntry[]>([]),[connectorCatalogLoading,setConnectorCatalogLoading]=useState(true),[connectorCatalogError,setConnectorCatalogError]=useState(''),[connectorCatalogRefresh,setConnectorCatalogRefresh]=useState(0)
 useEffect(()=>{let live=true;setConnectorCatalogLoading(true);setConnectorCatalogError('');unwrap(services.connectors.catalog()).then(items=>{if(live)setConnectorCatalog(items)}).catch(e=>{if(live)setConnectorCatalogError(e.message)}).finally(()=>{if(live)setConnectorCatalogLoading(false)});return()=>{live=false}},[connectorCatalogRefresh])
 const [connectorChoices,setConnectorChoices]=useState<Record<string,string[]|null>>({})
 const connectorChoiceLocks=useRef(new Set<string>())
 async function chooseConnectors(id:string,ids:string[]|null){if(host.closing||connectorChoiceLocks.current.has(id))return;connectorChoiceLocks.current.add(id);try{if(!id.startsWith('new:'))await unwrap(services.chat.setConversationConnectors({conversationId:id,connectorIds:ids}));setConnectorChoices(old=>({...old,[id]:ids}))}finally{connectorChoiceLocks.current.delete(id)}}
 const [skillChoices,setSkillChoices]=useState<Record<string,string[]|null>>({})
 const [toolChoices,setToolChoices]=useState<Record<string,ChatToolKind[]>>({})
 const [drafts,setDrafts]=useState<Record<string,string>>({}),[attachments,setAttachments]=useState<Record<string,string[]>>({})
 const [files,setFiles]=useState<Record<string,Attachment[]>>({}),[fileBusy,setFileBusy]=useState<Record<string,boolean>>({}),[fileError,setFileError]=useState<Record<string,string>>({})
 const latestFiles=useRef(files),latestNotes=useRef(attachments);latestFiles.current=files;latestNotes.current=attachments
 const fileLocks=useRef(new Set<string>())
 const draftAliases=useRef(new Map<string,string>())
 const creating=useRef(false),hydrated=useRef(false)
 const [jumpToMessage,setJump]=useState<string|null>(null),[readingPositions,setPositions]=useState<Record<string,number>>({}),[recoveryError,setRecoveryError]=useState('')
 const pendingDrafts=useRef(new Map<string,Parameters<typeof services.chat.saveDraft>[0]>()),lastDrafts=useRef(new Map<string,string>()),draftTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),writeQueue=useRef(Promise.resolve())
 const viewRef=useRef({selected,projectId,projectHome,positions:readingPositions}),viewDirty=useRef(false)
 async function flushDrafts(){clearTimeout(draftTimer.current);const entries=[...pendingDrafts.current];pendingDrafts.current.clear();const view=viewDirty.current?structuredClone(viewRef.current):null;viewDirty.current=false;const run=writeQueue.current.catch(()=>{}).then(async()=>{try{for(const [id,input] of entries)await unwrap(services.chat.saveDraft(input));if(view)await unwrap(services.chat.saveChatView(view));setRecoveryError('')}catch(e){for(const [id,input] of entries)if(!pendingDrafts.current.has(id))pendingDrafts.current.set(id,input);if(view)viewDirty.current=true;setRecoveryError((e as Error).message);throw e}});writeQueue.current=run;return run}
 function scheduleSave(){clearTimeout(draftTimer.current);draftTimer.current=setTimeout(()=>{void flushDrafts().catch(()=>{})},250)}
 useEffect(()=>host.registerFlush('chat',async()=>{await voiceRecorder.cancel();await flushDrafts()}),[])
 useEffect(()=>{if(!hydrated.current)return;for(const id of new Set([...Object.keys(drafts),...Object.keys(attachments),...Object.keys(files),...Object.keys(toolChoices),...Object.keys(skillChoices),...Object.keys(connectorChoices),...Object.keys(researchDrafts)])){const input={id,...(researchDrafts[id]?{research:researchDrafts[id]}:{}),...(connectorChoices[id]!==undefined?{connectorIds:connectorChoices[id]}:{}),...(skillChoices[id]!==undefined?{skillIds:skillChoices[id]}:{}),text:drafts[id]??'',noteIds:attachments[id]??[],tools:toolChoices[id]??[],attachmentIds:(files[id]??[]).map(a=>a.id)},key=JSON.stringify(input);if(lastDrafts.current.get(id)!==key){lastDrafts.current.set(id,key);pendingDrafts.current.set(id,input)}}if(pendingDrafts.current.size)scheduleSave()},[drafts,attachments,files,toolChoices,skillChoices,connectorChoices,researchDrafts])
 useEffect(()=>{if(!hydrated.current)return;viewRef.current={selected,projectId,projectHome,positions:readingPositions};viewDirty.current=true;scheduleSave()},[selected,projectId,projectHome,readingPositions])
 useEffect(()=>{let live=true;const apply=(next:ChatSnapshot)=>{if(live){setState(old=>next.revision>=old.revision?next:old);if(!hydrated.current){hydrated.current=true;const ds=next.drafts??{};setResearchDrafts(Object.fromEntries(Object.entries(ds).filter(([,d])=>d.research).map(([id,d])=>[id,d.research!])));setDrafts(Object.fromEntries(Object.entries(ds).map(([id,d])=>[id,d.text])));setAttachments(Object.fromEntries(Object.entries(ds).map(([id,d])=>[id,d.noteIds])));setToolChoices(Object.fromEntries(Object.entries(ds).map(([id,d])=>[id,d.tools])));setSkillChoices(Object.fromEntries(Object.entries(ds).filter(([,d])=>d.skillIds!==undefined).map(([id,d])=>[id,d.skillIds!])));setConnectorChoices(Object.fromEntries(Object.entries(ds).filter(([,d])=>d.connectorIds!==undefined).map(([id,d])=>[id,d.connectorIds!])));setFiles(Object.fromEntries(Object.entries(ds).map(([id,d])=>[id,d.attachments])));if(next.chatView){setSelected(next.chatView.selected);setProjectId(next.chatView.projectId);setProjectHome(next.chatView.projectHome);setPositions(next.chatView.positions)}}}};const unsubscribe=services.chat.subscribe(apply);unwrap(services.chat.load()).then(apply).catch(e=>{if(live)setError(e.message)}).finally(()=>{if(live)setLoading(false)});return()=>{live=false;unsubscribe()}},[])
 useEffect(()=>{if(!state.skills)return;const available=new Set(state.skills.map(s=>s.id));setSkillChoices(old=>{let changed=false;const next=Object.fromEntries(Object.entries(old).map(([id,ids])=>{const filtered=ids?.filter(value=>available.has(value))??null;if(ids&&filtered&&ids.length!==filtered.length)changed=true;return [id,filtered]}));return changed?next:old})},[state.skills])
 const project=state.projects.find(p=>p.id===projectId)
 const scopedConversations=state.conversations.filter(c=>!c.archivedAt&&!c.deletedAt&&(!project||c.projectId===project.id))
 const conversation=projectHome&&project?undefined:state.conversations.find(c=>c.id===selected)??scopedConversations[0]
 // Sources belong to the visible conversation; also cover archive/delete/branch
 // changes that replace it through a snapshot rather than a sidebar click.
 useLayoutEffect(()=>{if(sourceTarget&&(sourceTarget.conversationId!==conversation?.id||projectHome||artifactsView))dismissSourcesForNavigation()},[conversation?.id,projectHome,artifactsView,sourceTarget])
 useLayoutEffect(()=>{if(artifactTarget&&artifactOwner.current!==conversation?.id)dismissArtifactForNavigation()},[conversation?.id,artifactTarget])
 const draftId=conversation?.id??`new:${project?.id??'general'}`
 const knownArtifactFiles=useRef(new Set<string>()),streamingArtifactReplies=useRef(new Set<string>()),artifactBaseline=useRef(false)
 const artifactContext=useRef({id:conversation?.id,view:host.workspace.layout.view,library:artifactsView,closing:host.closing});artifactContext.current={id:conversation?.id,view:host.workspace.layout.view,library:artifactsView,closing:host.closing}
 function captureArtifactRequest(){const epoch=invalidateArtifactRequests(),context={...artifactContext.current};return()=>{const current=artifactContext.current;return epoch===artifactEpoch.current&&!current.closing&&current.id===context.id&&current.view===context.view&&current.library===context.library}}
 async function openGeneratedArtifact(input:Parameters<typeof services.artifacts.importGenerated>[0],options:{library?:boolean;automatic?:boolean;origin?:HTMLElement|null}={}){
  const automatic=!!options.automatic,context={...artifactContext.current}
  if(context.closing||context.view!=='Chat'||context.id!==input.conversationId||automatic&&(context.library||manualArtifactRequest.current!==null||!automaticPaneAvailable()))return
  const origin=options.origin??(document.activeElement instanceof HTMLElement?document.activeElement:null)
  const epoch=automatic?artifactEpoch.current:invalidateArtifactRequests(),sequence=automatic?++automaticArtifactRequest.current:0
  if(!automatic){rememberArtifactFocus(origin);manualArtifactRequest.current=epoch}
  const current=()=>{const now=artifactContext.current;return epoch===artifactEpoch.current&&!now.closing&&now.id===context.id&&now.view===context.view&&now.library===context.library&&(!automatic||sequence===automaticArtifactRequest.current&&automaticPaneAvailable())}
  try{const artifact=await unwrap(services.artifacts.importGenerated(input));if(!current())return;const version=artifact.versions.find(v=>v.source?.generatedFileId===input.fileId);if(!version)throw Error('The original generated file version is unavailable.');if(options.library)setArtifactsView(true);openArtifact({artifactId:artifact.id,versionId:version.id},automatic,{origin})}catch(e){if(current())throw e}finally{if(manualArtifactRequest.current===epoch)manualArtifactRequest.current=null}
 }
 useEffect(()=>{
  if(loading)return
  let candidate:{conversationId:string;messageId:string;fileId:string}|undefined
  for(const c of state.conversations)for(const m of c.messages){
   const response=m.id+':'+(m.activeVersionId??m.id),wasStreaming=streamingArtifactReplies.current.has(response)
   if(m.status==='streaming')streamingArtifactReplies.current.add(response)
   for(const file of m.generatedFiles??[]){if(artifactBaseline.current&&!knownArtifactFiles.current.has(file.id)&&(wasStreaming||m.status==='streaming')&&c.id===conversation?.id&&host.workspace.layout.view==='Chat'&&!artifactsView)candidate={conversationId:c.id,messageId:m.id,fileId:file.id};knownArtifactFiles.current.add(file.id)}
   if(m.status!=='streaming')streamingArtifactReplies.current.delete(response)
  }
  artifactBaseline.current=true
  if(candidate)void openGeneratedArtifact(candidate,{automatic:true}).catch(e=>host.notify(e.message))
 },[state,loading,conversation?.id,host.workspace.layout.view,artifactsView])

 async function select(id:string,messageId?:string,versionId?:string){invalidateArtifactRequests();setArtifactsView(false);const target=state.conversations.find(c=>c.id===id);if(!target){host.notify('This source chat is unavailable.');return false}if(conversation?.id!==id){dismissSourcesForNavigation();dismissArtifactForNavigation()}if(messageId&&versionId&&!target.messages.some(m=>m.id===messageId&&m.activeVersionId===versionId)){try{await unwrap(services.chat.selectMessageVersion({conversationId:id,messageId,versionId}))}catch(e){host.notify((e as Error).message);return false}}setProjectId(target.projectId??null);setSelected(id);setProjectHome(false);setJump(messageId??null);return true}
 function openProject(id:string|null){dismissSourcesForNavigation();dismissArtifactForNavigation();invalidateArtifactRequests();setArtifactsView(false);setProjectId(id);setProjectHome(!!id);setSelected('')}
 useCommand('chat.open',async({conversationId,messageId,versionId,report})=>{if(!await select(conversationId,messageId,versionId))return;host.navigate('Chat');if(report)openArtifact(report,false,{conversationId})})
 async function followupResearch(target:import('@zq/module-api').ArtifactTarget){const [view,version]=await Promise.all([unwrap(services.artifacts.researchView(target)),unwrap(services.artifacts.version(target))]);const conversationId=version.source?.conversationId;if(!conversationId||!await select(conversationId))throw Error('The source chat is unavailable. Restore it before continuing research.');setResearchDrafts(old=>({...old,[conversationId]:{mode:true,previousReport:target,sources:view.document.sources.map(({kind,id,scope})=>({kind,id,scope}))}}));setDrafts(old=>({...old,[conversationId]:`Follow up on “${view.document.title}”: `}));host.navigate('Chat');closeArtifact();}
 async function saveProject(input:{id?:string;name?:string;instructions?:string;icon?:string;color?:string}){const p=await unwrap(services.chat.saveProject(input));if(!input.id)openProject(p.id);return p}
 async function deleteProject(id:string){await unwrap(services.chat.deleteProject(id));if(projectId===id)openProject(null)}
 async function move(id:string,target:string|null){return unwrap(services.chat.moveConversation({id,projectId:target}))}
 async function create(choice?:{connectionId:string;model:string},options:{cancelOnNavigation?:boolean}={}){if(creating.current||loading||error)return;creating.current=true;dismissSourcesForNavigation();dismissArtifactForNavigation();invalidateArtifactRequests();setArtifactsView(false);const epoch=artifactEpoch.current,current=()=>!options.cancelOnNavigation||epoch===artifactEpoch.current;try{await flushDrafts();if(!current())return;const c=await unwrap(services.chat.createConversation({...(choice??project?.defaultModel??preferredModel(state.connections,state.defaultModel,conversation)??{connectionId:null,model:''}),projectId:project?.id??null,...(!conversation?{draftFrom:draftId}:{})}));if(!conversation){draftAliases.current.set(draftId,c.id);const transfer=<T,>(old:Record<string,T>,fallback:T)=>{const next={...old,[c.id]:old[draftId]??fallback};delete next[draftId];return next};pendingDrafts.current.delete(draftId);lastDrafts.current.delete(draftId);setDrafts(old=>transfer(old,''));setAttachments(old=>transfer(old,[]));setFiles(old=>transfer(old,[]));setToolChoices(old=>transfer(old,project?.defaultTools??[]));setSkillChoices(old=>transfer(old,null));setConnectorChoices(old=>transfer(old,null));setResearchDrafts(old=>transfer(old,{mode:false,sources:[]}))}else if(project?.defaultTools)setToolChoices(old=>({...old,[c.id]:project.defaultTools!}));if(!current())return;setSelected(c.id);setProjectHome(false);return c}catch(e){setError((e as Error).message)}finally{creating.current=false}}
 async function addFiles(id:string,selection?:File[]){
  if(fileLocks.current.has(id))return;fileLocks.current.add(id);setFileBusy(old=>({...old,[id]:true}));setFileError(old=>({...old,[id]:''}));
  try{
   if(selection&&selection.length>10)throw Error('Attach up to 10 files at a time.');
   const payload=[];const rejected:string[]=[];
   if(selection)for(const file of selection){if(file.size>10*1024*1024){rejected.push(`${file.name}: files can be up to 10 MB.`);continue}payload.push({name:file.name||'Pasted image.png',bytes:new Uint8Array(await file.arrayBuffer())})}
   const result=await unwrap(selection?services.attachments.import(payload):services.attachments.pick());
   const room=Math.max(0,10-(files[id]?.length??0)-(attachments[id]?.length??0));const accepted=result.items.slice(0,room);
   for(const extra of result.items.slice(room))void services.attachments.discard(extra.id);
   if(result.items.length>room)rejected.push('Attach up to 10 files and notes total.');
   setFiles(old=>({...old,[id]:[...(old[id]??[]),...accepted]}));
   setFileError(old=>({...old,[id]:[...rejected,...result.errors.map(e=>`${e.name}: ${e.message}`)].join('\n')}));
   return accepted;
  }catch(e){setFileError(old=>({...old,[id]:(e as Error).message}))}
  finally{fileLocks.current.delete(id);setFileBusy(old=>({...old,[id]:false}))}
 }
 async function rename(id:string,title:string){return unwrap(services.chat.renameConversation({id,title}))}
 async function remove(id:string){
  invalidateArtifactRequests();await unwrap(services.chat.updateConversation({id,deleted:true}));if(conversation?.id===id)dismissArtifactForNavigation()
  setSelected(old=>old===id?'':old)
 }
 function removeFile(id:string,fileId:string){setFiles(old=>({...old,[id]:(old[id]??[]).filter(a=>a.id!==fileId)}));void services.attachments.discard(fileId)}
 async function revise(input:Parameters<typeof services.chat.reviseMessage>[0]){invalidateArtifactRequests();await flushDrafts();return unwrap(services.chat.reviseMessage(input))}
 async function branch(messageId:string){if(!conversation)return;invalidateArtifactRequests();await flushDrafts();const c=await unwrap(services.chat.branchConversation({conversationId:conversation.id,messageId}));dismissArtifactForNavigation();setSelected(c.id);setProjectId(c.projectId??null);setProjectHome(false);return c}
 async function selectVersion(messageId:string,versionId:string){if(!conversation)return;invalidateArtifactRequests();return unwrap(services.chat.selectMessageVersion({conversationId:conversation.id,messageId,versionId}))}
 async function reviseGeneratedArtifact(input:Parameters<typeof services.artifacts.importGenerated>[0]){
  const current=captureArtifactRequest(),artifact=await unwrap(services.artifacts.importGenerated(input))
  if(!current())return
  const version=artifact.versions.find(v=>v.source?.generatedFileId===input.fileId)
  if(!version)throw Error('The original generated file version is unavailable.')
  await reviseArtifact({artifactId:artifact.id,versionId:version.id})
 }
 async function reviseArtifact(target:import('@zq/module-api').ArtifactTarget){
  const isCurrent=captureArtifactRequest(),saved=await unwrap(services.artifacts.version(target))
  if(!isCurrent())return
  if(typeof saved.content!=='string')throw Error('This imported file has no editable source. Its original layout cannot be revised in chat yet.')
  const source=state.conversations.find(c=>c.id===saved.source?.conversationId&&!c.deletedAt&&!c.archivedAt)
  let destination=source?.id
  if(source)await select(source.id)
  else {const created=await create(undefined,{cancelOnNavigation:true});if(!created)return;destination=created.id}
  setArtifactsView(false);setProjectHome(false);openArtifact(target,false,{focus:false,conversationId:destination})
  requestAnimationFrame(()=>document.querySelector<HTMLTextAreaElement>('[aria-label="Chat message"]')?.focus())
 }
 return {followupResearch,research,researchDrafts,setResearchDraft:(id:string,value:import('@zq/module-api').ResearchDraft)=>setResearchDrafts(old=>({...old,[id]:value})),connectorCatalog,connectorCatalogLoading,connectorCatalogError,refreshConnectorCatalog:()=>setConnectorCatalogRefresh(value=>value+1),connectors,connectorsLoading,connectorsError,connectorChoices,setConnectorChoices:chooseConnectors,skillChoices,setSkillChoices:(id:string,ids:string[]|null)=>setSkillChoices(old=>({...old,[id]:ids})),reviseGeneratedArtifact,reviseArtifact,sourceTarget,sourceMessage:sourceTarget?(state.conversations.find(c=>c.id===sourceTarget.conversationId)?.messages.find(m=>m.id===sourceTarget.message.id&&m.activeVersionId===sourceTarget.message.activeVersionId)??sourceTarget.message):null,openSources,artifactsView,artifactTarget,openArtifacts,openArtifact,openGeneratedArtifact,captureArtifactRequest,closeArtifact,searchConversations:(input:Parameters<typeof services.chat.searchConversations>[0])=>unwrap(services.chat.searchConversations(input)),voiceRecorder,receiveTranscript:({originId,text}:{originId:string;text:string})=>setDrafts(old=>{const id=draftAliases.current.get(originId)??originId;return {...old,[id]:[old[id]?.trimEnd(),text].filter(Boolean).join('\n')}}),flushDrafts,recoveryError,readingPositions,saveReadingPosition:(id:string,top:number)=>setPositions(old=>({...old,[id]:top})),jumpToMessage,acknowledgeJump:()=>setJump(null),revise,branch,selectVersion,updateConversation:(input:Parameters<typeof services.chat.updateConversation>[0])=>unwrap(services.chat.updateConversation(input)),updateProject:(input:Parameters<typeof services.chat.updateProject>[0])=>unwrap(services.chat.updateProject(input)),exportConversation:(id:string)=>unwrap(services.chat.exportConversation(id)),addGeneratedFile:async(input:Parameters<typeof services.chat.reuseGeneratedFile>[0])=>{const id=draftId;if(fileLocks.current.has(id))throw Error('Wait for the current attachments to finish.');fileLocks.current.add(id);setFileBusy(old=>({...old,[id]:true}));try{if((latestFiles.current[id]?.length??0)+(latestNotes.current[id]?.length??0)>=10)throw Error('Attach up to ten notes and files.');const item=await unwrap(services.chat.reuseGeneratedFile(input));if((latestFiles.current[id]?.length??0)+(latestNotes.current[id]?.length??0)>=10){await services.attachments.discard(item.id);throw Error('Attach up to ten notes and files.')}const next={...latestFiles.current,[id]:[...(latestFiles.current[id]??[]),item]};latestFiles.current=next;setFiles(next)}finally{fileLocks.current.delete(id);setFileBusy(old=>({...old,[id]:false}))}},toolChoices,setToolChoices:(id:string,tools:ChatToolKind[])=>setToolChoices(old=>({...old,[id]:tools})),project,projectHome,scopedConversations,draftId,openProject,saveProject,deleteProject,move,state,error,loading,files,fileBusy,fileError,addFiles,removeFile,rename,remove,clearFiles:(id:string)=>setFiles(old=>({...old,[id]:[]})),conversation,select,create,drafts,attachments,setDraft:(id:string,value:string)=>setDrafts(old=>({...old,[id]:value})),setAttachments:(id:string,value:string[])=>setAttachments(old=>({...old,[id]:value}))}
}
export type ChatController=ReturnType<typeof useChat>
