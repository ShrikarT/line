#!/usr/bin/env node
/** Synthetic generated-code controls only; run inside the documented isolated sandbox. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as RT from '@midnight-ntwrk/compact-runtime';
import {roleHash,hash,tag,bytes,u64,challenge,words,ORDER} from './private-offer-signers.mjs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
assert(process.argv[2],'Provide the separately compiled addressed managed directory.');
const managed=resolve(process.argv[2]);
const {Contract,ledger}=await import(pathToFileURL(join(managed,'contract/index.js')).href);
const info=JSON.parse(fs.readFileSync(join(managed,'compiler/contract-info.json')));
assert.equal(info['compiler-version'],'0.31.1');
assert.equal(info.circuits.length,12);
let active={};
const witnesses=Object.fromEntries(info.witnesses.map(({name})=>[name,(ctx,...args)=>{
 if(name==='rememberReserve')return [{...ctx.privateState,reserve:{book:args[0],salt:args[1]}},[]];
 assert(Object.hasOwn(active,name));return [ctx.privateState,active[name]];
}]));
const contract=new Contract(witnesses);
// Published dummy scalars are used solely for this isolated generated-code check.
const key=3n,r=11n,pk=RT.ecMulGenerator(key),announcement=RT.ecMulGenerator(r);
const issuer=roleHash('issuer',pk),merchant=roleHash('merchant',RT.ecMulGenerator(5n)),nextMerchant=roleHash('merchant',RT.ecMulGenerator(7n));
const nonce=bytes(),stable=hash([tag('line:signed:nk'),bytes()]);
function initialize(instanceNonce){active={reserveSalt:bytes()};return contract.initialState(RT.createConstructorContext({},'0'.repeat(64)),issuer,merchant,instanceNonce,stable);}
const a=initialize(nonce),b=initialize(nonce),c=initialize(bytes());
const domain=ledger(a.currentContractState.data).contractDomain,address='11'.repeat(32),authorizationNonce=bytes();
const message=hash([tag('line:signed:approval:v2'),domain,new Uint8Array(Buffer.from(address,'hex')),u64(1),nextMerchant,authorizationNonce]);
const h=challenge(message,pk,announcement),remainder=h%ORDER,quotient=h/ORDER;
const approval={rolePublicKey:pk,roleApproval:{announcement,response:words((r+remainder*key)%ORDER)},authorizationNonce,challengeQuotient:quotient,challengeRemainder:words(remainder),challengeWords:words(h),challengeCarry:(quotient*(ORDER%(1n<<128n))+remainder%(1n<<128n))/(1n<<128n)};
function execute(initial,contractAddress){active=approval;return contract.circuits.registerMerchant(RT.createCircuitContext(contractAddress,'0'.repeat(64),initial.currentContractState.data,structuredClone(initial.currentPrivateState),undefined,undefined,1_800_000_000),nextMerchant);}
const accepted=execute(a,address);
assert(ledger(accepted.context.currentQueryContext.state).registeredMerchants.member(nextMerchant));
assert.throws(()=>execute(b,'22'.repeat(32)),/approval challenge words/);
assert.throws(()=>execute(c,address),/approval challenge words/);
const repeated={currentContractState:{data:accepted.context.currentQueryContext.state},currentPrivateState:accepted.context.currentPrivateState};
assert.throws(()=>execute(repeated,address),/approval replay/);
console.log(JSON.stringify({complete:true,compiler:'0.31.1',circuits:12,scope:'Isolated generated Compact only',approvedAddressAccepted:true,copiedDomainOtherAddressRejected:true,freshDomainRejected:true,sameInstanceReplayRejected:true,nativeProof:false,networkSubmitted:false,ownerServiceIntegrated:false}));
