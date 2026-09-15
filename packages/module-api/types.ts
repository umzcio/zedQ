import type { ComponentType } from 'react'
export type View = 'HQ' | 'Notes' | 'Tasks' | 'Settings' | 'Chat' | 'Code'
export type ModuleManifest = {id:string;version:string;apiVersion:1;title:string;view:Exclude<View,'Settings'>;icon:'home'|'notes'|'tasks'|'chat'|'code';capabilities:string[]}
export type ModuleDefinition = {Root:ComponentType}
export type ModuleRuntime = {manifest:ModuleManifest;code:string;css:string;source:'bundled'|'installed';error?:string}
export type ModuleStatus = {id:string;title:string;version:string;bundledVersion:string;pendingVersion:string|null;previousVersion:string|null;source:string;error?:string}
