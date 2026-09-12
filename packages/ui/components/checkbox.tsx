import type { ComponentProps, ReactNode } from 'react'
import { Checkbox as Primitive } from 'radix-ui'
import { Check } from '@phosphor-icons/react'
import {ControlTooltip} from './tooltip'
import { cn } from '../lib/utils'
export function Checkbox({className,tooltip,title,...props}:ComponentProps<typeof Primitive.Root>&{tooltip?:ReactNode}){
 return <ControlTooltip content={tooltip??title??props['aria-label']}><Primitive.Root data-slot="checkbox" className={cn('zq-checkbox',className)} {...props}><Primitive.Indicator><Check size={12} weight="bold"/></Primitive.Indicator></Primitive.Root></ControlTooltip>
}
