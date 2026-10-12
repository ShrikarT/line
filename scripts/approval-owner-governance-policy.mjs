/** Explicit opt-in governance extension. Authorizes accounting instructions,
 * not asset payouts or external receipts. Existing purchase policies are kept.
 */
import {authorize as purchasePolicy} from './approval-owner-example-policy.mjs';
const u64=n=>typeof n==='bigint'&&n>=0n&&n<=18446744073709551615n;
const equal=(a,b)=>a instanceof Uint8Array&&b instanceof Uint8Array&&Buffer.from(a).equals(Buffer.from(b));
export function authorize(request,context){
 const {role,config}=context,{name,args,values:v}=request;
 if(!['withdrawUnencumberedReserve','withdrawFees','setStatus'].includes(name))return purchasePolicy(request,context);
 if(role!=='issuer'||config.governanceMode!=='bounded')return {allowed:false,reservationCost:0n};
 let allowed=false,cost=0n;
 if(name==='withdrawUnencumberedReserve'||name==='withdrawFees'){
  const amount=name==='withdrawFees'?request.feeReserve:args[0],maximum=name==='withdrawFees'?config.maxFeeWithdrawal:config.maxReserveWithdrawal;
  allowed=u64(amount)&&amount>0n&&u64(maximum)&&amount<=maximum&&request.reserveCommit instanceof Uint8Array&&request.reserveCommit.length===32;
  cost=allowed?amount:0n;
 }
 if(name==='setStatus'){
  const b=v.bookOpening,n=args[0];
  allowed=Boolean(b&&equal(b.domain,config.domain)&&equal(b.identity,config.agentIdentity)&&
   (b.status===1||b.status===2)&&u64(b.outstanding)&&u64(b.limit)&&b.outstanding<=b.limit&&u64(b.epoch)&&b.epoch<18446744073709551615n&&
   Number.isInteger(n)&&n>=1&&n<=3&&Array.isArray(config.allowedStatuses)&&config.allowedStatuses.includes(n)&&(n!==3||b.outstanding===0n));
 }
 return {allowed,reservationCost:cost};
}
