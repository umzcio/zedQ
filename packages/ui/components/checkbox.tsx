import type { ComponentProps } from 'react'
import { Checkbox as Primitive } from 'radix-ui'
import { Check } from '@phosphor-icons/react'
import { cn } from '../lib/utils'
export function Checkbox({className,...props}:ComponentProps<typeof Primitive.Root>){
 return <Primitive.Root data-slot="checkbox" className={cn('zq-checkbox',className)} {...props}><Primitive.Indicator><Check size={12} weight="bold"/></Primitive.Indicator></Primitive.Root>
}
