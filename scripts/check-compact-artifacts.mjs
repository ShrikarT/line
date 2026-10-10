#!/usr/bin/env node
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve, relative, isAbsolute, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { validateContractArtifacts } from "./contract-artifacts.mjs";

const projectRoot = process.cwd();
const scratchRoot = resolve(".compact-keys");
mkdirSync(scratchRoot, { recursive: true });
const temporaryRoot = resolve(mkdtempSync(join(scratchRoot, "line-compact-check-")));
const artifactDir = join(temporaryRoot, "line");
function files(root, prefix = "") {
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap(entry => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return files(root, path);
    if (!entry.isFile()) throw new Error(`Unexpected artifact type: ${path}`);
    return [path];
  }).sort();
}
try {
  const result = spawnSync(process.execPath, ["scripts/compile-compact.mjs", "--skip-zk", "contracts/line.compact", relative(projectRoot, artifactDir).split(sep).join("/")], { stdio: "inherit" });
  if (result.error || result.status !== 0) throw new Error(`Compact regeneration failed: ${result.error?.message ?? result.status}`);
  validateContractArtifacts({ artifactDir, requireKeys: false, requireRelease: false });
  const canonical = resolve("contracts/managed/line");
  const actual = files(artifactDir), expected = files(canonical);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("Managed artifact file inventory differs from fresh compiler output.");
  for (const path of actual) {
    if (path === "contract/index.js.map") {
      const generatedMap = JSON.parse(readFileSync(join(artifactDir, path), "utf8"));
      const canonicalMap = JSON.parse(readFileSync(join(canonical, path), "utf8"));
      // The compiler makes sourceRoot relative to its output location. Check
      // that both resolve to this project, then compare every other map field.
      for (const [base, map] of [[artifactDir, generatedMap], [canonical, canonicalMap]]) {
        if (resolve(base, "contract", map.sourceRoot) !== resolve(projectRoot)) throw new Error(`Unexpected source map root: ${map.sourceRoot} (${base}).`);
        delete map.sourceRoot;
      }
      if (JSON.stringify(generatedMap) !== JSON.stringify(canonicalMap)) throw new Error(`Generated artifact drift: ${path}`);
      continue;
    }
    if (!readFileSync(join(artifactDir, path)).equals(readFileSync(join(canonical, path)))) throw new Error(`Generated artifact drift: ${path}`);
  }
  console.log(`Zero generated artifact drift: ${actual.length} files, pinned compiler 0.31.1.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  const target = resolve(temporaryRoot);
  const parent = scratchRoot;
  const rel = relative(parent, target);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel) || !rel.startsWith("line-compact-check-")) throw new Error("Refusing unsafe temporary cleanup.");
  rmSync(target, { recursive: true, force: true });
}
