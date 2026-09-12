import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ModuleHostProvider } from '@zq/module-api'
import SkillsSettings from '../../../../modules/chat/SkillsSettings'
import SkillPicker from '../../../../modules/chat/SkillPicker'
import '@zq/ui/styles.css'
import '../../../../modules/chat/chat.css'
import '../../src/shell.css'
import '../../src/settings.css'
const ok = value => Promise.resolve({ ok: true, value })
window.events = []; window.failSave = false; window.holdSave = false
const initial = { id: 'writing', name: 'Writing style', description: 'Clear, concise prose', instructions: 'Use short sentences.', files: [], createdAt: 1, updatedAt: 1 }
const file = { id: 'reference', name: 'Style guide.txt', kind: 'text', size: 21, mime: 'text/plain', preview: 'Prefer concrete words.' }
function Fixture() {
 const [skills, setSkills] = useState([initial]), [selected, setSelected] = useState(null)
 const [view, setView] = useState('library')
 window.skills = skills; window.selection = selected; window.fillLibrary=()=>setSkills(Array.from({length:100},(_,i)=>({...initial,id:'full-'+i}))); window.fillAroundInstalled=()=>setSkills(old=>[...old.filter(s=>s.source),...Array.from({length:100-old.filter(s=>s.source).length},(_,i)=>({...initial,id:'full-'+i}))]); window.removeInstalled=()=>setSkills(old=>old.filter(s=>!s.source)); window.modifyInstalled=()=>setSkills(old=>old.map(s=>s.source?{...s,name:'My document workflow',instructions:'My local instructions.'}:s))
 // Browser-only transport fixture: native receipt matching is covered by native tests.
 // Publish metadata for four known fixture IDs before resolving browseSkills.
 window.loadLegacyImports=()=>{window.reconcileLegacySources=true;setSkills(['docx','pdf','xlsx','pptx'].map(name=>({...initial,id:'legacy-'+name,name:name==='docx'?'My Word workflow':name,instructions:'Existing '+name+' instructions.',source:null,package:{frontmatter:'name: '+name,resources:[]}})))}
 const services = { chat: {
  openLink:url=>{window.events.push(['openLink',url]);return ok(null)},
  browseSkills:async()=>{window.events.push(['browse']);if(window.reconcileLegacySources){if(window.holdReconciliation)await new Promise(resolve=>{window.finishReconciliation=resolve});setSkills(old=>old.map(skill=>skill.id.startsWith('legacy-')&&!skill.source?{...skill,source:{catalogId:skill.id.slice(7),revision:'r1',contentHash:'receipt-'+skill.id}}:skill));window.events.push(['reconcileLegacySources']);window.reconcileLegacySources=false}return window.failBrowse?Promise.resolve({ok:false,error:{code:'TEST',message:'Curated list unavailable. Try again.'}}):ok(['doc-coauthoring','internal-comms','docx','pdf','xlsx','pptx'].map(name=>({id:name,name,description:`Anthropic ${name} skill`,category:['doc-coauthoring','internal-comms'].includes(name)?'Writing':'Documents',source:`https://github.com/anthropics/skills/tree/main/skills/${name}`,url:`https://skills.sh/anthropics/skills/${name}`,requirements:['doc-coauthoring','internal-comms'].includes(name)?'Instructions for everyday writing.':'Requires external scripts and tools; these do not run in zQ.'})))},
  previewCatalogSkill:async id=>{window.events.push(['catalogPreview',id]);if(window.holdCatalog)await new Promise(resolve=>{window.finishCatalog=resolve});if(window.failCatalog)return {ok:false,error:{code:'TEST',message:'Could not download this skill. Try Preview again.'}};return ok({name:id,description:'Anthropic document skill',instructions:'Use the documented workflow.',source:{catalogId:id,revision:window.catalogRevision||'r1',contentHash:'initial-hash'},files:[],warnings:['Requires external scripts and tools; these do not run in zQ.'],package:{frontmatter:'name: '+id+'\nlicense: Apache-2.0',resources:[]}})},
  checkSkillUpdates:async()=>{window.events.push(['checkUpdates']);if(window.failCheck)return {ok:false,error:{code:'TEST',message:'Update checks failed. Try again.'}};const result=await services.chat.browseSkills();return ok(result.value.map(entry=>({...entry,revision:window.catalogRevision||'r1',checkedAt:Date.now(),...(window.failEntry?{checkError:'Could not check this skill.'}:{})})))},
  previewSkillUpdate:async id=>{window.events.push(['updatePreview',id]);const installed=skills.find(s=>s.id===id);const preview=await services.chat.previewCatalogSkill(installed.source.catalogId);return ok({id,expectedHash:'expected-current-hash',candidate:{...preview.value,name:installed.name},modified:installed.instructions==='My local instructions.'})},
  updateCatalogSkill:async input=>{window.events.push(['updateSkill',input]);if(window.holdUpdate)await new Promise(resolve=>{window.finishUpdate=resolve});if(window.failUpdate)return {ok:false,error:{code:'TEST',message:'This skill changed after the preview. Preview the update again.'}};const updated={...skills.find(s=>s.id===input.id),...input.candidate,id:input.id};setSkills(old=>old.map(s=>s.id===input.id?updated:s));return ok(updated)},
  pickSkillImport:options=>{window.events.push(['pickImport',options]);return window.importError?Promise.resolve({ok:false,error:{code:'TEST',message:'Invalid skill file.'}}):ok(window.cancelImport?null:{name:'Imported writer',description:'Imported description',instructions:'Preserve exact instructions.',files:[{name:'guide.md',kind:'text',mime:'text/plain',size:14,text:'Reference body'}],warnings:['Extra metadata was not imported.'],...(window.packageImport??{})})},
  importSkill:async input=>{window.events.push(['import',input]);if(window.holdImport)await new Promise(resolve=>{window.finishImport=resolve});if(window.failImport)return {ok:false,error:{code:'TEST',message:'Could not import skill. Try again.'}};window.packageResources=input.package?.resources;const skill={...input,...(input.package?{package:{...input.package,resources:input.package.resources.map(r=>({path:r.path,size:r.size,digest:'a'.repeat(64)}))}}:{}),id:'imported-'+Date.now(),createdAt:1,updatedAt:1,files:input.files.map((f,i)=>({...f,id:'import-file-'+i}))};setSkills(old=>[...old,skill]);return ok(skill)},
  previewSkillResource:async input=>{window.events.push(['previewResource',input]);if(window.holdResource)await new Promise(resolve=>{window.finishResource=resolve});const resource=window.packageResources.find(r=>r.path===input.path);return ok({name:input.path,size:resource.size,...(!input.path.endsWith('.png')?{text:atob(resource.data)}:{})})},
  saveSkillResource:async input=>{window.events.push(['saveResource',input]);if(window.holdResource)await new Promise(resolve=>{window.finishResource=resolve});return ok(true)},
  saveSkill: async input => {
   window.events.push(['save', input]); if (window.holdSave) await new Promise(resolve => { window.finishSave = resolve })
   if (window.failSave) return { ok: false, error: { code: 'TEST', message: 'Could not save this skill. Try again.' } }
   const skill = { ...(skills.find(s => s.id === input.id) || { id: `skill-${Date.now()}`, name: '', description: '', instructions: '', files: [], createdAt: 1 }), ...input, id: input.id || `skill-${Date.now()}`, updatedAt: Date.now() }
   setSkills(old => [...old.filter(s => s.id !== skill.id), skill]); return ok(skill)
  },
  duplicateSkill: id => { const copy = { ...skills.find(s => s.id === id), source: undefined, id: `copy-${Date.now()}`, name: `${skills.find(s => s.id === id).name} copy` }; setSkills(old => [...old, copy]); return ok(copy) },
  deleteSkill: id => { setSkills(old => old.filter(s => s.id !== id)); return ok(null) },
  exportSkill: id => { window.events.push(['export', id]); return ok(true) },
  addSkillFiles: input => { window.events.push(['addFiles', input]); if (window.failFiles) return Promise.resolve({ ok: false, error: { code: 'TEST', message: 'Reference text exceeds 100 KB. Remove a file and try again.' } }); setSkills(old => old.map(s => s.id === input.id ? { ...s, files: [...s.files, file] } : s)); return ok(null) },
  removeSkillFile: input => { window.events.push(['removeFile', input]); setSkills(old => old.map(s => s.id === input.id ? { ...s, files: s.files.filter(f => f.id !== input.attachmentId) } : s)); return ok(null) },
 }, attachments: { pick: () => ok({ items: [file], errors: [] }), discard: id => { window.events.push(['discard', id]); return ok(null) }, preview: () => ok({ ...file, text: file.preview }) } }
 const flushers = window.flushers ||= new Map()
 const host = { services, closing: false, registerFlush: (id, fn) => { flushers.set(id, fn); return () => flushers.delete(id) }, workspace: { layout: { view: 'Settings' } } }
 window.refreshSkill = () => setSkills(old => old.map(s => s.id === 'writing' ? { ...s, instructions: 'External update' } : s))
 return <ModuleHostProvider value={host}><main style={{ padding: 24, maxWidth: 850, minHeight: '100vh', background: 'var(--canvas)', color: 'var(--text)' }}><nav style={{ display: 'flex', gap: 16, marginBottom: 24 }}><button onClick={() => setView('library')}>Library fixture</button><button onClick={() => setView('picker')}>Picker fixture</button></nav>{view === 'library' ? <SkillsSettings chat={{ state: { skills, connections: [], error: '' }, error: '', loading: false }} closing={false}/> : <><SkillPicker skills={skills} selected={selected} inherited={['writing']} onChange={setSelected} disabled={false} onManage={() => setView('library')}/><output aria-label="Selected skill IDs">{JSON.stringify(selected)}</output></>}</main></ModuleHostProvider>
}
createRoot(document.getElementById('root')).render(<Fixture/>)
