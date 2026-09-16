/**
 * Structured errors for Line runtime operations.
 */

export class LineRuntimeError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(message: string, code: string, details?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class WalletNotConnectedError extends LineRuntimeError {
  constructor(message = "No Midnight wallet connection detected. Install and connect a compatible wallet (such as Lace) to submit transactions.") {
    super(message, "WALLET_NOT_CONNECTED");
  }
}

export class WalletApprovalRejectedError extends LineRuntimeError {
  constructor(message = "Transaction was rejected by the user in the wallet.") {
    super(message, "WALLET_APPROVAL_REJECTED");
  }
}

export class ContractNotConfiguredError extends LineRuntimeError {
  constructor(message = "Contract address is not configured. Set MIDNIGHT_CONTRACT_ADDRESS or deploy/join a contract.") {
    super(message, "CONTRACT_NOT_CONFIGURED");
  }
}

export class ContractNotFoundError extends LineRuntimeError {
  constructor(address: string, networkId: string) {
    super(`Contract ${address} was not found on network ${networkId}.`, "CONTRACT_NOT_FOUND", { address, networkId });
  }
}

export class ContractIncompatibleError extends LineRuntimeError {
  constructor(address: string, reason: string) {
    super(`Contract at ${address} is not compatible with Line protocol: ${reason}`, "CONTRACT_INCOMPATIBLE", { address, reason });
  }
}

export class NetworkUnreachableError extends LineRuntimeError {
  constructor(endpoint: string, originalError?: unknown) {
    super(
      `Failed to reach Midnight network service at ${endpoint}: ${originalError instanceof Error ? originalError.message : String(originalError)}`,
      "NETWORK_UNREACHABLE",
      { endpoint }
    );
  }
}

export class ProofServerError extends LineRuntimeError {
  constructor(endpoint: string, originalError?: unknown) {
    super(
      `Midnight proof server error at ${endpoint}: ${originalError instanceof Error ? originalError.message : String(originalError)}`,
      "PROOF_SERVER_ERROR",
      { endpoint }
    );
  }
}

export class CircuitExecutionError extends LineRuntimeError {
  constructor(circuit: string, reason: string, details?: Record<string, unknown>) {
    super(`Failed executing circuit '${circuit}': ${reason}`, "CIRCUIT_EXECUTION_ERROR", { circuit, reason, ...details });
  }
}
