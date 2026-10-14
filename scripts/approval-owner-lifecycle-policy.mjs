/** Opt-in issuer receipt records and bilateral enrollment/reopening policy.
 * The owner is responsible for authenticating records before binding them.
 * Test allowlists prove authorization matching, never actual money movement.
 */
import {authorize as governancePolicy} from './approval-owner-governance-policy.mjs';
import {fixtureAgentPolicy} from './durable-approval-actor.mjs';
const equal=(a,b)=>a instanceof Uint8Array&&b instanceof Uint8Array&&Buffer.from(a).equals(Buffer.from(b));
const u64=n=>typeof n==='bigint'&&n>=0n&&n<=18446744073709551615n;
export function authorize(request,context){
 const {role,config,clockUnixSeconds}=context,{name,args,values:v}=request;
 if(!['openLine','acknowledgeRepayment'].includes(name))return governancePolicy(request,context);
 const deny={allowed:false,reservationCost:0n};if(config.lifecycleMode!=='owner-records'||!u64(config.validBefore))return deny;
 if(name==='acknowledgeRepayment'){
  const b=v.bookOpening;
  if(role!=='issuer'||!b||!equal(b.domain,config.domain)||!equal(b.identity,config.agentIdentity)||![1,2].includes(b.status)||
   !u64(v.repayAmount)||v.repayAmount===0n||!u64(b.outstanding)||v.repayAmount>b.outstanding||!u64(b.limit)||b.outstanding>b.limit||!u64(b.epoch)||b.epoch===18446744073709551615n||
   !(v.paymentRef instanceof Uint8Array)||v.paymentRef.length!==32||!v.paymentRef.some(n=>n!==0)||
   !u64(args[0])||args[0]<=BigInt(clockUnixSeconds)||args[0]>config.validBefore||!Array.isArray(config.receipts)||typeof config.denomination!=='string')return deny;
  const allowed=config.receipts.some(receipt=>equal(receipt.paymentRef,v.paymentRef)&&receipt.amount===v.repayAmount&&
   equal(receipt.domain,config.domain)&&equal(receipt.beneficiaryIdentity,b.identity)&&receipt.denomination===config.denomination);
  return {allowed,reservationCost:0n};
 }
 if(!['issuer','agent'].includes(role)||!Array.isArray(config.acceptedTermsCatalog)||!config.acceptedTermsCatalog.some(t=>equal(t,v.acceptedTerms)))return deny;
 const b=v.bookOpening,previous=v.hasPreviousBook;
 const validPrevious=previous===false||previous===true&&b&&equal(b.domain,config.domain)&&equal(b.identity,config.agentIdentity)&&b.status===3&&b.outstanding===0n&&u64(b.generation)&&b.generation<18446744073709551615n;
 if(!validPrevious)return deny;
 if(role==='agent')return fixtureAgentPolicy(request,{...context,config:{...config,acceptedTerms:v.acceptedTerms}});
 const allowed=args[0]===1n&&equal(v.enrollmentIdentity,config.agentIdentity)&&u64(v.lineLimit)&&v.lineLimit>0n&&v.lineLimit<=config.maxLineLimit&&
  u64(args[1])&&args[1]>BigInt(clockUnixSeconds)&&args[1]<=config.validBefore&&u64(args[2])&&args[2]<=config.maxFee&&u64(args[3])&&args[3]<=config.maxBasisPoints;
 return {allowed,reservationCost:allowed?v.lineLimit:0n};
}
