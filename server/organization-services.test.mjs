import test from 'node:test';
import assert from 'node:assert/strict';
import {ORGANIZATION_SERVICES,fulfillOrganizationService} from './organization-services.mjs';

test('the paid integrity API computes the actual content digest and Unicode byte length',()=>{
 const result=fulfillOrganizationService('content-integrity','hello');
 assert.equal(result.sha256,'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
 assert.equal(result.utf8Bytes,5);assert.equal(result.unicodeCodePoints,5);
 const unicode=fulfillOrganizationService('content-integrity','💜');
 assert.equal(unicode.utf8Bytes,4);assert.equal(unicode.unicodeCodePoints,1);
 assert.notEqual(unicode.sha256,result.sha256);
});
test('document metrics process the submitted content rather than a canned response',()=>{
 const result=fulfillOrganizationService('text-metrics','Hello hello.\n\nWorld!');
 assert.equal(result.words,3);assert.equal(result.sentences,2);assert.equal(result.paragraphs,2);
 assert.deepEqual(result.recurringTerms[0],{term:'hello',count:2});
 assert.notDeepEqual(result,fulfillOrganizationService('text-metrics','A different document has five words.'));
});
test('suppliers have explicit positive base-unit pricing and reject invalid input',()=>{
 assert.equal(ORGANIZATION_SERVICES.length,2);
 for(const service of ORGANIZATION_SERVICES)assert(BigInt(service.price)>0n);
 for(const content of ['', '   ', 'x'.repeat(5001), null])assert.throws(()=>fulfillOrganizationService('text-metrics',content));
 assert.throws(()=>fulfillOrganizationService('unknown','Hello'));
});
