#!/usr/bin/env node
/**
 * Secret Pattern Audit Script
 *
 * Scans the codebase for banned hardcoded credentials, test passwords,
 * and default account identifiers (e.g. LineVault123, LineDeployer, line-default-account).
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const BANNED_PATTERNS = [
  { pattern: /LineVault123/i, label: "Hardcoded vault password (LineVault123)" },
  { pattern: /LineDeployer/i, label: "Hardcoded deployer password (LineDeployer)" },
  { pattern: /line-default-account/i, label: "Hardcoded default account name (line-default-account)" },
  { pattern: /privateStoragePassword:\s*["'][^"']+["']/i, label: "Hardcoded privateStoragePassword literal" },
];

const SCAN_DIRS = [
  join(process.cwd(), "src"),
  join(process.cwd(), "scripts"),
  join(process.cwd(), "mcp"),
];

const VIOLATIONS = [];

function scanFile(filePath) {
  // Exclude test fixtures, scripts audit runner tests, and node_modules
  if (
    filePath.includes("node_modules") ||
    filePath.includes(".git") ||
    filePath.includes("dist") ||
    filePath.endsWith(".log") ||
    filePath.endsWith("check-no-secret-patterns.mjs")
  ) {
    return;
  }

  const content = readFileSync(filePath, "utf8");
  for (const { pattern, label } of BANNED_PATTERNS) {
    if (pattern.test(content)) {
      VIOLATIONS.push({
        file: filePath,
        label,
      });
    }
  }
}

function scanDir(dir) {
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      scanDir(full);
    } else {
      scanFile(full);
    }
  }
}

console.log("=================================================");
console.log(" Line — Secret Pattern Audit");
console.log("=================================================");

for (const dir of SCAN_DIRS) {
  scanDir(dir);
}

if (VIOLATIONS.length > 0) {
  console.error("\n✗ AUDIT FAILURE: Hardcoded secret pattern(s) detected in source code:\n");
  for (const v of VIOLATIONS) {
    console.error(`  - ${v.file}`);
    console.error(`    Violation: ${v.label}`);
  }
  console.error("\nCredentials must be provided via runtime parameters, environment variables, or encrypted vaults.");
  process.exit(1);
}

console.log("✓ Secret pattern audit passed: Zero banned credentials or hardcoded secret patterns found.");
process.exit(0);
