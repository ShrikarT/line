/** Process lifecycle fixture only: no proof, signing or financial behavior. */
import {spawn} from 'node:child_process';
process.once('message',()=>{
 const child=spawn(process.execPath,['-e','setInterval(()=>{},60000)'],{stdio:'ignore',windowsHide:true});
 process.send({descendantPid:child.pid});
 process.once('message',()=>process.exit(0));
});
process.on('disconnect',()=>process.exit(0));process.send({ready:true});
