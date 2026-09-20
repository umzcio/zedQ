type Bounds={left:number;right:number;top:number;bottom:number}
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value))

// Functional drag scrolling: no easing or inertia. Integrating elapsed time
// makes a held pointer behave the same regardless of pointer-event frequency.
export function edgeScrollPosition(bounds:Bounds,current:number,maxScroll:number,pointer:{x:number;y:number},elapsedMs:number):number{
 const max=Math.max(0,maxScroll)
 if(pointer.y<bounds.top-16||pointer.y>bounds.bottom+16)return clamp(current,0,max)
 const left=clamp((bounds.left+32-pointer.x)/32,0,1)
 const right=clamp((pointer.x-(bounds.right-32))/32,0,1)
 const delta=(right-left)*480*clamp(elapsedMs,0,32)/1000
 return clamp(current+delta,0,max)
}
