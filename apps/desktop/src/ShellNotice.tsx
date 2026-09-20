import {useEffect,useLayoutEffect,useRef,useState} from 'react'

/** The caller owns the notice lifetime; this component only retains its exit. */
export default function ShellNotice({notice,action,onDismiss}:{notice:string;action?:{label:string;run:()=>void};onDismiss?:()=>void}){
 const [display,setDisplay]=useState({text:'',visible:false})
 const [reduced,setReduced]=useState(()=>matchMedia('(prefers-reduced-motion: reduce)').matches)
 const present=useRef(false),currentNotice=useRef(notice),generation=useRef(0)
 const finishExit=useRef<()=>void>(()=>{})

 useEffect(()=>{
  const media=matchMedia('(prefers-reduced-motion: reduce)')
  const update=()=>setReduced(media.matches)
  update();media.addEventListener('change',update)
  return()=>media.removeEventListener('change',update)
 },[])

 useLayoutEffect(()=>{
  currentNotice.current=notice
  const token=++generation.current
  let frame=0,nextFrame=0,timer:ReturnType<typeof setTimeout>|undefined
  finishExit.current=()=>{}
  const finish=()=>{
   if(generation.current!==token||currentNotice.current)return
   present.current=false
   setDisplay({text:'',visible:false})
  }
  if(notice){
   const entering=!present.current
   present.current=true
   setDisplay({text:notice,visible:reduced||!entering})
   if(entering&&!reduced){
    // Paint the initial opacity once. Subsequent messages reuse this DOM node.
    frame=requestAnimationFrame(()=>{
     nextFrame=requestAnimationFrame(()=>{
      if(generation.current===token&&currentNotice.current)setDisplay(old=>({...old,visible:true}))
     })
    })
   }
  }else if(present.current){
   if(reduced)finish()
   else{
    setDisplay(old=>({...old,visible:false}))
    finishExit.current=finish
    timer=setTimeout(finish,200)
   }
  }
  return()=>{
   ++generation.current
   cancelAnimationFrame(frame);cancelAnimationFrame(nextFrame)
   if(timer!==undefined)clearTimeout(timer)
   finishExit.current=()=>{}
  }
 },[notice,reduced])

 if(!display.text)return null
 return <div className="toast shell-notice" role="status" data-visible={display.visible} onTransitionEnd={event=>{
  if(event.target===event.currentTarget&&event.propertyName==='opacity'&&!currentNotice.current&&getComputedStyle(event.currentTarget).opacity==='0')finishExit.current()
 }}>{display.text}{notice&&action&&<><button type="button" onClick={()=>{action.run();onDismiss?.()}}>{action.label}</button><button type="button" aria-label="Dismiss notification" onClick={onDismiss}>×</button></>}</div>
}
