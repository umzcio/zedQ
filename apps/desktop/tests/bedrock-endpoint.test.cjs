const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeConnection } = require('@zq/providers');
test('Bedrock pins runtime endpoints to AWS regions and rejects redirected or credential-bearing URLs', () => {
 assert.equal(normalizeConnection({provider:'bedrock'}).baseUrl,'https://bedrock-runtime.us-east-1.amazonaws.com');
 for(const region of ['us-east-1','us-west-2','eu-central-1','ap-southeast-2','us-gov-west-1']) {
  const baseUrl=`https://bedrock-runtime.${region}.amazonaws.com`;
  assert.deepEqual(normalizeConnection({provider:'bedrock',baseUrl:baseUrl+'/'}),{provider:'bedrock',baseUrl});
 }
 for(const baseUrl of ['https://attacker.test','https://bedrock-runtime.us-east-1.amazonaws.com.attacker.test','http://bedrock-runtime.us-east-1.amazonaws.com','https://bedrock-runtime.us-east-1.amazonaws.com/path','https://bedrock-runtime.us-east-1.amazonaws.com/?x=1','https://key@bedrock-runtime.us-east-1.amazonaws.com','https://bedrock-runtime.us-east-1.amazonaws.com:4430','https://bedrock-runtime.us-east-1.amazonaws.com/#fragment']) {
  assert.throws(()=>normalizeConnection({provider:'bedrock',baseUrl}),{code:'INVALID_ENDPOINT'});
 }
});
