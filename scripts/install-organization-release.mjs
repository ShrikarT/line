/** Install the published public proving release; never generates or copies custody. */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolveContractRelease, validateContractArtifacts } from './contract-artifacts.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function verifyOrganizationDownload(bytes, metadata) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== metadata.bytes || hash(bytes) !== metadata.sha256) throw Error('Public organization archive integrity check failed.');
}

export async function installOrganizationRelease({ projectRoot = process.cwd(), transport = fetch } = {}) {
  projectRoot = resolve(projectRoot);
  const metadata = JSON.parse(readFileSync(join(projectRoot, 'deployment/organization-release.json'), 'utf8'));
  if (metadata.schema !== 'line-organization-download/v1' || !/^https:\/\/github\.com\/ShrikarT\/line\/releases\/download\/[A-Za-z0-9._-]+\/Line-Organization-Release-[a-f0-9]+\.tar\.gz$/.test(metadata.url) ||
      !Number.isSafeInteger(metadata.bytes) || metadata.bytes <= 0 || metadata.bytes > 150_000_000 || !/^[a-f0-9]{64}$/.test(metadata.sha256) || !/^[a-f0-9]{64}$/.test(metadata.releaseSha256)) throw Error('Invalid pinned organization download metadata.');
  const pointerPath = join(projectRoot, '.compact-keys/organization-release.json');
  if (existsSync(pointerPath)) {
    const existing = resolveContractRelease({ projectRoot, profile: 'organization' });
    validateContractArtifacts({ projectRoot, artifactDir: existing, profile: 'organization' });
    if (hash(readFileSync(join(existing, 'line-release.json'))) !== metadata.releaseSha256) throw Error('Preserve the existing organization release. Refusing to replace different keys.');
    return { installed: false, reused: true, releaseSha256: metadata.releaseSha256 };
  }
  const destination = join(projectRoot, '.compact-keys/releases/organization');
  if (existsSync(destination)) throw Error('An unselected organization directory already exists. Inspect it before installing keys.');
  const response = await transport(metadata.url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw Error(`Public organization download failed (${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  verifyOrganizationDownload(bytes, metadata);
  const staging = join(projectRoot, '.compact-keys', `.download-${randomUUID()}`);
  mkdirSync(staging, { recursive: true });
  const archive = join(staging, 'release.tar.gz');
  writeFileSync(archive, bytes, { flag: 'wx' });
  const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8', maxBuffer: 1024 * 1024 }).trim().split(/\r?\n/);
  if (entries.some(path => path !== 'organization-release.json' && !/^organization\/(?:[A-Za-z0-9_-]+\/)*(?:[A-Za-z0-9_.-]+)?$/.test(path)) || entries.some(path => path.split('/').includes('..'))) throw Error('Unexpected public organization archive path.');
  execFileSync('tar', ['-xzf', archive, '-C', staging], { timeout: 120_000 });
  const candidate = join(staging, 'organization');
  const validated = validateContractArtifacts({ projectRoot, artifactDir: candidate, profile: 'organization' });
  if (hash(readFileSync(join(candidate, 'line-release.json'))) !== metadata.releaseSha256) throw Error('Organization manifest differs from the pinned release.');
  const expected = new Set(['organization-release.json', 'organization/line-release.json', ...Object.keys(validated.files).map(path => `organization/${path}`)]);
  const files = entries.filter(path => !path.endsWith('/'));
  if (files.length !== expected.size || files.some(path => !expected.has(path))) throw Error('Unexpected file in public organization archive.');
  mkdirSync(dirname(destination), { recursive: true });
  renameSync(candidate, destination);
  const temporaryPointer = join(staging, 'selected-release.json');
  writeFileSync(temporaryPointer, JSON.stringify({ schema: 'line-contract-release-pointer/v1', profile: 'organization', artifactDir: '.compact-keys/releases/organization', releaseSha256: metadata.releaseSha256 }, null, 2) + '\n', { flag: 'wx' });
  renameSync(temporaryPointer, pointerPath);
  // Only exact temporary files are removed; existing release trees are untouched.
  unlinkSync(archive);
  unlinkSync(join(staging, 'organization-release.json'));
  rmdirSync(staging);
  return { installed: true, reused: false, files: Object.keys(validated.files).length, releaseSha256: metadata.releaseSha256 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 2) throw Error('Usage: node scripts/install-organization-release.mjs');
  console.log(JSON.stringify(await installOrganizationRelease()));
}
