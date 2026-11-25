import { verifyAgentGrant } from './agent-authorization.mjs';
import { organizationRecipient } from './organization-auth.mjs';
import { decodeNote } from '../src/lib/organization/transfers.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const need = (condition, message) => { if (!condition) throw Error(message); };

/** Explicit owner-operated, in-process transport to the actual supplier runtime.
 * The grant's real owner signature and current facility owner are checked. No
 * browser cookie, made-up bearer token, arbitrary URL or implicit wallet starts.
 * Remote unattended transport requires a separate authenticated protocol and
 * remains unavailable. The supplier still owns its separate keys and journal. */
export class AgentSupplierClient {
  constructor({ service, scope, proof, pairing, now = Date.now, mode = 'local' } = {}) {
    need(mode === 'local', 'Remote agent supplier authentication is not implemented.');
    need(service && scope && proof && pairing, 'Configure the actual local supplier and owner-signed pairing.');
    verifyAgentGrant(scope, proof, pairing, scope.issuedAt);
    need(typeof service.catalog === 'function' && typeof service.quote === 'function' && typeof service.redeem === 'function' && typeof service.order === 'function' && typeof service.authorizeOrganization === 'function', 'The local supplier runtime is incomplete.');
    this.service = service;
    this.scope = structuredClone(scope); this.proof = structuredClone(proof); this.pairing = structuredClone(pairing); this.now = now;
  }
  async authorize({ newPurchase = false } = {}) {
    verifyAgentGrant(this.scope, this.proof, this.pairing, newPurchase ? this.now() : this.scope.issuedAt);
    need(await this.service.authorizeOrganization(this.scope.facilityAddress, organizationRecipient(this.scope.ownerAddress)), 'The signed organization does not own this supplier facility.');
  }
  async catalog() {
    await this.authorize();
    const catalog = this.service.catalog();
    need(catalog.network === 'preprod' && catalog.sourceFingerprint === this.scope.sourceFingerprint, 'Supplier network or release differs from the signed pairing.');
    return { ...catalog, services: catalog.services.filter(service => this.scope.allowedServices.includes(service.id) && this.scope.allowedMerchants.includes(service.profile.publicKey)) };
  }
  async createOrder({ id, contractAddress, service, document, objective }) {
    need(UUID.test(id) && contractAddress === this.scope.facilityAddress, 'A stable order for the paired facility is required.');
    await this.authorize({ newPurchase: true });
    const catalog = await this.catalog();
    need(catalog.services.some(item => item.id === service), 'Supplier service is outside the signed authorization.');
    return this.service.quote(id, contractAddress, service, document, objective);
  }
  async getOrder(id) {
    need(UUID.test(id), 'A stable order ID is required.');
    await this.authorize();
    const order = this.service.order(id);
    if (order) need(order.contractAddress === this.scope.facilityAddress && this.scope.allowedServices.includes(order.service), 'Supplier order is outside the signed authorization.');
    return { order, busy: Boolean(order?.pending), error: null };
  }
  async submitClaim({ id, claim }) {
    const { order } = await this.getOrder(id);
    need(order, 'The original supplier order was not found.');
    const note = decodeNote(claim);
    need(note.contractAddress === this.scope.facilityAddress && note.domain === this.scope.domain && note.generation.toString() === this.scope.generation && this.scope.allowedMerchants.includes(note.merchantPk), 'Claim differs from the signed supplier scope.');
    // Existing obligations remain deliverable after grant expiry/revocation.
    // The supplier binds the exact quote/claim and reconciles its original bytes.
    return this.service.redeem(id, claim);
  }
}
