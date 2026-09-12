import * as React from 'react'
import { Popover as PopoverPrimitive } from 'radix-ui'
import { cn } from '../lib/utils'
export const Popover=PopoverPrimitive.Root
export const PopoverTrigger=PopoverPrimitive.Trigger
export function PopoverContent({className,align='center',sideOffset=6,...props}:React.ComponentProps<typeof PopoverPrimitive.Content>){
 return <PopoverPrimitive.Portal><PopoverPrimitive.Content data-slot="popover-content" align={align} sideOffset={sideOffset} className={cn('zq-popover-content z-50 rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1 motion-reduce:animate-none',className)} {...props}/></PopoverPrimitive.Portal>
}
