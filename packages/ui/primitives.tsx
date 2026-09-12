import type { ReactNode } from 'react'
export function IconButton({label,children,onClick,active=false}:{label:string;children:ReactNode;onClick:()=>void;active?:boolean}){return <button className={`icon-button ${active?'active':''}`} title={label} aria-label={label} aria-pressed={active} onClick={onClick}>{children}</button>}
export function ProjectTag({name}:{name?:string}){return name?<span className={`project-tag p-${name.toLowerCase()}`}><span/>{name}</span>:null}
