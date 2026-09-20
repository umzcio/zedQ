'use strict';
const { researchCapabilities } = require('@zq/providers');
const { connector, localMaterial } = require('./sources.cjs');
const { assert } = require('./schema.cjs');
/** Metadata only: no credentials, provider calls, or connector activation. */
function catalog(chat, request = {}, disabledReason = '') {
 assert(request && typeof request === 'object' && !Array.isArray(request));
 assert(Object.keys(request).every(k => ['conversationId', 'projectId', 'choice', 'attachmentIds'].includes(k)));
 assert(request.conversationId === undefined || typeof request.conversationId === 'string');
 assert(request.projectId === undefined || request.projectId === null || typeof request.projectId === 'string');
 assert(request.choice === undefined || request.choice && typeof request.choice.connectionId === 'string' && typeof request.choice.model === 'string');
 const conversation = request.conversationId ? chat.conversation(request.conversationId) : null;
 const projectId = conversation ? conversation.projectId ?? null : request.projectId ?? null;
 const choice = conversation ? { connectionId: conversation.connectionId, model: conversation.model } : request.choice;
 const connection = chat.state.connections.find(c => c.id === choice?.connectionId);
 const model = connection && connection.enabledModels?.includes(choice?.model) ? researchCapabilities(connection.provider, choice.model) : { supported: false, reason: 'Choose an enabled Chat model for research.' };
 const notes = chat.getNotes(), local = Object.create(chat); local.getNotes = () => notes;
 const items = [], input = { conversationId: conversation?.id, projectId };
 const add = (selection, label, scopeKind = 'none', scopeDescription = '') => {
  let reason = '', description = scopeDescription;
  try {
   if (selection.kind === 'connector') description = connector(chat.connectors, selection).scopeDescription;
   else if (selection.kind !== 'web') {
    // Pending attachments can be listed before a new conversation exists.
    if (!conversation && selection.kind === 'attachment') {
     const item = chat.attachments.items.get(selection.id); assert(item && typeof item.text === 'string' && item.text.trim() && item.kind !== 'image', 'This attachment has no research-readable text.');
    } else localMaterial(local, input, selection);
   }
  } catch (error) { reason = error.researchSafe ? error.message : 'This source is unavailable for research.'; }
  items.push({ ...selection, label, available: !reason, reason, scopeKind, scopeDescription: description });
 };
 if (model.supported) add({ kind: 'web', id: 'web', scope: [] }, 'Web', 'domains', 'Public HTTPS text pages. Leave domains empty to search the public web.');
 for (const note of notes.filter(n => !n.deletedAt)) add({ kind: 'note', id: note.id, scope: [] }, note.title || 'Untitled note');
 if (projectId) for (const file of chat.project(projectId).files) add({ kind: 'project_file', id: file.id, scope: [] }, file.name);
 assert(Array.isArray(request.attachmentIds ?? []) && (request.attachmentIds ?? []).length <= 10 && (request.attachmentIds ?? []).every(id => typeof id === 'string'));
 const history = conversation?.messages.flatMap(m => m.attachments ?? []) ?? [];
 for (const id of new Set([...(request.attachmentIds ?? []), ...history.map(a => a.id)])) {
  const file = chat.attachments.items.get(id) ?? history.find(a => a.id === id);
  add({ kind: 'attachment', id, scope: [] }, file?.name ?? 'Unavailable attachment');
 }
 for (const row of chat.connectors?.list() ?? []) add({ kind: 'connector', id: row.id, scope: [] }, row.name, ({ arxiv: 'papers', gmail: 'threads', 'google-drive': 'files', 'google-calendar': 'calendars' })[row.catalogId] ?? 'none');
 const endpointReason = connection && model.supported && connection.baseUrl !== ({ openai: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com/v1' })[connection.provider] ? 'Research currently supports the official provider endpoint only.' : '';
 const contextReason = conversation?.deletedAt || conversation?.archivedAt ? 'Restore this chat before starting research.' : conversation && (chat.runs.has(conversation.id) || conversation.queue?.items.length || conversation.messages.some(m => m.interactions?.some(i => i.status === 'waiting'))) ? 'Finish the response and clear queued messages before starting research.' : '';
 return { enabled: !disabledReason, supported: !!model.supported && !contextReason && !endpointReason, reason: disabledReason || contextReason || endpointReason || model.reason || '', sources: items };
}
module.exports = { catalog };
