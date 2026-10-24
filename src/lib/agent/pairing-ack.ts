import type { AgentGrantScope } from './types.ts';
import { browserAgentGrantDigest } from './grant.ts';
import { organizationMessageBytes } from '../organization/signing.ts';

export interface AgentPairingAcknowledgement {
  payload: {
    schema: 'line:agent-pairing-ack/v1';
    grantId: string;
    grantDigest: string;
    packageDigest: string;
    offerNonce: string;
    bookCommitment: string;
    storeRevision: number;
    acceptedAt: number;
  };
  signature: string;
}
const fields = ['schema','grantId','grantDigest','packageDigest','offerNonce','bookCommitment','storeRevision','acceptedAt'] as const;
const hex = /^[0-9a-f]{64}$/;
export function pairingAcknowledgementMessage(payload: AgentPairingAcknowledgement['payload']): string {
  if (!payload || typeof payload !== 'object' || Object.keys(payload).length !== fields.length || fields.some(key=>!Object.hasOwn(payload,key)||!Object.hasOwn(Object.getOwnPropertyDescriptor(payload,key)!,'value')) || payload.schema!=='line:agent-pairing-ack/v1' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(payload.grantId) || ['grantDigest','packageDigest','offerNonce','bookCommitment'].some(key=>typeof (payload as any)[key]!=='string'||!hex.test((payload as any)[key])) || !Number.isSafeInteger(payload.storeRevision) || payload.storeRevision<1 || !Number.isSafeInteger(payload.acceptedAt) || payload.acceptedAt<1) throw Error('Invalid runner pairing acknowledgement.');
  return 'Line agent pairing acknowledgement\n'+JSON.stringify(Object.fromEntries(fields.map(key=>[key,payload[key]])));
}

/** Acknowledges retained import only. It never authorizes browser unfencing or
 * proves exclusive custody of copied credentials on another device. */
export async function verifyPairingAcknowledgement(value: AgentPairingAcknowledgement, scope: AgentGrantScope, expectedPackageDigest: string): Promise<AgentPairingAcknowledgement> {
  if (!value || typeof value!=='object' || Object.keys(value).sort().join()!=='payload,signature' || ['payload','signature'].some(key=>!Object.hasOwn(Object.getOwnPropertyDescriptor(value,key)!,'value'))) throw Error('Invalid runner pairing acknowledgement.');
  const message=pairingAcknowledgementMessage(value.payload), captured=structuredClone(value), pinned=structuredClone(scope);
  if (typeof captured.signature!=='string'||!/^[0-9a-f]{128}$/.test(captured.signature)) throw Error('Invalid runner pairing acknowledgement signature.');
  const digest=await browserAgentGrantDigest(pinned), p=captured.payload;
  if (p.grantId!==pinned.grantId||p.grantDigest!==digest||p.packageDigest!==expectedPackageDigest||p.offerNonce!==pinned.nonce||p.bookCommitment!==pinned.bookCommitment||p.acceptedAt<pinned.issuedAt||p.acceptedAt>=pinned.expiresAt) throw Error('Runner pairing acknowledgement differs from the reviewed package.');
  const ledger=await import('@midnight-ntwrk/ledger-v8');
  if (!ledger.verifySignature(pinned.runnerSigningPublicKey,organizationMessageBytes(message),captured.signature)) throw Error('Runner pairing acknowledgement signature is invalid.');
  return captured;
}
