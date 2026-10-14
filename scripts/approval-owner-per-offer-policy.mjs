/** Opt-in supplier policy for opaque per-offer bindings from the owner's
 * authenticated financial caller. No stable buyer-binding allowlist is applied.
 * Use only after the owner accepts that scope; fixed-binding policy is separate.
 */
const u64=n=>typeof n==='bigint'&&n>=0n&&n<=18446744073709551615n;
export function authorize(request,context){
 const {role,config,clockUnixSeconds}=context,{name,args,values:v}=request;
 if(role!=='merchant'||config.facilityBindingMode!=='per-offer')return {allowed:false,reservationCost:0n};
 const expiry=args[name==='postQuote'?0:1];
 const validExpiry=u64(expiry)&&expiry>BigInt(clockUnixSeconds)&&expiry<=config.validBefore;
 let allowed=false;
 if(name==='postQuote')allowed=validExpiry&&v.quoteFacilityBinding instanceof Uint8Array&&v.quoteFacilityBinding.length===32&&
  v.quoteFacilityBinding.some(b=>b!==0)&&u64(v.quoteAmount)&&v.quoteAmount>0n&&v.quoteAmount<=config.maxQuoteAmount;
 if(name==='redeemDraw')allowed=validExpiry&&u64(v.redeemAmount)&&v.redeemAmount>0n&&v.redeemAmount<=config.maxQuoteAmount;
 return {allowed,reservationCost:0n};
}
