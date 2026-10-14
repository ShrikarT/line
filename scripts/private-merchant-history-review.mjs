#!/usr/bin/env node
/** Generated-only public transcript review of reachable refund histories.
 * Reports every differing public leaf; does not mask commitment values or
 * assert cryptographic indistinguishability, native validity or network privacy.
 * Raw financial witnesses and public byte values are not published here.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { runPrivateMerchantFixture } from './private-merchant-spike.mjs';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const source='contracts/experimental/line-private-merchant.compact';
const sourceSha256=digest(readFileSync(source));
const scriptFingerprints=Object.fromEntries(['scripts/private-merchant-history-review.mjs','scripts/private-merchant-spike.mjs',
 'scripts/signed-pool-signers.mjs','scripts/private-pool-spike.mjs','src/lib/line/encoding.ts','src/lib/security/vault-codec.ts']
 .map(path=>[path,digest(readFileSync(path))]));
const calls=[];
let fixture;
const index=process.argv.indexOf('--compiled-dir');
if(index>=0)assert(process.argv[index+1]&&!process.argv[index+1].startsWith('--'));
await runPrivateMerchantFixture({
 ...(index>=0?{compiledDir:process.argv[index+1]}:{}),
 async onAccepted(event){
  calls.push({name:event.name,isolatedBranch:event.isolatedBranch,seconds:event.seconds,
   inputState:digest(event.input),nextState:digest(event.nextState),
   public:Object.fromEntries(Object.entries(event.publicData).map(([key,value])=>[key,JSON.parse(value)]))});
 },
 async onComplete(report){fixture=report;}
});
assert.equal(digest(readFileSync(source)),sourceSha256,'Source changed during review.');
for(const [path,pinned]of Object.entries(scriptFingerprints))
 assert.equal(digest(readFileSync(path)),pinned,'Review harness changed during execution.');
assert.equal(calls.length,46);assert.equal(calls.filter(call=>call.isolatedBranch).length,7);
const sequence=['acknowledgeRepayment','cancelOrExpireNote','cancelOrExpireNote','cancelOrExpireNote'];
const alternateStart=calls.findIndex(call=>call.isolatedBranch&&call.name==='acknowledgeRepayment');
assert(alternateStart>=0);
const alternate=calls.slice(alternateStart,alternateStart+4);
const normal=calls.slice(alternateStart+4,alternateStart+8);
assert.deepEqual(alternate.map(call=>call.name),sequence);assert.deepEqual(normal.map(call=>call.name),sequence);
assert(alternate.every(call=>call.isolatedBranch));assert(normal.every(call=>!call.isolatedBranch));
assert.equal(alternate[0].inputState,normal[0].inputState,'Both histories must begin at the same reachable public state.');
for(const history of [alternate,normal])for(let i=1;i<history.length;i++)
 assert.equal(history[i].inputState,history[i-1].nextState,'History transitions must be continuous.');

function differences(left,right,path='',result=[]){
 if(JSON.stringify(left)===JSON.stringify(right))return result;
 if(left!==null&&right!==null&&typeof left==='object'&&typeof right==='object'){
  for(const key of new Set([...Object.keys(left),...Object.keys(right)]))
   differences(left[key],right[key],`${path}/${key}`,result);
 }else{
  const describe=value=>({type:value===null?'null':typeof value,
   ...(typeof value==='string'?{characters:value.length,hexEncoded:/^[0-9a-f]+$/i.test(value)}:{})});
  result.push({path,left:describe(left),right:describe(right)});
 }
 return result;
}
const pairs=alternate.map((left,i)=>{
 const right=normal[i],observedDifferences=differences(left.public,right.public);
 const publicInputsEqual=JSON.stringify(left.public.input)===JSON.stringify(right.public.input);
 const publicOutputsEqual=JSON.stringify(left.public.output)===JSON.stringify(right.public.output);
 assert.equal(left.seconds,right.seconds,'These histories must use the same observation time.');
 assert(publicInputsEqual&&publicOutputsEqual,'An exported argument/output distinguishes these histories.');
 assert(Array.isArray(left.public.transcript)&&Array.isArray(right.public.transcript));
 const unequalKinds=observedDifferences.filter(item=>!(item.left.type==='string'&&item.right.type==='string'&&
  item.left.hexEncoded&&item.right.hexEncoded&&item.left.characters===item.right.characters));
 return {circuit:left.name,publicInputsEqual,publicOutputsEqual,syntheticTimeEqual:true,
  transcriptEntries:{alternate:left.public.transcript.length,normal:right.public.transcript.length},
  differingLeaves:observedDifferences,otherDifferingLeafKinds:unequalKinds.length,
  classification:'Observed differences require semantic and cryptographic analysis; hex encoding alone does not imply hiding.'};
});
mkdirSync('.compact-keys',{recursive:true});const work=mkdtempSync(resolve('.compact-keys/private-merchant-history-review-'));
const report={schema:'line-private-merchant-history-review/v1',createdAt:new Date().toISOString(),sourceSha256,
 scriptFingerprints,
 freshCompilation:fixture.freshCompilation,artifactFingerprints:fixture.artifactFingerprints,
 generatedOnly:true,nativeProofsVerifiedByThisRun:false,networkExecuted:false,fullHistoryPrivacyPassed:false,
 commonReachableStart:true,continuousCounterfactualHistories:true,actionSequence:sequence,pairs,
 evidenceScope:'Finite generated query comparison only. Values are not equated or treated as private merely because they differ. Sender, fees, proofs, network timing, asset events and institutional custody are outside this run.'};
writeFileSync(join(work,'evidence.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({result:'REFUND PUBLIC TRANSCRIPTS REVIEWED; PRIVACY UNPROVEN',
 differingLeaves:pairs.map(pair=>pair.differingLeaves.length),evidence:join(work,'evidence.json')}));
