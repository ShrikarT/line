import test from 'node:test';
import assert from 'node:assert/strict';
import { ORGANIZATION_SERVICES, fulfillOrganizationService, extractDocumentSpans } from './organization-services.mjs';

test('the paid integrity API computes the actual content digest and Unicode byte length', () => {
  const result = fulfillOrganizationService('content-integrity', 'hello');
  assert.equal(result.sha256, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  assert.equal(result.utf8Bytes, 5); assert.equal(result.unicodeCodePoints, 5);
  const unicode = fulfillOrganizationService('content-integrity', '💜');
  assert.equal(unicode.utf8Bytes, 4); assert.equal(unicode.unicodeCodePoints, 1);
  assert.notEqual(unicode.sha256, result.sha256);
});

test('document metrics process the submitted content rather than a canned response', () => {
  const result = fulfillOrganizationService('text-metrics', 'Hello hello.\n\nWorld!');
  assert.equal(result.words, 3); assert.equal(result.sentences, 2); assert.equal(result.paragraphs, 2);
  assert.deepEqual(result.recurringTerms[0], { term: 'hello', count: 2 });
  assert.notDeepEqual(result, fulfillOrganizationService('text-metrics', 'A different document has five words.'));
});

test('suppliers have explicit positive base-unit pricing and reject invalid input', () => {
  assert.equal(ORGANIZATION_SERVICES.length, 3);
  assert.deepEqual(ORGANIZATION_SERVICES.map(s => ({ id: s.id, price: s.price, merchant: s.merchant })), [
    { id: 'text-metrics', price: '25000', merchant: 'A' },
    { id: 'content-integrity', price: '20000', merchant: 'B' },
    { id: 'line-doc-extract-v1', price: '50000', merchant: 'A' }
  ]);
  for (const service of ORGANIZATION_SERVICES) assert(BigInt(service.price) > 0n);
  for (const content of ['', '   ', 'x'.repeat(5001), null]) assert.throws(() => fulfillOrganizationService('text-metrics', content));
  assert.throws(() => fulfillOrganizationService('unknown', 'Hello'));
});

test('line-doc-extract-v1 extracts verbatim passages with stable half-open UTF-16 offsets matching objective', () => {
  const markdown = [
    '# Line Architecture Overview',
    'Line combines Compact spending rules with Preprod settlement.',
    '',
    '## Autonomous Agent Purchasing',
    'Agents execute purchase tasks within explicit budget boundaries.',
    '- Budget owner authorizes an agent.',
    '- Daily spending ceiling prevents overrun.',
    '',
    '## Unrelated Protocol Details',
    'Validators produce blocks every few seconds.'
  ].join('\n');

  const objective = 'What are the spending limits and budget for autonomous agents?';
  const result = fulfillOrganizationService('line-doc-extract-v1', markdown, objective);

  assert.equal(result.service, 'line-doc-extract-v1');
  assert.equal(result.version, 1);
  assert.equal(result.outcome, 'evidence_found');
  assert.equal(result.noMatchingEvidence, false);
  assert(result.passages.length >= 2);

  // Invariant: every passage verbatim matches document.slice(start, end)
  for (const p of result.passages) {
    assert.equal(markdown.slice(p.start, p.end), p.text);
    assert(Array.isArray(p.headingPath));
    assert(!/[\r\n\s]+$/.test(p.text), 'Passage must have no trailing whitespace');
  }

  // Heading path and context verification
  const budgetPassage = result.passages.find(p => p.text.includes('Budget owner authorizes'));
  assert(budgetPassage);
  assert.deepEqual(budgetPassage.headingPath, ['Line Architecture Overview', 'Autonomous Agent Purchasing']);
});

test('line-doc-extract-v1 returns explicit no_matching_evidence outcome when document does not address objective', () => {
  const doc = '# Planetary Science\n\nJupiter has dozens of moons including Europa and Ganymede.';
  const result = fulfillOrganizationService('line-doc-extract-v1', doc, 'cryptographic zero knowledge circuits');

  assert.equal(result.service, 'line-doc-extract-v1');
  assert.equal(result.outcome, 'no_matching_evidence');
  assert.equal(result.noMatchingEvidence, true);
  assert.deepEqual(result.passages, []);
  assert.equal(typeof result.inputDigest, 'string');
  assert.equal(typeof result.objectiveDigest, 'string');
});

test('natural objective filtering ignores question/instruction/function words against unrelated text with the/and/document', () => {
  const unrelatedDoc = '# System Administration\n\nThe document and its contents discuss memory and cpu allocation from the cluster.';
  const naturalObjective = 'What does the document say about refund policy?';
  const result = fulfillOrganizationService('line-doc-extract-v1', unrelatedDoc, naturalObjective);

  assert.equal(result.outcome, 'no_matching_evidence');
  assert.equal(result.noMatchingEvidence, true);
  assert.deepEqual(result.passages, []);
});

test('full-token matching rejects partial substring matches like art inside partial or start', () => {
  const doc = '# Overview\n\nThis is a partial result starting from particle physics.';
  const result = fulfillOrganizationService('line-doc-extract-v1', doc, 'Show me art');

  assert.equal(result.outcome, 'no_matching_evidence');
  assert.equal(result.noMatchingEvidence, true);
  assert.deepEqual(result.passages, []);

  const trueMatchDoc = '# Overview\n\nThis gallery displays modern art from regional creators.';
  const trueMatch = fulfillOrganizationService('line-doc-extract-v1', trueMatchDoc, 'Show me art');
  assert.equal(trueMatch.outcome, 'evidence_found');
  assert.equal(trueMatch.noMatchingEvidence, false);
  assert(trueMatch.passages.some(p => p.text.includes('modern art')));
});

test('line-doc-extract-v1 handles CRLF, emojis, lists and heading paths with exact half-open UTF-16 slices', () => {
  const crlfDoc = '# Customer Care 💜\r\n\r\n## Refund Policy 🛡️\r\nAll refunds are processed within 30 days.\r\n- Full refund for annual plans.\r\n- Prorated refund for monthly plans.\r\n\r\n## Shipping\r\nOrders ship in 2 days.';
  const result = fulfillOrganizationService('line-doc-extract-v1', crlfDoc, 'What is the refund policy?');

  assert.equal(result.outcome, 'evidence_found');
  assert(result.passages.length >= 2);
  for (const p of result.passages) {
    assert.equal(crlfDoc.slice(p.start, p.end), p.text);
    assert(!/[\r\n\s]+$/.test(p.text));
  }

  const listPassage = result.passages.find(p => p.text.includes('Full refund'));
  assert(listPassage);
  assert.deepEqual(listPassage.headingPath, ['Customer Care 💜', 'Refund Policy 🛡️']);
});

test('line-doc-extract-v1 enforces maximum 30 passages and 32KiB UTF-8 serialized byte limit deterministically', () => {
  const lines = ['# Big Document\n'];
  for (let i = 0; i < 45; i++) {
    lines.push(`## Section ${i}\nPassage content number ${i} discussing priority keyword topic.`);
  }
  const bigDoc = lines.join('\n\n');
  const result1 = fulfillOrganizationService('line-doc-extract-v1', bigDoc, 'keyword topic');
  const result2 = fulfillOrganizationService('line-doc-extract-v1', bigDoc, 'keyword topic');

  assert(result1.passages.length <= 30);
  assert.equal(result1.passages.length, 30);
  const serializedBytes = Buffer.byteLength(JSON.stringify(result1), 'utf8');
  assert(serializedBytes <= 32 * 1024);

  // Determinism check
  assert.deepEqual(result1, result2);

  // Invariant holds for all returned passages
  for (const p of result1.passages) {
    assert.equal(bigDoc.slice(p.start, p.end), p.text);
    assert(!/[\r\n\s]+$/.test(p.text));
  }
});

test('line-doc-extract-v1 correctly enforces Unicode bounds and rejects invalid inputs', () => {
  const largeDoc = '💜'.repeat(5001);
  assert.throws(() => fulfillOrganizationService('line-doc-extract-v1', largeDoc, 'test'), /5000 characters/);
  const largeObjective = 'a'.repeat(501);
  assert.throws(() => fulfillOrganizationService('line-doc-extract-v1', 'Valid doc', largeObjective), /500 characters/);
  assert.throws(() => fulfillOrganizationService('line-doc-extract-v1', 'Valid doc', ''), /500 characters/);
  assert.throws(() => fulfillOrganizationService('line-doc-extract-v1', 'Valid doc', '   '), /500 characters/);
  assert.throws(() => fulfillOrganizationService('line-doc-extract-v1', '', 'Valid objective'), /5000 characters/);
  assert.throws(() => fulfillOrganizationService('line-doc-extract-v1', '   ', 'Valid objective'), /5000 characters/);
});
