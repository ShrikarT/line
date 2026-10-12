/** Read-only public-artifact decomposition. No witness/proving/wallet API.
 * Finite component lengths are observations, not a privacy equivalence proof.
 */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import * as L from '@midnight-ntwrk/ledger-v8';
const hash=b=>createHash('sha256').update(b).digest('hex');
// midnight-transient-crypto 2.1.1 serializes the two Jubjub points at fixed
// 32-byte widths and the public Schnorr reply through midnight-serialize
// 1.1.1 ScaleBigInt. Parse lengths only; never retain the scalar's value.
function bindingEncoding(bytes){
 const tag=Buffer.from('midnight:pedersen-schnorr[v1]:');assert(Buffer.from(bytes).subarray(0,tag.length).equals(tag));
 const scalarOffset=tag.length+64,marker=bytes[scalarOffset];assert(marker!==undefined);
 const encodedBytes=[1,2,4][marker&3]??((marker>>>2)+5);
 assert.equal(bytes.length,scalarOffset+encodedBytes,'Unexpected public binding representation.');
 return {fixedTagAndPointBytes:scalarOffset,publicReplyScaleBytes:encodedBytes};
}
assert(process.argv[2],'Provide the completed private-offer native report directory.');
const dir=resolve(process.argv[2]),reportBytes=readFileSync(join(dir,'verification.json')),report=JSON.parse(reportBytes);
assert.equal(report.schema,'line-private-offer-proof/v1');assert.equal(report.complete,true);assert.equal(report.traces.length,66);
assert.equal(report.sourceSha256,hash(readFileSync('contracts/experimental/line-private-offer.compact')));
const indexes=[3,8,4,9,5,10,6,11,7,12,36,37,38,39,48,52,49,53,50,54,51,55];
const components=indexes.map(index=>{
 const trace=report.traces[index],raw=readFileSync(join(dir,`${index}-${trace.circuit}.proven-public-tx.bin`));
 assert.equal(hash(raw),trace.transactionSha256);assert.equal(raw.length,trace.bytes);
 const tx=L.Transaction.deserialize('signature','proof','binding',raw),intents=[...tx.intents.entries()];assert.equal(intents.length,1);
 const [segmentId,intent]=intents[0];assert.equal(intent.actions.length,1);const call=intent.actions[0];assert.equal(call.entryPoint,trace.circuit);
 const binding=intent.binding.serialize(),bindingParts=bindingEncoding(binding);
 return {traceIndex:index,circuit:trace.circuit,transactionSha256:trace.transactionSha256,transactionBytes:raw.length,
  segmentId,intentBytes:intent.serialize().length,bindingBytes:intent.binding.serialize().length,proofBytes:call.proof.serialize().length,
  bindingEncoding:bindingParts,
  fallibleZswapPresent:Boolean(tx.fallibleOffer?.size),guaranteedZswapPresent:tx.guaranteedOffer!==undefined,
  dustActionsPresent:intent.dustActions!==undefined,unshieldedOffersPresent:intent.guaranteedUnshieldedOffer!==undefined||intent.fallibleUnshieldedOffer!==undefined};
});
const pairs=[];for(let i=0;i<components.length;i+=2){const left=components[i],right=components[i+1];assert.equal(left.circuit,right.circuit);
 pairs.push({circuit:left.circuit,left,right,deltas:{transaction:right.transactionBytes-left.transactionBytes,intent:right.intentBytes-left.intentBytes,
  binding:right.bindingBytes-left.bindingBytes,proof:right.proofBytes-left.proofBytes},
  standaloneBindingDeltaAccountedForByReplyEncoding:right.bindingBytes-left.bindingBytes===right.bindingEncoding.publicReplyScaleBytes-left.bindingEncoding.publicReplyScaleBytes});
}
mkdirSync('.compact-keys',{recursive:true});const work=mkdtempSync(resolve('.compact-keys/offer-size-review-'));
const result={schema:'line-private-offer-public-component-review/v1',createdAt:new Date().toISOString(),sourceSha256:report.sourceSha256,
 nativeReportSha256:hash(reportBytes),pairs,sourceBoundArtifactHashesVerified:true,newCryptographicVerificationPerformed:false,
 networkSubmitted:false,fullHistoryPrivacyPassed:false,
 standaloneBindingLengthCause:'The fixed tag and two compressed points occupy 94 bytes. Canonical SCALE encoding of the already-public Schnorr reply accounts for every standalone binding length difference in these samples.',
 remainingUnexplained:'Full transaction and standalone intent deltas are not all accounted for by this component. Embedded encodings need not match standalone encodings.',
 evidenceScope:'Public SDK component lengths for eleven source-bound native pairs; only the standalone binding component has been explained. No witness/scalar values, complete-transcript equivalence, distributional conclusion or asset/network privacy certification.'};
writeFileSync(join(work,'components.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({report:join(work,'components.json'),pairs:pairs.map(p=>({circuit:p.circuit,indexes:[p.left.traceIndex,p.right.traceIndex],deltas:p.deltas,segmentIds:[p.left.segmentId,p.right.segmentId]}))}));
