// Audit evidence: asserts current behavior, not desired behavior. Synthetic data only.
// node --experimental-strip-types docs/audit-2026-10-07-repro.mjs
import assert from 'node:assert/strict';
import * as RT from '@midnight-ntwrk/compact-runtime';
import {boot,blankPrivate,readLedger,COIN_PK,CONTRACT_ADDR,Status} from '../src/lib/line/compact-harness.ts';
import {pad32,merchantPublicKey,toHex,agentId} from '../src/lib/line/encoding.ts';
import {MidnightNetworkRuntime} from '../src/lib/runtime/network.ts';
import {VaultPrivateStateProvider} from '../src/lib/runtime/vault-provider.ts';
import {unlockVaultSession,lockVaultSession,isVaultSessionUnlocked} from '../src/lib/security/vault.ts';
import {LocalDevelopmentRuntime} from '../src/lib/runtime/local.ts';
import {setRuntime} from '../src/lib/runtime/index.ts';
import {useAppStore} from '../src/app/store.ts';
import * as P from '../src/lib/line/protocol.ts';
const issuer=pad32('audit-issuer'),merchant=pad32('audit-merchant'),agent=pad32('audit-agent'),mpk=merchantPublicKey(merchant);
const ps=(o={})=>blankPrivate({callerSecret:issuer,agentSecret:agent,salt:pad32('salt-0'),newSalt:pad32('salt-1'),invoiceId:pad32('invoice'),quoteNonce:pad32('quote'),receiptNonce:pad32('receipt'),paymentRef:pad32('payment'),noteNonce:pad32('note'),noteSalt:pad32('note-salt'),noteIdentity:agentId(agent),lineLimit:150n,quoteAmount:80n,drawAmount:80n,redeemAmount:80n,repayAmount:20n,quoteMerchantPk:mpk,...o});
const evidence=[];
function record(id,details){evidence.push({id,...details});console.error(`Verified ${id}`);}
async function run(s,name,args,p=ps()){
  const r=await s.contract.circuits[name](RT.createCircuitContext(CONTRACT_ADDR,COIN_PK,s.state,p),...args);
  s.state=r.context.currentQueryContext.state;return r;
}
async function opened(domain='domain-one'){
  const s=await boot(issuer,merchant,pad32(domain),ps());
  await run(s,'fundReserve',[500n]);await run(s,'openLine',[10000n]);return s;
}
async function drawn(fee=0n,expiry=1000n){
  const s=await opened(),r=await run(s,'postQuote',[1000n],ps({callerSecret:merchant}));
  const Q=[...readLedger(s).quotes][0][0];await run(s,'draw',[Q,expiry,fee]);return {s,r,Q};
}
function contains(value,bytes,seen=new Set()){
  if(value instanceof Uint8Array)return toHex(value)===toHex(bytes);
  if(!value||typeof value!=='object'||seen.has(value))return false;
  seen.add(value);return Object.values(value).some(v=>contains(v,bytes,seen));
}
const net=new MidnightNetworkRuntime({networkId:'audit',contractAddress:'0'.repeat(64)});
net.connectedWallet={};net.getProviders=async()=>({
  privateStateProvider:{setContractAddress(){}},
  publicDataProvider:{watchForDeployTxData:async()=>({}),queryDeployContractState:async()=>({}),queryContractState:async()=>({})},
  zkConfigProvider:{getVerifierKeys:async()=>{throw new Error('Unexpected: binding reached verifier-key provider');}}
});
let bindingError='';try{await net.getBoundContract();}catch(e){bindingError=e.message;}
assert.match(bindingError,/Cannot read properties of undefined.*Symbol/);
assert.doesNotMatch(bindingError,/lineLimit/);
record('R01',{confirmed:'Missing witnesses are fixed; actual binding still fails',error:bindingError});
const a=await opened(),b=await opened('domain-two');
assert.notEqual(toHex(readLedger(a).contractDomain),toHex(readLedger(b).contractDomain));
assert.equal(toHex(readLedger(a).lineCommit),toHex(readLedger(b).lineCommit));
record('R02',{confirmed:'Identical books and salt yield identical line commitment in different domains'});
const {s,r}=await drawn();
assert.ok(contains(r.proofData.publicTranscript,mpk));
record('R03',{confirmed:'Merchant public key appears in generated postQuote public transcript'});
assert.equal([...readLedger(s).notes][0][1].amount,80n);assert.equal(readLedger(s).feeReserve,0n);
record('R04',{confirmed:'Zero fee accepted; public initial draw amount reveals initial outstanding balance of 80'});
await run(s,'acknowledgeRepayment',[1000n],ps({lineOutstanding:80n,lineEpoch:1n,salt:pad32('salt-1'),newSalt:pad32('salt-2')}));
await run(s,'acknowledgeRepayment',[1000n],ps({lineOutstanding:60n,lineEpoch:2n,salt:pad32('salt-2'),newSalt:pad32('salt-3')}));
record('R05',{confirmed:'Same payment reference and receipt nonce acknowledged twice on successive commitments',debtReduction:40});
const {s:ex}=await drawn(5n,8n),D=[...readLedger(ex).notes][0][0];
while(readLedger(ex).actionClock<8n)await run(ex,'setStatus',[Status.OPEN]);
await run(ex,'cancelOrExpireNote',[D]);assert.equal(readLedger(ex).encumberedReserve,0n);assert.equal(readLedger(ex).feeReserve,5n);
await run(ex,'withdrawUnencumberedReserve',[495n]);
await run(ex,'acknowledgeRepayment',[1000n],ps({lineOutstanding:85n,lineEpoch:1n,salt:pad32('salt-1'),newSalt:pad32('salt-2')}));
record('R06',{confirmed:'No-op status calls expire note, allow cancellation/withdrawal; cancelled debt and fee remain',withdrawn:495});
unlockVaultSession('Audit-Temporary-Only!');
const vp=new VaultPrivateStateProvider({networkId:'audit'});vp.setContractAddress('audit-contract');
await vp.set('bytes',{secret:new Uint8Array([1,2,3])});assert.equal((await vp.get('bytes')).secret instanceof Uint8Array,false);
await assert.rejects(()=>vp.set('bigint',{amount:1n}),/BigInt/);
await vp.setSigningKey('audit-address','synthetic-audit-key');lockVaultSession();
assert.equal(await vp.getSigningKey('audit-address'),'synthetic-audit-key');
record('R07',{confirmed:'Vault loses byte-array type, rejects bigint, and returns cached signing key when locked'});
const l=P.createLedger();l.totalReserve=100;l.encumberedReserve=20;l.redeemedReserve=10;l.feeReserve=5;
assert.equal((await new LocalDevelopmentRuntime(l).getReserveStatus()).withdrawableReserve,70);
record('R08',{confirmed:'Withdrawable reserve excludes fee liability',displayed:70,correct:65});
setRuntime(new LocalDevelopmentRuntime());
await useAppStore.getState().unlockVault('Audit-Temporary-Only!');
for(const role of ['issuer','merchant','agent'])await useAppStore.getState().generateIdentity(role);
assert.equal(await useAppStore.getState().doFundReserve(500),true);
assert.equal(await useAppStore.getState().doRegisterMerchant(useAppStore.getState().merchantRecord.merchantPk),true);
assert.equal(await useAppStore.getState().doOpen(150),true);
assert.equal(await useAppStore.getState().doQuote(40,'audit-A','A'),true);
assert.equal(await useAppStore.getState().doQuote(40,'audit-B','B'),true);
const qs=useAppStore.getState().merchantQuotes;
assert.equal(qs.at(-1).merchantPublicKey,qs.at(-2).merchantPublicKey);
record('R09',{confirmed:'Merchant A and B quotes use the same private/public key record'});
lockVaultSession();assert.equal(isVaultSessionUnlocked(),false);
assert.equal(useAppStore.getState().isVaultUnlocked,true);
assert.equal(await useAppStore.getState().doFundReserve(1),true);
record('R10',{confirmed:'Store can still authorize mutation after underlying vault session locks'});
const ts=P.createLedger();ts.issuerPubKey=P.issuerPublicKey(toHex(issuer));ts.registeredMerchants[toHex(mpk)]=false;
assert.equal(P.registerMerchant(ts,{caller:toHex(issuer),merchantPk:toHex(mpk)}).ok,true);
await run(a,'disableMerchant',[mpk]);await assert.rejects(()=>run(a,'registerMerchant',[mpk]),/already registered/);
record('R11',{confirmed:'TS model can re-register disabled merchant; generated Compact rejects it'});
console.log(JSON.stringify({auditDate:'2026-10-07',cases:evidence.length,evidence},null,2));
