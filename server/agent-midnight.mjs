import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { createUnprovenCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { resolveContractRelease, validateContractArtifacts } from '../scripts/contract-artifacts.mjs';
import { decodeOriginalOrganizationTransaction, originalOrganizationTransaction } from '../src/lib/organization/transactions.ts';
import { agentId, lineStateCommit, quoteCommit, drawNoteCommit, requiredDrawFee, hexToBytes, toHex } from '../src/lib/line/encoding.ts';
import { organizationRecipient } from './organization-auth.mjs';
import { assertFundedFeeTransaction } from './preprod-fees.mjs';

const CIRCUITS = ['registerMerchant', 'disableMerchant', 'fundReserve', 'withdrawUnencumberedReserve', 'withdrawFees', 'openLine', 'postQuote', 'draw', 'redeemDraw', 'cancelOrExpireNote', 'acknowledgeRepayment', 'setStatus'];
const need = (condition, message) => { if (!condition) throw Error(message); };
const same = (a, b) => a instanceof Uint8Array && b instanceof Uint8Array && Buffer.from(a).equals(Buffer.from(b));
const bytes32 = value => { need(typeof value === 'string' && /^[0-9a-f]{64}$/.test(value), 'Expected a canonical 32-byte value.'); return hexToBytes(value); };

export function assertSameAgentDrawCall(expected, actual) {
  const call = tx => {
    const actions = [...(tx.intents?.values() ?? [])].flatMap(intent => intent.actions);
    need(actions.length === 1, 'Expected exactly one agent contract call.');
    const action = actions[0], entryPoint = typeof action.entryPoint === 'string' ? action.entryPoint : Buffer.from(action.entryPoint ?? []).toString();
    need(entryPoint === 'draw', 'Prepared transaction is not an agent draw.');
    return { address: action.address, entryPoint, communicationCommitment: action.communicationCommitment, guaranteed: action.guaranteedTranscript, fallible: action.fallibleTranscript };
  };
  need(isDeepStrictEqual(call(expected), call(actual)), 'Fee balancing changed the prepared agent draw.');
}

/** Release-specific public VM query: redeemDraw first tests notes.member(D).
 * The generated organization release addresses notes at storage path [1,12].
 * Only use after verifying all release keys. Matching resulting state alone
 * could attribute an old redeemed note to another same-value payout. */
export function redemptionNoteCommitment(raw, address) {
  const actions = [...(raw.intents?.values() ?? [])].flatMap(intent => intent.actions ?? []).filter(action => action.address === address);
  need(actions.length === 1, 'Supplier receipt has no unique redemption call.');
  const action = actions[0];
  need((typeof action.entryPoint === 'string' ? action.entryPoint : Buffer.from(action.entryPoint ?? []).toString()) === 'redeemDraw', 'Supplier receipt is not a redemption call.');
  const program = [action.guaranteedTranscript, action.fallibleTranscript].filter(Boolean).flatMap(transcript => transcript.program);
  const cellBytes = value => value?.alignment?.length === 1 && value.alignment[0]?.tag === 'atom' && value.alignment[0].value?.tag === 'bytes' && value.value?.length === 1 && value.value[0] instanceof Uint8Array ? value.value[0] : null;
  const at = program.indexOf('member'), path = program[at - 2]?.idx?.path;
  const key = cellBytes(program[at - 1]?.push?.value?.content);
  need(at >= 3 && program[at - 3]?.dup?.n === 0 && program[at - 2].idx.cached === false && program[at - 2].idx.pushPath === false && path?.length === 2 && path.every((part, i) => part.tag === 'value' && cellBytes(part.value)?.length === 1 && cellBytes(part.value)[0] === [1, 12][i]) && program[at - 1].push.storage === false && program[at - 1].push.value.tag === 'cell' && key?.length === 32, 'Supplier redemption note query differs from this release.');
  return toHex(key);
}

/** Validate immutable retained bytes. Expired operations stay decodable for
 * reconciliation; ordinary submission always uses the stricter TTL check. */
export function decodeAgentDraw(pending, sourceFingerprint, { submit = false, now = Date.now() } = {}) {
  need(pending?.circuit === 'draw' && pending.sourceFingerprint === sourceFingerprint, 'Recover this draw with its original release.');
  const saved = { kind: 'call', circuit: 'draw', contractAddress: pending.facilityAddress, sourceFingerprint, txId: pending.identifier, transaction: pending.transaction };
  const tx = submit ? originalOrganizationTransaction(saved, sourceFingerprint, now) : decodeOriginalOrganizationTransaction(saved, sourceFingerprint);
  need(tx.transactionHash() === pending.transactionHash, 'Retained draw transaction hash differs.');
  return tx;
}

export function prepareAgentClaim(book, quote, { noteNonce, noteSalt, newSalt }) {
  need(toHex(agentId(bytes32(book.agentSecret))) === book.agentPk, 'Agent material belongs to another identity.');
  need(quote.contractAddress === book.facilityAddress && quote.domain === book.domain && quote.generation === book.generation, 'Quote differs from the current agent book.');
  const commitment = quoteCommit({ merchantPk: bytes32(quote.merchantPk), invoiceId: bytes32(quote.invoiceId), nonce: bytes32(quote.quoteNonce), amount: quote.amount, expiry: quote.expiry, generation: quote.generation, domain: bytes32(quote.domain), feeFlat: quote.feeFlat, feeBps: quote.feeBps });
  need(toHex(commitment) === quote.quoteCommitment, 'Quote commitment differs from its terms.');
  const fee = requiredDrawFee(quote.amount, quote.feeFlat, quote.feeBps);
  need(typeof book.epoch === 'bigint' && book.epoch >= 0n && book.epoch < (1n << 64n) - 1n && book.outstanding >= 0n && book.outstanding + quote.amount + fee <= book.limit && book.limit <= (1n << 64n) - 1n, 'Clearance could not be proven.');
  const note = { contractAddress: quote.contractAddress, domain: quote.domain, identity: book.agentPk, merchantPk: quote.merchantPk, quoteCommitment: quote.quoteCommitment, amount: quote.amount, fee, expiry: quote.expiry, generation: quote.generation, noteNonce, noteSalt, noteCommitment: '', redeemed: false };
  note.noteCommitment = toHex(drawNoteCommit({ domain: bytes32(note.domain), lineGeneration: note.generation, identity: bytes32(note.identity), quoteCommit: commitment, merchantPk: bytes32(note.merchantPk), amount: note.amount, fee, noteNonce: bytes32(noteNonce), expiry: note.expiry }, bytes32(noteSalt)));
  bytes32(newSalt);
  return { candidateBook: { ...book, outstanding: book.outstanding + quote.amount + fee, epoch: book.epoch + 1n, salt: newSalt }, candidateNote: note };
}

/** Actual SDK proving and dedicated fee-wallet balancing, with submission kept
 * separate so the runner can first commit exact signed bytes and its candidate.
 * Creating this adapter never opens an owner vault or starts a wallet. */
export class MidnightAgentAdapter {
  static async create({ feeWallet, sourceFingerprint }) {
    need(feeWallet?.started && feeWallet.providers && feeWallet.reader && feeWallet.api, 'Start an explicitly configured dedicated agent fee wallet first.');
    feeWallet.assertOpen();
    const release = validateContractArtifacts({ artifactDir: resolveContractRelease({ profile: 'organization' }), profile: 'organization' });
    need(release.inputs.source.sha256 === sourceFingerprint, 'Agent release differs from the paired organization release.');
    const generated = await import(pathToFileURL(join(release.artifactDir, 'contract/index.js')).href);
    const adapter = new MidnightAgentAdapter();
    adapter.owner = feeWallet;
    adapter.release = release;
    adapter.sourceFingerprint = sourceFingerprint;
    adapter.generated = generated;
    adapter.input = null;
    adapter.zk = new NodeZkConfigProvider(release.artifactDir);
    const witnesses = Object.fromEntries(release.compilerInfo.witnesses.map(({ name }) => [name, context => {
      const value = adapter.input?.[name];
      need(value !== undefined, 'Missing agent draw witness.');
      return [context.privateState, value];
    }]));
    adapter.compiled = CompiledContract.make('line-organization', generated.Contract).pipe(CompiledContract.withWitnesses(witnesses), CompiledContract.withCompiledFileAssets(release.artifactDir));
    // SDK state is exactly {}, never the private book. Only draw is exposed;
    // the application journal owns the secret book/candidate and all receipts.
    adapter.providers = { ...feeWallet.providers, zkConfigProvider: adapter.zk,
      proofProvider: httpClientProofProvider(feeWallet.endpoints.proofServerUri, adapter.zk),
      privateStateProvider: { setContractAddress() {}, async get() { return {}; } },
      midnightProvider: { async submitTx() { throw Error('Draw submission requires the durable agent journal.'); } },
    };
    return adapter;
  }

  async inspect(book, ownerAddress) {
    this.owner.assertOpen();
    need(toHex(agentId(bytes32(book.agentSecret))) === book.agentPk, 'Agent material belongs to another identity.');
    const state = await this.providers.publicDataProvider.queryContractState(book.facilityAddress);
    need(state && JSON.stringify(state.operations().map(value => typeof value === 'string' ? value : Buffer.from(value).toString()).sort()) === JSON.stringify([...CIRCUITS].sort()), 'Agent facility verifier setup differs.');
    for (const name of CIRCUITS) need(same(state.operation(name).verifierKey, await this.zk.getVerifierKey(name)), 'Agent facility release differs.');
    const ledger = this.generated.ledger(state.data);
    need(ledger.settlementTokenInitialized && toHex(ledger.settlementTokenColor) === '00'.repeat(32), 'This agent service requires funded native Preprod assets.');
    const commitment = lineStateCommit({ domain: bytes32(book.domain), identity: bytes32(book.agentPk), limit: book.limit, outstanding: book.outstanding, epoch: book.epoch }, bytes32(book.salt));
    need(toHex(ledger.contractDomain) === book.domain && ledger.lineGeneration === book.generation && toHex(ledger.identityCommit) === book.agentPk && same(ledger.lineCommit, commitment) && toHex(ledger.issuerPayoutRecipient.bytes) === organizationRecipient(ownerAddress), 'Agent book or owner differs from the current facility.');
    need(ledger.status === this.generated.Status.OPEN && ledger.lineExpiry > BigInt(Math.floor(Date.now() / 1000)), 'Clearance could not be proven.');
    return ledger;
  }

  async prepareDraw(intent) {
    need(!this.preparing, 'Agent proving is already active.');
    this.preparing = true;
    try { return await this.#prepareDraw(intent); }
    finally { this.preparing = false; this.input = null; }
  }

  async #prepareDraw({ book, quote, candidateBook, candidateNote, ownerAddress }) {
    const expected = prepareAgentClaim(book, quote, { noteNonce: candidateNote.noteNonce, noteSalt: candidateNote.noteSalt, newSalt: candidateBook.salt });
    need(expected.candidateNote.noteCommitment === candidateNote.noteCommitment && expected.candidateBook.outstanding === candidateBook.outstanding && expected.candidateBook.epoch === candidateBook.epoch, 'Draw candidate changed.');
    const state = await this.inspect(book, ownerAddress);
    need(quote.feeFlat === state.feeFlat && quote.feeBps === state.feeBps && state.quotes.member(bytes32(quote.quoteCommitment)) && !state.quotes.lookup(bytes32(quote.quoteCommitment)).used, 'Clearance could not be proven.');
    this.input = { callerSecret: bytes32(book.agentSecret), agentSecret: bytes32(book.agentSecret), salt: bytes32(book.salt), newSalt: bytes32(candidateBook.salt), lineLimit: book.limit, lineOutstanding: book.outstanding, lineEpoch: book.epoch, quoteMerchantPk: bytes32(quote.merchantPk), invoiceId: bytes32(quote.invoiceId), quoteNonce: bytes32(quote.quoteNonce), quoteAmount: quote.amount, drawAmount: quote.amount, noteNonce: bytes32(candidateNote.noteNonce), noteSalt: bytes32(candidateNote.noteSalt) };
    try {
      setNetworkId('preprod');
      const unproven = await createUnprovenCallTx(this.providers, { compiledContract: this.compiled, contractAddress: book.facilityAddress, circuitId: 'draw', privateStateId: `agent:${book.facilityAddress}`, args: [bytes32(quote.quoteCommitment), quote.expiry, candidateNote.fee] });
      const proven = await this.providers.proofProvider.proveTx(unproven.private.unprovenTx);
      const tx = assertFundedFeeTransaction(await this.providers.walletProvider.balanceTx(proven));
      assertSameAgentDrawCall(unproven.private.unprovenTx, tx);
      const signed = { circuit: 'draw', facilityAddress: book.facilityAddress, sourceFingerprint: this.sourceFingerprint, identifier: tx.identifiers().at(-1), transaction: toHex(tx.serialize()), transactionHash: tx.transactionHash() };
      decodeAgentDraw(signed, this.sourceFingerprint);
      await this.owner.persistWallet();
      return signed;
    } finally { this.input = null; }
  }

  async submitOriginal(pending) {
    this.owner.assertOpen();
    const tx = decodeAgentDraw(pending, this.sourceFingerprint, { submit: true });
    const extrinsic = this.owner.api.tx.midnight.sendMnTransaction('0x' + toHex(tx.serialize())).toHex();
    const response = await fetch(this.owner.endpoints.nodeUri, { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'author_submitExtrinsic', params: [extrinsic] }), signal: AbortSignal.timeout(30_000) });
    need(response.ok, 'Draw submission is uncertain. Reconcile the retained identifier.');
    const result = await response.json();
    need(result?.jsonrpc === '2.0' && result.id === 1 && !result.error && /^0x[0-9a-f]{64}$/i.test(result.result), 'Draw submission is uncertain. Reconcile the retained identifier.');
    return pending.identifier;
  }

  async reconcile(pending) {
    const original = decodeAgentDraw(pending, this.sourceFingerprint);
    const observed = await this.owner.reader.readOutcome({ kind: 'call', name: 'draw', identifier: pending.identifier }, pending.facilityAddress);
    // The read-only reader verifies canonical raw transaction identifiers, target,
    // entrypoint, SUCCESS and node-pinned finalized block. Merged transactions
    // can have a different aggregate hash; the original identifier must remain.
    need(observed.networkFinalityVerified === true && observed.raw.identifiers().includes(pending.identifier) && original.identifiers().includes(pending.identifier), 'The original draw has not been finalized.');
    need(['success', 'failure'].includes(observed.outcome), 'The original draw outcome is unresolved.');
    if (observed.outcome === 'success') for (const name of CIRCUITS) need(same(observed.state.operation(name)?.verifierKey, await this.zk.getVerifierKey(name)), 'Finalized draw release differs.');
    return { circuit: 'draw', contractAddress: pending.facilityAddress, identifier: pending.identifier, txHash: observed.transaction.hash, blockHeight: observed.transaction.block.height, blockHash: observed.canonicalHash, sourceFingerprint: this.sourceFingerprint, outcome: observed.outcome, finalizedHead: observed.finalizedHead };
  }

  async verifyRedemption(order, note) {
    const reference = order?.receipts?.find(row => row.circuit === 'redeemDraw' && row.contractAddress === note.contractAddress);
    if (!reference) return null;
    const observed = await this.owner.reader.read({ kind: 'call', name: 'redeemDraw', txHash: reference.txHash, blockHeight: reference.blockHeight }, note.contractAddress);
    need(observed.networkFinalityVerified === true, 'Supplier payment is not finalized.');
    for (const name of CIRCUITS) need(same(observed.state.operation(name)?.verifierKey, await this.zk.getVerifierKey(name)), 'Supplier payment release differs.');
    const state = this.generated.ledger(observed.compactState.data), key = bytes32(note.noteCommitment);
    need(toHex(state.contractDomain) === note.domain && state.notes.member(key), 'Supplier receipt does not contain this claim.');
    const meta = state.notes.lookup(key);
    need(meta.redeemed && !meta.cancelled && meta.amount === note.amount && meta.fee === note.fee && meta.expiry === note.expiry && meta.lineGeneration === note.generation, 'Supplier receipt does not settle this exact claim.');
    const merchant = bytes32(note.merchantPk);
    need(state.merchantPayoutRecipients.member(merchant), 'Supplier payment recipient is missing.');
    const recipient = toHex(state.merchantPayoutRecipients.lookup(merchant).bytes), color = toHex(state.settlementTokenColor);
    need(redemptionNoteCommitment(observed.raw, note.contractAddress) === note.noteCommitment, 'Supplier redemption call settles another claim.');
    const outputs = [...observed.raw.intents.values()].flatMap(intent => [intent.guaranteedUnshieldedOffer, intent.fallibleUnshieldedOffer].filter(Boolean).flatMap(offer => offer.outputs));
    need(outputs.some(output => output.owner === recipient && output.type === color && output.value === note.amount), 'Supplier receipt has no matching asset payout.');
    return { circuit: 'redeemDraw', contractAddress: note.contractAddress, txHash: observed.transaction.hash, blockHeight: observed.transaction.block.height, blockHash: observed.canonicalHash, sourceFingerprint: this.sourceFingerprint, outcome: 'success', finalizedHead: observed.finalizedHead, recipient, assetColor: color, amount: note.amount.toString(), noteCommitment: note.noteCommitment };
  }
}
