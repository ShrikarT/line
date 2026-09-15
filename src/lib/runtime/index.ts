import type { LineRuntime, RuntimeMode } from "./types.ts";
import { MidnightNetworkRuntime } from "./network.ts";
import { LocalDevelopmentRuntime } from "./local.ts";
import { InMemoryTestRuntime } from "./memory.ts";

export * from "./types.ts";
export { MidnightNetworkRuntime } from "./network.ts";
export { LocalDevelopmentRuntime } from "./local.ts";
export { InMemoryTestRuntime } from "./memory.ts";

let activeRuntime: LineRuntime | null = null;

export function getRuntime(preferredMode?: RuntimeMode): LineRuntime {
  if (activeRuntime && (!preferredMode || activeRuntime.mode === preferredMode)) {
    return activeRuntime;
  }

  const env = (typeof process !== "undefined" ? process.env : {}) as Record<string, string | undefined>;
  const viteEnv = ((typeof import.meta !== "undefined" ? (import.meta as unknown as { env?: Record<string, string | undefined> }).env : undefined) ?? {}) as Record<string, string | undefined>;

  const mode =
    preferredMode ??
    viteEnv.VITE_LINE_RUNTIME ??
    env.LINE_RUNTIME ??
    (viteEnv.PROD ? "network" : "local");

  switch (mode) {
    case "network":
      activeRuntime = new MidnightNetworkRuntime();
      break;
    case "test":
      activeRuntime = new InMemoryTestRuntime();
      break;
    case "local":
    default:
      activeRuntime = new LocalDevelopmentRuntime();
      break;
  }

  return activeRuntime;
}

export function setRuntime(runtime: LineRuntime): void {
  activeRuntime = runtime;
}
