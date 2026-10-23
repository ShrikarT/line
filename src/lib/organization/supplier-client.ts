import type { ConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";
import { withinDeadline } from "./finality.ts";
import { organizationSignInMessage } from "./sign-in.ts";
import { sanitizeServiceError } from "../runtime/endpoints.ts";

type Account = { wallet: Pick<ConnectedAPI, "signData">; receivingAddress: string; assertSession(): void; assertWallet(): Promise<unknown> };

/** HTTP-only session cookies belong to the server; no bearer token or role key
 * is persisted in the client. Each unlocked account establishes its own sign-in.
 */
export class OrganizationSupplierClient {
  private catalogChecked = false;
  private requiresAuthentication = false;
  private authenticated = false;
  private authenticatedUntil = 0;
  private authentication: Promise<void> | null = null;
  private account: Account;
  private origin: string;
  private report: (message: string) => void;
  private transport: typeof fetch;
  constructor(account: Account, origin: string, report: (message: string) => void = () => {}, transport: typeof fetch = fetch) {
    this.account=account; this.origin=origin; this.report=report; this.transport=transport;
  }
  private async fetch(path: string, body?: object) {
    this.account.assertSession();
    const response = await this.transport.call(globalThis, new URL(`/api/organization/${path}`, this.origin), { method: body ? "POST" : "GET", credentials: "same-origin", headers: { "X-Line-Organization": "wallet", "X-Line-Wallet": this.account.receivingAddress, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000) });
    const value = await response.json(); this.account.assertSession();
    return { response, value };
  }
  private async authenticate(allowResume = true) {
    if (this.authentication) return this.authentication;
    this.authentication = (async () => {
      await this.account.assertWallet();
      if (allowResume) {
        const retained = await this.fetch("auth/session");
        if (retained.response.ok) {
          const deadline = retained.value.expiresAt;
          // Match the one-minute clock tolerance of the nonce challenge. The
          // server still enforces the unchanged thirty-minute cookie deadline.
          if (retained.value.authenticated !== true || !Number.isSafeInteger(deadline) || deadline <= Date.now() || deadline > Date.now() + 31 * 60_000) throw new Error("The retained wallet sign-in response is invalid.");
          if (deadline > Date.now() + 120_000) {
            this.authenticated = true; this.authenticatedUntil = deadline;
            return;
          }
        } else if (retained.response.status !== 404 && !(retained.response.status === 401 && retained.value.code === "WALLET_AUTH_REQUIRED")) {
          throw new Error("The retained wallet sign-in could not be checked. Retry after the service recovers.");
        }
      }
      if (typeof this.account.wallet.signData !== "function") throw new Error("Update your wallet to support Midnight sign-in and reconnect.");
      const challenge = await this.fetch("auth/challenge", { address: this.account.receivingAddress });
      if (!challenge.response.ok) throw new Error(challenge.value.error ?? "Wallet sign-in is unavailable.");
      const { nonce, expiresAt, message } = challenge.value;
      if (typeof nonce !== "string" || !/^[0-9a-f]{64}$/.test(nonce) || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 180_000 || message !== organizationSignInMessage(this.origin, this.account.receivingAddress, nonce, expiresAt)) throw new Error("The supplier returned an invalid wallet sign-in challenge.");
      this.report("Sign in to Line with your wallet");
      let proof: Awaited<ReturnType<ConnectedAPI["signData"]>>;
      try {
        proof = await withinDeadline(this.account.wallet.signData(message, { encoding: "text", keyType: "unshielded" }), 180_000, "Wallet sign-in timed out. Close the old wallet prompt before retrying.");
      } catch (failure) {
        const detail = failure instanceof Error ? failure.message : typeof failure === "string" ? failure : "The wallet did not return a sign-in proof.";
        throw new Error(`Wallet sign-in did not complete: ${sanitizeServiceError(detail)}. The sign-in request was not automatically retried.`);
      }
      await this.account.assertWallet();
      const verified = await this.fetch("auth/verify", { nonce, proof });
      if (!verified.response.ok || verified.value.authenticated !== true || !Number.isSafeInteger(verified.value.expiresAt) || verified.value.expiresAt <= Date.now()) throw new Error(verified.value.error ?? "Wallet sign-in failed.");
      this.authenticated = true;
      this.authenticatedUntil = verified.value.expiresAt;
    })().finally(() => { this.authentication = null; });
    return this.authentication;
  }
  async request(path: string, body?: object): Promise<unknown> {
    if (!/^(?:catalog|network(?:\/(?:expired-opening|expired-disable|expired-compensation))?|orders(?:\/[0-9a-f-]{36}(?:\/redeem)?)?)$/.test(path)) throw new Error("Unknown supplier request.");
    if (path !== "catalog" && !this.catalogChecked) await this.request("catalog");
    if (path === "network" && this.authenticatedUntil <= Date.now() + 120000) this.authenticated = false;
    if (path !== "catalog" && this.requiresAuthentication && !this.authenticated) await this.authenticate();
    let result = await this.fetch(path, body);
    if (result.response.status === 401 && result.value.code === "WALLET_AUTH_REQUIRED") {
      this.authenticated = false; await this.authenticate(false);
      // Only explicit authentication rejection permits this one exact retry.
      // A timeout or uncertain payment never generates a replacement request.
      result = await this.fetch(path, body);
    }
    if (!result.response.ok) throw new Error(typeof result.value.error === "string" ? result.value.error : "The API supplier could not complete the request.");
    if (path === "catalog") { this.catalogChecked = true; this.requiresAuthentication = result.value.walletAuthentication === "required"; }
    return result.value;
  }
}
