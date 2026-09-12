import React from 'react'
import { createRoot } from 'react-dom/client'
import { ModuleHostProvider } from '@zq/module-api'
import { useChat } from '../../../../modules/chat/useChat'
import ChatView from '../../../../modules/chat/ChatView'
import SkillsSettings from '../../../../modules/chat/SkillsSettings'
import '@zq/ui/styles.css'
import '../../../../modules/chat/chat.css'
import '../../src/shell.css'
const ok = value => Promise.resolve({ ok: true, value })
const skill = { id: 'writing', name: 'Writing style', description: 'Clear prose', instructions: 'Use short sentences.', files: [], createdAt: 1, updatedAt: 1 }
let snapshot = { skills: [skill], revision: 1, error: '', projects: [{ id: 'project', name: 'Project', instructions: '', files: [], skillIds: ['writing'] }], connections: [{ id: 'conn', provider: 'ollama', name: 'Fixture', baseUrl: 'http://localhost:11434', enabledModels: ['fixture'], favoriteModels: [], modelLabels: {} }], defaultModel: { connectionId: 'conn', model: 'fixture' }, conversations: [], chatView: { selected: '', projectId: null, projectHome: false, positions: {} }, drafts: { 'new:general': { text: 'Hydrated message', noteIds: [], tools: [], attachments: [], skillIds: ['writing'] } } }
let subscriber; window.events = []
function publish() { snapshot = { ...snapshot, revision: snapshot.revision + 1 }; subscriber?.(snapshot) }
const host = { workspace: { layout: { view: 'Chat' }, notes: [], tasks: [], settings: {}, profile: {} }, closing: false, registerFlush: () => () => {}, commands: { register: () => () => {}, run: () => true }, navigate: () => {}, notify: message => window.events.push(['notify', message]), openSettings: section => {window.events.push(['settings', section]);window.showSkillSettings?.()}, services: { chat: {
 setApprovalMode:async input=>{window.events.push(['mode',input]);if(window.holdApprovalMode)await new Promise(resolve=>{window.finishApprovalMode=resolve});if(window.failApprovalMode)return {ok:false,error:{code:'TEST',message:'Could not save approval mode. Try again.'}};snapshot={...snapshot,conversations:snapshot.conversations.map(c=>c.id===input.conversationId?{...c,approvalMode:input.mode}:c)};publish();return ok(snapshot)},
 updateProject: input => { window.events.push(['updateProject', structuredClone(input)]); snapshot = { ...snapshot, projects: snapshot.projects.map(project => project.id === input.id ? { ...project, ...input } : project) }; publish(); return ok(snapshot.projects.find(project => project.id === input.id)) },
 browseSkills:()=>ok([]),
 load: () => ok(snapshot), subscribe: fn => { subscriber = fn; return () => {} },
 saveDraft: input => { window.events.push(['draft', structuredClone(input)]); snapshot = { ...snapshot, drafts: { ...snapshot.drafts, [input.id]: { ...input, attachments: [] } } }; return ok(null) }, saveChatView: input => { snapshot.chatView = input; return ok(null) },
 createConversation: input => { window.events.push(['create', input]); const draft = snapshot.drafts[input.draftFrom], conversation = { id: `chat-${snapshot.conversations.length + 1}`, title: 'Skill chat', connectionId: input.connectionId, model: input.model, projectId: input.projectId, skillIds: draft?.skillIds ?? null, messages: [], createdAt: 1, updatedAt: 1 }; const drafts = { ...snapshot.drafts }; if (input.draftFrom) { drafts[conversation.id] = draft; delete drafts[input.draftFrom] }; snapshot = { ...snapshot, conversations: [...snapshot.conversations, conversation], drafts }; publish(); return ok(conversation) },
 toolOptions: () => ok([]), inspectContext: input => { window.events.push(['context', input]); return ok({ referenceBytes: input.skillIds?.length ? 20 : 0, conversationBytes: 0, error: '' }) },
 send: input => { window.events.push(['send', structuredClone(input)]); snapshot = { ...snapshot, conversations: snapshot.conversations.map(c => c.id === input.conversationId ? { ...c, skillIds: input.skillIds } : c) }; publish(); return ok(snapshot) },
 }, voice: { status: () => ok({}), settings: () => ok({}) }, clipboard: { writeText: text => { window.events.push(['clipboard', text]); return ok(null) } } } }
window.deleteLibrarySkill = () => { snapshot = { ...snapshot, skills: [], projects: snapshot.projects.map(p => ({ ...p, skillIds: [] })), conversations: snapshot.conversations.map(c => ({ ...c, skillIds: c.skillIds?.filter(id => id !== 'writing') ?? null })) }; publish() }
window.installSlashSkills=(count=3)=>{snapshot={...snapshot,skills:Array.from({length:count},(_,i)=>i===0?skill:{...skill,id:'skill-'+i,name:i===1?'Code review':i===2?'Research notes':'Skill '+i,description:'Installed skill '+i})};publish()}
window.installCollidingSkills=()=>{snapshot={...snapshot,skills:[{...skill,id:'first-one',name:'Code review'},{...skill,id:'second-two',name:'Code-review'}]};publish()}
function Test() { const chat = useChat(); const [settingsVisible,setSettingsVisible]=React.useState(false); window.showSkillSettings=()=>setSettingsVisible(true); window.chatState = chat; return <div style={{ height: 800 }}><output aria-label="Current draft">{chat.draftId}</output><output aria-label="Skill choices">{JSON.stringify(chat.skillChoices)}</output><div><button onClick={() => chat.openProject('project')}>Open project draft</button><button onClick={() => chat.select('chat-1')}>Open first chat</button></div><button onClick={()=>setSettingsVisible(false)}>Return to composer</button>{settingsVisible?<SkillsSettings chat={chat} closing={false}/>:<ChatView chat={chat} notes={[]} closing={false} settings={() => {}} prepareNotes={async () => {}}/>}</div> }
createRoot(document.getElementById('root')).render(<ModuleHostProvider value={host}><Test/></ModuleHostProvider>)

window.loadSkillActivity = () => { snapshot = { ...snapshot, conversations: [{ id: 'chat-1', title: 'Skill activity', connectionId: 'conn', model: 'fixture', skillIds: null, createdAt: 1, updatedAt: 1, messages: [
 { id: 'answer', role: 'assistant', content: 'Document ready.', thinking: '', status: 'complete', createdAt: 1, context: [], error: '', skillUsage: [{ id: 'docx', name: 'docx', description: 'Word document workflows', source: 'automatic', referenceNames: ['guide.md'], hasResources: true }, { id: 'writing', name: 'Writing style', description: 'Clear prose', source: 'selected', referenceNames: [], hasResources: false }] },
 { id: 'legacy', role: 'assistant', content: 'Earlier answer.', thinking: '', status: 'complete', createdAt: 1, context: [], error: '' }
 ] }] }; publish() }
window.setProjectSkills = skillIds => { snapshot = { ...snapshot, projects: snapshot.projects.map(project => ({ ...project, skillIds })) }; publish() }
