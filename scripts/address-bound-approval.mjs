/** Exact v2 Compact approval digest. SHA-256 is not used for this message. */
import assert from 'node:assert/strict';
import {hash,tag,u64} from './signed-pool-signers.mjs';

export const ADDRESS_BOUND_APPROVAL_ABI='line-private-offer/v2';
export const isContractAddress=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
export function addressedApprovalMessage(domain,contractAddress,operation,body,nonce){
 assert(isContractAddress(contractAddress),'A canonical deployed contract address is required.');
 for(const value of [domain,body,nonce])assert(value instanceof Uint8Array&&value.length===32);
 assert(Number.isInteger(operation)&&operation>=1&&operation<=12);
 return hash([tag('line:signed:approval:v2'),domain,new Uint8Array(Buffer.from(contractAddress,'hex')),u64(operation),body,nonce]);
}
