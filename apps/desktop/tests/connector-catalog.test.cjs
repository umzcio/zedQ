'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {getCatalog,getCatalogEntry,isBundledArxiv}=require('../electron/mcp/catalog.cjs');
test('starter catalog exposes exactly the approved publishers and account types',()=>{
 const rows=getCatalog();assert.deepEqual(rows.map(r=>r.id),['scite','arxiv','gmail','google-calendar','google-drive','microsoft365','github']);
 for(const row of rows){assert.equal(new URL(row.url).protocol,'https:');assert.equal(new URL(row.documentationUrl).protocol,'https:');assert.ok(row.description&&row.setupNote);assert.equal(row.token,undefined);assert.equal(row.clientSecret,undefined);}
 for(const id of ['gmail','google-calendar','google-drive']){const row=getCatalogEntry(id);assert.equal(row.accountLabel,'Personal Google account');assert.equal(row.requiresSetup,true);assert.match(row.setupNote,/developer preview/);assert.equal(row.redirectPort,43187);}
 assert.equal(getCatalogEntry('microsoft365').accountLabel,'Work Microsoft account');assert.equal(getCatalogEntry('github').authType,'bearer');
});
test('catalog snapshots cannot mutate trusted defaults and bundled routing binds exact identity',()=>{
 const rows=getCatalog();rows[1].url='https://attacker.example';assert.equal(getCatalogEntry('arxiv').url,'https://export.arxiv.org/api/query');
 assert.equal(isBundledArxiv({catalogId:'arxiv',url:getCatalogEntry('arxiv').url}),true);
 assert.equal(isBundledArxiv({catalogId:'arxiv',url:'https://attacker.example'}),false);
 assert.equal(isBundledArxiv({name:'arXiv',url:getCatalogEntry('arxiv').url}),false);
});
