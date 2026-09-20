'use strict';
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { ArtifactService } = require('../../electron/artifact-service.cjs');
const { ChatService } = require('../../electron/chat-service.cjs');
const { ResearchService } = require('../../electron/research/service.cjs');
const { ResearchAdapter } = require('../../electron/research/adapter.cjs');
module.exports = async function setup(directory, emit) {
 const notes = [{ id: 'measurements', title: 'Measurements', body: 'A is 12. B is 20.', project: 'Personal', updated: 'Today', pinned: false },...Array.from({length:80},(_,i)=>({id:'reference-'+i,title:'Reference '+String(i+1).padStart(3,'0'),body:'Reference content.',project:'Personal',updated:'Today',pinned:false}))];
 const exports=[],artifacts=new ArtifactService({directory,onChange:value=>emit('artifactsChanged',value)});
 const keys = new Map(), calls = [], gates = new Set(); let held = true, failDetail = false, research;
 const json = value => ({ text: JSON.stringify(value), usage: { inputTokens: 10, outputTokens: 10 } });
 const provider = {
  streamChat: async args => args.onDelta({ content: 'Other chat remains usable.' }),
  researchRequest: async args => {
   const prompt = JSON.parse(args.prompt); calls.push(prompt);
   if (!prompt.research) return json({ title: 'Compare measurements', steps: ['Read the selected measurements', 'Compare A and B'], questions: ['Who is the audience?'] });
   const job = [...research.jobs.values()].find(j => j.status === 'running');
   if (job.phase === 'checking') return json({ findings: job.findings, gaps: job.gaps });
   if (job.phase === 'writing') return json({ title: 'Measurement report', markdown: job.evidence.length ? `B exceeds A by 8. [e:${job.evidence[0].id}]` : 'No evidence was collected.', citationIds: job.evidence.map(e => e.id), ...(job.evidence.length?{datasets:[{id:'values',title:'Measurement data',method:'Source values, in units.',columns:[{key:'name',label:'Item',type:'text'},{key:'value',label:'Measurement',type:'number',unit:'units'}],rows:[{values:['A',12],evidenceIds:[job.evidence[0].id]},{values:['B',20],evidenceIds:[job.evidence[0].id]}]}],charts:[{id:'comparison',title:'Measured values',type:'bar',datasetId:'values',x:'name',y:'value'}]}:{datasets:[],charts:[]}) });
   if (held) await new Promise((resolve, reject) => { const release = () => { gates.delete(release); args.signal.removeEventListener('abort', abort); resolve(); }; const abort = () => { gates.delete(release); reject(args.signal.reason); }; gates.add(release); args.signal.addEventListener('abort', abort, { once: true }); if (args.signal.aborted) abort(); });
   return job.evidence.length ? json({ findings: [{ id: 'comparison', kind: 'calculation', text: '20 - 12 = 8.', evidenceIds: [job.evidence[0].id] }], gaps: [], action: { kind: 'finish' } }) : json({ findings: [], gaps: [], action: { kind: 'read', sourceId: 'measurements', offset: 0 } });
  }
 };
 const chat = new ChatService({ directory: path.join(directory, 'chat'), artifacts, provider, credentials: { get: async id => keys.get(id), set: async (id, value) => keys.set(id, value), delete: async id => keys.delete(id) }, getNotes: () => notes, onChange: value => emit('chatChanged', value) });
 const connection = await chat.saveConnection({ name: 'Isolated model', provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'isolated-test-key', enabledModels: ['gpt-5'] });
 const one = chat.createConversation({ connectionId: connection.id, model: 'gpt-5' }), two = chat.createConversation({ connectionId: connection.id, model: 'gpt-5' });
 chat.renameConversation({ id: one.id, title: 'First chat' }); chat.renameConversation({ id: two.id, title: 'Second chat' }); chat.saveChatView({ selected: one.id });
 const adapter = new ResearchAdapter({ chat, publish: input => artifacts.publishResearch(input) });
 research = new ResearchService({ directory: path.join(directory, 'research'), adapter, onChange: value => emit('researchChanged', value) }); chat.researchBusy = id => research.busy(id);
 return { chat, research, artifacts, exports, calls, async call(service, method, input) {
  try {
   if (service === 'fixture') {
    if (method === 'bootstrap') return { ok: true, value: { ids: [one.id, two.id], notes } };
    if (method === 'hold') { held = true; return {ok:true,value:null}; }
    if (method === 'failDetail') { failDetail = true; return {ok:true,value:null}; }
    if (method === 'release') { held = false; [...gates].forEach(fn => fn()); return { ok: true, value: null }; }
   }
   if(service==='attachments'&&method==='pick')return{ok:true,value:await chat.attachments.importFiles([{name:'Upload fixture.txt',bytes:Buffer.from('A is 12. B is 20.')}])};
   if(service==='attachments')return{ok:true,value:await chat.attachments[method](input)};
   if(service==='artifacts'&&method==='status')return{ok:true,value:{warning:''}};
   if(service==='artifacts'&&method==='exportResearch'){exports.push(await artifacts.researchExport(input));return{ok:true,value:true}};
   if(service==='chat'&&method==='openLink')return{ok:true,value:true};
   if (service === 'research' && method === 'get' && failDetail) { failDetail=false; throw Error('Temporary detail read failure'); }
   const target = service === 'chat' ? chat : service==='artifacts'?artifacts:research;
   return { ok: true, value: await target[method === 'load' ? 'snapshot' : method === 'send' ? 'sendMessage' : method](input) };
  } catch (error) { return { ok: false, error: { code: error.code ?? 'FIXTURE', message: error.message } }; }
 }, close() { research.shutdown(); chat.shutdown(); } };
};
