const {test}=require('node:test');const assert=require('node:assert/strict');
const {inspectToolSchema,validateToolArguments}=require('../electron/mcp/schema.cjs');
test('MCP schema defaults to 2020-12 and supports explicit draft seven',async()=>{
 const modern={type:'object',properties:{name:{type:'string'}},unevaluatedProperties:false};
 assert.equal(await validateToolArguments(modern,{name:'test'}),true);
 assert.equal(await validateToolArguments(modern,{name:'test',extra:1}),false);
 assert.equal(await validateToolArguments({...modern,$schema:'https://json-schema.org/draft/2020-12/schema'},{extra:1}),false);
 assert.equal(await validateToolArguments({$schema:'http://json-schema.org/draft-07/schema#',type:'object',properties:{a:{type:'integer'}},additionalProperties:false},{a:2}),true);
});
test('unsupported vocabularies, schemas, and external references fail closed',async()=>{
 assert.throws(()=>inspectToolSchema({$vocabulary:{'https://example.test/custom':true}}),/vocabulary/);
 assert.throws(()=>inspectToolSchema({$ref:'https://example.test/schema'}),/references/);
 await assert.rejects(validateToolArguments({type:'object',inventedValidation:true},{}),/Unsupported/);
});
test('adversarial regular expressions cannot block the app process',async()=>{
 let ticked=false;setTimeout(()=>{ticked=true},20);
 await assert.rejects(validateToolArguments({type:'object',properties:{name:{type:'string',pattern:'^(a+)+$'}}},{name:'a'.repeat(100)+'!'},{timeoutMs:400}),/time limit/);
 assert.equal(ticked,true);
 const controller=new AbortController();controller.abort();await assert.rejects(validateToolArguments({type:'object'},{},{signal:controller.signal}));
});
