'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { catalog } = require('../electron/research/catalog.cjs');
const { ChatService } = require('../electron/chat-service.cjs');
const { ChatStore } = require('../electron/chat-store.cjs');
function fixture() {
 const conversation = { id: 'chat', connectionId: 'account', model: 'gpt-5', projectId: null, messages: [] };
 const connection = { id: 'account', provider: 'openai', baseUrl: 'https://api.openai.com/v1', enabledModels: ['gpt-5'] };
 const chat = { state: { connections: [connection] }, runs: new Map(), getNotes: () => [{ id: 'note', title: 'Measurements', body: 'PRIVATE CONTENT' }], conversation: () => conversation,
  project: () => { throw Error('Unexpected project access'); }, attachments: { items: new Map() }, connectors: { list: () => [{ id: 'custom', name: 'Unsupported connector', catalogId: 'custom' }] } };
 return { chat, connection, conversation };
}
test('source catalog returns metadata without credentials, source bodies, or connector calls', () => {
 const f = fixture(), result = catalog(f.chat, { conversationId: 'chat', projectId: 'unrelated-project' });
 assert.equal(result.supported, true); assert.equal(result.enabled, true);
 assert.deepEqual(result.sources.map(s => s.id), ['web', 'note', 'custom']);
 assert.equal(result.sources[1].available, true); assert.equal(result.sources[2].available, false);
 assert.doesNotMatch(JSON.stringify(result), /PRIVATE CONTENT/);
});
test('catalog explains unsupported endpoints, busy chats, and the release gate', () => {
 const f = fixture(); f.connection.baseUrl = 'https://proxy.example/v1';
 assert.equal(catalog(f.chat, { conversationId: 'chat' }).supported, false);
 f.connection.baseUrl = 'https://api.openai.com/v1'; f.conversation.queue = { items: [{}] };
 assert.match(catalog(f.chat, { conversationId: 'chat' }).reason, /queued/);
 const gated = catalog(f.chat, { conversationId: 'chat' }, 'Report publishing is not ready.');
 assert.equal(gated.enabled, false); assert.match(gated.reason, /publishing/);
 assert.throws(() => catalog(f.chat, { choice: 'bad' }));
});
test('catalog includes only requested pending attachments and this conversation history', () => {
 const f = fixture(); f.chat.attachments.items.set('chosen', { name: 'Chosen.txt', text: 'SELECTED BODY', mime: 'text/plain' });
 f.chat.attachments.items.set('other', { name: 'Other.txt', text: 'UNSELECTED BODY' });
 const result = catalog(f.chat, { choice: { connectionId: 'account', model: 'gpt-5' }, attachmentIds: ['chosen'] });
 assert.equal(result.sources.find(s => s.id === 'chosen').available, true);
 assert.ok(!result.sources.some(s => s.id === 'other')); assert.doesNotMatch(JSON.stringify(result), /SELECTED BODY/);
});
test('research draft sources and scopes survive reload; invalid edits preserve the saved draft', t => {
 const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zq-research-draft-'));
 const service = new ChatService({ directory }); t.after(() => { service.shutdown(); fs.rmSync(directory, { recursive: true, force: true }); });
 const research = { mode: true, sources: [{ kind: 'web', id: 'web', scope: ['example.org'] }] };
 service.saveDraft({ id: 'new:general', text: 'Compare the evidence', research });
 assert.deepEqual(new ChatStore(directory).load().drafts['new:general'].research, research);
 assert.throws(() => service.saveDraft({ id: 'new:general', research: { mode: true, sources: [{ kind: 'shell', id: 'command', scope: [] }] } }));
 assert.equal(new ChatStore(directory).load().drafts['new:general'].text, 'Compare the evidence');
});
