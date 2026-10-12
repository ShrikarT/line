/** Real pinned Rust proving. Private preimages/binding overrides use stdin only. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
export function nativeLocalProvingProvider({managedDir,checker,prover,parameterCache,onCheck=()=>{},onDiagnostic=()=>{}}){
 const cache=resolve(parameterCache);mkdirSync(cache,{recursive:true});
 const circuit=name=>{assert(typeof name==='string'&&/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name),'Invalid circuit name.');return name;};
 function execute(file,args,input){
  return new Promise((yes,no)=>{
   const child=spawn(file,args,{stdio:['pipe','pipe','pipe'],env:{...process.env,RAYON_NUM_THREADS:'2',MIDNIGHT_PP:cache,MIDNIGHT_PARAM_SOURCE:'https://srs.midnight.network/'}});
   const output=[];let size=0,diagnostic='',lastStage=null,done=false;
   const timer=setTimeout(()=>{child.kill();finish(Error('Native prover timeout.'));},1_800_000);
   function finish(error,result){if(done)return;done=true;clearTimeout(timer);error?no(error):yes(result);}
   child.on('error',()=>finish(Error('Native proving process unavailable.')));
   child.stdout.on('data',chunk=>{size+=chunk.length;if(size>16*1024*1024){child.kill();finish(Error('Native proving output exceeds limit.'));}else output.push(chunk);});
   // Store only a bounded static error category, never raw library output.
   child.stderr.on('data',chunk=>{const message=chunk.toString(),match=message.match(/(?:LOCAL_PROVER|PREIMAGE_CHECK)_REJECTED:([a-z_]+)/);if(match)diagnostic=match[1];else if(/stack overflow/i.test(message))diagnostic='stack_overflow';
    const stage=message.match(/LOCAL_PROVER_STAGE:(preimage_decoded|provider_ready|key_material_loaded|proof_self_verified)/);if(stage)lastStage=stage[1];});
   child.on('close',(code,signal)=>{if(code===0)finish(null,Buffer.concat(output));else{onDiagnostic({category:diagnostic||'process_failure',exitCode:code,signal,lastStage});finish(Error('Native prover rejected: '+(diagnostic||'process_failure')));}});
   child.stdin.on('error',()=>{});child.stdin.end(input);
  });
 }
 return {
  async check(preimage,key){
   const name=circuit(key),raw=await execute(checker,[join(managedDir,'zkir',name+'.bzkir')],Buffer.from(preimage));
   const result=JSON.parse(raw.toString('utf8'));assert.equal(result.nativePreimageCheckPassed,true);assert(Array.isArray(result.statementSkipPattern));
   onCheck({circuit:name,nativeEvaluationPassed:true,statementBlocks:result.statementBlocks,skippedBlocks:result.skippedBlocks});
   return result.statementSkipPattern.map(value=>value===null?undefined:BigInt(value));
  },
  async prove(preimage,key,overwriteBindingInput){
   const name=circuit(key),override=overwriteBindingInput!==undefined;
   const header=Buffer.alloc(override?33:1);header[0]=override?1:0;
   if(override){assert(typeof overwriteBindingInput==='bigint'&&overwriteBindingInput>=0n&&overwriteBindingInput<(1n<<256n));let value=overwriteBindingInput;for(let i=1;i<33;i++){header[i]=Number(value&255n);value>>=8n;}}
   const raw=await execute(prover,[managedDir,name],Buffer.concat([header,Buffer.from(preimage)]));
   assert(raw.subarray(0,18).toString('ascii').startsWith('midnight:proof['),'Native prover did not return tagged proof bytes.');
   return new Uint8Array(raw);
  }
 };
}
