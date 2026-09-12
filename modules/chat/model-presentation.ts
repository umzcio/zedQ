import type { ModelChoice } from '@zq/module-api'

// Keep exact provider IDs for requests; only known naming conventions get labels.
export function modelName(id:string,labels?:Record<string,string>){
 if(labels&&Object.hasOwn(labels,id))return labels[id]
 if(id.startsWith('claude-'))return id.replace(/-\d{8}$/,'').replace(/(\d)-(\d)(?=-|$)/g,'$1.$2').split('-').map(word=>word[0]?.toUpperCase()+word.slice(1)).join(' ')
 if(/^gpt-/.test(id))return id.replace(/^gpt-/,'GPT-').replace(/-(mini|nano|preview|turbo|latest)/g,' $1')
 if(/^gemini-/.test(id))return id.replace(/^gemini-/,'Gemini ').replace(/-/g,' ')
 if(/^grok-/.test(id))return id.replace(/^grok-/,'Grok ').replace(/-/g,' ')
 if(/^sonar(?:-|$)/.test(id))return id.split('-').map(word=>word[0]?.toUpperCase()+word.slice(1)).join(' ')
 return id
}
export function preferredModel(connections:{id:string;enabledModels:string[]}[],defaultModel:ModelChoice|null,previous?:{connectionId:string|null;model:string}):ModelChoice|null{
 const enabled=(choice:{connectionId:string|null;model:string}|null|undefined)=>!!choice&&connections.some(c=>c.id===choice.connectionId&&c.enabledModels.includes(choice.model))
 if(enabled(defaultModel))return defaultModel
 if(enabled(previous))return {connectionId:previous!.connectionId!,model:previous!.model}
 const first=connections.find(c=>c.enabledModels.length)
 return first?{connectionId:first.id,model:first.enabledModels[0]}:null
}
