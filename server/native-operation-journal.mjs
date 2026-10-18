import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import * as L from '@midnight-ntwrk/ledger-v8';
import { u8aToHex } from '@polkadot/util';
import { SucceedEntirely } from '@midnight-ntwrk/midnight-js-types';
import { sanitizeServiceError } from '../src/lib/runtime/endpoints.ts';
const DIR='.midnight-cache/live-checkout';
const copy=value=>structuredClone(value);

/** Shared durable submission and independent finality; no facility or role setup.
 * The owner supplies state/control, directory, api/endpoints, reader and
 * persistWallet(). The owner must serialize operations and drain them before
 * releasing wallet custody. A pending signed operation survives restart.
 */
export class NativeOperationJournal {
 async journalAndSubmit(tx){
    if(!this.state.pending)throw Error('Submission has no durable operation context.');
    const pending=this.state.pending,identifier=tx.identifiers().at(-1);if(!identifier)throw Error('Transaction has no identifier.');
    const actions=[...tx.intents.values()].flatMap(intent=>intent.actions);if(actions.length!==1)throw Error('Expected one contract action.');
    const address=actions[0].address;if(pending.kind==='deploy')pending.after.contractAddress=address;else if(address!==this.state.contractAddress)throw Error('Transaction targets another contract.');
    const record=this.transactionRecord(pending,tx);
    const directory=this.directory??DIR;
    writeFileSync(`${directory}/${pending.id}.bin`,tx.serialize(),{flag:'wx'});writeFileSync(`${directory}/${pending.id}.json`,JSON.stringify(record,null,2)+'\n',{flag:'wx'});
    pending.record=record;await this.save();
    await this.submitPrepared(tx);return identifier;
 }
 transactionRecord(pending,tx){
  const actions=[...tx.intents.values()].flatMap(intent=>intent.actions),action=actions[0];
  if(actions.length!==1||!(pending.kind==='deploy'?action instanceof L.ContractDeploy:pending.kind==='call'?action instanceof L.ContractCall:action instanceof L.MaintenanceUpdate))throw Error('Saved transaction action mismatch.');
  if(pending.kind==='call'&&(typeof action.entryPoint==='string'?action.entryPoint:Buffer.from(action.entryPoint).toString())!==pending.name)throw Error('Saved transaction circuit mismatch.');
  if(pending.kind==='deploy')pending.after.contractAddress=action.address;else if(action.address!==this.state.contractAddress)throw Error('Saved transaction targets another contract.');
  const txId=tx.identifiers().at(-1);if(!txId)throw Error('Saved transaction identifier is missing.');
  return {schema:'line-live-checkout-operation/v1',id:pending.id,kind:pending.kind,name:pending.name,contractAddress:action.address,txId,txHash:tx.transactionHash(),disposition:'prepared',createdAt:new Date().toISOString()};
 }
 async submitPrepared(tx){
  const pending=this.state.pending,row=pending?.record;if(row?.disposition!=='prepared')throw Error('Only a provably unsubmitted transaction can be submitted.');
  const actual=this.transactionRecord(pending,tx);for(const key of ['id','kind','name','contractAddress','txId','txHash'])if(actual[key]!==row[key])throw Error('Saved transaction journal mismatch.');
  const extHex=this.api.tx.midnight.sendMnTransaction(u8aToHex(tx.serialize())).toHex();
  // Persist uncertainty before the network call. A restart never repeats it.
  row.disposition='submission-attempted';await this.save();writeFileSync(`${this.directory??DIR}/${pending.id}.json`,JSON.stringify(row,null,2)+'\n');
  this.progress='Waiting for Preprod confirmation';console.log(JSON.stringify({operation:pending.id,txHash:row.txHash}));
  const response=await (this.fetchImpl??fetch)(this.endpoints.nodeUri,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'author_submitExtrinsic',params:[extHex]}),signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error('Submission result is uncertain. Reconcile the saved transaction.');const result=await response.json();if(result.error||typeof result.result!=='string'){
   row.submissionError={code:Number.isInteger(result.error?.code)?result.error.code:null,message:sanitizeServiceError(String(result.error?.message??'Invalid RPC submission response').slice(0,512)),data:typeof result.error?.data==='string'?sanitizeServiceError(result.error.data.slice(0,512)):null};
   await this.save();writeFileSync(`${this.directory??DIR}/${pending.id}.json`,JSON.stringify(row,null,2)+'\n');
   throw Error(`RPC rejected the submission (${row.submissionError.code??'unknown'}): ${row.submissionError.message}. Reconcile the saved transaction.`);
  }
  row.extrinsicHash=result.result;row.disposition='submitted';await this.save();writeFileSync(`${this.directory??DIR}/${pending.id}.json`,JSON.stringify(row,null,2)+'\n');
 }
 async recoverPending(){
  const pending=this.state.pending;if(!pending)return;
  const directory=this.directory??DIR,path=`${directory}/${pending.id}.bin`;
  if(!pending.record&&!existsSync(path)){this.state.pending=null;await this.save();return;}
  if(!pending.record||pending.record.disposition==='prepared'){
   const tx=L.Transaction.deserialize('signature','proof','binding',new Uint8Array(readFileSync(path)));
   pending.record??=this.transactionRecord(pending,tx);await this.save();
   await this.submitPrepared(tx);
  }
  return this.reconcile();
 }
 async save(){await this.control.set('application',this.state);}
 async reconcile(){
  const pending=this.state.pending;if(!pending?.record)return;
  const row=pending.record;const observed=await this.reader.read({kind:row.kind,name:row.name,identifier:row.txId},row.contractAddress);
  const receipt={...row,disposition:'confirmed-success',blockHeight:observed.transaction.block.height,finalizedHead:observed.finalizedHead,feePaid:observed.transaction.fees?.paidFees??null,verifiedAt:new Date().toISOString()};
  this.state={...pending.after,receipts:[...this.state.receipts.filter(x=>x.id!==row.id),receipt],pending:null};await this.save();writeFileSync(`${this.directory??DIR}/${row.id}.json`,JSON.stringify(receipt,null,2)+'\n');this.progress='Confirmed on Midnight Preprod';return receipt;
 }
 async operation(id,kind,name,input,after,execute){
  if(!/^[a-z0-9-]{1,100}$/.test(id))throw Error('Invalid operation identifier.');
  if(this.state.pending)throw Error('Reconcile the pending transaction before preparing another operation.');
  const retained=this.state.receipts.find(x=>x.id===id);
  if(retained){await this.reader.read({kind:retained.kind,name:retained.name,txHash:retained.txHash,blockHeight:retained.blockHeight},retained.contractAddress);return retained;}
  this.input=input;this.state.pending={id,kind,name,after:copy(after),record:null};await this.save();
  try{const result=await execute(),receipt=result.public??result.deployTxData?.public??result;if(receipt.status!==SucceedEntirely)throw Error('Transaction did not succeed entirely.');return await this.reconcile();}
  catch(error){if(!this.state.pending?.record&&!existsSync(`${this.directory??DIR}/${id}.bin`)){this.state.pending=null;await this.save();}throw Error(sanitizeServiceError(error.message));}
  finally{this.input=null;await this.persistWallet();}
 }
}
