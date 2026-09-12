import type {ChatMessage,ChatSource} from '@zq/module-api'
function safeURL(value:string){
 if(typeof value!=='string'||value.length>8192||/[\x00-\x20\x7f]/.test(value))return
 try{const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return;return url.href}catch{return}
}
export function messageSources(message:Pick<ChatMessage,'content'|'status'|'toolActivity'|'sources'>){
 const searched=message.toolActivity?.some(t=>(t.kind==='web_search'||t.kind==='x_search')&&t.status==='complete')??false
 const linked=message.sources===undefined&&searched,sources:ChatSource[]=[],seen=new Set<string>()
 function add(url:string,title:string,id?:string){const safe=safeURL(url);if(!safe||seen.has(safe)||sources.length>=100)return;seen.add(safe);sources.push({id:id||String(sources.length+1),url:safe,title:title?.trim().slice(0,1000)||new URL(safe).hostname})}
 if(Array.isArray(message.sources))for(const source of message.sources.slice(0,100))add(source.url,source.title,source.id)
 else if(linked){
  // Legacy content is merely a list of links, never verified provider metadata.
  for(const match of message.content.matchAll(/\[([^\]\n]{1,1000})\]\(<?(https?:\/\/[^\s<>]+?)>?(?:\s+"[^"\n]*")?\)/g))add(match[2],match[1])
  for(const match of message.content.matchAll(/^\[([^\]\n]+)\]:\s*<?(https?:\/\/[^\s<>]+)>?/gm))add(match[2],'')
 }
 return {sources,linked,missing:searched&&message.status!=='streaming'&&!sources.length}
}

// Hide only the exact generated appendix when every link is still available in
// the source pane. Stored response text and ordinary inline citations stay intact.
export function withoutSourceAppendix(content:string,sources:ChatSource[]){
 const match=/\n\nSources:[ \t]*\r?\n([\s\S]+?)\s*$/.exec(content)
 if(!match||!sources.length)return content
 let fence:{character:string;length:number}|undefined
 for(const line of content.slice(0,match.index).split('\n')){const marker=/^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];if(marker){if(!fence)fence={character:marker[0],length:marker.length};else if(marker[0]===fence.character&&marker.length>=fence.length)fence=undefined}}
 if(fence)return content
 const known=new Set(sources.map(s=>safeURL(s.url)).filter(Boolean))
 const rows=match[1].trim().split(/\r?\n/)
 if(!rows.every(row=>{const link=/^\[\d+\]\(<?(https?:\/\/[^\s<>]+?)>?\)$/.exec(row.trim());return !!link&&known.has(safeURL(link[1]))}))return content
 return content.slice(0,match.index)
}

export function sourceForLink(href:string|undefined,sources:ChatSource[]){
 const url=href&&safeURL(href)
 return url?sources.find(source=>safeURL(source.url)===url):undefined
}

export function isCitationLabel(label:string){return /^(?:\d+|\[\d+\])$/.test(label.trim())}
export function citationSiteLabel(href:string){return new URL(href).hostname.replace(/^www\./,'')}
