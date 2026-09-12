export type TabState = {order:string[];active:string|null}
export type CloseMode = 'one'|'others'|'right'|'all'
type SavedTabs = {tabOrder?:string[];tabs?:string[];selectedNote?:string|null;activeFileId?:string|null}

export function restoreTabState(saved:SavedTabs, notes:string[], files:string[]):TabState {
 const available=new Set([...notes.map(id=>`note:${id}`),...files.map(id=>`file:${id}`)])
 const candidates=saved.tabOrder??[...files.map(id=>`file:${id}`),...(saved.tabs??notes.slice(0,1)).map(id=>`note:${id}`)]
 const order=[...new Set(candidates)].filter(key=>available.has(key))
 const selected=saved.activeFileId?`file:${saved.activeFileId}`:`note:${saved.selectedNote??''}`
 return {order,active:order.includes(selected)?selected:order[0]??null}
}
export function openTab(state:TabState,key:string):TabState {
 return {order:state.order.includes(key)?state.order:[...state.order,key],active:key}
}
export function closeTabs(state:TabState,key:string,mode:CloseMode):TabState {
 const index=state.order.indexOf(key)
 if(index<0)return state
 const order=state.order.filter((id,i)=>mode==='one'?id!==key:mode==='others'?id===key:mode==='right'?i<=index:false)
 const active=state.active&&order.includes(state.active)?state.active:order[Math.min(state.order.indexOf(state.active??''),order.length-1)]??order[0]??null
 return {order,active}
}
export function moveTab(state:TabState,key:string,target:string,side:'before'|'after'):TabState {
 if(key===target||!state.order.includes(key)||!state.order.includes(target))return state
 const order=state.order.filter(id=>id!==key)
 order.splice(order.indexOf(target)+(side==='after'?1:0),0,key)
 return {...state,order}
}
