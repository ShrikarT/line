#!/usr/bin/env node
// Five separately addressed role-local provers. Same host/administrator remains
// trusted; this is not independent production custody. Only these labeled
// containers are managed. The existing server on port 6300 is untouched.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const image='midnightntwrk/proof-server:8.1.3',label='io.line.private-pool-experiment';
export const proverRoles=['issuer','agent-a','agent-b','merchant-a','merchant-b'];
export const proverUrls=Object.fromEntries(proverRoles.map((role,index)=>[role,`http://127.0.0.1:${6301+index}`]));
function docker(args){const result=spawnSync('docker',args,{encoding:'utf8',timeout:120_000});if(result.error)throw result.error;return result;}
async function waitForRemoval(id){
 // Docker stop can return before --rm has finished deleting the container.
 // Wait for that exact ID; never remove or adopt another container by name.
 for(let attempt=0;attempt<60;attempt++){
  const inspected=docker(['inspect',id]);
  if(inspected.status!==0){assert.match(inspected.stderr,/No such (object|container)/i,'Docker inspection failed during owned cleanup.');return;}
  assert.equal(JSON.parse(inspected.stdout)[0].Id,id,'Cleanup observed a different container.');
  await new Promise(resolve=>setTimeout(resolve,500));
 }
 throw Error('Owned prover removal did not finish; do not restart it until inspected.');
}
async function main(){
 const action=process.argv[2];assert(['start','stop','kill'].includes(action),'Use start, stop, or kill (only after the owning proof run has ended).');
 const selected=process.argv[3];assert(!selected||proverRoles.includes(selected),'Unknown role.');
 for(const [index,role] of proverRoles.entries()){
  if(selected&&role!==selected)continue;
  const name=`line-pool-proof-${role}`,inspected=docker(['inspect',name]);
  let existing;
  if(inspected.status===0){existing=JSON.parse(inspected.stdout)[0];
   assert.equal(existing.Config.Labels?.[label],role,`Refusing to manage an unowned container: ${name}`);
   assert.equal(existing.Config.Image,image,'Refusing a different image.');
   assert.equal(existing.HostConfig.NanoCpus,2_000_000_000,'Refusing different CPU limits.');
   assert.equal(existing.HostConfig.AutoRemove,true,'Refusing a container without automatic removal.');
   assert(existing.Config.Env?.includes('RAYON_NUM_THREADS=2'),'Refusing different prover worker configuration.');
   const binding=existing.HostConfig.PortBindings?.['6300/tcp']?.[0];
   assert(binding?.HostIp==='127.0.0.1'&&binding.HostPort===String(6301+index),'Refusing different port bindings.');
  }else assert.match(inspected.stderr,/No such (object|container)/i,'Docker inspection must succeed before managing a container.');
  if(action==='stop'||action==='kill'){
   if(existing){const stopped=docker(action==='kill'?['kill',existing.Id]:['stop','--time','10',existing.Id]);assert.equal(stopped.status,0,stopped.stderr);await waitForRemoval(existing.Id);}
  }else{
   if(!existing){const started=docker(['run','--detach','--rm','--name',name,'--label',`${label}=${role}`,
    '--publish',`127.0.0.1:${6301+index}:6300`,'--cpus','2','--env','RAYON_NUM_THREADS=2',image,'midnight-proof-server','-v']);
    assert.equal(started.status,0,started.stderr);
   }else assert(existing.State.Running,'An existing owned prover is stopped; inspect it before restarting.');
   let version;
   // A fresh container downloads and verifies protocol parameters before it
   // listens. Readiness is not a proof-latency benchmark.
   for(let attempt=0;attempt<120;attempt++){
    try{const response=await fetch(`${proverUrls[role]}/version`,{signal:AbortSignal.timeout(3000)});if(response.ok)version=(await response.text()).trim().replace(/^"|"$/g,'');if(version==='8.1.3')break;}catch{}
    await new Promise(resolve=>setTimeout(resolve,1000));
   }assert.equal(version,'8.1.3',`Prover ${role} failed readiness.`);
  }
 }
 console.log(JSON.stringify({action,roles:selected?[selected]:proverRoles,proverUrls,commonProver:false,sameHostTrusted:true}));
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/private-pool-provers.mjs'))main().catch(error=>{console.error(error.message);process.exitCode=1;});
