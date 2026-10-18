import { resolveContractRelease, validateContractArtifacts } from './contract-artifacts.mjs';
const release = validateContractArtifacts({ artifactDir: resolveContractRelease({ profile: 'organization' }), profile: 'organization' });
console.log(JSON.stringify({ profile: 'organization', validatedFiles: Object.keys(release.files).length, sourceSha256: release.inputs.source.sha256 }));
