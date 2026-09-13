import type {SVGProps} from 'react'

/** Shared Connectors mark: three joined blocks and one offset block. */
export function ConnectorIcon({size=24,...props}:SVGProps<SVGSVGElement>&{size?:number|string}) {
 return <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
  <rect x="14" y="3" width="7" height="7" rx="1"/>
  <path d="M10 14V8a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1H3m7 0v7"/>
 </svg>
}
