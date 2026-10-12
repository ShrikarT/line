/** Synthetic-owner one-command storage subprocess. It never signs, proves,
 * submits or claims finality. Every invocation opens its own bounded lease.
 */
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {PrivateFinanceJournal} from './private-finance-journal.mjs';
import {encodeVaultJson as wire,decodeVaultJson as unwire} from '../src/lib/security/vault-codec.ts';
const self=fileURLToPath(import.meta.url);
export function financeCommand(owner,action,payload){
 assert(['initialize','snapshot','prepare','confirm'].includes(action));
 const body=wire({action,payload});assert(Buffer.byteLength(body)<=1_000_000);
 const child=fork(self,['--fixture-finance'],{execArgv:['--experimental-strip-types'],stdio:['ignore','ignore','pipe','ipc'],
  env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,LINE_FINANCE_TEST_OWNER:wire(owner)}});
 return new Promise((yes,no)=>{
  let result,received=false;
  const timer=setTimeout(()=>{child.kill();no(Error('Financial storage response is uncertain; inspect the journal.'));},60_000);
  child.on('error',error=>{clearTimeout(timer);no(error);});
  child.on('message',message=>{
   if(message.ready){child.send({body},error=>{if(error){clearTimeout(timer);child.kill();no(error);}});return;}
   if(message.error){clearTimeout(timer);no(Error('Financial checkpoint command failed.'));return;}
   if(message.body){try{result=unwire(message.body);received=true;}catch(error){clearTimeout(timer);child.kill();no(error);}}
  });
  child.on('exit',code=>{clearTimeout(timer);if(code===0&&received)yes(result);else no(Error('Financial checkpoint response is uncertain; inspect the journal.'));});
 });
}
if(process.argv[1]&&resolve(process.argv[1])===self&&process.argv[2]==='--fixture-finance'){
 const owner=unwire(process.env.LINE_FINANCE_TEST_OWNER);delete process.env.LINE_FINANCE_TEST_OWNER;
 process.once('message',async message=>{
  let journal;
  try{
   assert(typeof message.body==='string'&&Buffer.byteLength(message.body)<=1_000_000);
   const {action,payload}=unwire(message.body);assert(['initialize','snapshot','prepare','confirm'].includes(action));
   journal=await PrivateFinanceJournal.open({...owner,create:action==='initialize'});
   let value;
   if(action==='initialize')await journal.initialize(payload);
   if(action==='prepare')value=await journal.prepare(payload);
   if(action==='confirm')await journal.confirm(payload.operationId,payload.observedPublicState);
   if(action==='snapshot')value=journal.snapshot();
   // Explicit synthetic-owner fault: exit after durable publication, before
   // replying or releasing the lease. Recovery must prove the old PID dead.
   if(owner.crashAfterWrite&&['prepare','confirm'].includes(action))process.exit(23);
   await journal.close();journal=undefined;
   process.send({body:wire({value:value??null,pid:process.pid})},()=>process.disconnect());
  }catch{
   if(journal)await journal.close().catch(()=>{});
   process.exitCode=1;process.send({error:true},()=>process.disconnect());
  }
 });
 process.on('disconnect',()=>process.exit(process.exitCode??0));process.send({ready:true});
}
