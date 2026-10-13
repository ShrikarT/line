/** Experimental owner-operated mTLS boundary around the durable software signer.
 * The coordinator receives approvals/public identity, never owner configuration
 * or a signing/storage key. No claim of independent operators or hardware keys.
 */
import assert from 'node:assert/strict';
import {createServer,request as httpsRequest} from 'node:https';
import {createHash,timingSafeEqual} from 'node:crypto';
import {checkServerIdentity} from 'node:tls';
import {REQUEST_BYTES,RESPONSE_BYTES,encodeApprovalFrame,decodeApprovalFrame} from './approval-service-frame.mjs';
import {ADDRESS_BOUND_APPROVAL_ABI,isContractAddress} from './address-bound-approval.mjs';
const fingerprint=raw=>createHash('sha256').update(raw).digest('hex'); // TLS certificate identity only.
const DENIED='Approval could not be authorized.',UNCERTAIN='Approval response is uncertain; retry only the identical operation.';
const keys=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===[...names].sort().join('|');
const same=(a,b)=>a instanceof Uint8Array&&b instanceof Uint8Array&&a.length===b.length&&timingSafeEqual(a,b);

export async function startApprovalOwnerService({signer,role,approvalABI,domain,key,cert,ca,allowedClients,host='127.0.0.1',port=0}){
 assert(['issuer','agent','merchant','permissionless'].includes(role));assert(['line-private-offer/v1',ADDRESS_BOUND_APPROVAL_ABI].includes(approvalABI));
 assert(domain instanceof Uint8Array&&domain.length===32);assert(signer&&typeof signer.approve==='function');
 const scope=signer.ownerScope;assert.equal(scope.role,role);assert.equal(scope.approvalABI,approvalABI);assert(same(scope.domain,domain),'Owner must bind this domain before serving approvals.');
 if(approvalABI===ADDRESS_BOUND_APPROVAL_ABI)assert(isContractAddress(scope.contractAddress),'Owner must pin the deployed contract address.');
 assert(Array.isArray(allowedClients)&&allowedClients.length>0&&allowedClients.every(x=>/^[0-9a-f]{64}$/.test(x)));
 assert(Number.isInteger(port)&&port>=0&&port<=65535);
 const permitted=new Set(allowedClients),sockets=new Set();let stopping=false;
 const identity={version:1,role,approvalABI,domain:new Uint8Array(domain),publicKey:signer.publicKey,
  ...(approvalABI===ADDRESS_BOUND_APPROVAL_ABI?{contractAddress:scope.contractAddress}:{})};
 const reply=(res,body,status=200)=>{if(res.destroyed)return;res.writeHead(status,{'content-type':'application/octet-stream','content-length':String(RESPONSE_BYTES),'cache-control':'no-store'});res.end(encodeApprovalFrame(body,RESPONSE_BYTES));};
 const server=createServer({key,cert,ca,requestCert:true,rejectUnauthorized:true,minVersion:'TLSv1.3'},async(req,res)=>{
  try{
   const peer=req.socket.getPeerCertificate();
   if(stopping||!req.socket.authorized||!peer.raw||!permitted.has(fingerprint(peer.raw))){req.resume();reply(res,{ok:false,error:DENIED},403);return;}
   if(req.method!=='POST'||!['/v1/identity','/v1/approve'].includes(req.url)||req.headers['content-type']!=='application/octet-stream'||
    req.headers['content-length']!==String(REQUEST_BYTES)||req.headers['transfer-encoding']!==undefined){req.resume();reply(res,{ok:false,error:DENIED},400);return;}
   const chunks=[];let count=0;
   for await(const chunk of req){count+=chunk.length;if(count>REQUEST_BYTES){req.destroy();return;}chunks.push(chunk);}
   if(count!==REQUEST_BYTES)throw Error('frame');
   const message=decodeApprovalFrame(Buffer.concat(chunks),REQUEST_BYTES);
   if(req.url==='/v1/identity'){if(!keys(message,['version'])||message.version!==1)throw Error('shape');reply(res,{ok:true,identity});return;}
   if(!keys(message,['operationId','descriptor']))throw Error('shape');
   // DurableApprovalSigner validates role/ABI/typed fields and owner policy,
   // and commits the exact operation before its response can leave this owner.
   const approval=signer.approve(message);reply(res,{ok:true,approval});
  }catch{reply(res,{ok:false,error:DENIED});}
 });
 server.maxConnections=16;server.maxHeadersCount=24;server.headersTimeout=5000;server.requestTimeout=5000;server.keepAliveTimeout=1000;
 server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
 // Deliberately no TLS keylog, request-body or signer-error logging.
 await new Promise((yes,no)=>{server.once('error',no);server.listen(port,host,()=>{server.off('error',no);yes();});});
 return {port:server.address().port,identity,
  async close(){if(stopping)return;stopping=true;const closed=new Promise((yes,no)=>server.close(error=>error?no(error):yes()));for(const socket of sockets)socket.destroy();await closed;}
 };
}

