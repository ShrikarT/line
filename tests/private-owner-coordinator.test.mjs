import test from 'node:test';
import assert from 'node:assert/strict';
import {coordinatorDrawFee} from '../scripts/private-owner-coordinator.mjs';

test('coordinator uses exact ceiling fees for zero, fractional and maximum basis points',()=>{
 assert.equal(coordinatorDrawFee(15n,1n,0n),1n);
 assert.equal(coordinatorDrawFee(15n,1n,100n),2n);
 assert.equal(coordinatorDrawFee(100n,1n,100n),2n);
 assert.equal(coordinatorDrawFee(101n,1n,100n),3n);
 assert.equal(coordinatorDrawFee(15n,1n,10000n),16n);
});

test('coordinator rejects invalid numeric terms and UInt64 cost overflow',()=>{
 const max=(1n<<64n)-1n;
 for(const args of [[0n,0n,0n],[-1n,1n,0n],[1n,-1n,0n],[1n,1n,-1n],[1n,1n,10001n],
  [1,1n,0n],[max+1n,0n,0n],[1n,max,0n],[max,0n,1n]])assert.throws(()=>coordinatorDrawFee(...args));
 assert.equal(coordinatorDrawFee(max,0n,0n),0n);
});
