#!/usr/bin/env node
/** Owner CLI. Run separately under the role owner's account; no coordinator
 * provisioning endpoint. Software keys, not HSM or administrative isolation.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {DurableApprovalSigner} from './durable-approval-signer.mjs';
import {startApprovalOwnerService} from './approval-owner-service.mjs';
import {encodeVaultJson,decodeVaultJson} from '../src/lib/security/vault-codec.ts';
let signer,service;
try{
 assert(process.argv[2],'Provide an owner-controlled profile file.');
 const profilePath=resolve(process.argv[2]),bytes=readFileSync(profilePath);assert(bytes.length<=128*1024);
 const profile=decodeVaultJson(bytes.toString('utf8')),base=dirname(profilePath),file=p=>resolve(base,p);
 assert(profile.version===1&&['line-private-offer/v1','line-private-offer/v2'].includes(profile.approvalABI));
 const policyPath=file(profile.policyModule),policyBytes=readFileSync(policyPath);
 assert.equal(createHash('sha256').update(policyBytes).digest('hex'),profile.policyModuleSha256,'Owner policy source changed.');
 const {authorize}=await import(pathToFileURL(policyPath).href);assert.equal(typeof authorize,'function');
 const secret=process.env.LINE_APPROVAL_OWNER_STORE_KEY_HEX;assert(typeof secret==='string'&&/^[0-9a-f]{64}$/.test(secret));
 delete process.env.LINE_APPROVAL_OWNER_STORE_KEY_HEX;
 signer=new DurableApprovalSigner({directory:file(profile.storeDirectory),encryptionKey:Buffer.from(secret,'hex'),
  custodyId:profile.custodyId,role:profile.role,approvalABI:profile.approvalABI,create:profile.createIdentity===true,authorize,
  policyModuleSha256:profile.policyModuleSha256});
 if(process.argv.includes('--identity')){process.stdout.write(encodeVaultJson({role:profile.role,publicKey:signer.publicKey})+'\n');signer.close();}
 else{
  signer.bindPolicy(profile.policy);
  service=await startApprovalOwnerService({signer,role:profile.role,approvalABI:profile.approvalABI,domain:profile.policy.domain,
   host:profile.host??'127.0.0.1',port:profile.port,key:readFileSync(file(profile.tls.key)),cert:readFileSync(file(profile.tls.cert)),ca:readFileSync(file(profile.tls.ca)),
   allowedClients:profile.tls.allowedClients});
  process.stdout.write(encodeVaultJson({ready:true,port:service.port,identity:service.identity})+'\n');
  let closing=false;const stop=async()=>{if(closing)return;closing=true;try{await service.close();signer.close();process.exit(0);}catch{process.exit(1);}};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  // Local owner control only; no network stop/provisioning route.
  process.stdin.on('data',chunk=>{if(chunk.length<=16&&chunk.toString('utf8').trim()==='stop')void stop();});process.stdin.resume();
 }
}catch{if(service)await service.close().catch(()=>{});signer?.close();console.error('Approval owner service could not start.');process.exitCode=1;}
