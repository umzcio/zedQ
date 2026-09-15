import type {Note} from './data'
const timestamp=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:0
export const noteActivity=(note:Note)=>Math.max(timestamp(note.updated),timestamp(note.openedAt))
export function recentNotes(notes:Note[]){return notes.slice().sort((a,b)=>noteActivity(b)-noteActivity(a))}
export function resumeNote(notes:Note[],selectedId?:string){const recent=recentNotes(notes);return recent[0]&&noteActivity(recent[0])?recent[0]:notes.find(n=>n.id===selectedId)??recent[0]}
export function noteUpdatedLabel(value:unknown,now=Date.now()){
 if(typeof value!=='number'||!Number.isFinite(value)||value<0)return 'Saved note'
 const seconds=Math.max(0,Math.floor((now-value)/1000));if(seconds<60)return 'Just now'
 const minutes=Math.floor(seconds/60);if(minutes<60)return `${minutes} ${minutes===1?'minute':'minutes'} ago`
 const hours=Math.floor(minutes/60);if(hours<24)return `${hours} ${hours===1?'hour':'hours'} ago`
 const days=Math.floor(hours/24);if(days<7)return `${days} ${days===1?'day':'days'} ago`
 return new Date(value).toLocaleDateString(undefined,{month:'short',day:'numeric',year:new Date(now).getFullYear()!==new Date(value).getFullYear()?'numeric':undefined})
}
