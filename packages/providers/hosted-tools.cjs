const {failure}=require('./transport.cjs');
const definitions={
 web_search:{kind:'web_search',label:'Web search',description:'Search the web and cite sources.'},
 x_search:{kind:'x_search',label:'Search X',description:'Search posts and discussions on X.'},
 code_execution:{kind:'code_execution',label:'Run code',description:'Analyze data in a fresh provider-hosted sandbox.'},
};
// Verified official model/tool documentation is recorded in docs/research.
// Unknown models are not probed with a paid generation request.
function hostedToolOptions(provider,model){
 if(typeof model!=='string')return [];
 let kinds=[];
 if(provider==='openai'){
  if(/^(?:gpt-4\.1|gpt-5(?:\.1)?|gpt-6-astra|gpt-5\.6-(?:luna|terra|cyber)|gpt-5\.5|gpt-5\.4(?:-mini|-nano)?|chat-latest)(?:-\d{4}-\d{2}-\d{2})?$/.test(model))kinds=['web_search','code_execution'];
  else if(/^gpt-4\.1(?:-mini)?(?:-\d{4}-\d{2}-\d{2})?$/.test(model))kinds=['web_search'];
 }else if(provider==='anthropic'&&/^claude-(?:(?:opus|sonnet)-(?:4-[56]|5)|haiku-4-5|(?:fable|mythos)-5(?:-1)?)(?:-\d{8})?$/.test(model))kinds=['web_search','code_execution'];
 else if(provider==='google'&&/^(?:gemini-2\.5-(?:pro|flash|flash-lite)|gemini-3\.1-pro-preview|gemini-3\.8-flash|gemini-3\.5-flash|gemini-3-flash-preview)$/.test(model.replace(/^models\//,'')))kinds=['code_execution'];
 else if(['xai','openrouter'].includes(provider))kinds=require('./hosted-routing.cjs').routingHostedCapabilities(provider,model);
 return kinds.map(k=>({...definitions[k]}));
}
function validateHostedTools(provider,model,tools=[]){
 const allowed=hostedToolOptions(provider,model).map(t=>t.kind);
 if(!Array.isArray(tools)||tools.length>3||new Set(tools).size!==tools.length||tools.some(t=>!allowed.includes(t)))throw failure('UNSUPPORTED_TOOLS','These tools are not available for the selected model.');
 return tools;
}
module.exports={hostedToolOptions,validateHostedTools};
