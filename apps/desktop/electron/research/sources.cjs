'use strict';
const { createHash } = require('node:crypto');
const { isBundledArxiv, isBundledGmail, isBundledGoogle } = require('../mcp/catalog.cjs');
const schema = require('./schema.cjs');
const { allowedDomains } = require('./web-reader.cjs');
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const cut = (value, bytes) => { let result = ''; for (const ch of value) { bytes -= Buffer.byteLength(ch); if (bytes < 0) break; result += ch; } return result; };
const READS = {
 arxiv: ['search_papers', 'get_paper'], gmail: ['search_threads', 'get_thread', 'get_message', 'list_labels'],
 'google-drive': ['search_files', 'get_file', 'read_file'],
 'google-calendar': ['list_calendars', 'list_events', 'search_events', 'get_event', 'free_busy'],
};
function connector(service, selection) {
 const row = service?.list().find(r => r.id === selection.id);
 if (!row || ![isBundledArxiv, isBundledGmail, isBundledGoogle].some(test => test(row)))
  throw schema.fault('RESEARCH_CONNECTOR_UNSUPPORTED', 'This connector does not yet have a supported research read adapter. Its tools will not be activated.');
 if (row.status !== 'connected') throw schema.fault('RESEARCH_CONNECTOR_OFFLINE', 'Connect the selected research connector before continuing.');
 let names = READS[row.catalogId] ?? [];
 if (selection.scope.length) names = row.catalogId === 'arxiv' ? ['get_paper'] : row.catalogId === 'gmail' ? ['get_thread'] : row.catalogId === 'google-drive' ? ['get_file', 'read_file'] : names.filter(n => n !== 'list_calendars');
 // An arbitrary server's readOnlyHint is not authorization. These are reviewed
 // bundled endpoints and operations; schemas and enabled flags remain pinned.
 const tools = row.tools.filter(t => t.enabled && names.includes(t.name));
 if (!tools.length) throw schema.fault('RESEARCH_CONNECTOR_DISABLED', 'Enable a supported read tool for this connector before selecting it for research.');
 const revision = hash({ revision: row.revision, url: row.url, tools });
 const unit = { arxiv: 'paper IDs', gmail: 'thread IDs', 'google-drive': 'file IDs', 'google-calendar': 'calendar IDs' }[row.catalogId];
 return { row, tools, revision, scopeDescription: selection.scope.length ? `Only these ${unit}: ${selection.scope.join(', ')}` : row.catalogId === 'arxiv' ? 'Public paper metadata and abstracts; not full paper text.' : 'Search and read within this connected account. No changes or messages will be sent.' };
}
function checkConnectorScope(row, selection, name, args) {
 const scope = selection.scope; if (!scope.length) return;
 const values = row.catalogId === 'arxiv' ? [args.id] : row.catalogId === 'gmail' ? [args.threadId] : row.catalogId === 'google-drive' ? [args.fileId] : name === 'free_busy' ? args.calendarIds : [args.calendarId ?? 'primary'];
 schema.assert(Array.isArray(values) && values.length && values.every(v => typeof v === 'string' && scope.includes(v)), 'This connector request is outside the selected research scope.');
}
function localMaterial(chat, input, source, saved = []) {
 schema.assert(source.scope.length === 0, 'Local research references use their selected item ID, without an additional scope.');
 let item;
 if (source.kind === 'note') {
  const note = chat.getNotes().find(n => n.id === source.id && !n.deletedAt);
  if (note) item = { name: note.title || 'Untitled note', text: note.body, mime: 'text/markdown' };
 } else if (source.kind === 'project_file') item = input.projectId ? chat.project(input.projectId).files.find(f => f.id === source.id) : undefined;
 else {
  const conversation = chat.conversation(input.conversationId);
  const messages = [...conversation.messages, ...(conversation.branches ?? []).flatMap(b => b.messages)];
  item = chat.attachments.items.get(source.id) ?? messages.flatMap(m => m.attachments ?? []).find(f => f.id === source.id);
  // Pending files disappear from AttachmentService after a restart. The selected
  // copy already committed in this job remains available, never another chat's files.
  if (!item) { const snapshot = saved.find(m => m.sourceId === source.id); if (snapshot) return structuredClone(snapshot); }
 }
 if (!item) throw schema.fault('RESEARCH_SOURCE_MISSING', 'A selected research reference is no longer available. Restore it or start a new job.');
 if (item.kind === 'image' || typeof item.text !== 'string' || !item.text.trim()) throw schema.fault('RESEARCH_SOURCE_UNSUPPORTED', 'Research currently reads text and extracted PDF text. This selected reference has no supported text.');
 const value = { sourceId: source.id, title: item.name, text: item.text, mime: item.mime ?? 'text/plain' };
 schema.material([value]); return value;
}
function resolveSource(chat, input, source, saved) {
 if (source.kind === 'web') {
  allowedDomains(source.scope);
  return { ...source, label: 'Web', revision: 'public-https-reader-1', capability: 'search_read', scopeDescription: source.scope.length ? `Only these domains and their subdomains: ${source.scope.join(', ')}` : 'Search public web sources and read public HTTPS text pages.' };
 }
 if (source.kind === 'connector') {
  const result = connector(chat.connectors, source);
  return { ...source, label: result.row.name, revision: result.revision, capability: 'search_read', scopeDescription: result.scopeDescription };
 }
 const material = localMaterial(chat, input, source, saved);
 return { ...source, label: cut(material.title, 512), revision: hash(material), capability: 'read', scopeDescription: 'Only the explicitly selected text reference.' };
}
function evidence(job, source, { title, locator, text, url, level = 'excerpt', retrievedAt = Date.now(), tool, requestId }) {
 const excerpt = cut(text.replace(/\0/g, ''), 28000).trim();
 schema.assert(excerpt.length > 0, 'This source returned no readable evidence.');
 const contentHash = hash(excerpt), id = 'e-' + hash([source.id, locator, contentHash]).slice(0, 32);
 const prior = job.evidence.find(e => e.id === id); if (prior) return structuredClone(prior);
 return { id, sourceId: source.id, title: cut(title, 1024), locator: cut(locator, 4096), ...(url ? { url } : {}), retrievedAt, excerpt, contentHash, level, provenance: { tool, requestId } };
}
function connectorText(result) {
 if (!result || result.isError) throw schema.fault('RESEARCH_CONNECTOR_READ', 'The selected connector could not read this source.');
 const parts = (result.content ?? []).flatMap(p => p.type === 'text' && typeof p.text === 'string' ? [p.text] : p.type === 'resource' && typeof p.resource?.text === 'string' ? [p.resource.text] : []);
 const text = parts.join('\n');
 if (!text.trim()) throw schema.fault('RESEARCH_CONNECTOR_CONTENT', 'The connector returned no text. Binary documents are not read by this research adapter.');
 return { text, truncated: Buffer.byteLength(text) > 28000 || (result.content ?? []).some(p => p.type === 'image' || p.type === 'audio' || p.resource?.blob) };
}
module.exports = { hash, cut, connector, checkConnectorScope, localMaterial, resolveSource, evidence, connectorText };
