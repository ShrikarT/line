import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyOrganizationDownload } from '../scripts/install-organization-release.mjs';

const original = new TextEncoder().encode('public proving archive fixture');
const metadata = { bytes: original.length, sha256: createHash('sha256').update(original).digest('hex') };
test('the exact pinned archive bytes pass integrity verification', () => {
  assert.doesNotThrow(() => verifyOrganizationDownload(original, metadata));
});
test('a modified archive of the same length is rejected before extraction', () => {
  const changed = original.slice(); changed[4] ^= 1;
  assert.throws(() => verifyOrganizationDownload(changed, metadata), /integrity/);
});
test('truncated archive bytes are rejected before extraction', () => {
  assert.throws(() => verifyOrganizationDownload(original.slice(1), metadata), /integrity/);
});
