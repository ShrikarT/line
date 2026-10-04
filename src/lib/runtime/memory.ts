import { LocalDevelopmentRuntime } from "./local.ts";
import type { RuntimeMode } from "./types.ts";
import type { Ledger } from "../line/types.ts";

export class InMemoryTestRuntime extends LocalDevelopmentRuntime {
  override readonly mode: RuntimeMode = "test";
  override readonly networkId: string = "in-memory-test";

  constructor(initialLedger?: Ledger) {
    super(initialLedger);
  }

  override getContractAddress(): string {
    return "0xtest_contract_in_memory";
  }
}
