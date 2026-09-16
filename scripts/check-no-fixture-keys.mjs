#!/usr/bin/env node
/**
 * Automated Audit Check: No Hardcoded Fixture Keys in Production Dependency Graph
 *
 * Recursively inspects the entire transitive production dependency tree starting from
 * src/main.tsx, src/App.tsx, src/pages/, src/app/, src/lib/runtime/, and src/components/.
 *
 * Fails with exit code 1 if ANY production module transitively imports:
 * - keys.ts / test fixtures
 * - demo.ts / dev simulator snapshots
 * - hardcoded fixture secrets (ISSUER_SK, AGENT_SK, MERCHANT_A_SK, MERCHANT_B_SK, line:demo:)
 */
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

const VIOLATIONS = [];
const visited = new Set();

const FORBIDDEN_IMPORT_PATTERNS = [
  /\/keys(?:\.[a-z]+)?$/,
  /\/demo(?:\.[a-z]+)?$/,
  /\/fixtures(?:\/|$)/,
  /\/test\//,
];

const FORBIDDEN_TEXT_PATTERNS = [
  "ISSUER_SK",
  "AGENT_SK",
  "MERCHANT_A_SK",
  "MERCHANT_B_SK",
  "line:demo:",
];

function resolveImport(importPath, currentFileDir) {
  let target = importPath;
  if (target.startsWith("@/")) {
    target = join(process.cwd(), "src", target.slice(2));
  } else if (target.startsWith(".")) {
    target = resolve(currentFileDir, target);
  } else {
    // External package dependency
    return null;
  }

  const extensions = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js"];
  for (const ext of extensions) {
    const p = target + ext;
    if (existsSync(p) && statSync(p).isFile()) {
      return p;
    }
  }
  return null;
}

function extractImports(content) {
  const imports = [];
  const staticRegex = /(?:import|export)\s+(?:[\s\S]*?from\s+)?["']([^"']+)["']/g;
  let match;
  while ((match = staticRegex.exec(content)) !== null) {
    imports.push(match[1]);
  }
  const dynamicRegex = /import\s*\(\s*["']([^"']+)["']\s*\)/g;
  while ((match = dynamicRegex.exec(content)) !== null) {
    imports.push(match[1]);
  }
  return imports;
}

function scanProductionModule(filePath) {
  const normalized = resolve(filePath);
  if (visited.has(normalized)) return;
  visited.add(normalized);

  if (!existsSync(normalized)) return;
  const content = readFileSync(normalized, "utf8");
  const fileDir = dirname(normalized);

  // Check for forbidden text patterns in production modules
  for (const pat of FORBIDDEN_TEXT_PATTERNS) {
    if (content.includes(pat)) {
      VIOLATIONS.push({
        file: normalized,
        detail: `Contains forbidden fixture secret pattern "${pat}"`,
      });
    }
  }

  // Extract all imported modules
  const rawImports = extractImports(content);
  for (const imp of rawImports) {
    // Check if the import path matches forbidden targets
    for (const forbidden of FORBIDDEN_IMPORT_PATTERNS) {
      if (forbidden.test(imp)) {
        VIOLATIONS.push({
          file: normalized,
          detail: `Direct import of forbidden fixture module: "${imp}"`,
        });
      }
    }

    // Resolve and recursively scan local file
    const resolvedPath = resolveImport(imp, fileDir);
    if (resolvedPath) {
      // If it resolved into a test fixture or dev module
      for (const forbidden of FORBIDDEN_IMPORT_PATTERNS) {
        if (forbidden.test(resolvedPath.replace(/\\/g, "/"))) {
          VIOLATIONS.push({
            file: normalized,
            detail: `Transitive resolution into forbidden fixture path: "${resolvedPath}"`,
          });
        }
      }

      // Do not recurse into node_modules or tests
      if (
        !resolvedPath.includes("node_modules") &&
        !resolvedPath.includes(".test.") &&
        !resolvedPath.includes(".spec.")
      ) {
        scanProductionModule(resolvedPath);
      }
    }
  }
}

function scanDirDirectly(dir, excludeFiles = []) {
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      scanDirDirectly(full, excludeFiles);
    } else if (
      (entry.endsWith(".ts") || entry.endsWith(".tsx") || entry.endsWith(".js")) &&
      !entry.includes(".test.") &&
      !entry.includes(".spec.") &&
      !excludeFiles.includes(entry)
    ) {
      scanProductionModule(full);
    }
  }
}

console.log("=================================================");
console.log(" Line — Full Production Graph Key Audit");
console.log("=================================================");

// 1. Scan from primary entrypoints
const entrypoints = [
  join(process.cwd(), "src/main.tsx"),
  join(process.cwd(), "src/App.tsx"),
  join(process.cwd(), "src/app/store.ts"),
  join(process.cwd(), "src/lib/runtime/index.ts"),
  join(process.cwd(), "src/lib/runtime/network.ts"),
  join(process.cwd(), "src/lib/runtime/wallet.ts"),
];

for (const ep of entrypoints) {
  if (existsSync(ep)) {
    scanProductionModule(ep);
  }
}

// 2. Scan all production UI pages
scanDirDirectly(join(process.cwd(), "src/pages"));

// 3. Scan all UI components
scanDirDirectly(join(process.cwd(), "src/components"));

// 4. Scan all runtime modules
scanDirDirectly(join(process.cwd(), "src/lib/runtime"));

// 5. Scan protocol library (excluding unit tests)
scanDirDirectly(join(process.cwd(), "src/lib/line"));

// 6. Scan app state
scanDirDirectly(join(process.cwd(), "src/app"));

console.log(`Inspected ${visited.size} production modules in dependency graph.`);

if (VIOLATIONS.length > 0) {
  console.error("\n✗ AUDIT FAILURE: Hardcoded fixture keys or demo modules detected in production graph:\n");
  for (const v of VIOLATIONS) {
    console.error(`  - ${v.file}`);
    console.error(`    ${v.detail}`);
  }
  console.error("\nProduction paths must use wallet authorization, runtime parameters, or encrypted vault storage.");
  process.exit(1);
}

console.log("✓ Audit check passed: Zero fixture keys or demo snapshots found across production graph.");
process.exit(0);
