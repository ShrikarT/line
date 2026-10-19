/** Read only already-public, source-bound proof artifacts. Reports component
 * widths and opcode positions, never values, witnesses or scalar contents.
 */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,existsSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import * as L from '@midnight-ntwrk/ledger-v8';
const sha=b=>createHash('sha256').update(b).digest('hex');
const [input,binary]=process.argv.slice(2);assert(input);
const dir=resolve(input),exe=resolve(binary??`.compact-keys/native-proof-target/debug/line-native-public-components${process.platform==='win32'?'.exe':''}`);
let corpus,rawReport;
const publicReportPath='tests/fixtures/private-offer-public-pairs/native-proof.json';
if(existsSync(join(dir,'manifest.json'))){
 corpus=JSON.parse(readFileSync(join(dir,'manifest.json')));assert.equal(corpus.schema,'line-private-offer-public-corpus/v1');
 assert.equal(corpus.publicNativeReport,publicReportPath);rawReport=readFileSync(publicReportPath);assert.equal(sha(rawReport),corpus.publicNativeReportSha256);
 assert.equal(corpus.entries.length,22);assert(/^[0-9a-f]{64}$/.test(corpus.originalNativeReportSha256));
}else rawReport=readFileSync(join(dir,'verification.json'));
const report=JSON.parse(rawReport);
assert.equal(report.schema,'line-private-offer-proof/v1');assert.equal(report.complete,true);assert.equal(report.traces.length,66);
assert.equal(report.sourceSha256,sha(readFileSync('contracts/experimental/line-private-offer.compact')));
const helpers=['scripts/private-offer-wire-review.mjs','scripts/native-public-components/src/main.rs','scripts/native-public-components/Cargo.toml','scripts/native-public-components/Cargo.lock'];
const fingerprints=Object.fromEntries(helpers.map(p=>[p,sha(readFileSync(p))])),exeHash=sha(readFileSync(exe));
const indexes=[3,8,4,9,5,10,6,11,7,12,36,37,38,39,48,52,49,53,50,54,51,55];
if(corpus){assert.equal(corpus.sourceSha256,report.sourceSha256);assert.deepEqual(corpus.entries.map(x=>x.index),indexes);
 for(const e of corpus.entries){const t=report.traces[e.index];assert.equal(e.circuit,t.circuit);assert.equal(e.file,`${e.index}-${e.circuit}.proven-public-tx.bin`);assert.equal(e.transactionSha256,t.transactionSha256);assert.equal(e.bytes,t.bytes);}}
