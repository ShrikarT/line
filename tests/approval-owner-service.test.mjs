import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {request as httpsRequest} from 'node:https';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import * as RT from '@midnight-ntwrk/compact-runtime';
import {DurableApprovalSigner} from '../scripts/durable-approval-signer.mjs';
import {startApprovalOwnerService,approvalOwnerClient} from '../scripts/approval-owner-service.mjs';
import {REQUEST_BYTES,RESPONSE_BYTES,encodeApprovalFrame,decodeApprovalFrame} from '../scripts/approval-service-frame.mjs';
import {ORDER,RADIX,actionBody,approvalMessage,challenge} from '../scripts/private-offer-signers.mjs';
import {tlsFixture} from './fixtures/approval-service-tls.mjs';
import {encodeVaultJson,decodeVaultJson} from '../src/lib/security/vault-codec.ts';
const bytes=()=>new Uint8Array(randomBytes(32)),NOW=Math.floor(Date.now()/1000),tls=tlsFixture();
function policy(request,{role,config}){
 const v=request.values;
 const allowed=role==='issuer'&&request.name==='fundReserve'&&request.args[0]>0n&&request.args[0]<=30n||
  role==='merchant'&&request.name==='postQuote'&&v.quoteAmount===15n&&Buffer.from(v.quoteFacilityBinding).equals(Buffer.from(config.binding))||
  role==='merchant'&&request.name==='redeemDraw'&&v.redeemAmount===15n;
 return {allowed,reservationCost:role==='issuer'?request.args[0]:0n};
}
function owner(role='issuer'){
 const directory=mkdtempSync(join(tls.root,role+'-')),encryptionKey=bytes(),domain=bytes(),binding=bytes();
 const options={directory,encryptionKey,custodyId:role+'-owner',role,authorize:policy,approvalABI:'line-private-offer/v1'};
 const signer=new DurableApprovalSigner({...options,create:true});signer.bindPolicy({domain,binding,maxAuthorizedCost:50n});
 const request={operationId:'fund:1',descriptor:{name:'fundReserve',args:[20n],domain,privateFinance:true,values:{},reserveCommit:bytes()}};
 return {signer,options,domain,binding,request};
}
async function serve(x){const service=await startApprovalOwnerService({signer:x.signer,role:x.options.role,approvalABI:'line-private-offer/v1',domain:x.domain,...tls.material('server'),allowedClients:[tls.fingerprint('caller')]});
 const settings={url:'https://127.0.0.1:'+service.port+'/',...tls.material('caller'),expectedServerFingerprint:tls.fingerprint('server'),expectedRole:x.options.role,expectedPublicKey:x.signer.publicKey,expectedDomain:x.domain};
 return {service,settings,client:approvalOwnerClient(settings)};
}
function verify(response,descriptor){
 const [op,body]=actionBody(response.rolePublicKey,descriptor),h=challenge(approvalMessage(descriptor.domain,op,body,response.authorizationNonce),response.rolePublicKey,response.roleApproval.announcement);
 assert.deepEqual(RT.ecMulGenerator(response.roleApproval.response.hi*RADIX+response.roleApproval.response.lo),RT.ecAdd(response.roleApproval.announcement,RT.ecMul(response.rolePublicKey,h%ORDER)));
}
test('padded frames round-trip typed witnesses without exposing numeric payload length',()=>{
 const short={balance:1n,salt:bytes()},long={balance:18446744073709551615n,salt:bytes()};
 const a=encodeApprovalFrame(short,REQUEST_BYTES),b=encodeApprovalFrame(long,REQUEST_BYTES);assert.equal(a.length,b.length);assert.equal(a.length,REQUEST_BYTES);
 assert.deepEqual(decodeApprovalFrame(a,REQUEST_BYTES),short);assert.notDeepEqual(encodeApprovalFrame(short,REQUEST_BYTES),a);
 for(const f of [a.subarray(0,a.length-1),Buffer.alloc(REQUEST_BYTES)])assert.throws(()=>decodeApprovalFrame(f,REQUEST_BYTES));
 assert.throws(()=>encodeApprovalFrame({x:'x'.repeat(REQUEST_BYTES)},REQUEST_BYTES));
});
test('authenticated issuer approvals are policy bounded and exact retries survive owner restart',async()=>{
 const x=owner();let connection=await serve(x);
 try{
  assert.equal((await connection.client.identity()).role,'issuer');const first=await connection.client.approve(x.request);verify(first,x.request.descriptor);
  assert.deepEqual(await connection.client.approve(x.request),first);
  await connection.service.close();x.signer.close();x.signer=new DurableApprovalSigner({...x.options,create:false});connection=await serve(x);
  assert.deepEqual(await connection.client.approve(x.request),first);
  await connection.client.approve({...x.request,operationId:'fund:2'});
  await assert.rejects(connection.client.approve({...x.request,operationId:'fund:3'}),/could not be authorized/);
  const changed=structuredClone(x.request);changed.descriptor.args[0]=21n;
  await assert.rejects(connection.client.approve(changed),/could not be authorized/);
 }finally{await connection.service.close();x.signer.close();}
});
test('a CA-valid unlisted caller and missing client identity cannot obtain approvals',async()=>{
 const x=owner(),connection=await serve(x);
 try{
  const wrong=approvalOwnerClient({...connection.settings,...tls.material('other-caller')});await assert.rejects(wrong.approve(x.request),/uncertain/);
  const missing=approvalOwnerClient({...connection.settings,key:undefined,cert:undefined});await assert.rejects(missing.approve(x.request),/uncertain/);
  verify(await connection.client.approve(x.request),x.request.descriptor);
 }finally{await connection.service.close();x.signer.close();}
});
test('client role, public identity and domain pins reject mistaken owner endpoints',async()=>{
 const x=owner(),connection=await serve(x);
 try{
  for(const settings of [{expectedRole:'merchant'},{expectedPublicKey:RT.ecMulGenerator(3n)},{expectedDomain:bytes()},{expectedServerFingerprint:'0'.repeat(64)}]){
   const wrong=approvalOwnerClient({...connection.settings,...settings});await assert.rejects(wrong.identity());
  }
  await assert.rejects(approvalOwnerClient({...connection.settings,expectedRole:'merchant'}).approve(x.request));
  const scope=x.signer.ownerScope;scope.domain.fill(0);assert.deepEqual(x.signer.ownerScope.domain,x.domain);
 }finally{await connection.service.close();x.signer.close();}
});
test('two merchant owners sign their own quotes without receiving financial books',async()=>{
 const a=owner('merchant'),b=owner('merchant'),one=await serve(a),two=await serve(b);
 try{
  for(const [x,c]of [[a,one],[b,two]]){
   const request={operationId:'quote:1',descriptor:{name:'postQuote',args:[BigInt(NOW+300)],domain:x.domain,privateFinance:true,
    values:{quoteFacilityBinding:x.binding,invoiceId:bytes(),quoteAmount:15n,quoteNonce:bytes()}}};
   const signed=await c.client.approve(request);verify(signed,request.descriptor);
   const polluted=structuredClone(request);polluted.operationId='quote:bad';polluted.descriptor.values.bookOpening={secret:bytes()};
   await assert.rejects(c.client.approve(polluted),/could not be authorized/);
   const issuerCall={...x.request,descriptor:{...x.request.descriptor,domain:x.domain}};await assert.rejects(c.client.approve(issuerCall),/could not be authorized/);
  }
  assert.notDeepEqual(a.signer.publicKey,b.signer.publicKey);
 }finally{await one.service.close();await two.service.close();a.signer.close();b.signer.close();}
});
test('denied and accepted RPC results use the same application response size',async()=>{
 const x=owner(),connection=await serve(x);
 async function raw(message){const frame=encodeApprovalFrame(message,REQUEST_BYTES);return new Promise((yes,no)=>{
  const req=httpsRequest(new URL('/v1/approve',connection.settings.url),{...tls.material('caller'),method:'POST',agent:false,
   headers:{'content-type':'application/octet-stream','content-length':String(frame.length)}},res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>yes({status:res.statusCode,raw:Buffer.concat(chunks)}));res.on('error',no);});req.on('error',no);req.end(frame);
 });}
 try{
  const allowed=await raw(x.request),denied=await raw({...x.request,operationId:'bad:1',descriptor:{...x.request.descriptor,args:[31n]}});
  assert.equal(allowed.status,200);assert.equal(denied.status,200);assert.equal(allowed.raw.length,RESPONSE_BYTES);assert.equal(denied.raw.length,RESPONSE_BYTES);
  assert.equal(decodeApprovalFrame(allowed.raw,RESPONSE_BYTES).ok,true);assert.deepEqual(decodeApprovalFrame(denied.raw,RESPONSE_BYTES),{ok:false,error:'Approval could not be authorized.'});
 }finally{await connection.service.close();x.signer.close();}
});

