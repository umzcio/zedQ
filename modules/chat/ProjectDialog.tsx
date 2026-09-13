import { useRef, useState } from 'react'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@zq/ui'
import { Button } from '@zq/ui'
import { Input } from '@zq/ui'
import { Textarea,SelectField,Checkbox } from '@zq/ui'
import ConnectorPicker from './ConnectorPicker'
import {useHost} from '@zq/module-api'
import {useToolOptions} from './ChatTools'
import {preferredModel,modelName} from './model-presentation'
import type { ChatProject,ModelChoice,ChatToolKind } from '@zq/module-api'
import type { ChatController } from './useChat'

export function ProjectDialog({ project, remove=false, renameOnly=false, closing, chat, onClose }: {project?:ChatProject;remove?:boolean;renameOnly?:boolean;closing:boolean;chat:ChatController;onClose:()=>void}) {
 const {openSettings}=useHost()
 const [connectorIds,setConnectorIds]=useState<string[]>(project?.connectorIds??[])
 const [name,setName]=useState(project?.name??''),[instructions,setInstructions]=useState(project?.instructions??'')
 const [busy,setBusy]=useState(false),[error,setError]=useState('')
 const [defaultModel,setDefaultModel]=useState<ModelChoice|null>(project?.defaultModel??null),[defaultTools,setDefaultTools]=useState<ChatToolKind[]>(project?.defaultTools??[])
 const {options,ready,error:toolError}=useToolOptions(defaultModel??preferredModel(chat.state.connections,chat.state.defaultModel))
 const modelOptions=chat.state.connections.flatMap(connection=>connection.enabledModels.map(model=>({value:JSON.stringify({connectionId:connection.id,model}),label:`${modelName(model,connection.modelLabels)} · ${connection.name}`})))
 if(defaultModel&&!modelOptions.some(option=>option.value===JSON.stringify(defaultModel)))modelOptions.push({value:JSON.stringify(defaultModel),label:`${defaultModel.model} (current default)`})
 const savedProjectId=useRef(project?.id)
 const lock=useRef(false),cancel=useRef<HTMLButtonElement>(null),input=useRef<HTMLInputElement>(null)
 const blocked=closing||busy
 async function save(){
  if(blocked||lock.current)return;lock.current=true;setBusy(true);setError('')
  try{if(remove&&project)await chat.deleteProject(project.id);else{const saved=await chat.saveProject({id:savedProjectId.current,name,...(renameOnly?{}:{instructions})});savedProjectId.current=saved.id;if(!renameOnly)await chat.updateProject({id:saved.id,defaultModel,connectorIds,defaultTools:defaultTools.filter(tool=>options.some(option=>option.kind===tool))})}onClose()}
  catch(e){setError((e as Error).message)}finally{lock.current=false;setBusy(false)}
 }
 return <Dialog open onOpenChange={open=>{if(!open&&!blocked)onClose()}}><DialogContent className="project-dialog" showCloseButton={!blocked} onOpenAutoFocus={e=>{e.preventDefault();if(remove)cancel.current?.focus();else{input.current?.focus();input.current?.select()}}}>
  <DialogTitle>{remove?'Delete project?':renameOnly?'Rename project':project?'Project settings':'New project'}</DialogTitle>
  <DialogDescription>{remove?'The project’s files and instructions will be removed. Its conversations will stay in All chats.':'Give related conversations a shared home, with files and instructions they can use.'}</DialogDescription>
  <form onSubmit={e=>{e.preventDefault();void save()}}>
   {!remove&&<><label htmlFor="project-name">Name</label><Input ref={input} id="project-name" aria-label="Project name" maxLength={256} value={name} disabled={blocked} onChange={e=>setName(e.target.value)} placeholder="What are you working on?"/>
    {!renameOnly&&<><label htmlFor="project-instructions">Instructions</label><Textarea id="project-instructions" aria-label="Project instructions" maxLength={16000} value={instructions} disabled={blocked} onChange={e=>setInstructions(e.target.value)} placeholder="Tell zQ what this project is about and how you’d like it to respond."/><div className="project-default-controls"><label>Default model</label><SelectField tooltip="Choose the starting model for new chats in this project; changing it resets the default tools" label="Project default model" value={defaultModel?JSON.stringify(defaultModel):''} onValueChange={value=>{setDefaultModel(value?JSON.parse(value):null);setDefaultTools([])}} disabled={blocked} options={[{value:'',label:'Use workspace default'},...modelOptions]}/>{options.length>0&&<div><label>Default tools</label>{options.map(option=><label key={option.kind} className="chat-tool-option"><Checkbox aria-label={`Use ${option.label} by default`} tooltip={`${defaultTools.includes(option.kind) ? 'Turn off' : 'Enable'} ${option.label} by default for new project chats. ${option.description}`} disabled={blocked} checked={defaultTools.includes(option.kind)} onCheckedChange={checked=>setDefaultTools(old=>checked===true?[...old,option.kind]:old.filter(tool=>tool!==option.kind))}/><span>{option.label}</span></label>)}</div>}<label>Connectors</label><ConnectorPicker connectors={chat.connectors} selected={connectorIds} disabled={blocked||chat.connectorsLoading} onChange={ids=>setConnectorIds(ids??[])} onManage={()=>{onClose();openSettings?.('connectors')}}/><p>Defaults apply to new conversations. You can choose another model or tools for an individual chat.</p>{toolError&&<p role="alert">{toolError}</p>}</div></>}
   </>}
   {error&&<p className="chat-action-error" role="alert">{error}</p>}
   <div className="dialog-actions"><Button ref={cancel} type="button" variant="ghost" disabled={blocked} onClick={onClose}>Cancel</Button><Button tooltip={remove ? 'Delete this project’s files and instructions; keep its chats in All chats' : !name.trim() ? 'Enter a project name to continue' : !renameOnly && !ready ? 'Wait for the model’s available tools to load' : !renameOnly && toolError ? 'Resolve the tool-loading error before saving' : renameOnly ? 'Save the new project name' : project ? 'Save shared instructions and defaults for new chats' : 'Create a project with shared instructions and chat defaults'} type="submit" variant={remove?'destructive':'default'} className={remove?'chat-delete-confirm':'primary-button'} disabled={blocked||!remove&&(!name.trim()||!renameOnly&&(!ready||!!toolError))}>{busy?'Saving…':remove?'Delete project':renameOnly?'Rename':project?'Save changes':'Create project'}</Button></div>
  </form>
 </DialogContent></Dialog>
}