export function approvalOwnerClient({url,key,cert,ca,expectedServerFingerprint,expectedRole,expectedPublicKey,expectedDomain,expectedApprovalABI='line-private-offer/v1',expectedContractAddress,timeoutMs=10_000}){
 const target=new URL(url);assert(target.protocol==='https:'&&!target.username&&!target.password&&!target.search&&!target.hash&&target.pathname==='/');
 assert(['issuer','agent','merchant','permissionless'].includes(expectedRole));assert(expectedDomain instanceof Uint8Array&&expectedDomain.length===32);
 assert(['line-private-offer/v1',ADDRESS_BOUND_APPROVAL_ABI].includes(expectedApprovalABI));
 if(expectedApprovalABI===ADDRESS_BOUND_APPROVAL_ABI)assert(isContractAddress(expectedContractAddress),'Pin the deployed contract address.');
 assert(typeof expectedServerFingerprint==='string'&&/^[0-9a-f]{64}$/.test(expectedServerFingerprint),'Pin the owner TLS leaf certificate.');
 assert(Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=60_000);
 async function call(path,message){
  const frame=encodeApprovalFrame(message,REQUEST_BYTES);
  return new Promise((yes,no)=>{
   let settled=false;const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?no(error):yes(value);};
   const req=httpsRequest(new URL(path,target),{method:'POST',key,cert,ca,rejectUnauthorized:true,minVersion:'TLSv1.3',agent:false,
    checkServerIdentity(host,peer){const error=checkServerIdentity(host,peer);if(error)return error;
     if(!peer.raw||fingerprint(peer.raw)!==expectedServerFingerprint)return Error('Approval owner TLS identity mismatch.');},
    headers:{'content-type':'application/octet-stream','content-length':String(REQUEST_BYTES)}},res=>{
    const chunks=[];let count=0;
    if(res.statusCode!==200||res.headers['content-type']!=='application/octet-stream'||res.headers['content-length']!==String(RESPONSE_BYTES)){
     req.destroy();finish(Error(UNCERTAIN));return;
    }
    res.on('data',chunk=>{count+=chunk.length;if(count>RESPONSE_BYTES){req.destroy();finish(Error(UNCERTAIN));}else chunks.push(chunk);});
    res.on('error',()=>finish(Error(UNCERTAIN)));res.on('aborted',()=>finish(Error(UNCERTAIN)));
    res.on('end',()=>{try{const value=decodeApprovalFrame(Buffer.concat(chunks),RESPONSE_BYTES);assert(keys(value,value.ok===true?[path==='/v1/identity'?'identity':'approval','ok']:['ok','error']));
     if(value.ok!==true){assert.equal(value.error,DENIED);finish(Error(DENIED));}else finish(null,value);
    }catch{finish(Error(UNCERTAIN));}});
   });
   const timer=setTimeout(()=>{req.destroy();finish(Error(UNCERTAIN));},timeoutMs);req.on('error',()=>finish(Error(UNCERTAIN)));req.end(frame);
  });
 }
 function matches(pk){assert(pk&&expectedPublicKey&&pk.x===expectedPublicKey.x&&pk.y===expectedPublicKey.y,'Approval owner identity mismatch.');}
 let verifiedIdentity;
 const client={
  async identity(){const {identity}=await call('/v1/identity',{version:1});
   assert(keys(identity,['version','role','approvalABI','domain','publicKey',...(expectedApprovalABI===ADDRESS_BOUND_APPROVAL_ABI?['contractAddress']:[])]));assert.equal(identity.version,1);assert.equal(identity.role,expectedRole);
   assert.equal(identity.approvalABI,expectedApprovalABI);assert(same(identity.domain,expectedDomain));matches(identity.publicKey);
   if(expectedApprovalABI===ADDRESS_BOUND_APPROVAL_ABI)assert.equal(identity.contractAddress,expectedContractAddress,'Approval owner contract address mismatch.');return identity;
  },
  async approve(message){assert(keys(message,['operationId','descriptor']));assert(same(message.descriptor?.domain,expectedDomain),'Approval domain mismatch.');
   if(expectedApprovalABI===ADDRESS_BOUND_APPROVAL_ABI)assert.equal(message.descriptor?.contractAddress,expectedContractAddress,'Approval contract address mismatch.');
   if(!verifiedIdentity){verifiedIdentity=client.identity().catch(error=>{verifiedIdentity=undefined;throw error;});}await verifiedIdentity;
   const {approval}=await call('/v1/approve',message);
   assert(keys(approval,['rolePublicKey','roleApproval','authorizationNonce','challengeQuotient','challengeRemainder','challengeWords','challengeCarry']));
   matches(approval.rolePublicKey);return approval;}
 };return client;
}
