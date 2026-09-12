import type { ComponentProps } from 'react'
import { DropdownMenu as Primitive } from 'radix-ui'
import { cn } from '../lib/utils'

export const DropdownMenu=Primitive.Root
export const DropdownMenuTrigger=Primitive.Trigger
export function DropdownMenuContent({className,sideOffset=5,...props}:ComponentProps<typeof Primitive.Content>){
 return <Primitive.Portal><Primitive.Content sideOffset={sideOffset} className={cn('zq-context-menu zq-dropdown-menu',className)} {...props}/></Primitive.Portal>
}
export function DropdownMenuItem({className,...props}:ComponentProps<typeof Primitive.Item>){
 return <Primitive.Item className={cn('zq-context-item',className)} {...props}/>
}
export function DropdownMenuSeparator(props:ComponentProps<typeof Primitive.Separator>){
 return <Primitive.Separator className="zq-context-separator" {...props}/>
}
export const DropdownMenuSub=Primitive.Sub
export function DropdownMenuSubTrigger({className,...props}:ComponentProps<typeof Primitive.SubTrigger>){
 return <Primitive.SubTrigger className={cn('zq-context-item',className)} {...props}/>
}
export function DropdownMenuSubContent({className,sideOffset=5,...props}:ComponentProps<typeof Primitive.SubContent>){
 return <Primitive.Portal><Primitive.SubContent sideOffset={sideOffset} className={cn('zq-context-menu zq-dropdown-menu',className)} {...props}/></Primitive.Portal>
}
