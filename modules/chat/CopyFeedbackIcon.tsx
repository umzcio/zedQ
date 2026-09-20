import {Check,Copy} from '@phosphor-icons/react'
import './copy-feedback.css'

export default function CopyFeedbackIcon({copied,animate}:{copied:boolean;animate:boolean}){
 return <span className="chat-copy-feedback" data-copied={copied} data-animate={animate} aria-hidden="true"><Copy size={14}/><Check size={14}/></span>
}
