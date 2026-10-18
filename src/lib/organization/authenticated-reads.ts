import type { PublicDataProvider } from "@midnight-ntwrk/midnight-js-types";
import { defer, switchMap } from "rxjs";

/** Reauthenticate before starting SDK reads, including finality and streams.
 * No contract construction, signing or payment submission is retried here.
 */
export function authenticatedOrganizationReads(provider: PublicDataProvider, authorize?: () => Promise<void>): PublicDataProvider {
  if (!authorize) return provider;
  const before = <A extends unknown[], R>(read: (...args: A) => Promise<R>) => async (...args: A): Promise<R> => { await authorize(); return read(...args); };
  return {
    queryContractState: before(provider.queryContractState.bind(provider)),
    queryZSwapAndContractState: before(provider.queryZSwapAndContractState.bind(provider)),
    queryDeployContractState: before(provider.queryDeployContractState.bind(provider)),
    queryUnshieldedBalances: before(provider.queryUnshieldedBalances.bind(provider)),
    watchForContractState: before(provider.watchForContractState.bind(provider)),
    watchForUnshieldedBalances: before(provider.watchForUnshieldedBalances.bind(provider)),
    watchForDeployTxData: before(provider.watchForDeployTxData.bind(provider)),
    watchForTxData: before(provider.watchForTxData.bind(provider)),
    contractStateObservable: (...args) => defer(authorize).pipe(switchMap(() => provider.contractStateObservable(...args))),
    unshieldedBalancesObservable: (...args) => defer(authorize).pipe(switchMap(() => provider.unshieldedBalancesObservable(...args))),
  };
}
