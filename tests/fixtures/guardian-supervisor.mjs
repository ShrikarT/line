/** Hard parent-loss fixture; no proof, wallet or financial behavior. */
import {fork} from 'node:child_process';import {resolve} from 'node:path';
import {startWorkerGuardian} from '../../scripts/private-worker-guardian.mjs';
const worker=fork(resolve('tests/fixtures/guardian-worker.mjs'),[],{stdio:['ignore','ignore','ignore','ipc'],detached:process.platform!=='win32',windowsHide:true});
const guard=await startWorkerGuardian(worker,JSON.parse(process.argv[2]));
worker.on('message',message=>{if(message.descendantPid)process.send({workerPid:worker.pid,guardianPid:guard.pid,descendantPid:message.descendantPid});});
worker.send({start:true});process.on('disconnect',()=>process.exit(0));