function widths(op){
 const aligned=op.push?.value?.tag==='cell'?op.push.value.content:op.popeq?.result;
 return {kind:typeof op==='string'?op:Object.keys(op)[0],
  ...(aligned?{alignment:aligned.alignment,atomBytes:aligned.value.map(v=>v.length)}:{}),
  ...(op.push?{storage:op.push.storage,stateTag:op.push.value.tag}:{})};
}
const loaded=indexes.map(index=>{
 const trace=report.traces[index],path=join(dir,`${index}-${trace.circuit}.proven-public-tx.bin`),raw=readFileSync(path);
 assert.equal(sha(raw),trace.transactionSha256);assert.equal(raw.length,trace.bytes);
 const native=spawnSync(exe,[path],{encoding:'utf8',timeout:60_000,maxBuffer:2*1024*1024,env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot}});
 assert.equal(native.status,0,'Public component reader rejected.');const n=JSON.parse(native.stdout);
 assert.equal(n.canonicalPublicRoundtrip,true);assert.equal(n.taggedTransaction,raw.length);assert.equal(n.cryptographicVerificationPerformed,false);
 const tx=L.Transaction.deserialize('signature','proof','binding',raw),intents=[...tx.intents.values()];assert.equal(intents.length,1);
 assert.equal(n.intents.length,1);const intent=intents[0];assert.equal(intent.actions.length,1);const call=intent.actions[0];assert.equal(call.entryPoint,trace.circuit);
 assert.equal(n.intents[0].calls.length,1);assert.equal(call.guaranteedTranscript,undefined);assert(call.fallibleTranscript);
 const nc=n.intents[0].calls[0],ft=nc.fallibleDetails[0];assert(ft);assert.equal(ft.ops.length,call.fallibleTranscript.program.length);
 return {index,circuit:trace.circuit,transactionSha256:trace.transactionSha256,native:n,
  publicOpcodeWidths:call.fallibleTranscript.program.map(widths)};
});
const delta=(a,b,keys)=>Object.fromEntries(keys.map(k=>[k,b[k]-a[k]]));
const pairs=[];
for(let i=0;i<loaded.length;i+=2){
 const a=loaded[i],b=loaded[i+1];assert.equal(a.circuit,b.circuit);const x=a.native,y=b.native,xi=x.intents[0],yi=y.intents[0],xc=xi.calls[0],yc=yi.calls[0];
 const xf=xc.fallibleDetails[0],yf=yc.fallibleDetails[0];assert.equal(xf.ops.length,yf.ops.length);
 const publicProgramDifferences=[];
 for(let j=0;j<xf.ops.length;j++)if(JSON.stringify(xf.ops[j])!==JSON.stringify(yf.ops[j])||JSON.stringify(a.publicOpcodeWidths[j])!==JSON.stringify(b.publicOpcodeWidths[j])){
  publicProgramDifferences.push({index:j,left:{...xf.ops[j],...a.publicOpcodeWidths[j]},right:{...yf.ops[j],...b.publicOpcodeWidths[j]}});
 }
 const d={transaction:delta(x,y,['taggedTransaction','transaction','standardTransaction','intentsMap','networkId','guaranteedCoins','fallibleCoins','bindingRandomness']),
  intent:delta(xi,yi,['intent','actions','binding','ttl','guaranteedUnshieldedOffer','fallibleUnshieldedOffer','dustActions']),
  call:delta(xc,yc,['call','action','address','entryPoint','guaranteedTranscript','fallibleTranscript','communicationCommitment','proof']),
  transcript:delta(xf,yf,['gas','effects','program','version'])};
 const sum=o=>Object.values(o).reduce((s,v)=>s+v,0);
 const residuals={transaction:d.transaction.taggedTransaction-(d.transaction.intentsMap+d.transaction.networkId+d.transaction.guaranteedCoins+d.transaction.fallibleCoins+d.transaction.bindingRandomness),
  intent:d.intent.intent-(d.intent.actions+d.intent.binding+d.intent.ttl+d.intent.guaranteedUnshieldedOffer+d.intent.fallibleUnshieldedOffer+d.intent.dustActions),
  call:d.call.call-(d.call.address+d.call.entryPoint+d.call.guaranteedTranscript+d.call.fallibleTranscript+d.call.communicationCommitment+d.call.proof),
  transcript:d.call.fallibleTranscript-sum(d.transcript)};
 const program=[...L.Transaction.deserialize('signature','proof','binding',readFileSync(join(dir,`${a.index}-${a.circuit}.proven-public-tx.bin`))).intents.values()][0].actions[0].fallibleTranscript.program;
 const sharedGroups=new Map();for(const difference of publicProgramDifferences){const key=JSON.stringify(program[difference.index]);const group=sharedGroups.get(key)??[];group.push(difference.index);sharedGroups.set(key,group);}
 pairs.push({circuit:a.circuit,leftIndex:a.index,rightIndex:b.index,leftTransactionSha256:a.transactionSha256,rightTransactionSha256:b.transactionSha256,
  leftBytes:x.taggedTransaction,rightBytes:y.taggedTransaction,deltas:d,arithmeticResiduals:residuals,publicProgramDifferences,
  repeatedIdenticalPublicOpGroups:[...sharedGroups.values()].filter(g=>g.length>1),
  allMeasuredFieldDeltasAccountedFor:Object.values(residuals).every(v=>v===0)});
}
assert(pairs.every(p=>p.allMeasuredFieldDeltasAccountedFor),'The fixed sample component deltas have changed.');
mkdirSync('.compact-keys',{recursive:true});const work=mkdtempSync(resolve('.compact-keys/offer-wire-review-'));
const controls=[],first=loaded[0],firstBytes=readFileSync(join(dir,`${first.index}-${first.circuit}.proven-public-tx.bin`));
for(const [name,bytes]of [['truncated-public-transaction',firstBytes.subarray(0,firstBytes.length-1)],['trailing-public-bytes',Buffer.concat([firstBytes,Buffer.from([0])])]]){
 const path=join(work,name+'.bin');writeFileSync(path,bytes);
 const checked=spawnSync(exe,[path],{encoding:'utf8',timeout:60_000,maxBuffer:100_000,env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot}});
 assert.equal(checked.status,1);assert.equal(checked.stdout,'');assert.match(checked.stderr,/PUBLIC_DECOMPOSITION_REJECTED/);controls.push({name,rejected:true});
}
for(const [p,h]of Object.entries(fingerprints))assert.equal(sha(readFileSync(p)),h);assert.equal(sha(readFileSync(exe)),exeHash);
const registry=join(process.env.CARGO_HOME??join(process.env.USERPROFILE??process.env.HOME,'.cargo'),'registry','src');
const sourceFiles=['midnight-ledger-8.1.3/src/structure.rs','midnight-base-crypto-1.0.2/src/fab/serialize.rs','midnight-base-crypto-1.0.2/src/fab/encoding.rs',
 'midnight-storage-core-1.2.1/src/arena.rs','midnight-storage-core-1.2.1/src/storable.rs','midnight-transient-crypto-2.1.1/src/curve.rs',
 'midnight-transient-crypto-2.1.1/src/commitment.rs','midnight-serialize-1.1.1/src/util.rs'];
const encodingSources=Object.fromEntries(sourceFiles.map(p=>{const roots=readdirSync(registry).map(r=>join(registry,r,p)).filter(existsSync);assert(roots.length>=1);const hashes=roots.map(r=>sha(readFileSync(r)));assert.equal(new Set(hashes).size,1);return[p,hashes[0]];}));
const result={schema:'line-private-offer-wire-review/v1',createdAt:new Date().toISOString(),sourceSha256:report.sourceSha256,nativeReportSha256:corpus?.originalNativeReportSha256??sha(rawReport),
 publicNativeReportSha256:sha(readFileSync(publicReportPath)),...(corpus?{publicCorpusManifestSha256:sha(readFileSync(join(dir,'manifest.json')))}:{}),encodingSources,
 scriptFingerprints:fingerprints,nativeReaderSha256:exeHash,pairs,controls,sourceBoundArtifactHashesVerified:true,newCryptographicVerificationPerformed:false,
 allElevenMeasuredDeltasAccountedFor:pairs.every(p=>p.allMeasuredFieldDeltasAccountedFor),
 networkSubmitted:false,fullHistoryPrivacyPassed:false,evidenceScope:'Eleven saved native-verified public pairs decomposed by pinned Rust serialization. Actual fields and public opcode widths only; no witness/private journal access, new proofs, distributional conclusion or complete-history privacy claim.'};
writeFileSync(join(work,'wire.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({report:join(work,'wire.json'),pairs:pairs.map(p=>({circuit:p.circuit,indexes:[p.leftIndex,p.rightIndex],delta:p.rightBytes-p.leftBytes,residuals:p.arithmeticResiduals,opDifferences:p.publicProgramDifferences.map(x=>x.index)}))}));
