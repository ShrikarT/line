import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContractRelease, SUPPORTED_COMPACT } from '../scripts/contract-artifacts.mjs';
import { publishOrganizationAssets } from '../scripts/publish-organization-assets.mjs';

const managed = fileURLToPath(new URL('../contracts/managed/organization/', import.meta.url));
const names = JSON.parse(readFileSync(join(managed, 'compiler/contract-info.json'), 'utf8')).circuits.map(circuit => circuit.name);
async function project(t) {
  const root = mkdtempSync(join(tmpdir(), 'line-public-assets-'));
  t.after(() => { assert(resolve(root).startsWith(resolve(tmpdir()) + sep + 'line-public-assets-')); rmSync(root, { recursive: true, force: true }); });
  mkdirSync(join(root, 'contracts/organization'), { recursive: true }); mkdirSync(join(root, 'scripts')); mkdirSync(join(root, 'dist'));
  writeFileSync(join(root, 'contracts/organization/line.compact'), 'pragma language_version 0.23;\n// Public-export integrity fixture only.\n');
  writeFileSync(join(root, 'scripts/compile-compact.mjs'), '// Integrity fixture wrapper.\n');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ compact: SUPPORTED_COMPACT, dependencies: { '@midnight-ntwrk/compact-runtime': '0.16.0' } }));
  writeFileSync(join(root, 'dist/index.html'), '<main>Fixture build</main>');
  const release = await buildContractRelease({ projectRoot: root, profile: 'organization', compile: ({ artifactDir }) => {
    cpSync(managed, artifactDir, { recursive: true });
    // Synthetic public proving material tests export integrity, not ZK validity.
    for (const name of names) for (const path of [`keys/${name}.prover`, `keys/${name}.verifier`, `zkir/${name}.bzkir`]) {
      mkdirSync(dirname(join(artifactDir, path)), { recursive: true }); writeFileSync(join(artifactDir, path), `PUBLIC EXPORT FIXTURE ${path}`);
    }
  } });
  return { root, release };
}
function files(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(directory, entry.name), prefix + entry.name + '/') : [prefix + entry.name]).sort();
}
test('deployment export contains the exact public proving allowlist and the source-bound browser manifest', async t => {
  const { root, release } = await project(t);
  writeFileSync(join(release.artifactDir, 'DO-NOT-PUBLISH.private'), 'PRIVATE EXPORT CONTROL');
  const result = publishOrganizationAssets({ projectRoot: root });
  const directory = join(root, 'dist/organization-zk');
  assert.deepEqual(files(directory), ['release.json', ...names.flatMap(name => [`keys/${name}.prover`, `keys/${name}.verifier`, `zkir/${name}.bzkir`])].sort());
  const manifest = JSON.parse(readFileSync(join(directory, 'release.json'), 'utf8'));
  assert.equal(manifest.profile, 'organization'); assert.deepEqual(manifest.inputs, release.inputs); assert.deepEqual(manifest.files, release.files);
  for (const file of files(directory).filter(file => file !== 'release.json')) assert.deepEqual(readFileSync(join(directory, file)), readFileSync(join(release.artifactDir, file)));
  assert.equal(result.files, 37); assert.equal(result.sourceFingerprint, release.inputs.source.sha256);
  assert.throws(() => publishOrganizationAssets({ projectRoot: root }), /clean frontend build/);
});
test('modified source or proving material fails before publishing any public directory', async t => {
  for (const target of ['source', 'prover']) {
    const { root, release } = await project(t);
    writeFileSync(target === 'source' ? join(root, 'contracts/organization/line.compact') : join(release.artifactDir, 'keys/draw.prover'), 'tampered');
    assert.throws(() => publishOrganizationAssets({ projectRoot: root }));
    assert.equal(existsSync(join(root, 'dist/organization-zk')), false);
    assert.deepEqual(files(join(root, 'dist')), ['index.html']);
  }
});
test('publication requires a frontend build and never overwrites an existing output directory', async t => {
  const { root } = await project(t);
  rmSync(join(root, 'dist/index.html'));
  assert.throws(() => publishOrganizationAssets({ projectRoot: root }), /frontend build/);
  writeFileSync(join(root, 'dist/index.html'), 'build');
  mkdirSync(join(root, 'dist/organization-zk')); writeFileSync(join(root, 'dist/organization-zk/retained'), 'existing output');
  assert.throws(() => publishOrganizationAssets({ projectRoot: root }), /clean frontend build/);
  assert.equal(readFileSync(join(root, 'dist/organization-zk/retained'), 'utf8'), 'existing output');
});
