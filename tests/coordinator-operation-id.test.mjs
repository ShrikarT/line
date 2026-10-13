import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync} from 'node:fs';
import {resolve,join,relative,sep} from 'node:path';
import {spawn} from 'node:child_process';
import * as RT from '@midnight-ntwrk/compact-runtime';
import {DurableApprovalSigner} from '../scripts/durable-approval-signer.mjs';
import {startApprovalOwnerService} from '../scripts/approval-owner-service.mjs';
import {coordinatorCommand} from '../scripts/private-owner-coordinator.mjs';
import {tlsFixture} from './fixtures/approval-service-tls.mjs';
const bytes=()=>new Uint8Array(randomBytes(32)),sha=b=>createHash('sha256').update(b).digest('hex');
function authorize(request){return {allowed:request.name==='fundReserve'&&request.args[0]>0n&&request.args[0]<=10n,reservationCost:request.args[0]};}

test('owner-invalid IDs reject before staging and inherited names preserve exact completed requests',{timeout:180_000},async()=>{
 mkdirSync('.compact-keys',{recursive:true});const directory=mkdtempSync(resolve('.compact-keys/operation-id-worker-')),managedDir=join(directory,'managed');
 const source='contracts/experimental/line-private-offer.compact';
 await new Promise((yes,no)=>{
  const child=spawn(process.execPath,['scripts/compile-compact.mjs','--skip-zk',source,relative(process.cwd(),managedDir).split(sep).join('/')],{stdio:['ignore','pipe','pipe'],windowsHide:true});
  let size=0;const timer=setTimeout(()=>{child.kill();no(Error('Operation-ID fixture compilation timed out.'));},120_000);
  for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{size+=chunk.length;if(size>64*1024){child.kill();no(Error('Unexpected compiler output.'));}});
  child.on('error',error=>{clearTimeout(timer);no(error);});child.on('close',code=>{clearTimeout(timer);code===0?yes():no(Error('Operation-ID fixture compilation failed.'));});
 });
 const tls=tlsFixture(),signer=new DurableApprovalSigner({directory:join(directory,'issuer'),encryptionKey:bytes(),custodyId:'operation-id-test',role:'issuer',authorize,create:true,approvalABI:'line-private-offer/v1'});
 let service;
 const config={managedDir,sourceSha256:sha(readFileSync(source)),executableSha256:sha(readFileSync(join(managedDir,'contract/index.js'))),directory:join(directory,'finance'),password:Buffer.from(bytes()).toString('hex')};
 const command=(action,payload)=>coordinatorCommand(config,action,payload);
 try{
  const initialized=await command('initialize',{points:{issuer:signer.publicKey,agent:RT.ecMulGenerator(11n),merchantA:RT.ecMulGenerator(12n),merchantB:RT.ecMulGenerator(13n)},
   instanceNonce:bytes(),terms:bytes(),limit:100n,flatFee:1n,basisPoints:100n,unixSeconds:Math.floor(Date.now()/1000)});
  config.scope=initialized.value.scope;signer.bindPolicy({domain:initialized.value.domain,maxAuthorizedCost:20n});
  service=await startApprovalOwnerService({signer,role:'issuer',approvalABI:'line-private-offer/v1',domain:initialized.value.domain,...tls.material('server'),allowedClients:[tls.fingerprint('caller')]});
  config.clients={issuer:{url:'https://127.0.0.1:'+service.port+'/',...tls.material('caller'),expectedServerFingerprint:tls.fingerprint('server'),expectedRole:'issuer',expectedPublicKey:signer.publicKey,expectedDomain:initialized.value.domain}};
  for(const operationId of ['ordinary:fund','__proto__','_starts',':starts','-starts','a'.repeat(129),'constructor','toString']){
   const request={operationId,actor:'issuer',circuit:'fundReserve',amount:5n};
   if(!/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,127}$/.test(operationId)){
    const ownerBefore=readFileSync(join(directory,'issuer','signer.enc.json'));
    await assert.rejects(command('prepare',request));
    const status=await command('status',{});
    assert.equal(readFileSync(join(directory,'issuer','signer.enc.json')).equals(ownerBefore),true,'Invalid ID must not request an owner approval.');
    assert.equal(status.value.authorizationOperation,null);assert.equal(status.value.pendingOperation,null);
    continue;
   }
   const prepared=await command('prepare',request);
   const restored=await command('restore',{operationId});
   assert.notEqual(prepared.pid,restored.pid);assert.deepEqual(restored.value.publicState,prepared.value.publicState);assert.equal(restored.value.fingerprint,prepared.value.fingerprint);
   await command('confirm',{operationId,observedPublicState:restored.value.publicState});
   const retry=await command('prepare',request);assert.deepEqual(retry.value,{operationId,alreadyConfirmed:true});
   await assert.rejects(command('prepare',{...request,amount:6n}));
   const status=await command('status',{});assert.equal(status.value.authorizationOperation,null);assert.equal(status.value.pendingOperation,null);assert(status.value.completedOperations.includes(operationId));
  }
 }finally{if(service)await service.close();signer.close();}
});
