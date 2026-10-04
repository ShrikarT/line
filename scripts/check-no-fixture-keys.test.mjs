#!/usr/bin/env node
/**
 * Negative test suite for check-no-fixture-keys.mjs
 *
 * Verifies that introducing forbidden fixture imports or hardcoded secret patterns
 * into any production directory triggers exit code 1 in the audit runner.
 */
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";

const auditScriptPath = join(process.cwd(), "scripts/check-no-fixture-keys.mjs");

function runAudit() {
  const res = spawnSync("node", [auditScriptPath], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  return {
    code: res.status,
    stdout: res.stdout,
    stderr: res.stderr,
  };
}

console.log("Running check-no-fixture-keys negative audit test suite...");

// Baseline check: current repo must pass cleanly
const base = runAudit();
assert.equal(base.code, 0, `Baseline check failed unexpectedly: ${base.stderr}`);

// Test Case 1: Direct import of fixtures in src/pages/
const testFile1 = join(process.cwd(), "src/pages/__test_leak_page.tsx");
try {
  writeFileSync(
    testFile1,
    `import { ISSUER_SK } from "../test/fixtures/keys.ts";\nexport const Leak = () => <div>{ISSUER_SK}</div>;\n`,
    "utf8",
  );

  const res1 = runAudit();
  assert.equal(
    res1.code,
    1,
    `Expected exit code 1 when fixture keys imported into src/pages, got ${res1.code}`,
  );
  assert.match(
    res1.stderr,
    /__test_leak_page\.tsx/,
    "Expected error output to flag __test_leak_page.tsx",
  );
  console.log("✓ Test 1 passed: src/pages fixture import caught.");
} finally {
  if (existsSync(testFile1)) unlinkSync(testFile1);
}

// Test Case 2: Forbidden secret text pattern in src/app/
const testFile2 = join(process.cwd(), "src/app/__test_leak_store.ts");
try {
  writeFileSync(
    testFile2,
    `export const defaultKey = "AGENT_SK";\n`,
    "utf8",
  );

  const res2 = runAudit();
  assert.equal(
    res2.code,
    1,
    `Expected exit code 1 when secret pattern found in src/app, got ${res2.code}`,
  );
  assert.match(
    res2.stderr,
    /AGENT_SK/,
    "Expected error output to mention AGENT_SK pattern",
  );
  console.log("✓ Test 2 passed: src/app secret pattern caught.");
} finally {
  if (existsSync(testFile2)) unlinkSync(testFile2);
}

// Test Case 3: Forbidden import in src/lib/runtime/
const testFile3 = join(process.cwd(), "src/lib/runtime/__test_leak_runtime.ts");
try {
  writeFileSync(
    testFile3,
    `import { DEMO } from "../../test/fixtures/keys.ts";\nexport const x = DEMO;\n`,
    "utf8",
  );

  const res3 = runAudit();
  assert.equal(
    res3.code,
    1,
    `Expected exit code 1 when test fixtures imported into src/lib/runtime, got ${res3.code}`,
  );
  console.log("✓ Test 3 passed: src/lib/runtime fixture import caught.");
} finally {
  if (existsSync(testFile3)) unlinkSync(testFile3);
}

// Ensure baseline still passes after cleanup
const final = runAudit();
assert.equal(final.code, 0, `Final cleanup baseline failed: ${final.stderr}`);

console.log("✓ All negative audit checks passed successfully.");
