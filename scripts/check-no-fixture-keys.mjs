#!/usr/bin/env node
/**
 * Automated Audit Check: No Hardcoded Fixture Keys in Production Paths
 *
 * Ensures that no production UI pages (src/pages/) or production runtime
 * implementations (src/lib/runtime/) import fixture keys from keys.ts.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const VIOLATIONS = [];

function scanDir(dir, isProduction) {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      scanDir(fullPath, isProduction);
    } else if (
      (entry.endsWith(".ts") || entry.endsWith(".tsx") || entry.endsWith(".js")) &&
      !entry.includes(".test.") &&
      !entry.includes(".spec.")
    ) {
      const content = readFileSync(fullPath, "utf8");
      // Check for imports of keys.ts
      if (
        /from\s+["'].*\/keys(?:\.ts)?["']/.test(content) ||
        /import\s+.*from\s+["'].*\/keys["']/.test(content)
      ) {
        VIOLATIONS.push({ file: fullPath, pattern: "Import of fixture keys.ts" });
      }
    }
  }
}

console.log("=================================================");
console.log(" Line — Checking for Fixture Keys in Production");
console.log("=================================================");

const targetDirs = [
  join(process.cwd(), "src/pages"),
  join(process.cwd(), "src/lib/runtime"),
];

for (const dir of targetDirs) {
  scanDir(dir, true);
}

// Special check: ensure src/lib/runtime/network.ts never imports keys
const networkFile = join(process.cwd(), "src/lib/runtime/network.ts");
const networkContent = readFileSync(networkFile, "utf8");
if (networkContent.includes("keys.ts") || networkContent.includes("ISSUER_SK")) {
  VIOLATIONS.push({ file: networkFile, pattern: "Fixture key usage in network runtime" });
}

if (VIOLATIONS.length > 0) {
  console.error("✗ AUDIT FAILURE: Found hardcoded fixture keys in production paths:\n");
  for (const v of VIOLATIONS) {
    console.error(`  - ${v.file}: ${v.pattern}`);
  }
  console.error("\nProduction paths must require wallet connection or user entry / vault unlock.");
  process.exit(1);
}

console.log("✓ Audit check passed: No fixture keys found in production paths (src/pages, src/lib/runtime).");
