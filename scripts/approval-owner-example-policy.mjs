/** Bounded example owner policy for the private-offer purchase lifecycle.
 * It authorizes actions; it verifies neither underwriting nor payment receipts.
 * Unsupported governance/payment/dispute actions deny by default.
 */
import {fixtureAgentPolicy} from './durable-approval-actor.mjs';
const equal=(a,b)=>a instanceof Uint8Array&&b instanceof Uint8Array&&Buffer.from(a).equals(Buffer.from(b));
const u64=n=>typeof n==='bigint'&&n>=0n&&n<=18446744073709551615n;
export function authorize(request,context){
 const {role,config,clockUnixSeconds}=context,{name,args,values:v}=request;
 if(role==='agent')return fixtureAgentPolicy(request,context);
 let allowed=false,cost=0n;
 if(role==='issuer'){
  if(name==='fundReserve'){allowed=u64(args[0])&&args[0]>0n&&args[0]<=config.maxReserveAction;cost=args[0];}
  if(name==='registerMerchant'||name==='disableMerchant')allowed=config.allowedMerchants.some(m=>equal(m,args[0]));
  if(name==='openLine'){
   allowed=args[0]===1n&&equal(v.enrollmentIdentity,config.agentIdentity)&&equal(v.acceptedTerms,config.acceptedTerms)&&
    v.hasPreviousBook===false&&u64(v.lineLimit)&&v.lineLimit>0n&&v.lineLimit<=config.maxLineLimit&&
    u64(args[1])&&args[1]>BigInt(clockUnixSeconds)&&args[1]<=config.validBefore&&u64(args[2])&&args[2]<=config.maxFee&&u64(args[3])&&args[3]<=config.maxBasisPoints;
   cost=v.lineLimit;
  }
 }
 if(role==='merchant'){
  const validExpiry=u64(args[name==='postQuote'?0:1])&&args[name==='postQuote'?0:1]>BigInt(clockUnixSeconds)&&args[name==='postQuote'?0:1]<=config.validBefore;
  if(name==='postQuote')allowed=validExpiry&&equal(v.quoteFacilityBinding,config.facilityBinding)&&u64(v.quoteAmount)&&v.quoteAmount>0n&&v.quoteAmount<=config.maxQuoteAmount;
  if(name==='redeemDraw')allowed=validExpiry&&u64(v.redeemAmount)&&v.redeemAmount>0n&&v.redeemAmount<=config.maxQuoteAmount;
 }
 return {allowed,reservationCost:allowed?cost:0n};
}
