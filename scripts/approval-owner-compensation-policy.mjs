/** Explicit compensation policy with owner-local, note-bound receipts.
 * Admission authenticates an owner's instruction, not an external transfer.
 */
import {authorize as lifecyclePolicy} from './approval-owner-lifecycle-policy.mjs';
import {authorize as perOfferPolicy} from './approval-owner-per-offer-policy.mjs';
import {roleHash} from './private-offer-signers.mjs';
const equal=(a,b)=>a instanceof Uint8Array&&b instanceof Uint8Array&&Buffer.from(a).equals(Buffer.from(b));
const u64=n=>typeof n==='bigint'&&n>=0n&&n<(1n<<64n),deny=()=>({allowed:false,reservationCost:0n});
export function createCompensationPolicy(registry){
 return function authorize(request,context){
  const {role,config,publicKey,clockUnixSeconds}=context,{name,args,values:v}=request;
  if(name==='acknowledgeRepayment'){
   if(role!=='issuer'||!registry||config.receiptAuthority!==registry.binding)return deny();
   const receipt=registry.get(v.paymentRef);if(!receipt||receipt.purpose!=='repayment')return deny();
   const {purpose,evidenceClass,...record}=receipt;
   return lifecyclePolicy(request,{...context,config:{...config,receipts:[record]}});
  }
  if(name!=='cancelOrExpireNote')return role==='merchant'?perOfferPolicy(request,context):lifecyclePolicy(request,context);
  const mode=args[1];if(config.compensationMode!=='bounded'||!Array.isArray(config.compensationModes)||!config.compensationModes.includes(mode))return deny();
  if(mode===0n)return {allowed:true,reservationCost:0n}; // Compact checks actual expiry, never this policy clock alone.
  if(mode===1n){
   const b=v.bookOpening,identity=role==='agent'?roleHash('agent',publicKey,config.domain):config.agentIdentity;
   const allowed=['issuer','agent'].includes(role)&&b&&equal(b.domain,config.domain)&&equal(b.identity,identity)&&u64(b.limit)&&u64(b.outstanding)&&b.outstanding<=b.limit&&u64(b.epoch)&&b.epoch<(1n<<64n)-1n;
   return {allowed:Boolean(allowed),reservationCost:0n};
  }
  if(mode!==2n||role!=='issuer'||!registry||config.receiptAuthority!==registry.binding||!u64(args[2])||!u64(config.validBefore)||args[2]<=BigInt(clockUnixSeconds)||args[2]>config.validBefore)return deny();
  const receipt=registry.get(v.paymentRef);
  const allowed=receipt&&receipt.purpose==='refund'&&equal(receipt.noteCommit,args[0])&&receipt.amount===v.repayAmount&&
   equal(receipt.domain,config.domain)&&equal(receipt.beneficiaryIdentity,config.agentIdentity)&&receipt.denomination===config.denomination;
  return {allowed:Boolean(allowed),reservationCost:0n};
 };
}
