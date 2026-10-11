/** Native Node-only providers, loaded only when there is no browser window. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import { resolveContractRelease, validateContractArtifacts } from "../../../scripts/contract-artifacts.mjs";
import type { LineCircuitId, LinePrivateWitnessContext } from "./network.ts";

export function createNodeZkProvider(artifactDir?: string) {
  const checked = validateContractArtifacts({ artifactDir: artifactDir ?? resolveContractRelease() });
  const canonical = readFileSync(join(process.cwd(), "contracts/managed/line/contract/index.js"));
  if (!canonical.equals(readFileSync(join(checked.artifactDir, "contract/index.js")))) throw new Error("Canonical bindings differ from the validated proving release.");
  return new NodeZkConfigProvider<LineCircuitId>(checked.artifactDir);
}
export function createNodePrivateStateProvider(passwordProvider: () => string | Promise<string>, accountId: string) {
  return levelPrivateStateProvider<string, LinePrivateWitnessContext>({ privateStoragePasswordProvider: passwordProvider, accountId });
}
