import {useLayoutEffect,useRef,type RefObject} from 'react'
import type {skillCommandRanges} from './skill-commands'
export default function SkillDraftHighlights({text,ranges,input}:{text:string;ranges:ReturnType<typeof skillCommandRanges>;input:RefObject<HTMLTextAreaElement|null>}){
 const overlay=useRef<HTMLDivElement>(null)
 useLayoutEffect(()=>{const textarea=input.current,layer=overlay.current;if(!textarea||!layer)return;const sync=()=>{layer.style.width=`${textarea.clientWidth}px`;layer.scrollTop=textarea.scrollTop;layer.scrollLeft=textarea.scrollLeft};sync();textarea.addEventListener('scroll',sync);const observer=new ResizeObserver(sync);observer.observe(textarea);return()=>{textarea.removeEventListener('scroll',sync);observer.disconnect()}},[input,text,ranges.length])
 const content=[];let end=0
 for(const range of ranges){if(range.start<end)continue;content.push(text.slice(end,range.start),<span key={`${range.start}:${range.id}`} className="skill-command-highlight">{text.slice(range.start,range.end)}</span>);end=range.end}
 content.push(text.slice(end),'\u200b')
 return <div ref={overlay} aria-hidden="true" className="skill-draft-highlights">{content}</div>
}
