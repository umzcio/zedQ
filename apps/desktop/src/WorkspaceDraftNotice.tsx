import {useEffect,useState} from 'react'
import {Button,Dialog,DialogContent,DialogTitle,DialogDescription} from '@zq/ui'
import {unwrap,type WorkspaceDraftIssue} from '@zq/module-api'

export default function WorkspaceDraftNotice({issues,onReview,closing}:{issues:WorkspaceDraftIssue[];onReview:(issue:WorkspaceDraftIssue)=>void;closing:boolean}){
 const[open,setOpen]=useState(false),[error,setError]=useState(''),[saving,setSaving]=useState(false)
 useEffect(()=>{if(!issues.length){setOpen(false);setError('')}},[issues.length])
 if(!issues.length)return null
 async function saveCopy(issue:WorkspaceDraftIssue){setSaving(true);setError('');try{const unicodeSafe=new TextDecoder('utf-8',{ignoreBOM:true}).decode(new TextEncoder().encode(issue.text))===issue.text;await unwrap(window.zq.workspace.saveDraftCopy({name:`${issue.kind}-${issue.field}-draft.${unicodeSafe?'txt':'json'}`,text:unicodeSafe?issue.text:JSON.stringify({text:issue.text},null,2)}))}catch(e){setError((e as Error).message)}finally{setSaving(false)}}
 return <><div className="workspace-draft-notice" role="alert"><span>{issues.length===1?'One edit cannot be saved.':`${issues.length} edits cannot be saved.`} Other valid changes still save.</span><Button size="sm" variant="ghost" disabled={closing} onClick={()=>setOpen(true)}>Review edits</Button></div><Dialog open={open} onOpenChange={setOpen}><DialogContent className="workspace-draft-dialog"><DialogTitle>Edits need attention</DialogTitle><DialogDescription>The full text is still in this open workspace. Correct these edits before closing zQ, or save a copy and then remove the unsaved text. Saving a copy does not change the edit.</DialogDescription><div className="workspace-draft-list">{issues.map(issue=><div className="workspace-draft-item" key={issue.key}><strong>{issue.label}</strong><p>{issue.message}</p><div><Button size="sm" variant="outline" disabled={closing||saving} onClick={()=>{setOpen(false);onReview(issue)}}>Go to edit</Button><Button size="sm" variant="ghost" disabled={closing||saving} onClick={()=>void saveCopy(issue)}>Save a copy…</Button></div></div>)}</div>{error&&<p role="alert">{error}</p>}</DialogContent></Dialog></>
}
