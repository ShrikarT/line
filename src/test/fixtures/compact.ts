/** Explicit deterministic genesis-time execution for isolated generated tests. */
import { boot as bootLive, bootWithPk as bootWithPkLive } from "../../lib/line/compact-harness.ts";
export const boot = (...args: Parameters<typeof bootLive>) => bootLive(args[0], args[1], args[2], args[3], args[4] ?? (() => 0));
export const bootWithPk = (...args: Parameters<typeof bootWithPkLive>) => bootWithPkLive(args[0], args[1], args[2], args[3], args[4] ?? (() => 0));
