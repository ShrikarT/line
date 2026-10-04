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

export class MissingPrivateWitnessError extends LineRuntimeError {
  constructor(witnessName: string, reason = "required 32-byte witness is missing or malformed") {
    super(`Missing private witness '${witnessName}': ${reason}`, "MISSING_PRIVATE_WITNESS", { witnessName, reason });
  }
}

export class InvalidWitnessError extends LineRuntimeError {
  constructor(witnessName: string, reason: string) {
    super(`Invalid private witness '${witnessName}': ${reason}`, "INVALID_WITNESS", { witnessName, reason });
  }
}

export class VaultLockedError extends LineRuntimeError {
  constructor(message = "Private state storage locked: Passphrase or active vault session required.") {
    super(message, "VAULT_LOCKED");
  }
}

export class VaultPassphraseError extends LineRuntimeError {
  constructor(message = "Decryption failed: Incorrect vault passphrase.") {
    super(message, "VAULT_PASSPHRASE_ERROR");
  }
}

export class VaultTamperedError extends LineRuntimeError {
  constructor(message = "Ciphertext authentication failed: Vault record has been corrupted or tampered.") {
    super(message, "VAULT_TAMPERED_ERROR");
  }
}

export class VaultPersistenceError extends LineRuntimeError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(`Critical: Local vault persistence failed after on-chain transaction: ${message}`, "VAULT_PERSISTENCE_ERROR", details);
  }
}

export class UnsupportedOperationError extends LineRuntimeError {
  constructor(operation: string) {
    super(`Operation '${operation}' is not supported in this runtime environment.`, "UNSUPPORTED_OPERATION", { operation });
  }
}

