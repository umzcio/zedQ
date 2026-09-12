import * as React from 'react'
import { ContextMenu as ContextMenuPrimitive } from 'radix-ui'
import { cn } from '../lib/utils'

// shadcn composition, styled with zQ's shared menu tokens.
export function ContextMenu(props:React.ComponentProps<typeof ContextMenuPrimitive.Root>){
 return <ContextMenuPrimitive.Root data-slot="context-menu" {...props}/>
}
export function ContextMenuTrigger(props:React.ComponentProps<typeof ContextMenuPrimitive.Trigger>){
 return <ContextMenuPrimitive.Trigger data-slot="context-menu-trigger" {...props}/>
}
export function ContextMenuContent({className,...props}:React.ComponentProps<typeof ContextMenuPrimitive.Content>){
 return <ContextMenuPrimitive.Portal><ContextMenuPrimitive.Content data-slot="context-menu-content" className={cn('zq-context-menu',className)} {...props}/></ContextMenuPrimitive.Portal>
}
export function ContextMenuItem({className,...props}:React.ComponentProps<typeof ContextMenuPrimitive.Item>){
 return <ContextMenuPrimitive.Item data-slot="context-menu-item" className={cn('zq-context-item',className)} {...props}/>
}
export function ContextMenuSeparator(props:React.ComponentProps<typeof ContextMenuPrimitive.Separator>){
 return <ContextMenuPrimitive.Separator data-slot="context-menu-separator" className="zq-context-separator" {...props}/>
}
export const ContextMenuSub=ContextMenuPrimitive.Sub
export const ContextMenuSubTrigger=ContextMenuPrimitive.SubTrigger
export function ContextMenuSubContent({className,...props}:React.ComponentProps<typeof ContextMenuPrimitive.SubContent>){
 return <ContextMenuPrimitive.Portal><ContextMenuPrimitive.SubContent className={cn('zq-context-menu',className)} {...props}/></ContextMenuPrimitive.Portal>
}
