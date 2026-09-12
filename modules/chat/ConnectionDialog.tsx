import { useHost, unwrap, type Connection, type ConnectionInput, type ProviderKind } from '@zq/module-api'
import { useRef, useState } from 'react'
import { ProviderLogo } from './ProviderLogo'
import { ModelChecklist } from './ModelChecklist'
import { bedrockRegions, bedrockEndpoint, bedrockRegion } from './bedrock-regions'
import { Button, Dialog, DialogContent, DialogTitle, DialogDescription, Input, SelectField } from '@zq/ui'

export const connectionProviders: { value: ProviderKind; label: string; legacy?: boolean }[] = [
 { value: 'ollama', label: 'Ollama' }, { value: 'vllm', label: 'vLLM' }, { value: 'openai', label: 'OpenAI' },
 { value: 'anthropic', label: 'Anthropic' }, { value: 'google', label: 'Google Gemini' }, { value: 'xai', label: 'xAI' },
 { value: 'perplexity', label: 'Perplexity' }, { value: 'openrouter', label: 'OpenRouter' }, { value: 'bedrock', label: 'AWS Bedrock' },
 { value: 'groq', label: 'Groq', legacy: true },
]
const ollamaEndpoint = 'http://127.0.0.1:11434/'

export function ConnectionDialog({ connection, disabled, closing, onClose, onSaved, onCloseAutoFocus }: {
 connection?: Connection; disabled: boolean; closing: boolean; onClose: () => void; onSaved: (name: string) => void; onCloseAutoFocus: (event: Event) => void
}) {
 const { services } = useHost()
 const [provider, setProvider] = useState<ProviderKind>(connection?.provider ?? 'ollama')
 const [name, setName] = useState(connection?.name ?? 'Ollama')
 const [baseUrl, setBaseUrl] = useState(connection?.baseUrl ?? ollamaEndpoint)
 const [apiKey, setApiKey] = useState(''), [removeApiKey, setRemoveApiKey] = useState(false)
 const [busy, setBusy] = useState<'test' | 'save' | null>(null), [error, setError] = useState('')
 const [models, setModels] = useState<string[] | null>(null)
 const [selecting,setSelecting]=useState(false),[selectedModels,setSelectedModels]=useState<string[]>([])
 const pending = useRef(false), nameInput = useRef<HTMLInputElement>(null)
 const selfHosted = provider === 'ollama' || provider === 'vllm'
 const blocked = disabled || closing || !!busy
 const savedKey = !!connection?.hasApiKey && !removeApiKey
 const endpointChanged = !!connection && baseUrl.trim().replace(/\/+$/, '') !== connection.baseUrl.replace(/\/+$/, '')
 const missingKey = !selfHosted && !apiKey.trim() && !savedKey
 const needsKeyChoice = (provider === 'vllm' || provider === 'bedrock') && endpointChanged && savedKey && !apiKey.trim()
 const valid = !!name.trim() && (!selfHosted || !!baseUrl.trim()) && !missingKey && !needsKeyChoice
 function resetResult() { setError(''); setModels(null) }
 function close() { if (closing || busy || pending.current) return; setApiKey(''); onClose() }
 function changeProvider(next: ProviderKind) {
  const previousLabel = connectionProviders.find(option => option.value === provider)?.label
  if (!name.trim() || name === previousLabel) setName(connectionProviders.find(option => option.value === next)!.label)
  setSelectedModels([]); setProvider(next); setBaseUrl(next === 'ollama' ? ollamaEndpoint : next === 'bedrock' ? bedrockEndpoint('us-east-1') : ''); setApiKey(''); setRemoveApiKey(false); resetResult()
 }
 async function submit(action: 'test' | 'save') {
  if (blocked || pending.current || !valid) return
  pending.current = true; setBusy(action); setError(''); if(action==='test')setModels(null)
  const input: ConnectionInput = { ...(connection ? { id: connection.id } : {}), name: name.trim(), provider, baseUrl: selfHosted || provider === 'bedrock' ? baseUrl.trim() : '', ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}), ...(removeApiKey ? { removeApiKey: true } : {}),...(!connection&&action==='save'?{enabledModels:selectedModels}:{}) }
  try {
   if (action === 'test') {const available=await unwrap(services.chat.testConnection(input));setModels(available);if(!connection){setSelectedModels(old=>old.filter(model=>available.includes(model)));setSelecting(true)}}
   else { const saved = await unwrap(services.chat.saveConnection(input)); setApiKey(''); onSaved(saved.name) }
  } catch (e) { setError((e as Error).message) }
  finally { pending.current = false; setBusy(null) }
 }
 return <Dialog open onOpenChange={open => { if (!open) close() }}>
  <DialogContent className={`connection-dialog provider-setup-dialog ${selecting?'provider-selecting-models':''}`} showCloseButton={!closing && !busy} onCloseAutoFocus={onCloseAutoFocus} onOpenAutoFocus={event => { event.preventDefault(); nameInput.current?.focus(); nameInput.current?.select() }}>
   <div className="provider-dialog-heading"><ProviderLogo provider={provider} size={30}/><DialogTitle>{connection ? 'Edit connection' : selecting?'Choose your models':'Add provider'}</DialogTitle></div>
   <DialogDescription>{selecting?'Only the models you select will appear in Chat.':connection?'Update your connection details. Your selected models are kept.':'Connect a provider, then choose the models you want to use.'}</DialogDescription>
   <form onSubmit={event => { event.preventDefault(); void submit(!connection&&!selecting?'test':'save') }}>
    {!selecting&&<>
    {!connection&&<div className="provider-options" role="group" aria-label="Provider">{connectionProviders.filter(option=>!option.legacy).map(option=><button type="button" key={option.value} aria-pressed={provider===option.value} disabled={blocked} onClick={()=>changeProvider(option.value)}><ProviderLogo provider={option.value} size={23}/><span>{option.label}</span></button>)}</div>}
    <label htmlFor="connection-name">Name<Input ref={nameInput} id="connection-name" value={name} disabled={blocked} maxLength={120} required onChange={event => { setName(event.target.value); resetResult() }}/></label>
    {selfHosted && <label htmlFor="connection-endpoint">Endpoint<Input id="connection-endpoint" type="url" placeholder={provider === 'ollama' ? ollamaEndpoint : 'https://your-server/v1'} value={baseUrl} disabled={blocked} required onChange={event => { setBaseUrl(event.target.value); resetResult() }}/></label>}
    {provider === 'bedrock' && <div className="connection-region-field"><label>AWS region<SelectField label="AWS region" className="connection-region-select" value={bedrockRegion(baseUrl)} disabled={blocked} onValueChange={region=>{setBaseUrl(bedrockEndpoint(region));setSelectedModels([]);resetResult()}} options={bedrockRegions.map(([value,label])=>({value,label:`${label} · ${value}`}))}/></label><p className="connection-field-hint">Choose the region for your Bedrock API key and models.</p></div>}
    {provider !== 'ollama' && <div className="connection-key-field"><label htmlFor="connection-key">API key{provider === 'vllm' ? ' (optional)' : ''}<Input id="connection-key" type="password" autoComplete="new-password" spellCheck={false} value={apiKey} placeholder={savedKey ? 'Leave blank to keep saved key' : 'Enter API key'} disabled={blocked || removeApiKey} required={!selfHosted && !savedKey} onChange={event => { setApiKey(event.target.value); resetResult() }}/></label>
     <p className="connection-field-hint">{savedKey ? 'A key is saved. Enter a new key to replace it.' : 'Keys are stored securely on this Mac and are never shown again.'}</p>
     {provider === 'vllm' && connection?.hasApiKey && <Button className="connection-key-toggle" type="button" variant="ghost" disabled={blocked} onClick={() => { setRemoveApiKey(value => !value); setApiKey(''); resetResult() }}>{removeApiKey ? 'Keep saved key' : 'Remove saved key'}</Button>}
     {removeApiKey && <p className="connection-field-hint">The saved key will be removed when you save.</p>}
     {needsKeyChoice && <p className="connection-field-hint">{provider === 'bedrock' ? 'Enter a Bedrock API key for the selected region.' : 'To change the endpoint, enter a new key or remove the saved key.'}</p>}
    </div>}
    </>}
    {selecting&&models&&<ModelChecklist models={models} selected={selectedModels} onChange={setSelectedModels} disabled={blocked}/>}
    {error && <p className="chat-error" role="alert">{error}</p>}
    {!selecting&&models!==null&&<p className="connection-result" role="status">Connected · {models.length} models available</p>}
    <div className="connection-dialog-actions">
     {connection&&<Button type="button" variant="outline" disabled={blocked||!valid} onClick={()=>void submit('test')}>{busy==='test'?'Testing…':'Test connection'}</Button>}
     {selecting&&<Button type="button" variant="ghost" disabled={blocked} onClick={()=>setSelecting(false)}>Back</Button>}
     <span/>
     <Button type="button" variant="ghost" disabled={blocked} onClick={close}>Cancel</Button>
     <Button type="submit" disabled={blocked||!valid}>{busy==='test'?'Connecting…':busy==='save'?'Saving…':connection?'Save changes':selecting?`Add provider${selectedModels.length?` · ${selectedModels.length} selected`:''}`:'Connect & choose models'}</Button>
    </div>
   </form>
  </DialogContent>
 </Dialog>
}
