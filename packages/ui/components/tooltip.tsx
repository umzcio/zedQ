import * as React from 'react'
import { Tooltip as Primitive, Slot } from 'radix-ui'

const SharedProvider = React.createContext(false)
export function TooltipProvider({children}: {children: React.ReactNode}) {
 return <SharedProvider.Provider value={true}><Primitive.Provider delayDuration={450} skipDelayDuration={300}>{children}</Primitive.Provider></SharedProvider.Provider>
}

// Visible text is a conservative fallback. Explicit copy should explain actions
// whose label alone is ambiguous. Never inspect a component's implementation.
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
 const [open,setOpen]=React.useState(false)
 const props=(children as React.ReactElement<ChildProps>).props
 const expanded=!!props['aria-haspopup']&&(props['aria-expanded']===true||props['aria-expanded']==='true')
 const target=React.cloneElement(children as React.ReactElement<ChildProps>,{title:undefined})
 return <Primitive.Root open={open&&!expanded} onOpenChange={setOpen}>
  <Primitive.Trigger asChild><TooltipAnchor>{props.disabled?
   <span className="zq-tooltip-disabled" tabIndex={0} aria-label={props['aria-label']??controlText(props.children)} aria-disabled="true">{target}</span>:target}
  </TooltipAnchor></Primitive.Trigger>
  <Primitive.Portal><Primitive.Content side={side} sideOffset={7} collisionPadding={10} className="zq-tooltip" data-slot="tooltip-content">{content}</Primitive.Content></Primitive.Portal>
 </Primitive.Root>
}

export type TooltipButtonProps = React.ComponentProps<'button'> & {tooltip?:Content}
export const TooltipButton=React.forwardRef<HTMLButtonElement,TooltipButtonProps>(function TooltipButton({tooltip,title,children,...props},ref){
 const content=tooltip??title??props['aria-label']??controlText(children)
 return <ControlTooltip content={content}><button {...props} ref={ref}>{children}</button></ControlTooltip>
})
export const TooltipLink=React.forwardRef<HTMLAnchorElement,React.ComponentProps<'a'>&{tooltip?:Content}>(function TooltipLink({tooltip,title,children,...props},ref){
 const content=tooltip??title??props['aria-label']??controlText(children)
 return <ControlTooltip content={content}><a {...props} ref={ref}>{children}</a></ControlTooltip>
})
