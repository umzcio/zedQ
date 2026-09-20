export type Pane = { tabs: string[]; active: string };
export type WorkbenchLayout = { panes: Pane[]; focus: number; shown: boolean; axis: 'columns' | 'rows'; ratio: number };
export const emptyLayout = (): WorkbenchLayout => ({panes:[{tabs:[],active:''}],focus:0,shown:false,axis:'columns',ratio:50});
export function restoreLayout(raw: unknown, legacy = ''): WorkbenchLayout {
  if (!raw || typeof raw !== 'object') return legacy ? openTab(emptyLayout(),legacy) : emptyLayout();
  const input=raw as Partial<WorkbenchLayout>, seen=new Set<string>();
  const panes=(Array.isArray(input.panes)?input.panes:[]).slice(0,2).map(p=>{
    const tabs=(Array.isArray(p?.tabs)?p.tabs:[]).filter((id:unknown):id is string=>typeof id==='string'&&id.length>0&&id.length<200&&!seen.has(id)&&!!seen.add(id)).slice(0,100);
    return {tabs,active:tabs.includes(p.active)?p.active:tabs[0]||''};
  });
  if(!panes.length)return emptyLayout();
  return {panes,focus:input.focus===1&&panes.length===2?1:0,shown:input.shown===true,axis:input.axis==='rows'?'rows':'columns',ratio:typeof input.ratio==='number'&&Number.isFinite(input.ratio)?Math.max(20,Math.min(80,input.ratio)):50};
}
export function openTab(layout:WorkbenchLayout,id:string):WorkbenchLayout {
  if(!id)return {...layout,shown:false};
  const existing=layout.panes.findIndex(p=>p.tabs.includes(id)),focus=existing<0?layout.focus:existing;
  return {...layout,shown:true,focus,panes:layout.panes.map((p,i)=>i===focus?{tabs:p.tabs.includes(id)?p.tabs:[...p.tabs,id],active:id}:p)};
}
export function closeTab(layout:WorkbenchLayout,id:string):WorkbenchLayout {
  let panes=layout.panes.map(p=>{const index=p.tabs.indexOf(id),tabs=p.tabs.filter(t=>t!==id);return {tabs,active:p.active===id?tabs[Math.max(0,index-1)]||'':p.active};});
  let focus=layout.focus;
  if(panes.length===2&&panes.some(p=>!p.tabs.length)){panes=panes.filter(p=>p.tabs.length);focus=0;}
  if(!panes.length)panes=[{tabs:[],active:''}];
  return {...layout,panes,focus,shown:panes.some(p=>p.tabs.length)&&layout.shown};
}
export function splitLayout(layout:WorkbenchLayout,axis:WorkbenchLayout['axis']):WorkbenchLayout {
  if(layout.panes.length===2)return {...layout,axis,shown:true};
  const pane=layout.panes[0],other=pane.tabs.find(id=>id!==pane.active);
  return {...layout,axis,shown:true,ratio:50,panes:[{...pane,tabs:pane.tabs.filter(id=>id!==other)},{tabs:other?[other]:[],active:other||''}]};
}
export function moveTab(layout:WorkbenchLayout,id:string,target:number):WorkbenchLayout {
  let next=layout.panes.length===1?splitLayout(layout,layout.axis):layout;
  target=target===1?1:0;
  const panes=next.panes.map((p,i)=>{const tabs=p.tabs.filter(t=>t!==id);return i===target?{tabs:[...tabs,id],active:id}:{tabs,active:p.active===id?tabs[0]||'':p.active};});
  return {...next,panes,focus:target,shown:true};
}
export function mergePanes(layout:WorkbenchLayout):WorkbenchLayout {
  const active=layout.panes[layout.focus].active,tabs=layout.panes.flatMap(p=>p.tabs);
  return {...layout,focus:0,panes:[{tabs,active:active||tabs[0]||''}]};
}
