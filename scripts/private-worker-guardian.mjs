/** Kernel/process-group containment for one caller-owned financial worker. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export async function startWorkerGuardian(worker,{path,sha256}){
 assert(Number.isSafeInteger(worker.pid)&&worker.pid>1);
 assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'),sha256,'Guardian executable changed.');
 const child=spawn(path,[String(worker.pid)],{stdio:['pipe','pipe','pipe'],windowsHide:true,env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot}});
 child.stdin.on('error',()=>{});child.stderr.resume();
 let ready=false,closed=false,code,output='';const exit=new Promise(resolve=>{child.once('error',()=>{closed=true;resolve({code:null});});child.once('close',c=>{closed=true;code=c;resolve({code:c});});});
 try{
  await new Promise((yes,no)=>{
   const timer=setTimeout(()=>{child.stdin.end();no(Error('Worker containment setup timed out.'));},10_000);
   child.stdout.on('data',chunk=>{output+=chunk.toString();if(output.length>256){clearTimeout(timer);child.stdin.end();no(Error('Worker containment output rejected.'));}
    if(/GUARD_READY:(windows-job|posix-group)\r?\n/.test(output)&&!ready){ready=true;clearTimeout(timer);yes();}});
   child.on('error',()=>{clearTimeout(timer);no(Error('Worker containment unavailable.'));});
   child.on('close',()=>{if(!ready){clearTimeout(timer);no(Error('Worker containment rejected.'));}});
  });
 }catch(error){child.stdin.end();worker.kill();await exit;throw error;}
 return {pid:child.pid,mode:output.includes('windows-job')?'windows-job':'posix-group',exit,
  async close(){if(!closed)child.stdin.end();const result=await exit;assert.equal(result.code,0,'Worker containment termination is uncertain.');},
  get closed(){return closed;},get exitCode(){return code;}};
}
