import type {ArtifactReference} from './artifact-types'
export type Note = {artifacts?:ArtifactReference[];id:string;title:string;body:string;project:string;updated:string;pinned:boolean}
export const columns = ['Inbox','Next','Doing','Waiting','Done'] as const
export type Status = typeof columns[number]
export type Task = {artifacts?:ArtifactReference[];id:string;title:string;description:string;project:string;status:Status;priority:'Normal'|'High';noteId?:string}
export const projects = ['zQ','llm-img','zBrain']
