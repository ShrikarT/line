// Read-only verification; no wallet, signer, proof generation or submission.
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {createFinalizedReceiptReader} from './finalized-contract-receipt.mjs';
import {resolveMidnightEndpoints,sanitizeServiceError} from '../src/lib/runtime/endpoints.ts';
import {resolveContractRelease,validateContractArtifacts} from './contract-artifacts.mjs';

try {
 const directory='.midnight-cache/live-checkout',release=validateContractArtifacts({artifactDir:resolveContractRelease()});
 const reader=createFinalizedReceiptReader({endpoints:resolveMidnightEndpoints({networkId:'preprod',blockfrostProjectId:process.env.MIDNIGHT_BLOCKFROST_PROJECT_ID})});
 const records=readdirSync(directory).filter(name=>name.endsWith('.json')).map(name=>JSON.parse(readFileSync(`${directory}/${name}`,'utf8'))).filter(row=>row.schema==='line-live-checkout-operation/v1'&&row.disposition==='confirmed-success').sort((a,b)=>a.blockHeight-b.blockHeight);
 if(records.length<22||new Set(records.map(row=>row.contractAddress)).size!==1)throw Error('Expected the complete confirmed live checkout record.');
 const receipts=[];let latest;
 for(const row of records){
  latest=await reader.read({kind:row.kind,name:row.name,txHash:row.txHash,blockHeight:row.blockHeight},row.contractAddress);
  receipts.push({id:row.id,kind:row.kind,name:row.name,txHash:row.txHash,blockHeight:row.blockHeight,finalizedHead:latest.finalizedHead,verified:true});
 }
 // The validated release's required key inventory is the authority.
 const names=readdirSync(`${release.artifactDir}/keys`).filter(name=>name.endsWith('.verifier')).map(name=>name.slice(0,-9)).sort();
 if(names.length!==12)throw Error('Expected exactly twelve canonical verifier keys.');
 for(const name of names)if(!Buffer.from(latest.state.operation(name).verifierKey).equals(readFileSync(`${release.artifactDir}/keys/${name}.verifier`)))throw Error('Deployed verifier key mismatch.');
 const report={checkedAt:new Date().toISOString(),network:'preprod',contractAddress:records[0].contractAddress,sourceSha256:release.inputs.source.sha256,confirmedTransactions:receipts.length,canonicalVerifierKeysMatched:names,receipts,trust:'TLS indexer and RPC providers; canonical finalized-block and raw-transaction checks, not a light-client proof',tokenPayoutEstablished:false,cashRepaymentVerified:false};
 writeFileSync('docs/preprod-2026-10-14-evidence/live-checkout-receipts.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({verified:true,confirmedTransactions:receipts.length,canonicalVerifierKeysMatched:names.length}));
}catch(error){console.error(sanitizeServiceError(error.message));process.exitCode=1;}
