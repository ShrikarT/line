import type { LineRuntime, RuntimeMode } from "./types.ts";
import { MidnightNetworkRuntime } from "./network.ts";
import { LocalDevelopmentRuntime } from "./local.ts";
import { InMemoryTestRuntime } from "./memory.ts";

export * from "./types.ts";
export { MidnightNetworkRuntime } from "./network.ts";
export { LocalDevelopmentRuntime } from "./local.ts";
export { InMemoryTestRuntime } from "./memory.ts";

const RUNTIME_MODE_KEY = "line.runtime.mode";

let activeRuntime: LineRuntime | null = null;

function readStoredMode(): RuntimeMode | undefined {
  try {
    if (typeof localStorage === "undefined") return undefined;
    const value = localStorage.getItem(RUNTIME_MODE_KEY);
    if (value === "local" || value === "network" || value === "test") return value;
  } catch {
    // Private mode or a non-browser test runner.
  }
  return undefined;
}

function storeMode(mode: RuntimeMode): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(RUNTIME_MODE_KEY, mode);
  } catch {
    // Ignore storage failures; the in-memory runtime still switches.
  }
}

export function getRuntime(preferredMode?: RuntimeMode): LineRuntime {
  if (activeRuntime && (!preferredMode || activeRuntime.mode === preferredMode)) {
    return activeRuntime;
  }

  const env = (typeof process !== "undefined" ? process.env : {}) as Record<string, string | undefined>;
  const viteEnv = ((typeof import.meta !== "undefined" ? (import.meta as unknown as { env?: Record<string, string | undefined> }).env : undefined) ?? {}) as Record<string, string | undefined>;

  // Explicit env wins. Otherwise honor the last choice the user made in the
  // header. A production bundle used to force network mode and then reload
  // back into it, so "Switch to Simulator" never stuck and the desks did nothing.
  const mode =
    preferredMode ??
    viteEnv.VITE_LINE_RUNTIME ??
    env.LINE_RUNTIME ??
    readStoredMode() ??
    "local";

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
  storeMode(runtime.mode);
}
