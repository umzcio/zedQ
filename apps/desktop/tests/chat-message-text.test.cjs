const {test}=require('node:test');
const assert=require('node:assert/strict');
const {plainMessage,sourceMessageLink,messageMatches,codeTokens,codeFilename}=require('../../../modules/chat/message-text.ts');
test('plain message copy keeps citations and literal code while removing formatting',()=>{
 assert.equal(plainMessage('# Heading\n\n**Answer** [1](<https://example.com/source>)\n\n```js\nconst x = "**literal**";\n```\n\nUse `**literal**`.'),'Heading\n\nAnswer 1 (https://example.com/source)\n\nconst x = "**literal**";\n\nUse **literal**.');
});
test('source links encode untrusted identifiers instead of injecting link structure',()=>{
 assert.equal(sourceMessageLink('abc/def','a&b'),'zq://chat/abc%2Fdef?message=a%26b');
 assert.equal(sourceMessageLink('chat','message','old&1'),'zq://chat/chat?message=message&version=old%261');
});
test('find matches text case insensitively and excludes empty queries',()=>{
 assert.equal(messageMatches('Hello WORLD',' world '),true);
 assert.equal(messageMatches('Hello','   '),false);
 assert.equal(messageMatches('Hello','goodbye'),false);
});
test('syntax tokens reconstruct exact source and classify language tokens',()=>{
 for(const [language,code] of [['typescript','const x = "hello"; // comment\nreturn 42'],['python','# hello\ndef x():\n return True'],['sql','SELECT 5 FROM users -- query'],['html','<!-- comment --><div class="x">Hi</div>'],['unknown','<script>anything</script>']]){
  const tokens=codeTokens(code,language);assert.equal(tokens.map(t=>t.text).join(''),code);
  if(language==='typescript'){assert.ok(tokens.some(t=>t.kind==='keyword'&&t.text==='const'));assert.ok(tokens.some(t=>t.kind==='string'));assert.ok(tokens.some(t=>t.kind==='comment'));assert.ok(tokens.some(t=>t.kind==='number'));}
 }
});
test('large code blocks avoid expensive tokenization and filenames remain inert',()=>{
 const text='const x=1;'.repeat(11000);assert.equal(codeTokens(text,'js').length,1);
 assert.equal(codeFilename('typescript'),'snippet.ts');assert.equal(codeFilename('../../bad'),'snippet.txt');assert.equal(codeFilename(''),'snippet.txt');
});
