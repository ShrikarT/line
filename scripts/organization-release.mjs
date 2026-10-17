import { buildContractRelease, resolveContractRelease, validateContractArtifacts } from './contract-artifacts.mjs';
const [command, ...args] = process.argv.slice(2);
if (args.length || !['build', 'validate'].includes(command)) throw Error('Usage: organization-release.mjs build|validate');
const profile = 'organization';
const result = command === 'build' ? await buildContractRelease({ profile }) : validateContractArtifacts({ artifactDir: resolveContractRelease({ profile }), profile });
console.log(`Validated organization-funded release: ${result.artifactDir}`);
