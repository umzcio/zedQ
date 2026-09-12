import * as React from 'react'
import { Tooltip as Primitive, Slot } from 'radix-ui'

const SharedProvider = React.createContext<React.RefObject<boolean>|null>(null)
export function TooltipProvider({children}: {children: React.ReactNode}) {
 // Menus restore focus programmatically after pointer selection. That focus
 // should not reopen help; actual keyboard navigation should.
 const keyboard=React.useRef(false)
 React.useEffect(()=>{
  const onPointerDown=()=>{keyboard.current=false}
  const onKeyDown=(event:KeyboardEvent)=>{if(!['Shift','Control','Alt','Meta'].includes(event.key))keyboard.current=true}
  document.addEventListener('pointerdown',onPointerDown,true)
  document.addEventListener('keydown',onKeyDown,true)
  return()=>{document.removeEventListener('pointerdown',onPointerDown,true);document.removeEventListener('keydown',onKeyDown,true)}
 },[])
 return <SharedProvider.Provider value={keyboard}><Primitive.Provider delayDuration={450} skipDelayDuration={300}>{children}</Primitive.Provider></SharedProvider.Provider>
}

// Read visible text to distinguish labeled controls from icon-only controls.
// Never inspect a component's implementation.
export function controlText(children: React.ReactNode): string {
 return React.Children.toArray(children).map(child => {
  if(typeof child==='string'||typeof child==='number')return String(child)
  if(React.isValidElement<{children?:React.ReactNode;'aria-hidden'?:boolean|string}>(child)&&child.props['aria-hidden']!==true&&child.props['aria-hidden']!=='true')return controlText(child.props.children)
  return ''
 }).filter(Boolean).join(' ').replace(/\s+/g,' ').trim()
}

type Content = React.ReactNode | false
type ChildProps = {disabled?:boolean;title?:string;'aria-label'?:string;'aria-expanded'?:boolean|string;'aria-haspopup'?:boolean|string;children?:React.ReactNode}
export function ControlTooltip({content,children,side='top'}:{content?:Content;children:React.ReactElement;side?:'top'|'right'|'bottom'|'left'}) {
 const shared=React.useContext(SharedProvider)
 if(content===false||content===undefined||content===null||content==='')return children
 const body=<TooltipBody content={content} side={side}>{children}</TooltipBody>
 return shared?body:<TooltipProvider>{body}</TooltipProvider>
}
// Tooltip's trigger state must not overwrite a Checkbox/Select/Collapsible's
// own state when Radix composes the two primitives through asChild.
const TooltipAnchor=React.forwardRef<HTMLElement,React.ComponentProps<typeof Slot.Root>>(function TooltipAnchor(props,ref){
 const {'data-state':_tooltipState,...rest}=props as React.ComponentProps<typeof Slot.Root>&{'data-state'?:string}
 return <Slot.Root {...rest} ref={ref}/>
})
function TooltipBody({content,children,side}:{content:React.ReactNode;children:React.ReactElement;side:'top'|'right'|'bottom'|'left'}) {
 const keyboard=React.useContext(SharedProvider)
 const [open,setOpen]=React.useState(false)
 const leaveTimer=React.useRef<ReturnType<typeof setTimeout>|undefined>(undefined)
 const cancelLeave=React.useCallback(()=>{clearTimeout(leaveTimer.current);leaveTimer.current=undefined},[])
 const close=React.useCallback(()=>{cancelLeave();setOpen(false)},[cancelLeave])
 // Radix's hover corridor has no timeout. Stopping in the gap can otherwise
 // leave help visible forever. Still allow crossing into the text to read it.
 const scheduleLeave=()=>{cancelLeave();leaveTimer.current=setTimeout(close,120)}
 React.useEffect(()=>cancelLeave,[cancelLeave])
 React.useEffect(()=>{
  if(!open)return
  const onVisibilityChange=()=>{if(document.hidden)close()}
  window.addEventListener('blur',close)
  document.addEventListener('visibilitychange',onVisibilityChange)
  return()=>{window.removeEventListener('blur',close);document.removeEventListener('visibilitychange',onVisibilityChange)}
 },[open,close])
 const props=(children as React.ReactElement<ChildProps>).props
 const expanded=!!props['aria-haspopup']&&(props['aria-expanded']===true||props['aria-expanded']==='true')
 const target=React.cloneElement(children as React.ReactElement<ChildProps>,{title:undefined})
 return <Primitive.Root open={open&&!expanded} onOpenChange={next=>{cancelLeave();setOpen(next)}}>
  <Primitive.Trigger asChild onPointerEnter={cancelLeave} onPointerLeave={scheduleLeave} onPointerCancel={close} onFocus={event=>{if(!keyboard?.current)event.preventDefault()}}><TooltipAnchor>{props.disabled?
   <span className="zq-tooltip-disabled" tabIndex={0} aria-label={props['aria-label']??controlText(props.children)} aria-disabled="true">{target}</span>:target}
  </TooltipAnchor></Primitive.Trigger>
  <Primitive.Portal><Primitive.Content onPointerEnter={cancelLeave} onPointerLeave={scheduleLeave} onPointerCancel={close} side={side} sideOffset={7} collisionPadding={10} className="zq-tooltip" data-slot="tooltip-content">{content}</Primitive.Content></Primitive.Portal>
 </Primitive.Root>
}

export type TooltipButtonProps = React.ComponentProps<'button'> & {tooltip?:Content}
export const TooltipButton=React.forwardRef<HTMLButtonElement,TooltipButtonProps>(function TooltipButton({tooltip,title,children,...props},ref){
 const content=tooltip??title??(controlText(children)?undefined:props['aria-label'])
 return <ControlTooltip content={content}><button {...props} ref={ref}>{children}</button></ControlTooltip>
})
export const TooltipLink=React.forwardRef<HTMLAnchorElement,React.ComponentProps<'a'>&{tooltip?:Content}>(function TooltipLink({tooltip,title,children,...props},ref){
 const content=tooltip??title??(controlText(children)?undefined:props['aria-label'])
 return <ControlTooltip content={content}><a {...props} ref={ref}>{children}</a></ControlTooltip>
})
