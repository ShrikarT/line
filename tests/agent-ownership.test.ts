import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as L from '@midnight-ntwrk/ledger-v8';
import { bech32m } from '@scure/base';
import { agentId, contractDomain, issuerPublicKey, merchantPublicKey, lineStateCommit, pad32, toHex } from '../src/lib/line/encoding.ts';
import { encryptSecret, encodeVaultJson } from '../src/lib/security/vault.ts';
import { organizationAccountKey, type OrganizationRecord } from '../src/lib/organization/account.ts';
import { validateOrganizationRecord, decodeOrganizationBackup } from '../src/lib/organization/backup.ts';
import { validateBrowserDelegations, assertDelegatedSnapshotStable, type BrowserAgentDelegation } from '../src/lib/agent/ownership.ts';
import { generateX25519KeyPair, encryptBookOpening, createPairingPackage } from '../src/lib/agent/pairing.ts';
import { agentGrantMessage, browserAgentGrantDigest } from '../src/lib/agent/grant.ts';
import { organizationMessageBytes } from '../src/lib/organization/signing.ts';

async function fixture() {
  const issuer=pad32('delegation-control-issuer'),agent=pad32('delegation-control-agent'),merchant=pad32('delegation-control-merchant');
  const ownerKey=L.sampleSigningKey(),verifyingKey=L.signatureVerifyingKey(ownerKey),owner=bech32m.encodeFromBytes('mn_addr_preprod',Buffer.from(L.addressFromKey(verifyingKey),'hex'));
  const nonce=pad32('delegation-control-instance'),salt=pad32('delegation-control-salt');
  const domain=contractDomain(issuerPublicKey(issuer),merchantPublicKey(merchant),nonce),identity=agentId(agent);
  const runner=await generateX25519KeyPair(),returned=await generateX25519KeyPair();
  const record:OrganizationRecord={snapshot:{schema:'line:organization-account/v1',networkId:'preprod',accountId:'11'.repeat(32),issuerSecret:toHex(issuer),merchantSecret:toHex(merchant),facilities:[{id:randomUUID(),name:'Controlled facility',address:'ab'.repeat(32),instanceNonce:toHex(nonce),maintenanceKey:'33'.repeat(32),assetColor:'00'.repeat(32),issuerRecipient:owner,merchants:[{name:'Controlled merchant',publicKey:toHex(merchantPublicKey(merchant)),address:owner}],agentSecret:toHex(agent),salt:toHex(salt),limit:1000000n,outstanding:100000n,epoch:1n,generation:2n}],quotes:[],notes:[],receipts:[]},pending:null};
  const scope={schema:'line:agent-grant/v1' as const,grantId:randomUUID(),networkId:'preprod' as const,facilityAddress:'ab'.repeat(32),domain:toHex(domain),sourceFingerprint:'44'.repeat(32),ownerAddress:owner,runnerOrigin:'http://127.0.0.1:8000',runnerPublicKey:runner.publicKeyHex,runnerSigningPublicKey:L.signatureVerifyingKey(L.sampleSigningKey()),returnPublicKey:returned.publicKeyHex,agentPk:toHex(identity),generation:'2',bookCommitment:toHex(lineStateCommit({domain,identity,limit:1000000n,outstanding:100000n,epoch:1n},salt)),nonce:'55'.repeat(32),issuedAt:1000,expiresAt:2000,maxSpend:'100000',maxFee:'1500',allowedServices:['line-doc-extract-v1'],allowedMerchants:[toHex(merchantPublicKey(merchant))]};
  const entry:BrowserAgentDelegation={schema:'line:browser-agent-delegation/v1',facilityId:record.snapshot.facilities[0].id,scope,returnPrivateKey:returned.privateKeyHex,phase:'staged',stagedAt:1000,package:null};
  record.delegations=[entry];
  return {record,entry,ownerKey,verifyingKey,runner,returned};
}

test('staged and export-ready fences survive encrypted backup without nesting into candidates',async()=>{
  const {record,entry,ownerKey,verifyingKey}=await fixture();
  const key=organizationAccountKey('preprod',record.snapshot.accountId);
  for (const phase of ['staged','export-ready'] as const) {
    if (phase==='export-ready') {
      const proof={verifyingKey,signature:L.signData(ownerKey,organizationMessageBytes(agentGrantMessage(entry.scope)))};
      const f=record.snapshot.facilities[0];
      entry.package=createPairingPackage(entry.scope,proof,await encryptBookOpening({purpose:'line:agent-pairing/v1',recipientPublicKeyHex:entry.scope.runnerPublicKey,grantDigest:await browserAgentGrantDigest(entry.scope),nonce:entry.scope.nonce,payload:{agentSecret:f.agentSecret,salt:f.salt,limit:f.limit.toString(),outstanding:f.outstanding.toString(),epoch:f.epoch.toString(),generation:f.generation.toString()}}));
      entry.phase=phase;
    }
    const backup=await encryptSecret(key,encodeVaultJson(record),'ControlledBackup123!');
    assert.deepEqual(await decodeOrganizationBackup(JSON.stringify(backup),'ControlledBackup123!',key,record.snapshot.accountId),record);
    const candidate=structuredClone(record.snapshot);
    assert.equal('delegations' in candidate,false);
    const pending={id:'controlled-pause',kind:'call' as const,circuit:'setStatus',facilityId:entry.facilityId,contractAddress:entry.scope.facilityAddress,sourceFingerprint:entry.scope.sourceFingerprint,after:candidate,txId:null,transaction:null};
    assert.doesNotThrow(()=>validateOrganizationRecord({...record,pending},record.snapshot.accountId));
    assert.throws(()=>validateOrganizationRecord({...record,pending:{...pending,circuit:'draw'}},record.snapshot.accountId));
  }
});

test('fences bind exact private book/domain/identity/generation and forbid ambiguous or duplicate ownership',async()=>{
  const {record}=await fixture();
  for (const change of [
    (r:OrganizationRecord)=>{r.snapshot.facilities[0].outstanding+=1n;},
    (r:OrganizationRecord)=>{r.snapshot.facilities[0].generation+=1n;},
    (r:OrganizationRecord)=>{r.snapshot.facilities[0].agentSecret='ff'.repeat(32);},
    (r:OrganizationRecord)=>{r.delegations!.push(structuredClone(r.delegations![0]));},
    (r:OrganizationRecord)=>{(r.delegations![0] as any).phase='released';},
    (r:OrganizationRecord)=>{(r.snapshot as any).delegations=r.delegations;},
  ]) {const bad=structuredClone(record);change(bad);assert.throws(()=>validateOrganizationRecord(bad,record.snapshot.accountId));}
  assert.deepEqual(validateBrowserDelegations(undefined,record.snapshot),[]);
  const legacy=structuredClone(record);delete legacy.delegations;
  assert.deepEqual(validateOrganizationRecord(legacy,record.snapshot.accountId),legacy);
});

test('ordinary candidate commits preserve delegated facilities while allowing other facilities and receipts',async()=>{
  const {record}=await fixture(),before=record.snapshot,next=structuredClone(before);
  next.facilities.push({...next.facilities[0],id:randomUUID(),address:'cd'.repeat(32)});
  assert.doesNotThrow(()=>assertDelegatedSnapshotStable(before,next,record.delegations!));
  next.facilities[0].salt='ee'.repeat(32);
  assert.throws(()=>assertDelegatedSnapshotStable(before,next,record.delegations!));
  assert.throws(()=>assertDelegatedSnapshotStable(before,{...before,issuerSecret:'ff'.repeat(32)},record.delegations!));
});
