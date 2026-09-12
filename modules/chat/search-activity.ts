import type {ChatToolActivity} from '@zq/module-api'
export function searchActivitySummary(tools:ChatToolActivity[]=[]){
 const searches=tools.filter(t=>t.kind==='web_search'||t.kind==='x_search')
 if(!searches.length)return null
 const running=searches.some(t=>t.status==='running'),complete=searches.some(t=>t.status==='complete'),failed=searches.some(t=>t.status==='error'),stopped=searches.some(t=>t.status==='stopped'),interrupted=searches.some(t=>t.status==='interrupted')
 const web=searches.some(t=>t.kind==='web_search'),x=searches.some(t=>t.kind==='x_search'),where=web&&x?'web and X':x?'X':'the web'
 const label=running?`Searching ${where}`:failed?(complete?'Search finished with errors':'Search failed'):stopped?'Search stopped':interrupted?'Search interrupted':`Searched ${where}`
 return {firstId:searches[0].id,count:searches.length,label,running,searches}
}
