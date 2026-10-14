/** Fixed application frame sizes; this does not hide TLS peers or timing. */
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {encodeVaultJson,decodeVaultJson} from '../src/lib/security/vault-codec.ts';
export const REQUEST_BYTES=128*1024,RESPONSE_BYTES=8*1024;
const MAGIC=Buffer.from('LAP1');
export function encodeApprovalFrame(value,size){
 assert(size===REQUEST_BYTES||size===RESPONSE_BYTES);
 const payload=Buffer.from(encodeVaultJson(value),'utf8');assert(payload.length>0&&payload.length<=size-8,'Approval frame exceeds bounds.');
 const frame=randomBytes(size);MAGIC.copy(frame);frame.writeUInt32BE(payload.length,4);payload.copy(frame,8);return frame;
}
export function decodeApprovalFrame(frame,size){
 assert(Buffer.isBuffer(frame)&&frame.length===size&&frame.subarray(0,4).equals(MAGIC),'Invalid approval frame.');
 const length=frame.readUInt32BE(4);assert(length>0&&length<=size-8,'Invalid approval frame length.');
 return decodeVaultJson(frame.subarray(8,8+length).toString('utf8'));
}
