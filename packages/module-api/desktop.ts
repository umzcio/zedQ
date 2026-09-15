import type {ConnectorBridge} from './connector-types'
import type {ArtifactBridge} from './artifact-types'
import type {VoiceBridge} from './voice-types'
import type { ChatBridge, AttachmentBridge } from './chat-types'
import type { Note, Task } from './data'
import type { View, ModuleRuntime, ModuleStatus } from './types'
export type WorkspaceState = {
 notes: Note[]; tasks: Task[]; theme: 'light'|'dark'|'system'; palette: 'green'|'blue'|'red'|'gunmetal';
 layout: {view: View; selectedNote: string; tabs: string[]; tabOrder?: string[]; sidebar: boolean; split: boolean; quickCapture: string; activeFileId: string|null}
}
export type FileDocument = {id:string;path:string;name:string;body:string;savedBody:string;fingerprint:string;warning?:string}
export type Result<T> = {ok:true;value:T}|{ok:false;error:{code:string;message:string}}
export type DesktopBridge = {
 platform:string;
 clipboard:{writeText:(text:string)=>Promise<Result<null>>};
 modules:{runtime:()=>Promise<Result<ModuleRuntime[]>>;list:()=>Promise<Result<ModuleStatus[]>>;install:()=>Promise<Result<ModuleStatus|null>>;download:(url:string)=>Promise<Result<ModuleStatus>>;rollback:(id:string)=>Promise<Result<ModuleStatus>>;recover:(id:string,version:string)=>Promise<Result<ModuleRuntime>>};
 attachments:AttachmentBridge;
 chat:ChatBridge;
 connectors:ConnectorBridge;
 voice:VoiceBridge;
 artifacts:ArtifactBridge;
 workspace:{saveDraftCopy:(input:{name:string;text:string})=>Promise<Result<boolean>>;load:()=>Promise<Result<WorkspaceState|null>>;save:(state:WorkspaceState)=>Promise<Result<null>>};
 files:{list:()=>Promise<Result<FileDocument[]>>;open:()=>Promise<Result<FileDocument|null>>;edit:(id:string,body:string)=>Promise<Result<FileDocument>>;save:(id:string)=>Promise<Result<FileDocument>>;saveAs:(id:string)=>Promise<Result<FileDocument|null>>;reload:(id:string)=>Promise<Result<FileDocument|null>>};
 onCommand:(callback:(command:string)=>void)=>()=>void;
 onCloseRequested:(callback:(id:string)=>void)=>()=>void;
 onCloseCancelled:(callback:(id:string)=>void)=>()=>void;
 finishClose:(id:string,error?:string)=>void;
}
declare global { interface Window {zq:DesktopBridge} }
export async function unwrap<T>(result:Promise<Result<T>>):Promise<T> {
 const response=await result
 if(!response.ok) throw Object.assign(new Error(response.error.message),{code:response.error.code})
 return response.value
}
export function freshWorkspace():WorkspaceState {
 const id=crypto.randomUUID()
 return {notes:[{id,title:'Untitled',body:'',project:'',updated:Date.now(),pinned:false}],tasks:[],theme:'system',palette:'green',layout:{view:'Notes',selectedNote:id,tabs:[id],sidebar:true,split:false,quickCapture:'',activeFileId:null}}
}
