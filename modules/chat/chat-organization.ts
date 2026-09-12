import type {Conversation,ChatProject} from '@zq/module-api'
export type ConversationScope='active'|'archived'|'trash'
export function inConversationScope(c:Conversation,scope:ConversationScope){return scope==='trash'?!!c.deletedAt:scope==='archived'?!!c.archivedAt&&!c.deletedAt:!c.archivedAt&&!c.deletedAt}
export function pinnedFirst<T extends {pinned?:boolean}>(items:T[]):T[]{return items.map((item,index)=>({item,index})).sort((a,b)=>Number(!!b.item.pinned)-Number(!!a.item.pinned)||a.index-b.index).map(({item})=>item)}
export type ConversationMatch={messageId?:string;versionId?:string;snippet?:string}
export function conversationMatch(c:Conversation,query:string):ConversationMatch|null{
 const needle=query.trim().toLocaleLowerCase();if(!needle||c.title.toLocaleLowerCase().includes(needle))return {}
 for(const message of c.messages){for(const candidate of [{id:undefined,content:message.content},...(message.versions??[]).filter(v=>v.id!==message.activeVersionId)]){const index=candidate.content.toLocaleLowerCase().indexOf(needle);if(index<0)continue;const start=Math.max(0,index-35),end=Math.min(candidate.content.length,index+needle.length+85);return {messageId:message.id,versionId:candidate.id,snippet:`${start?'…':''}${candidate.content.slice(start,end).replace(/\s+/g,' ')}${end<candidate.content.length?'…':''}`}}}
 return null
}
export function scopedChats(conversations:Conversation[],scope:ConversationScope,projectId:string|null,query=''){return pinnedFirst(conversations.filter(c=>(c.projectId??null)===projectId&&inConversationScope(c,scope)&&conversationMatch(c,query)!==null))}
export function orderedProjects(projects:ChatProject[]){return pinnedFirst(projects)}
