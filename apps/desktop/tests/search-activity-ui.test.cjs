const {test}=require('node:test'),assert=require('node:assert/strict');
const {searchActivitySummary}=require('../../../modules/chat/search-activity.ts');
const tool=(id,status='complete',kind='web_search')=>({id,status,kind});
test('search activity becomes one summary without including document or code tools',()=>{
 assert.equal(searchActivitySummary([tool('doc','complete','create_document')]),null);
 const result=searchActivitySummary([tool('a'),tool('doc','complete','create_document'),tool('b')]);
 assert.equal(result.firstId,'a');assert.equal(result.count,2);assert.equal(result.label,'Searched the web');assert.equal(result.running,false);
});
test('summary represents running, failed, interrupted, and mixed search outcomes honestly',()=>{
 assert.equal(searchActivitySummary([tool('a'),tool('b','running')]).label,'Searching the web');
 assert.equal(searchActivitySummary([tool('a'),tool('b','error')]).label,'Search finished with errors');
 assert.equal(searchActivitySummary([tool('a','error')]).label,'Search failed');
 assert.equal(searchActivitySummary([tool('a','interrupted')]).label,'Search interrupted');
 assert.equal(searchActivitySummary([tool('a'),tool('b','stopped')]).label,'Search stopped');
 assert.equal(searchActivitySummary([tool('a','complete','x_search')]).label,'Searched X');
 assert.equal(searchActivitySummary([tool('a'),tool('b','running','x_search')]).label,'Searching web and X');
});