test('a separately launched owner CLI retains identity and exact approval across process restart',async()=>{
 const directory=mkdtempSync(join(tls.root,'cli-owner-')),profilePath=join(directory,'owner-profile.json'),policyPath=join(directory,'policy.mjs');
 const source='const ownerLimit=30n;\nexport const authorize = '+policy.toString().replace('<=30n','<=ownerLimit')+';\n';writeFileSync(policyPath,source);
 const key=bytes(),domain=bytes(),profile={version:1,approvalABI:'line-private-offer/v1',role:'issuer',custodyId:'cli-issuer-owner',createIdentity:true,
  storeDirectory:join(directory,'encrypted-store'),policyModule:policyPath,policyModuleSha256:createHash('sha256').update(source).digest('hex'),
  policy:{domain,binding:bytes(),maxAuthorizedCost:50n},port:0,
  tls:{key:tls.path('server.key'),cert:tls.path('server.crt'),ca:tls.path('ca.crt'),allowedClients:[tls.fingerprint('caller')]}};
 async function start(){
  writeFileSync(profilePath,encodeVaultJson(profile));
  const child=spawn(process.execPath,['--experimental-strip-types',resolve('scripts/serve-approval-owner.mjs'),profilePath],{
   env:{...process.env,LINE_APPROVAL_OWNER_STORE_KEY_HEX:Buffer.from(key).toString('hex')},stdio:['pipe','pipe','pipe'],windowsHide:true});
  const ready=await new Promise((yes,no)=>{let text='';const timer=setTimeout(()=>{child.kill();no(Error('Owner CLI readiness timed out.'));},15_000);
   child.on('error',error=>{clearTimeout(timer);no(error);});child.on('exit',()=>{clearTimeout(timer);no(Error('Owner CLI stopped before readiness.'));});
   child.stdout.on('data',chunk=>{text+=chunk;if(text.length>64*1024){child.kill();clearTimeout(timer);no(Error('Unexpected owner output.'));}
    else if(text.includes('\n')){try{const r=decodeVaultJson(text.trim());assert.equal(r.ready,true);clearTimeout(timer);yes(r);}catch{clearTimeout(timer);no(Error('Invalid owner readiness metadata.'));}}});
  });
  const settings={url:'https://127.0.0.1:'+ready.port+'/',...tls.material('caller'),expectedServerFingerprint:tls.fingerprint('server'),expectedRole:'issuer',expectedPublicKey:ready.identity.publicKey,expectedDomain:domain};
  return {child,ready,client:approvalOwnerClient(settings),async stop(){const done=new Promise((yes,no)=>child.once('exit',c=>c===0?yes():no(Error('Owner CLI did not stop cleanly.'))));child.stdin.end('stop\n');await done;}};
 }
 let actor=await start();
 try{
  assert.notEqual(actor.child.pid,process.pid);
  const request={operationId:'fund:cli',descriptor:{name:'fundReserve',args:[20n],domain,privateFinance:true,values:{},reserveCommit:bytes()}},first=await actor.client.approve(request);
  verify(first,request.descriptor);const oldPid=actor.child.pid;await actor.stop();profile.createIdentity=false;actor=await start();
  assert.notEqual(actor.child.pid,oldPid);assert.deepEqual(actor.ready.identity.publicKey,first.rolePublicKey);assert.deepEqual(await actor.client.approve(request),first);
  await actor.stop();actor=undefined;
  const changed=source.replace('ownerLimit=30n','ownerLimit=100n');writeFileSync(policyPath,changed);
  profile.policyModuleSha256=createHash('sha256').update(changed).digest('hex');
  await assert.rejects(start(),/stopped before readiness/);
 }finally{if(actor)await actor.stop();}
});
