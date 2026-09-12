import type { ReactNode } from 'react'
import {TooltipButton} from './components/tooltip'
export function IconButton({label,children,onClick,active=false,tooltip}:{label:string;children:ReactNode;onClick:()=>void;active?:boolean;tooltip?:ReactNode}){return <TooltipButton tooltip={tooltip} className={`icon-button ${active?'active':''}`} title={label} aria-label={label} aria-pressed={active} onClick={onClick}>{children}</TooltipButton>}
export function ProjectTag({name}:{name?:string}){return name?<span className={`project-tag p-${name.toLowerCase()}`}><span/>{name}</span>:null}
