// Controlled generated-Compact + installed SDK integration. No network, actual
// proving, fee signing, wallet credentials or chain acceptance is involved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as R from '@midnight-ntwrk/compact-runtime';
import * as L from '@midnight-ntwrk/ledger-v8';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { createUnprovenCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import * as generated from '../contracts/managed/organization/contract/index.js';
import { WITNESSES, blankPrivate } from '../src/lib/line/compact-harness.ts';
import { pad32, issuerPublicKey, merchantPublicKey, agentId, quoteCommit, toHex } from '../src/lib/line/encoding.ts';
import { MidnightAgentAdapter, prepareAgentClaim, redemptionNoteCommitment } from './agent-midnight.mjs';

test('actual SDK constructs the generated draw and reaches the external prover boundary without submitting', async () => {
  const address = R.dummyContractAddress(), issuer = pad32('sdk-control-issuer');
  const agent = pad32('sdk-control-agent'), merchant = pad32('sdk-control-merchant');
  const salt = pad32('sdk-control-salt'), expiry = BigInt(Math.floor(Date.now()/1000)+3600);
  const ps = blankPrivate({callerSecret:issuer,agentSecret:agent,salt,lineLimit:1000000n});
  const contract = new generated.Contract(WITNESSES);
  let state = contract.initialState(R.createConstructorContext(ps,'0'.repeat(64)),issuerPublicKey(issuer),merchantPublicKey(merchant),pad32('sdk-control-instance'),{bytes:pad32('sdk-control-owner')},{bytes:pad32('sdk-control-payee')},new Uint8Array(32)).currentContractState;
  const call = (name,args,overrides={}) => {
    const ctx = R.createCircuitContext(address,'0'.repeat(64),state,{...ps,...overrides},undefined,undefined,Number(expiry-1800n));
    ctx.currentQueryContext.block = {...ctx.currentQueryContext.block,balance:new Map([[{tag:'unshielded',raw:'00'.repeat(32)},1000000n]])};
    const result = contract.circuits[name](ctx,...args);
    const next = new R.ContractState(); next.data = result.context.currentQueryContext.state; state = next;
  };
  call('fundReserve',[1000000n]);
  call('openLine',[expiry,1000n,100n]);
  const invoiceId = pad32('sdk-control-invoice'), quoteNonce = pad32('sdk-control-quote');
  call('postQuote',[expiry],{callerSecret:merchant,invoiceId,quoteNonce,quoteAmount:50000n});
  const ledger = generated.ledger(state.data);
  const book = {facilityAddress:address,domain:toHex(ledger.contractDomain),agentSecret:toHex(agent),agentPk:toHex(agentId(agent)),salt:toHex(salt),limit:1000000n,outstanding:0n,epoch:0n,generation:1n};
  const quote = {contractAddress:address,domain:book.domain,merchantPk:toHex(merchantPublicKey(merchant)),invoiceId:toHex(invoiceId),quoteNonce:toHex(quoteNonce),amount:50000n,expiry,generation:1n,feeFlat:1000n,feeBps:100n};
  quote.quoteCommitment = toHex(quoteCommit({domain:ledger.contractDomain,merchantPk:merchantPublicKey(merchant),invoiceId,nonce:quoteNonce,amount:quote.amount,expiry,generation:1n,feeFlat:1000n,feeBps:100n}));
  const candidate = prepareAgentClaim(book,quote,{noteNonce:toHex(pad32('sdk-control-note')),noteSalt:toHex(pad32('sdk-control-note-salt')),newSalt:toHex(pad32('sdk-control-next'))});
  // Retain real public operation-key encodings, replacing only fixture state data.
  // The historical fixture is not evidence of this synthetic transaction's validity.
  const operations = R.ContractState.deserialize(Buffer.from(readFileSync(new URL('../tests/fixtures/organization-closed-state.hex',import.meta.url),'utf8').trim(),'hex'));
  operations.data = state.data;
  const adapter = new MidnightAgentAdapter();
  adapter.sourceFingerprint = '12'.repeat(32);
  adapter.inspect = async () => ledger;
  const witnessNames = JSON.parse(readFileSync(new URL('../contracts/managed/organization/compiler/contract-info.json',import.meta.url),'utf8')).witnesses.map(w=>w.name);
  const witnesses = Object.fromEntries(witnessNames.map(name=>[name,ctx=>{
    assert.notEqual(adapter.input?.[name],undefined,`Missing ${name}`);
    return [ctx.privateState,adapter.input[name]];
  }]));
  adapter.compiled = CompiledContract.make('line-organization',generated.Contract).pipe(CompiledContract.withWitnesses(witnesses),CompiledContract.withCompiledFileAssets('contracts/managed/organization'));
  let proverCalls=0, balanceCalls=0, submissions=0;
  adapter.providers = {
    publicDataProvider:{async queryZSwapAndContractState(requested){assert.equal(requested,address);return [new L.ZswapChainState(),operations,L.LedgerParameters.initialParameters()];}},
    privateStateProvider:{async get(){return {};}},
    walletProvider:{getCoinPublicKey:()=> '00'.repeat(32),getEncryptionPublicKey:()=> '00'.repeat(32),async balanceTx(){balanceCalls++;throw Error('Unexpected balance');}},
    zkConfigProvider:{async getVerifierKey(name){return operations.operation(name).verifierKey;}},
    proofProvider:{async proveTx(tx){
      proverCalls++;
      const actions=[...tx.intents.values()].flatMap(intent=>intent.actions);
      assert.equal(actions.length,1);assert.equal(actions[0].address,address);assert.equal(actions[0].entryPoint,'draw');
      throw Error('Controlled external prover boundary');
    }},
    midnightProvider:{async submitTx(){submissions++;throw Error('Must not submit');}},
  };
  await assert.rejects(adapter.prepareDraw({book,quote,...candidate,ownerAddress:'unused-controlled-inspect'}),/Controlled external prover boundary/);
  assert.equal(proverCalls,1);assert.equal(balanceCalls,0);assert.equal(submissions,0);
  assert.equal(adapter.input,null);assert.equal(adapter.preparing,false);
  // The exact release's generated redemption query binds its public note key.
  // Exercise the SDK partitioner as well as historical public fixture parsing.
  call('draw',[Buffer.from(quote.quoteCommitment,'hex'),expiry,candidate.candidateNote.fee],{callerSecret:agent,invoiceId,quoteNonce,quoteAmount:quote.amount,drawAmount:quote.amount,quoteMerchantPk:merchantPublicKey(merchant),noteNonce:pad32('sdk-control-note'),noteSalt:pad32('sdk-control-note-salt'),newSalt:pad32('sdk-control-next')});
  operations.data = state.data;
  adapter.input = {callerSecret:merchant,noteIdentity:agentId(agent),noteQuoteCommit:Buffer.from(quote.quoteCommitment,'hex'),noteNonce:pad32('sdk-control-note'),noteSalt:pad32('sdk-control-note-salt'),redeemAmount:quote.amount};
  const redemption = await createUnprovenCallTx(adapter.providers,{compiledContract:adapter.compiled,contractAddress:address,circuitId:'redeemDraw',privateStateId:'controlled-redeem',args:[Buffer.from(candidate.candidateNote.noteCommitment,'hex'),expiry]});
  assert.equal(redemptionNoteCommitment(redemption.private.unprovenTx,address),candidate.candidateNote.noteCommitment);
  assert.ok(redemption.public.nextContractState);
  adapter.input=null;
});
