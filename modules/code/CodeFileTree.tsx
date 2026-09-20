import {useEffect, useRef, useState} from 'react';
import {useHost, type CodeFileEntry, type CodeWorkspaceTarget} from '@zq/module-api';
import {CaretRight, FolderSimple, File} from '@phosphor-icons/react';
import {ItemMenu, MoreMenu, type Action} from './CodeManagement';
import type {TransferActivation} from './TransferCompletion';
import {codeError} from './errors';

type Listing = {entries: CodeFileEntry[]; truncated: boolean};
export function CodeFileTree({target, rootPath, local, reload, selected, onOpen, onUpload, onDownload, transferring}: {
  target: CodeWorkspaceTarget; rootPath: string; local: boolean; reload: number;
  selected?: string; onOpen: (path: string) => void;
  onUpload:(path:string,activation?:TransferActivation)=>void; onDownload:(path:string,activation?:TransferActivation)=>void; transferring:boolean;
}) {
  const host=useHost(), bridge=host.services.code;
  const [folders,setFolders]=useState<Record<string,Listing>>({});
  const [expanded,setExpanded]=useState<Set<string>>(new Set(['']));
  const [loading,setLoading]=useState<Set<string>>(new Set());
  const [errors,setErrors]=useState<Record<string,string>>({});
  const generation=useRef(0), serials=useRef(new Map<string,number>()), expandedRef=useRef(expanded);
  expandedRef.current=expanded;
  async function load(path: string, token=generation.current) {
    const serial=(serials.current.get(path)||0)+1;serials.current.set(path,serial);
    setLoading(old=>new Set(old).add(path));setErrors(old=>({...old,[path]:''}));
    try {
      const result=await bridge.invoke('listFiles',{...target,path});
      if(token===generation.current && serials.current.get(path)===serial)setFolders(old=>({...old,[path]:result}));
    } catch(error) {
      if(token===generation.current && serials.current.get(path)===serial)setErrors(old=>({...old,[path]:codeError(error)}));
    } finally {
      if(token===generation.current && serials.current.get(path)===serial)setLoading(old=>{const next=new Set(old);next.delete(path);return next});
    }
  }
  useEffect(()=>{
    const token=++generation.current;
    setLoading(new Set());
    for(const path of expandedRef.current)void load(path,token);
    return ()=>{generation.current++};
  },[bridge,target,reload]);
  function toggle(path: string) {
    const opening=!expanded.has(path);
    setExpanded(old=>{const next=new Set(old);if(opening)next.add(path);else next.delete(path);return next});
    if(opening && !folders[path])void load(path);
  }
  const copy=(value: string)=>void host.services.clipboard.writeText(value);
  function actions(entry: CodeFileEntry): Action[] {
    return [
      {label:entry.kind==='directory'?(expanded.has(entry.path)?'Collapse folder':'Expand folder'):'Open file',disabled:entry.kind==='symlink',run:()=>entry.kind==='directory'?toggle(entry.path):onOpen(entry.path)},
      ...(entry.kind==='directory'?[{label:'Upload files…',disabled:transferring,run:(activation?:TransferActivation)=>onUpload(entry.path,activation)}]:entry.kind==='file'?[{label:'Download…',disabled:transferring,run:(activation?:TransferActivation)=>onDownload(entry.path,activation)}]:[]),
      {label:'Copy relative path',run:()=>copy(entry.path)},
      {label:'Copy full path',run:()=>copy(rootPath.replace(/\/$/,'')+'/'+entry.path)},
      ...(entry.kind==='directory'?[{label:'Refresh folder',run:()=>{setExpanded(old=>new Set(old).add(entry.path));void load(entry.path)}}]:[]),
      ...(local && target.projectId && [{label:'Reveal in Finder',run:()=>void bridge.invoke('revealFile',{projectId:target.projectId!,path:entry.path}).catch(error=>setErrors(old=>({...old,'':codeError(error)})))}] || []),
    ];
  }
  function renderFolder(path: string, depth: number): React.ReactNode {
    const listing=folders[path];
    return <div className="code-file-branch">
      {loading.has(path)&&<p className="code-tree-message" role="status">Loading…</p>}
      {errors[path]&&<div className="code-tree-message" role="alert">{errors[path]} <button onClick={()=>void load(path)}>Retry</button></div>}
      {listing && [...listing.entries].sort((a,b)=>Number(b.kind==='directory')-Number(a.kind==='directory')||a.name.localeCompare(b.name)).map(entry=><div key={entry.path}>
        <ItemMenu actions={actions(entry)}><div className={`code-file-row ${selected===entry.path?'selected':''}`} style={{paddingLeft:depth*14}}>
          <button disabled={entry.kind==='symlink'} aria-expanded={entry.kind==='directory'?expanded.has(entry.path):undefined} aria-label={`${entry.kind==='directory'?'Folder':'File'} ${entry.path}`} onClick={()=>entry.kind==='directory'?toggle(entry.path):onOpen(entry.path)}>
            {entry.kind==='directory'?<><CaretRight size={12} className={expanded.has(entry.path)?'expanded':''}/><FolderSimple size={16}/></>:<><span className="code-tree-indent"/><File size={16}/></>}
            <span>{entry.name}</span>{entry.kind==='symlink'&&<small>symlink</small>}
          </button><MoreMenu label={`Actions for ${entry.path}`} actions={actions(entry)}/>
        </div></ItemMenu>
        {entry.kind==='directory'&&expanded.has(entry.path)&&renderFolder(entry.path,depth+1)}
      </div>)}
      {listing&&!listing.entries.length&&!loading.has(path)&&!errors[path]&&<p className="code-tree-message" style={{paddingLeft:depth*14+8}}>Empty folder</p>}
      {listing?.truncated&&<p className="code-tree-message">More files exist; this listing is limited.</p>}
    </div>;
  }
  return <div className="code-file-tree" aria-label="File explorer">{renderFolder('',0)}</div>;
}
