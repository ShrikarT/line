// Read-only local demo check. Does not load signer configuration or submit calls.
const base = 'http://127.0.0.1:5174';
const checks = await Promise.allSettled([
  fetch('http://127.0.0.1:6300/health', { signal: AbortSignal.timeout(10000) }).then(response => {
    if (!response.ok) throw Error('Proof server is not healthy.');
    return true;
  }),
  fetch(`${base}/api/preprod/status`, {
    headers: { Origin: base, 'X-Line-Preprod': 'operator' },
    signal: AbortSignal.timeout(45000),
  }).then(async response => {
    if (!response.ok) throw Error('Local operator API is unavailable.');
    return response.json();
  }),
]);
const proofServerReady = checks[0].status === 'fulfilled';
const state = checks[1].status === 'fulfilled' ? checks[1].value : null;
const ready = proofServerReady && state?.phase === 'ready' && !state.busy && !state.pending && !state.error;
const report = {
  checkedAt: new Date().toISOString(),
  ready,
  proofServerReady,
  operatorApiReady: state !== null,
  phase: state?.phase ?? null,
  busy: state?.busy ?? null,
  hasPendingTransaction: !!state?.pending,
  hasOperationError: !!state?.error,
  confirmedReceipts: state?.receipts?.length ?? null,
  nextStep: !proofServerReady
    ? 'Start Docker Desktop, then docker start line-preprod-proof-8-1-3.'
    : !state ? 'Start the local app on port 5174 with its existing Preprod configuration.'
    : state.busy ? 'Wait for the active operation; do not submit another request.'
    : state.pending ? 'Reconcile the saved transaction in /preprod; do not create a replacement request.'
    : state.error ? 'Review the operation error in /preprod before proceeding.'
    : ready ? 'Open /preprod. Readiness does not guarantee fees, capacity or future network confirmation.'
    : 'Complete the existing facility setup before purchasing.',
};
console.log(JSON.stringify(report, null, 2));
if (!ready) process.exitCode = 1;
