import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as L from '@midnight-ntwrk/ledger-v8';
import { buildContractRelease } from '../../scripts/contract-artifacts.mjs';

const managed = fileURLToPath(new URL('../../contracts/managed/organization/', import.meta.url));
const sourcePath = fileURLToPath(new URL('../../contracts/organization/line.compact', import.meta.url));
const wrapperPath = fileURLToPath(new URL('../../scripts/compile-compact.mjs', import.meta.url));
const closedHexPath = fileURLToPath(new URL('organization-closed-state.hex', import.meta.url));
const packageJsonPath = fileURLToPath(new URL('../../package.json', import.meta.url));
const repoNodeModules = fileURLToPath(new URL('../../node_modules', import.meta.url));

/** Build a self-contained validated organization release fixture in an isolated temporary root.
 * Cleans up automatically via t.after if a test context t is provided.
 */
export async function createOrganizationReleaseFixture(t) {
  const projectRoot = mkdtempSync(join(tmpdir(), 'line-org-fixture-'));
  const targetNodeModules = join(projectRoot, 'node_modules');
  symlinkSync(repoNodeModules, targetNodeModules, process.platform === 'win32' ? 'junction' : 'dir');

  const cleanup = () => {
    try {
      unlinkSync(targetNodeModules);
    } catch {}
    if (resolve(projectRoot).startsWith(resolve(tmpdir()) + sep)) {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  };
  if (t?.after) {
    t.after(cleanup);
  }

  mkdirSync(join(projectRoot, 'contracts/organization'), { recursive: true });
  mkdirSync(join(projectRoot, 'scripts'), { recursive: true });

  // Write exact canonical source, compiler wrapper, and package configuration
  writeFileSync(join(projectRoot, 'contracts/organization/line.compact'), readFileSync(sourcePath, 'utf8'));
  writeFileSync(join(projectRoot, 'scripts/compile-compact.mjs'), readFileSync(wrapperPath, 'utf8'));
  writeFileSync(join(projectRoot, 'package.json'), readFileSync(packageJsonPath, 'utf8'));

  const closedHex = readFileSync(closedHexPath, 'utf8').trim();
  const stateObj = L.ContractState.deserialize(Buffer.from(closedHex, 'hex'));
  const info = JSON.parse(readFileSync(join(managed, 'compiler/contract-info.json'), 'utf8'));
  const names = info.circuits.map(c => c.name);

  const release = await buildContractRelease({
    projectRoot,
    profile: 'organization',
    compile: ({ artifactDir }) => {
      cpSync(managed, artifactDir, { recursive: true });
      for (const name of names) {
        const op = stateObj.operation(name);
        mkdirSync(join(artifactDir, 'keys'), { recursive: true });
        writeFileSync(join(artifactDir, 'keys', `${name}.verifier`), Buffer.from(op.verifierKey));
        writeFileSync(join(artifactDir, 'keys', `${name}.prover`), Buffer.from(`TEST PROVER: ${name}`));
        mkdirSync(join(artifactDir, 'zkir'), { recursive: true });
        writeFileSync(join(artifactDir, 'zkir', `${name}.bzkir`), Buffer.from(`TEST BZKIR: ${name}`));
      }
    },
  });

  return {
    projectRoot,
    artifactDir: release.artifactDir,
    release: release.release,
    cleanup,
  };
}
