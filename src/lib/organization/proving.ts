import type { ConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";
import { createProofProvider, type KeyMaterialProvider, type ProofProvider } from "@midnight-ntwrk/midnight-js-types";
import { withinDeadline } from "./finality.ts";

/** Delegate private preimages to the user's chosen wallet proving service.
 * No organization book is silently sent to a first-party or localhost prover.
 * Acquiring a provider is lazy: connecting an account does not request a proof.
 */
export function organizationProofProvider(
  wallet: Pick<ConnectedAPI, "getProvingProvider">,
  keys: KeyMaterialProvider,
  assertSession: () => void,
  report: (message: string) => void = () => {},
  acquisitionTimeoutMs = 25_000,
): ProofProvider {
  let provider: Promise<ProofProvider> | undefined;
  return {
    async proveTx(tx, config) {
      assertSession();
      if (typeof wallet.getProvingProvider !== "function") throw new Error("Your wallet must support Midnight Connector v4 proving. Update your wallet and reconnect before trying again.");
      report("Prepare the proof with your wallet");
      provider ??= withinDeadline(wallet.getProvingProvider(keys), acquisitionTimeoutMs,
        "The wallet proving service is not responding. Reopen your wallet and try again.")
        .then(proving => {
          if (!proving || typeof proving.check !== "function" || typeof proving.prove !== "function") throw new Error("The wallet returned an incompatible proving service.");
          return createProofProvider(proving);
        }).catch(error => { provider = undefined; throw error; });
      const current = await provider;
      assertSession();
      const proven = await withinDeadline(current.proveTx(tx, config), 300_000,
        "Proof preparation timed out. No transaction was submitted by Line.");
      assertSession();
      return proven;
    },
  };
}
