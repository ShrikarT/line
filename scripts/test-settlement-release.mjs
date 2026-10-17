import { buildContractRelease, resolveContractRelease, validateContractArtifacts } from './contract-artifacts.mjs';
const [command, ...args] = process.argv.slice(2);
if (args.length || !['build', 'validate'].includes(command)) throw Error('Usage: test-settlement-release.mjs build|validate');
const profile = 'test-settlement';
const result = command === 'build' ? await buildContractRelease({ profile }) : validateContractArtifacts({ artifactDir: resolveContractRelease({ profile }), profile });
console.log(`Validated separate test-token release: ${result.artifactDir}`);
