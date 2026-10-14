import test from 'node:test';import assert from 'node:assert/strict';
import {fork} from 'node:child_process';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';import {resolve} from 'node:path';
import {startWorkerGuardian} from '../scripts/private-worker-guardian.mjs';
const path=resolve(process.env.LINE_TEST_GUARDIAN??`.compact-keys/worker-guardian-target/debug/line-private-worker-guardian${process.platform==='win32'?'.exe':''}`);
const config={path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')};
const pausedWorker=()=>fork(resolve('tests/fixtures/guardian-worker.mjs'),[],{stdio:['ignore','ignore','ignore','ipc'],detached:process.platform!=='win32',windowsHide:true});
function next(child,predicate){return new Promise((yes,no)=>{const timer=setTimeout(()=>{cleanup();no(Error('Lifecycle fixture timed out.'));},10_000);const message=x=>{if(predicate(x)){cleanup();yes(x);}};const cleanup=()=>{clearTimeout(timer);child.off('message',message);};child.on('message',message);});}
function running(pid){try{process.kill(pid,0);if(process.platform==='linux'){const stat=readFileSync('/proc/'+pid+'/stat','utf8');if(stat.slice(stat.lastIndexOf(')')+2).startsWith('Z'))return false;}return true;}catch(error){if(error.code==='ESRCH'||error.code==='ENOENT')return false;throw error;}}
async function stopped(pid){const end=Date.now()+10_000;while(running(pid)&&Date.now()<end)await new Promise(r=>setTimeout(r,25));assert.equal(running(pid),false,'Owned process remains running.');}
async function started(worker){const pending=next(worker,x=>x.descendantPid);worker.send({start:true});return (await pending).descendantPid;}
function exited(child){return new Promise(resolve=>child.once('close',resolve));}

test('guardian rejects a changed executable before starting work',async()=>{
 const worker=pausedWorker();try{await assert.rejects(startWorkerGuardian(worker,{...config,sha256:'0'.repeat(64)}));}finally{worker.kill();await stopped(worker.pid);}
});
test('normal worker exit stops a live descendant before guardian completion',async()=>{
 const worker=pausedWorker();const guard=await startWorkerGuardian(worker,config);let descendant;
 try{descendant=await started(worker);assert(running(descendant));const closed=exited(worker);worker.send({stop:true});await closed;await guard.exit;await guard.close();await stopped(worker.pid);await stopped(descendant);}finally{if(!guard.closed)await guard.close();}
});
test('hard worker loss stops its descendant through the guardian',async()=>{
 const worker=pausedWorker();const guard=await startWorkerGuardian(worker,config);let descendant;
 try{descendant=await started(worker);const closed=exited(worker);worker.kill('SIGKILL');await closed;await guard.exit;await guard.close();await stopped(worker.pid);await stopped(descendant);}finally{if(!guard.closed)await guard.close();}
});
test('closing the owner channel stops both the live worker and its descendant',async()=>{
 const worker=pausedWorker();const guard=await startWorkerGuardian(worker,config);let descendant;
 try{descendant=await started(worker);await guard.close();await stopped(worker.pid);await stopped(descendant);}finally{if(!guard.closed)await guard.close();}
});
test('Windows kernel job stops worker and descendant if the guardian is killed',{skip:process.platform!=='win32'},async()=>{
 const worker=pausedWorker();const guard=await startWorkerGuardian(worker,config);const descendant=await started(worker);
 process.kill(guard.pid,'SIGKILL');await guard.exit;await stopped(worker.pid);await stopped(descendant);
});
test('hard supervisor loss closes ownership and stops its worker and descendant',async()=>{
 const owner=fork(resolve('tests/fixtures/guardian-supervisor.mjs'),[JSON.stringify(config)],{stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});
 const started=await next(owner,x=>x.descendantPid);const closed=exited(owner);owner.kill('SIGKILL');await closed;
 await stopped(started.workerPid);await stopped(started.descendantPid);await stopped(started.guardianPid);
});
