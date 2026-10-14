import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {runRecoverableOwnerCoordinator} from '../scripts/recoverable-owner-coordinator.mjs';

test('address-bound coordinator restores real owner-approved purchases at both merchants',{
 skip:!process.env.COMPACT_ADDRESS_MANAGED_DIR,timeout:240_000,
},async()=>{
 const source='contracts/experimental/line-private-offer-addressed.compact';
 const expectedHash=createHash('sha256').update(readFileSync(source)).digest('hex');
 const report=await runRecoverableOwnerCoordinator({compiledDir:process.env.COMPACT_ADDRESS_MANAGED_DIR,
  approvalABI:'line-private-offer/v2',onInitialized:async({scope})=>assert.equal(scope.sourceSha256,expectedHash)});
 assert.equal(report.approvalABI,'line-private-offer/v2');
 assert.equal(report.sourceSha256,expectedHash);
 assert.equal(report.traces.length,10);assert.equal(report.controls.length,6);
 assert.equal(report.crashes.length,8);assert.equal(report.merchants,2);
 assert.equal(report.preparedPacketReloadedWithoutFreshApproval,true);
 assert.equal(report.authenticAssetSettlement,false);assert.equal(report.networkSubmitted,false);
});
