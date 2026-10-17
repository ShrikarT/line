import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveContractRelease, validateContractArtifacts } from './contract-artifacts.mjs';
import { publicOrganizationManifest } from '../server/zk-assets.ts';

/** Export only the same proving files served by /organization-zk locally.
 * A complete validated release is mandatory. No credentials, wallet cache,
 * private application records or unlisted artifact-directory files are copied.
 */
export function publishOrganizationAssets({ projectRoot = process.cwd() } = {}) {
  projectRoot = resolve(projectRoot);
  const dist = join(projectRoot, 'dist'), destination = join(dist, 'organization-zk');
  if (!existsSync(join(dist, 'index.html')) || lstatSync(dist).isSymbolicLink()) throw Error('Run a frontend build before exporting its organization proving assets.');
  if (existsSync(destination)) throw Error('Run a clean frontend build before publishing proving assets again; existing output is never overwritten.');
  const release = validateContractArtifacts({ artifactDir: resolveContractRelease({ projectRoot, profile: 'organization' }), projectRoot, profile: 'organization' });
  const names = release.compilerInfo.circuits.map(circuit => circuit.name);
  const paths = names.flatMap(name => [`keys/${name}.prover`, `keys/${name}.verifier`, `zkir/${name}.bzkir`]);
  if (paths.length !== 36 || paths.some(path => !/^(?:keys\/[a-zA-Z]+\.(?:prover|verifier)|zkir\/[a-zA-Z]+\.bzkir)$/.test(path) || !release.files[path])) throw Error('Organization release has an invalid public proving allowlist.');
  const staging = join(dist, `.organization-zk-${randomUUID()}`);
  mkdirSync(staging);
  try {
    for (const path of paths) {
      const target = join(staging, path); mkdirSync(dirname(target), { recursive: true }); copyFileSync(join(release.artifactDir, path), target);
      const bytes = readFileSync(target), expected = release.files[path];
      if (bytes.length !== expected.size || createHash('sha256').update(bytes).digest('hex') !== expected.sha256) throw Error('Proving material changed during export; no public directory was published.');
    }
    writeFileSync(join(staging, 'release.json'), JSON.stringify(publicOrganizationManifest(release)) + '\n', { flag: 'wx' });
    // Recheck source/configuration and all artifacts after copying. Publish the
    // whole directory only when every exported file matches its original release.
    validateContractArtifacts({ artifactDir: release.artifactDir, projectRoot, profile: 'organization' });
    renameSync(staging, destination);
    return { files: paths.length + 1, sourceFingerprint: release.inputs.source.sha256, destination };
  } finally {
    if (existsSync(staging)) {
      // Verify the actual absolute target before recursive cleanup on Windows.
      if (dirname(realpathSync(staging)) !== realpathSync(dist) || !basename(staging).startsWith('.organization-zk-')) throw Error('Refusing cleanup outside the frontend build directory.');
      rmSync(staging, { recursive: true, force: true });
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 2) throw Error('Usage: node --experimental-strip-types scripts/publish-organization-assets.mjs');
  const result = publishOrganizationAssets();
  console.log(`Prepared ${result.files} public organization proving files for source ${result.sourceFingerprint}.`);
}
