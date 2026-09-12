import { ControlTooltip } from '@zq/ui'
export default function ThinkingMark(){
 return <ControlTooltip content="The model is preparing a response. Use Stop response to end generation."><span tabIndex={0} className="thinking-mark" role="status" aria-label="z is thinking"><span aria-hidden="true">z</span></span></ControlTooltip>
}
