import * as React from 'react'
import { Collapsible as CollapsiblePrimitive } from 'radix-ui'
import {ControlTooltip,controlText} from './tooltip'
import { cn } from '../lib/utils'
export const Collapsible=CollapsiblePrimitive.Root
export function CollapsibleTrigger({tooltip,title,...props}:React.ComponentProps<typeof CollapsiblePrimitive.Trigger>&{tooltip?:React.ReactNode}){return <ControlTooltip content={tooltip??title??props['aria-label']??controlText(props.children)}><CollapsiblePrimitive.Trigger {...props}/></ControlTooltip>}
export function CollapsibleContent({className,...props}:React.ComponentProps<typeof CollapsiblePrimitive.Content>){
 return <CollapsiblePrimitive.Content data-slot="collapsible-content" className={cn('zq-collapsible-content overflow-hidden',className)} {...props}/>
}
