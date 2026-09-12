const {test}=require('node:test');const assert=require('node:assert/strict');
const {inConversationScope,pinnedFirst,conversationMatch,scopedChats}=require('../../../modules/chat/chat-organization.ts');
function chat(id,patch={}){return {id,title:'Chat '+id,connectionId:null,model:'',createdAt:1,updatedAt:1,messages:[],...patch}}
test('pins stay within their current project and existing order is stable',()=>{
 const input=[chat('a'),chat('b',{pinned:true}),chat('c',{projectId:'p',pinned:true}),chat('d',{pinned:true})];
 assert.deepEqual(scopedChats(input,'active',null).map(c=>c.id),['b','d','a']);assert.deepEqual(scopedChats(input,'active','p').map(c=>c.id),['c']);assert.deepEqual(input.map(c=>c.id),['a','b','c','d']);
 assert.deepEqual(pinnedFirst(input.map(c=>({...c,pinned:false}))).map(c=>c.id),['a','b','c','d']);
});
test('active, archive, and trash scopes are disjoint, including deleted archived chats',()=>{
 const items=[chat('a'),chat('b',{archivedAt:10}),chat('c',{deletedAt:20}),chat('d',{deletedAt:20,archivedAt:10})];
 assert.deepEqual(items.filter(c=>inConversationScope(c,'active')).map(c=>c.id),['a']);assert.deepEqual(items.filter(c=>inConversationScope(c,'archived')).map(c=>c.id),['b']);assert.deepEqual(items.filter(c=>inConversationScope(c,'trash')).map(c=>c.id),['c','d']);
});
test('message search produces a bounded snippet and precise navigation target',()=>{
 const c=chat('a',{messages:[{id:'m',content:'Prefix '.repeat(20)+'Needle '+ 'suffix '.repeat(30)}]});const found=conversationMatch(c,' needle ');assert.equal(found.messageId,'m');assert.match(found.snippet,/Needle/);assert.ok(found.snippet.length<140);assert.equal(conversationMatch(c,'absent'),null);assert.deepEqual(conversationMatch(c,'Chat'),{});
});
test('search can identify preserved versions without returning the wrong visible content',()=>{
 const c=chat('a',{messages:[{id:'m',content:'Current answer',activeVersionId:'new',versions:[{id:'old',content:'Earlier unique response'},{id:'new',content:'Current answer'}]}]});
 assert.equal(conversationMatch(c,'unique').versionId,'old');assert.equal(conversationMatch(c,'Current').versionId,undefined);
});
