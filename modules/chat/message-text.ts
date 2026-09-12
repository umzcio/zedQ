/** A readable plain-text copy keeps link destinations and code, but removes Markdown decoration. */
export function plainMessage(markdown:string){
 const code:string[]=[]
 const protect=(value:string)=>{code.push(value);return `\u0000CODE${code.length-1}\u0000`}
 return markdown.replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^ {0,3}\1[ \t]*$/gm,(_match,_fence,body)=>protect(body.replace(/\n$/,'')))
  .replace(/`([^`\n]+)`/g,(_match,body)=>protect(body))
  .replace(/!\[([^\]]*)\]\(([^)]+)\)/g,'[Image: $1] ($2)')
  .replace(/\[([^\]]+)\]\(<?([^)>]+)>?\)/g,'$1 ($2)')
  .replace(/^\s{0,3}#{1,6}\s+/gm,'').replace(/^\s*>\s?/gm,'')
  .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g,(_m,a,b)=>a??b)
  .replace(/~~([^~]+)~~/g,'$1').replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g,'$1')
  .replace(/\u0000CODE(\d+)\u0000/g,(_match,index)=>code[Number(index)]).trim()
}
export function sourceMessageLink(conversationId:string,messageId:string,versionId?:string){return `zq://chat/${encodeURIComponent(conversationId)}?message=${encodeURIComponent(messageId)}${versionId?`&version=${encodeURIComponent(versionId)}`:''}`}
export function messageMatches(content:string,query:string){return !!query.trim()&&content.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())}
export type CodeToken={text:string;kind?:'comment'|'string'|'number'|'keyword'|'tag'}
const supported=/^(?:js|jsx|javascript|ts|tsx|typescript|json|jsonc|py|python|bash|sh|shell|zsh|css|scss|sql|go|rust|rs|java|c|cpp|csharp|cs|swift|kotlin|kt|ruby|rb|html|xml|yaml|yml)$/i
const keywords=new Set('as async await break case catch class const continue def default defer delete do elif else enum export extends false finally fn for from func function if impl import in interface let match new nil none null of package pass private public raise return select self static struct super switch this throw true try type typeof undefined use var void when while with yield'.split(' '))
export function codeTokens(code:string,language:string):CodeToken[]{
 if(!supported.test(language)||code.length>100_000)return [{text:code}]
 const hashComments=/^(py|python|bash|sh|shell|zsh|ruby|rb|yaml|yml)$/i.test(language)
 const sql=/^sql$/i.test(language),markup=/^(html|xml)$/i.test(language)
 const pattern=markup?/<!--[\s\S]*?(?:-->|$)|<\/?[\w:-]+|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g:
  /\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\n]*|\#[^\n]*|--[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b/g
 const tokens:CodeToken[]=[];let end=0
 for(const match of code.matchAll(pattern)){
  if(match.index>end)tokens.push({text:code.slice(end,match.index)})
  const text=match[0],lower=text.toLowerCase()
  const comment=text.startsWith('/*')||text.startsWith('//')||text.startsWith('<!--')||(hashComments&&text.startsWith('#'))||(sql&&text.startsWith('--'))
  const kind=comment?'comment':/^['"`]/.test(text)?'string':/^\d/.test(text)?'number':markup&&text.startsWith('<')?'tag':keywords.has(lower)||(sql&&/^(and|or|not|select|insert|update|into|values|where|join|on|order|by|group|having|limit|table|create|drop|alter|distinct|count|sum|asc|desc)$/.test(lower))?'keyword':undefined
  tokens.push({text,kind});end=match.index+text.length
 }
 if(end<code.length)tokens.push({text:code.slice(end)})
 return tokens
}
export function codeFilename(language:string){
 const extensions:Record<string,string>={javascript:'js',jsx:'jsx',typescript:'ts',tsx:'tsx',python:'py',bash:'sh',shell:'sh',zsh:'sh',rust:'rs',ruby:'rb',csharp:'cs',kotlin:'kt',yml:'yaml'}
 const ext=extensions[language]??(/^[a-z0-9]{1,10}$/.test(language)?language:'txt')
 return `snippet.${ext||'txt'}`
}
