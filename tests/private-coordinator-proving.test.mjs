import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {validateCoordinatorProofConfig,coordinatorProofDirectory} from '../scripts/private-coordinator-proving.mjs';
import {EncryptedCheckoutStore} from '../server/checkout-storage.ts';
const sha=b=>createHash('sha256').update(b).digest('hex');
const scope={networkId:'synthetic-preview',sourceSha256:sha(readFileSync('contracts/experimental/line-private-offer.compact')),executableSha256:'0'.repeat(64)};

test('local coordinator proving rejects network-mode substitution and changed Compact source',()=>{
 assert.throws(()=>validateCoordinatorProofConfig({}, {...scope,networkId:'preprod'}));
 assert.throws(()=>validateCoordinatorProofConfig({managedDir:'.'}, {...scope,sourceSha256:'0'.repeat(64)}));
});

test('proof cache is separate from the financial store and cannot pollute its dedicated directory',async()=>{
 mkdirSync('.compact-keys',{recursive:true});const root=mkdtempSync(resolve('.compact-keys/proof-store-isolation-')),directory=join(root,'financial');
 const cache=coordinatorProofDirectory(directory,'draw:1');assert.equal(resolve(cache,'..'),root);
 assert.notEqual(cache,coordinatorProofDirectory(directory,'draw:2'));assert.throws(()=>coordinatorProofDirectory(directory,'../draw'));
 const financial=await EncryptedCheckoutStore.openBound(directory,'synthetic-owner-password',sha(Buffer.from('financial')));
 const proof=await EncryptedCheckoutStore.openBound(cache,'synthetic-owner-password',sha(Buffer.from('proof')));
 try{await proof.save('66666666-6666-4666-8666-666666666666',{publicBytes:new Uint8Array([1,2,3])});assert.deepEqual(await financial.loadAll(),[]);}finally{await proof.close();await financial.close();}
 const reopened=await EncryptedCheckoutStore.openBound(directory,'synthetic-owner-password',sha(Buffer.from('financial')));try{assert.deepEqual(await reopened.loadAll(),[]);}finally{await reopened.close();}
});

test('local coordinator proving rejects changed generated executable and unpinned key manifest',()=>{
 mkdirSync('.compact-keys',{recursive:true});const root=mkdtempSync(resolve('.compact-keys/proof-config-denial-')),managedDir=join(root,'managed');
 mkdirSync(join(managedDir,'contract'),{recursive:true});mkdirSync(join(managedDir,'compiler'));
 const executable=Buffer.from('// Invalid fixture. Never imported or executed.');writeFileSync(join(managedDir,'contract/index.js'),executable);
 assert.throws(()=>validateCoordinatorProofConfig({managedDir},scope));
 writeFileSync(join(managedDir,'compiler/contract-info.json'),'{}');writeFileSync(join(root,'key-generation.json'),JSON.stringify({complete:false}));
 assert.throws(()=>validateCoordinatorProofConfig({managedDir,keyManifestSha256:'0'.repeat(64)},{...scope,executableSha256:sha(executable)}));
});
