/** Public wire types. Role secrets, signed-operation candidates and private books
 * are absent from task responses. Decimal amounts stay strings. */
export const AGENT_GRANT_FIELDS = Object.freeze(['schema', 'grantId', 'networkId', 'facilityAddress', 'domain', 'sourceFingerprint',
  'ownerAddress', 'runnerOrigin', 'runnerPublicKey', 'runnerSigningPublicKey', 'returnPublicKey',
  'agentPk', 'generation', 'bookCommitment', 'nonce', 'issuedAt', 'expiresAt', 'maxSpend', 'maxFee', 'allowedServices', 'allowedMerchants'] as const);
export interface AgentGrantScope {
  schema: 'line:agent-grant/v1';
  grantId: string;
  networkId: 'preprod';
  facilityAddress: string;
  domain: string;
  sourceFingerprint: string;
  ownerAddress: string;
  runnerOrigin: string;
  runnerPublicKey: string; // 64-hex raw X25519 encryption key
  runnerSigningPublicKey: string; // 64-hex raw Schnorr BIP340 signing key
  returnPublicKey: string; // 64-hex raw X25519 browser return encryption key
  agentPk: string;
  generation: string;
  bookCommitment: string;
  nonce: string; // offerNonce
  issuedAt: number;
  expiresAt: number;
  maxSpend: string;
  maxFee: string;
  allowedServices: string[];
  allowedMerchants: string[];
}

export interface AgentGrantProof {
  scheme?: 'schnorr_bip340';
  verifyingKey: string;
  signature: string;
}

export type AgentTaskStatus = 'quote_pending' | 'payment_pending' | 'payment_uncertain'
  | 'claim_authorized' | 'redemption_pending' | 'redemption_uncertain'
  | 'paid_awaiting_delivery' | 'paid_undelivered' | 'result_ready' | 'completed'
  | 'failed' | 'approval_needed' | 'denied';

export type AgentDenialReason = 'budget_exceeded' | 'fee_exceeded' | 'supplier_not_authorized'
  | 'authorization_inactive' | 'purchase_not_authorized' | null;

export interface AgentReceipt {
  circuit: 'draw' | 'redeemDraw';
  contractAddress: string;
  identifier?: string;
  txHash: string;
  blockHeight: number;
  blockHash: string;
  sourceFingerprint: string;
  outcome: 'success' | 'failure';
}

export interface SourcePassage {
  start: number;
  end: number;
  text: string;
  headingPath: string[];
}

export interface AgentBrief {
  text: string;
  citations: { start: number; end: number }[];
}

export interface AgentTaskView {
  id: string;
  orderId: string;
  objective: string;
  status: AgentTaskStatus;
  paymentStatus: 'unpaid' | 'pending' | 'uncertain' | 'authorized' | 'paid' | 'failed';
  deliveryStatus: 'pending' | 'delivered' | 'undelivered';
  denialReason?: AgentDenialReason;
  cost: {
    assetColor: string;
    decimals: 6;
    merchantPrice: string;
    organizationFee: string;
    totalAllowanceCharge: string;
  } | null;
  result: {
    service: 'line-doc-extract-v1';
    version: 1;
    inputDigest: string;
    objectiveDigest: string;
    outcome: 'evidence_found' | 'no_matching_evidence';
    passages: SourcePassage[];
  } | null;
  brief: AgentBrief | null;
  receipts: AgentReceipt[];
  error: string | null;
  updatedAt: number;
}

export interface AgentEncryptedEnvelope {
  version: 1;
  purpose: 'line:agent-pairing/v1' | 'line:agent-handback/v1';
  ephemeralPublicKey: string; // 64-hex (32 bytes raw)
  nonce: string; // 64-hex (32 bytes raw)
  iv: string; // 24-hex (12 bytes raw)
  ciphertext: string; // hex string (includes 16-byte GCM auth tag)
}

export interface AgentBookOpeningPayload {
  agentSecret: string; // 64-hex (32 bytes raw)
  salt: string; // 64-hex (32 bytes raw)
  limit: string; // decimal string
  outstanding: string; // decimal string
  epoch: string; // decimal string
  generation: string; // decimal string
}

export interface AgentPairingOffer {
  schema: 'line:agent-pairing-offer/v1';
  runnerOrigin: string;
  runnerPublicKey: string; // 64-hex raw X25519
  runnerSigningPublicKey: string; // 64-hex raw Schnorr BIP340
  offerNonce: string; // 64-hex (32 bytes raw)
  timestamp: number;
}

export interface AgentPairingPackage {
  schema: 'line:agent-pairing-package/v1';
  packageId: string; // UUID, equals scope.grantId
  offerNonce: string; // 64-hex, equals scope.nonce
  scope: AgentGrantScope;
  ownerSignature: AgentGrantProof;
  encryptedOpening: AgentEncryptedEnvelope;
}
