const {test}=require('node:test');const assert=require('node:assert/strict');
const {messageSources}=require('../../../modules/chat/chat-sources.ts');
const base={content:'[Article](https://example.com/article)',status:'complete',toolActivity:[{kind:'web_search',status:'complete'}]};
test('older search responses label extracted links as linked sources',()=>{const result=messageSources(base);assert.equal(result.linked,true);assert.deepEqual(result.sources,[{id:'1',url:'https://example.com/article',title:'Article'}]);});
test('native empty metadata does not turn model-written links into provider sources',()=>{const result=messageSources({...base,sources:[]});assert.equal(result.linked,false);assert.equal(result.missing,true);assert.deepEqual(result.sources,[]);});
test('source presentation rejects unsafe metadata and stays quiet during search or ordinary replies',()=>{assert.deepEqual(messageSources({...base,sources:[{id:'1',url:'javascript:bad',title:'Unsafe'}]}).sources,[]);assert.equal(messageSources({...base,status:'streaming',sources:[]}).missing,false);assert.equal(messageSources({...base,toolActivity:[]}).sources.length,0);assert.equal(messageSources({...base,content:'[Bad](https://user:pw@example.com/)'}).sources.length,0);});
const {withoutSourceAppendix}=require('../../../modules/chat/chat-sources.ts');
const sourceRows=[{id:'1',url:'https://example.com/one',title:'First article'},{id:'2',url:'https://example.com/two',title:'Second article'}];
const appendix='\n\nSources:\n[1](<https://example.com/one>)\n[2](<https://example.com/two>)';
test('duplicate generated source appendix becomes one structured source control',()=>{
 const answer='Claim with an inline citation [1](https://example.com/one).';
 assert.equal(withoutSourceAppendix(answer+appendix,sourceRows),answer);
 assert.equal(withoutSourceAppendix(answer+appendix+'\n',sourceRows),answer);
});
test('source cleanup preserves unrepresented links, authored prose and code examples',()=>{
 for(const [content,sources] of [['Answer'+appendix,sourceRows.slice(0,1)],['Answer'+appendix+'\nMore explanation.',sourceRows],['```md\nExample'+appendix,sourceRows],['A normal numbered [1](https://example.com/one).',sourceRows],['Answer'+appendix,[]]])assert.equal(withoutSourceAppendix(content,sources),content);
});
const {sourceForLink}=require('../../../modules/chat/chat-sources.ts');
test('inline citations resolve to the exact represented URL, including normalized root URLs',()=>{
 const sources=[{id:'1',url:'https://example.com/',title:'Home'},{id:'2',url:'https://example.com/article#section',title:'Article'}];
 assert.equal(sourceForLink('https://EXAMPLE.com:443',sources),sources[0]);
 assert.equal(sourceForLink('https://example.com/article#section',sources),sources[1]);
 for(const url of [undefined,'https://other.example/','https://example.com/article','https://user:secret@example.com/','javascript:alert(1)'])assert.equal(sourceForLink(url,sources),undefined);
});
const {isCitationLabel,citationSiteLabel}=require('../../../modules/chat/chat-sources.ts');
test('provider bracketed numeric links and plain numeric links both render as site citations',()=>{
 for(const text of ['2','[2]','[29]'])assert.equal(isCitationLabel(text),true);
 for(const text of ['Read the article','Chapter 2','[not a citation]'])assert.equal(isCitationLabel(text),false);
 assert.equal(citationSiteLabel('https://www.axios.com/news/article'),'axios.com');
 assert.equal(citationSiteLabel('https://blogs.nvidia.com/research'),'blogs.nvidia.com');
});
