'use strict';
// Publisher endpoints and public client configuration. Never put credentials here.
const GOOGLE_SETUP = 'Personal Google account. Google Workspace MCP is in developer preview and requires an enabled Google Cloud project and an OAuth web client. Add your account as a test user and register http://127.0.0.1:43187/oauth/callback, then enter the client ID and secret.';
const catalog = [
 {id:'scite',name:'Scite.AI',description:'Find research and explore evidence with Smart Citations.',category:'Research',url:'https://api.scite.ai/mcp',publisher:'Scite',documentationUrl:'https://scite.ai/mcp',accountLabel:'Scite account',setupNote:'Sign in to Scite in your browser. Available literature and tools depend on your account.',authType:'oauth',requiresSetup:false},
 {id:'arxiv',name:'arXiv',description:'Search papers and read abstracts, with links to the original papers and PDFs.',category:'Research',url:'https://export.arxiv.org/api/query',publisher:'arXiv',documentationUrl:'https://info.arxiv.org/help/api/user-manual.html',accountLabel:'No account needed',setupNote:'Uses the public arXiv API through a bundled MCP adapter. Searches include metadata and abstracts; full papers open from their source links.',authType:'oauth',requiresSetup:false,bundled:true},
 ...[
  ['gmail','Gmail','Search your inbox and work with email.','https://gmailmcp.googleapis.com/mcp/v1'],
  ['google-calendar','Google Calendar','Find events and check calendar availability.','https://calendarmcp.googleapis.com/mcp/v1'],
  ['google-drive','Google Drive','Find and work with files in your personal Drive.','https://drivemcp.googleapis.com/mcp/v1'],
 ].map(([id,name,description,url])=>({id,name,description,url,category:'Productivity',publisher:'Google',documentationUrl:'https://developers.google.com/workspace/guides/configure-mcp-servers',accountLabel:'Personal Google account',setupNote:GOOGLE_SETUP,authType:'oauth',redirectPort:43187,redirectHost:'127.0.0.1',requiresSetup:true})),
 {id:'microsoft365',name:'Microsoft 365',description:'Work with email, calendar, OneDrive, and Teams through Work IQ.',category:'Productivity',url:'https://workiq.svc.cloud.microsoft/mcp',publisher:'Microsoft',documentationUrl:'https://github.com/microsoft/work-iq/tree/main/plugins/workiq',accountLabel:'Work Microsoft account',setupNote:'Sign in with your work account. Work IQ availability, permissions, and administrator consent depend on your organization. Uses Microsoft’s published public MCP client configuration.',authType:'oauth',clientId:'ba081686-5d24-4bc6-a0d6-d034ecffed87',redirectPort:12798,redirectHost:'127.0.0.1',redirectPath:'/',requiresSetup:false},
 {id:'github',name:'GitHub',description:'Work with repositories, issues, and pull requests.',category:'Development',url:'https://api.githubcopilot.com/mcp/',publisher:'GitHub',documentationUrl:'https://github.com/github/github-mcp-server/blob/main/docs/host-integration.md',accountLabel:'GitHub account',setupNote:'Enter a GitHub personal access token with access to the repositories you choose. Organization approval may be required. Browser sign-in requires your own registered OAuth app.',authType:'bearer',requiresSetup:true},
];
function getCatalog(){ return structuredClone(catalog); }
function getCatalogEntry(id){ const entry=catalog.find(item=>item.id===id);return entry?structuredClone(entry):undefined; }
function isBundledArxiv(row){return row?.catalogId==='arxiv' && row.url===getCatalogEntry('arxiv').url;}
module.exports={getCatalog,getCatalogEntry,isBundledArxiv};
