import type { LineRuntime } from "./types.ts";

let activeRuntime: LineRuntime | null = null;

/** Inspect the selected runtime without loading or constructing a contract engine. */
export function getActiveRuntime(): LineRuntime | null { return activeRuntime; }
export function selectActiveRuntime(runtime: LineRuntime): void { activeRuntime = runtime; }
