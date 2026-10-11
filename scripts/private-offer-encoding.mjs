/** Actual Compact encoding for the experimental supplier-facing offer ABI. */
import * as RT from '@midnight-ntwrk/compact-runtime';
import {BYTES32,UINT64} from '../src/lib/line/encoding.ts';
import {hash,tag,u64} from './signed-pool-signers.mjs';

const fields=[['domain',BYTES32],['identity',BYTES32],['generation',UINT64]];
export const FACILITY_BINDING_TYPE={alignment:()=>fields.flatMap(([,type])=>type.alignment()),
 toValue:value=>fields.flatMap(([key,type])=>type.toValue(value[key])),
 fromValue:value=>Object.fromEntries(fields.map(([key,type])=>[key,type.fromValue(value)]))};
export const facilityBinding=(book,salt)=>RT.persistentCommit(FACILITY_BINDING_TYPE,
 {domain:book.domain,identity:book.identity,generation:book.generation},salt);
export const offerCommit=({merchant,binding,invoice,amount,expiry,nonce,domain})=>
 hash([tag('line:offer:quote'),merchant,binding,invoice,u64(amount),u64(expiry),nonce,domain]);
