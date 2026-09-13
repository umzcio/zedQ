import scite from './connector-assets/scite.svg?inline'
import arxiv from './connector-assets/arxiv.svg?inline'
import gmail from './connector-assets/gmail.svg?inline'
import calendar from './connector-assets/google-calendar.svg?inline'
import drive from './connector-assets/google-drive.svg?inline'
import microsoft from './connector-assets/microsoft365.ico?inline'
import github from './connector-assets/github.svg?inline'

const marks:Record<string,string>={scite,arxiv,gmail,'google-calendar':calendar,'google-drive':drive,microsoft365:microsoft,github}
export function ConnectorLogo({id}:{id:string}) {
 if(['scite','arxiv','github'].includes(id))return <span className={`connector-logo connector-logo-${id}`} aria-hidden="true" style={{display:'inline-block',backgroundColor:'currentColor',mask:`url("${marks[id]}") center / contain no-repeat`,WebkitMask:`url("${marks[id]}") center / contain no-repeat`}}/>
 return marks[id]?<img className={`connector-logo connector-logo-${id}`} src={marks[id]} alt="" aria-hidden="true" draggable={false}/>:null
}
