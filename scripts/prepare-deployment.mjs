/** Stage only a validated public organization release; never copies wallet data. */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { resolveContractRelease, validateContractArtifacts, RELEASE_FILENAME } from './contract-artifacts.mjs';

const projectRoot = process.cwd();
const source = resolveContractRelease({ projectRoot, profile: 'organization' });
const validated = validateContractArtifacts({ projectRoot, artifactDir: source, profile: 'organization' });
const stage = resolve('.deployment');
mkdirSync(stage, { recursive: true });
const stable = join(stage, 'organization');
if (existsSync(stable)) {
  const old = validateContractArtifacts({ projectRoot, artifactDir: stable, profile: 'organization' });
  if (JSON.stringify(old.release) !== JSON.stringify(validated.release)) throw Error('Existing staged release differs. Archive .deployment/organization before preparing a different release.');
} else {
// Docker runs only after this command succeeds; an incomplete directory fails
// validation on the next invocation rather than publishing a partial release.
const destination = stable;
mkdirSync(destination);
for (const file of [...Object.keys(validated.files), RELEASE_FILENAME]) {
  mkdirSync(dirname(join(destination, file)), { recursive: true });
  copyFileSync(join(source, file), join(destination, file));
}
validateContractArtifacts({ projectRoot, artifactDir: destination, profile: 'organization' });
// A stable directory is needed by Docker COPY. Do not overwrite an older build.
}
const pointer = JSON.parse(readFileSync('.compact-keys/organization-release.json', 'utf8'));
pointer.artifactDir = '.compact-keys/releases/organization';
const { writeFileSync } = await import('node:fs');
writeFileSync(join(stage, 'organization-release.json'), JSON.stringify(pointer, null, 2) + '\n');
console.log(JSON.stringify({ profile: 'organization', publicFiles: Object.keys(validated.files).length, releaseSha256: pointer.releaseSha256, staged: true, walletDataCopied: false }));
