/** Reject the SDK's empty fee intent before it becomes a durable submission.
 * A positive fee overhead is configured so even a zero-rounded estimate spends
 * DUST. This check does not replace native proof or node validation.
 */
export function assertFundedFeeTransaction(tx) {
  const actions = [...(tx.intents?.values() ?? [])].map(intent => intent.dustActions).filter(Boolean);
  if (!actions.some(action => action.spends.length > 0) || actions.some(action => action.spends.length === 0 && action.registrations.length === 0)) {
    throw Error('Fee balancing produced an empty DUST intent. Rebuild with a positive fee overhead.');
  }
  return tx;
}
