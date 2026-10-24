import type { OrganizationSnapshot } from '../organization/account.ts';
import { agentId, contractDomain, issuerPublicKey, lineStateCommit, hexToBytes, toHex } from '../line/encoding.ts';
import { encodeVaultJson } from '../security/vault-codec.ts';
import { agentGrantMessage } from './grant.ts';
import { verifyPairingPackageStructure } from './pairing.ts';
import type { AgentGrantScope, AgentPairingOffer, AgentPairingPackage } from './types.ts';

/** Encrypted account metadata, outside transaction candidate snapshots. Neither
 * expiry nor loss of an acknowledgement releases this fence. Handback is a
 * separate protocol; no phase in this initial staging slice permits unfencing. */
export interface BrowserAgentDelegation {
  schema: 'line:browser-agent-delegation/v1';
  facilityId: string;
  scope: AgentGrantScope;
  returnPrivateKey: string;
  phase: 'staged' | 'export-ready';
  stagedAt: number;
  package: AgentPairingPackage | null;
}
export interface AgentDelegationRequest {
  offer: AgentPairingOffer;
  pinned: Pick<AgentPairingOffer,'runnerOrigin'|'runnerPublicKey'|'runnerSigningPublicKey'>;
  sourceFingerprint: string;
  expiresAt: number;
  maxSpend: string;
  maxFee: string;
  allowedServices: string[];
  allowedMerchants: string[];
}
const need = (value: unknown): void => { if (!value) throw Error('The retained agent delegation is invalid. Keep the organization fenced for recovery.'); };

export function assertDelegationBook(scope: AgentGrantScope, facility: OrganizationSnapshot['facilities'][number], issuerSecret: string): void {
  agentGrantMessage(scope);
  need(facility.address === scope.facilityAddress && facility.issuerRecipient === scope.ownerAddress && facility.generation.toString() === scope.generation && facility.generation > 0n && facility.merchants[0]);
  const domain=contractDomain(issuerPublicKey(hexToBytes(issuerSecret)),hexToBytes(facility.merchants[0].publicKey),hexToBytes(facility.instanceNonce));
  const identity=agentId(hexToBytes(facility.agentSecret));
  need(toHex(domain)===scope.domain && toHex(identity)===scope.agentPk && toHex(lineStateCommit({domain,identity,limit:facility.limit,outstanding:facility.outstanding,epoch:facility.epoch},hexToBytes(facility.salt)))===scope.bookCommitment);
}

export function validateBrowserDelegations(value: unknown, snapshot: OrganizationSnapshot): BrowserAgentDelegation[] {
  if (value === undefined) return [];
  need(Array.isArray(value) && value.length<=50);
  const entries=value as BrowserAgentDelegation[], grants=new Set<string>(), nonces=new Set<string>(), facilities=new Set<string>();
  for (const entry of entries) {
    need(entry && typeof entry==='object' && !Array.isArray(entry) && Object.keys(entry).sort().join()===['schema','facilityId','scope','returnPrivateKey','phase','stagedAt','package'].sort().join());
    need(entry.schema==='line:browser-agent-delegation/v1' && ['staged','export-ready'].includes(entry.phase) && typeof entry.returnPrivateKey==='string' && /^[0-9a-f]{64}$/.test(entry.returnPrivateKey) && entry.returnPrivateKey!=='00'.repeat(32));
    const facility=snapshot.facilities.find(f=>f.id===entry.facilityId);
    need(facility);
    assertDelegationBook(entry.scope,facility!,snapshot.issuerSecret);
    need(Number.isSafeInteger(entry.stagedAt) && entry.stagedAt===entry.scope.issuedAt && !grants.has(entry.scope.grantId) && !nonces.has(entry.scope.nonce) && !facilities.has(entry.facilityId));
    grants.add(entry.scope.grantId);nonces.add(entry.scope.nonce);facilities.add(entry.facilityId);
    if (entry.phase==='staged') need(entry.package===null);
    else {
      const pkg=verifyPairingPackageStructure(entry.package);
      need(agentGrantMessage(pkg.scope)===agentGrantMessage(entry.scope));
    }
  }
  return structuredClone(entries);
}

/** Applies on every ordinary encrypted commit, including saved candidates,
 * failures and recovery archives. Other facilities can still make progress. */
export function assertDelegatedSnapshotStable(before: OrganizationSnapshot, after: OrganizationSnapshot, delegations: BrowserAgentDelegation[]): void {
  if (!delegations.length) return;
  const message="This facility is delegated. Return its runner's reconciled book before changing the organization keys or facility.";
  if (before.issuerSecret!==after.issuerSecret || before.merchantSecret!==after.merchantSecret) throw Error(message);
  for (const entry of delegations) {
    const original=before.facilities.find(f=>f.id===entry.facilityId),next=after.facilities.find(f=>f.id===entry.facilityId);
    if (!original || !next || encodeVaultJson(original)!==encodeVaultJson(next)) throw Error(message);
  }
}
