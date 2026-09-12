import * as React from 'react'
import { Collapsible as CollapsiblePrimitive } from 'radix-ui'
import { cn } from '../lib/utils'
export const Collapsible=CollapsiblePrimitive.Root
export const CollapsibleTrigger=CollapsiblePrimitive.Trigger
export function CollapsibleContent({className,...props}:React.ComponentProps<typeof CollapsiblePrimitive.Content>){
 return <CollapsiblePrimitive.Content data-slot="collapsible-content" className={cn('zq-collapsible-content overflow-hidden',className)} {...props}/>
}
