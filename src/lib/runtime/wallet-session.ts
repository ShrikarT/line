export type RememberedWallet = { id: string; rdns: string; address: string; network: "preprod" };
const KEY = "line:wallet-connection:v1";
export function rememberedWallet(): RememberedWallet | null {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(KEY) ?? "null");
    if (value?.network === "preprod" && typeof value.id === "string" && value.id.length <= 256 && typeof value.rdns === "string" && value.rdns.length <= 256 && typeof value.address === "string" && value.address.length <= 256) return value;
  } catch { /* No persistence in restricted storage environments. */ }
  return null;
}
export function rememberWallet(value: RememberedWallet) { try { window.sessionStorage.setItem(KEY, JSON.stringify(value)); } catch { /* Connection remains usable without refresh restoration. */ } }
export function forgetWallet() { try { window.sessionStorage.removeItem(KEY); } catch { /* Storage may be disabled. */ } }
