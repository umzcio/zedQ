import * as React from 'react'
import {HoverCard as HoverCardPrimitive} from 'radix-ui'
import {cn} from '../lib/utils'
export const HoverCard=HoverCardPrimitive.Root
export const HoverCardTrigger=HoverCardPrimitive.Trigger
export function HoverCardContent({className,align='start',sideOffset=7,...props}:React.ComponentProps<typeof HoverCardPrimitive.Content>){
 return <HoverCardPrimitive.Portal><HoverCardPrimitive.Content data-slot="hover-card-content" align={align} sideOffset={sideOffset} className={cn('zq-popover-content z-50 rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95 motion-reduce:animate-none',className)} {...props}/></HoverCardPrimitive.Portal>
}
