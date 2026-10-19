import { resolveMidnightEndpoints, assertEndpointCredentials } from '../src/lib/runtime/endpoints.ts';
import { resolveContractRelease, validateContractArtifacts } from '../scripts/contract-artifacts.mjs';

/** Public readers and wallet-operated contracts need no hosted signing wallet.
 * Every financial opening and pending transaction remains in the user's vault.
 */
export function createWalletOnlyOrganizationService(env = process.env) {
  const endpoints = resolveMidnightEndpoints({ networkId: 'preprod', blockfrostProjectId: env.MIDNIGHT_BLOCKFROST_PROJECT_ID });
  assertEndpointCredentials(endpoints, ['indexerUri', 'indexerWsUri']);
  const release = validateContractArtifacts({ artifactDir: resolveContractRelease({ profile: 'organization' }), profile: 'organization' });
  const capabilities = Object.freeze({ hostedSupplierAutomation: false });
  return {
    endpoints, capabilities,
    catalog: () => ({ network: 'preprod', assetColor: '0'.repeat(64), decimals: 6, sourceFingerprint: release.inputs.source.sha256, services: [], ...capabilities }),
    close: async () => {},
  };
}
