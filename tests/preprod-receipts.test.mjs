import test from 'node:test';
import assert from 'node:assert/strict';
import { validateReceiptMetadata } from '../scripts/verify-preprod-receipts.mjs';

const address='ab'.repeat(32),hash='cd'.repeat(32),blockHash='ef'.repeat(32);
const row={kind:'call',name:'draw',txHash:hash,blockHeight:120};
const receipt=()=>({hash,block:{height:120,hash:blockHash},transactionResult:{status:'SUCCESS',segments:[{id:0,success:true}]},
 contractActions:[{__typename:'ContractCall',address,entryPoint:'draw',state:'public fixture'}]});
test('receipt validation requires exact successful finalized action metadata',()=>{
 const tx=receipt();assert.equal(validateReceiptMetadata(row,tx,address,125,blockHash),tx.contractActions[0]);
});
for(const [label,mutate,expected]of [
 ['different transaction hash',tx=>{tx.hash='00'.repeat(32);},'RECEIPT_HASH_HEIGHT_MISMATCH'],
 ['different reported block',tx=>{tx.block.height=119;},'RECEIPT_HASH_HEIGHT_MISMATCH'],
 ['partial success',tx=>{tx.transactionResult.status='PARTIAL_SUCCESS';},'TRANSACTION_NOT_ENTIRELY_SUCCESSFUL'],
 ['failed segment under success label',tx=>{tx.transactionResult.segments[0].success=false;},'FAILED_TRANSACTION_SEGMENT'],
 ['other contract',tx=>{tx.contractActions[0].address='00'.repeat(32);},'CONTRACT_ACTION_NOT_UNIQUE'],
 ['ambiguous contract action',tx=>{tx.contractActions.push({...tx.contractActions[0]});},'CONTRACT_ACTION_NOT_UNIQUE'],
 ['registration mislabeled as execution',tx=>{tx.contractActions[0].__typename='ContractUpdate';},'CONTRACT_ACTION_KIND_MISMATCH'],
 ['other circuit',tx=>{tx.contractActions[0].entryPoint='redeemDraw';},'CIRCUIT_ENTRY_POINT_MISMATCH'],
 ])test(`receipt validation rejects ${label}`,()=>{const tx=receipt();mutate(tx);assert.throws(()=>validateReceiptMetadata(row,tx,address,125,blockHash),new RegExp(expected));});
test('included block must be finalized',()=>assert.throws(()=>validateReceiptMetadata(row,receipt(),address,119,blockHash),/BLOCK_NOT_FINALIZED/));
test('indexer block must match current RPC canonical block',()=>assert.throws(()=>validateReceiptMetadata(row,receipt(),address,125,'00'.repeat(32)),/INDEXER_RPC_BLOCK_MISMATCH/));
