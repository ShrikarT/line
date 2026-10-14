import {PreprodLive} from '../server/preprod-live.mjs';
import {sanitizeServiceError} from '../src/lib/runtime/endpoints.ts';
import {writeFileSync} from 'node:fs';
let runtime;
try{runtime=await PreprodLive.create();const action=process.argv[2]??'status';let result;
 if(action==='setup')result=await runtime.setup();
 else if(action==='purchase')result=await runtime.purchase(process.argv[3],process.argv[4]??'Line lets an agent buy two services using issuer-approved credit on Midnight Preprod.');
 else if(action==='acknowledge')result=await runtime.acknowledge(process.argv[3]);
 else if(action==='status')result=runtime.summary();
 else throw Error('Choose setup, purchase, acknowledge or status.');
 writeFileSync('.compact-keys/preprod-live-last-summary.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}catch(error){console.error(sanitizeServiceError(error.message));process.exitCode=1;}
finally{await runtime?.close();}
