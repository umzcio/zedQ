import type { CommandBus, Commands } from '@zq/module-api'
export function createCommandBus(onMissing:(name:string)=>void):CommandBus {
 const handlers=new Map<keyof Commands,(payload:never)=>void>()
 return {
  run(name,payload){const handler=handlers.get(name);if(handler){handler(payload as never);return true}onMissing(name);return false},
  register(name,handler){if(handlers.has(name))throw Error(`Command already registered: ${name}`);handlers.set(name,handler as (payload:never)=>void);return()=>{if(handlers.get(name)===handler)handlers.delete(name)}},
 }
}
