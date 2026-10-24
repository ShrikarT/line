import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as L from '@midnight-ntwrk/ledger-v8';
import { bech32m } from '@scure/base';
import { agentGrantMessage, browserAgentGrantDigest, verifyBrowserGrantOwner, walletAgentGrantProof } from '../src/lib/agent/grant.ts';
import { organizationMessageBytes } from '../src/lib/organization/signing.ts';
import { agentGrantDigest } from '../server/agent-authorization.mjs';
import { organizationSigningBytes } from '../server/organization-auth.mjs';
import type { AgentGrantScope } from '../src/lib/agent/types.ts';

function fixture() {
  const key=L.sampleSigningKey(),verifyingKey=L.signatureVerifyingKey(key);
  const scope:AgentGrantScope={schema:'line:agent-grant/v1',grantId:randomUUID(),networkId:'preprod',facilityAddress:'11'.repeat(32),domain:'22'.repeat(32),sourceFingerprint:'33'.repeat(32),ownerAddress:bech32m.encodeFromBytes('mn_addr_preprod',Buffer.from(L.addressFromKey(verifyingKey),'hex')),runnerOrigin:'http://127.0.0.1:8000',runnerPublicKey:'44'.repeat(32),runnerSigningPublicKey:'55'.repeat(32),returnPublicKey:'66'.repeat(32),agentPk:'77'.repeat(32),generation:'2',bookCommitment:'88'.repeat(32),nonce:'99'.repeat(32),issuedAt:1000,expiresAt:2000,maxSpend:'100000',maxFee:'1500',allowedServices:['line-doc-extract-v1'],allowedMerchants:['aa'.repeat(32)]};
  const proof={verifyingKey,signature:L.signData(key,organizationSigningBytes(agentGrantMessage(scope)))};
  return {scope,proof};
}

test('browser and server share canonical grant digest and exact UTF-8 wallet signature bytes',async()=>{
  const {scope,proof}=fixture();
  assert.equal(await browserAgentGrantDigest(scope),agentGrantDigest(scope));
  await verifyBrowserGrantOwner(scope,proof);
  const connectorProof=walletAgentGrantProof({data:agentGrantMessage(scope),signature:proof.signature.toUpperCase(),verifyingKey:proof.verifyingKey.toUpperCase()});
  assert.deepEqual(connectorProof,proof);
  await verifyBrowserGrantOwner(scope,connectorProof);
  assert.deepEqual(Buffer.from(organizationMessageBytes('💜')),organizationSigningBytes('💜'));
  assert.equal(Buffer.from(organizationMessageBytes('💜')).toString(),'midnight_signed_message:4:💜');
  await assert.rejects(verifyBrowserGrantOwner({...scope,maxSpend:'100001'},proof),/owner signature is invalid/);
  await assert.rejects(verifyBrowserGrantOwner(scope,{...proof,signature:'ff'.repeat(64)}),/owner signature is invalid/);
});

test('browser verification captures signature material before asynchronous ledger loading',async()=>{
  const {scope,proof}=fixture();
  const verifying=verifyBrowserGrantOwner(scope,proof);
  proof.signature='ff'.repeat(64);
  await verifying;
  assert.throws(()=>agentGrantMessage({...scope,ownerAddress:scope.ownerAddress.slice(0,-1)+'x'}),/receiving wallet/);
  const accessor={...scope};Object.defineProperty(accessor,'maxSpend',{enumerable:true,get(){return '100000';}});
  assert.throws(()=>agentGrantMessage(accessor),/Unexpected agent grant fields/);
  const sparse={...scope,allowedServices:new Array<string>(1)};
  assert.throws(()=>agentGrantMessage(sparse),/supplier scope/);
  let reads=0;const services=['line-doc-extract-v1'];
  Object.defineProperty(services,'0',{enumerable:true,get(){reads++;return 'line-doc-extract-v1';}});
  assert.throws(()=>agentGrantMessage({...scope,allowedServices:services}),/supplier scope/);
  assert.equal(reads,0,'canonical grant validation never executes supplier-scope getters');
});
