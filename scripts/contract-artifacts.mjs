#!/usr/bin/env node
/** Line-owned release validation. File SHA-256 fingerprints do not replace Compact hashes.
 * Matching keys are established by a fresh full trusted-compiler run, then bound to
 * its source/JS/ZKIR by an integrity manifest. This is not a cryptographic proof audit.
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

export const RELEASE_FILENAME = "line-release.json";
export const POINTER_FILENAME = ".compact-keys/current-release.json";
export const SUPPORTED_COMPACT = Object.freeze({ compiler: "0.31.1", language: "0.23.0", runtime: "0.16.0", ledger: "8.0.2" });
const BYTES32 = { "type-name": "Bytes", length: 32 };
const UINT64 = { "type-name": "Uint", maxval: "18446744073709551615" };
const STATUS = { "type-name": "Enum", name: "Status", elements: ["NONE", "OPEN", "DEFAULTED", "CLOSED"] };
const EMPTY = { "type-name": "Tuple", types: [] };
const arg = (name, type) => ({ name, type });
const CIRCUITS = {
  registerMerchant: [arg("merchantPk", BYTES32)], disableMerchant: [arg("merchantPk", BYTES32)],
  fundReserve: [arg("amount", UINT64)], withdrawUnencumberedReserve: [arg("amount", UINT64)],
  withdrawFees: [], openLine: [arg("expiry", UINT64), arg("flatFee", UINT64), arg("basisPoints", UINT64)], postQuote: [arg("expiry", UINT64)],
  draw: [arg("quoteCommitPublic", BYTES32), arg("noteExpiry", UINT64), arg("fee", UINT64)],
  redeemDraw: [arg("noteCommitPublic", BYTES32), arg("noteExpiry", UINT64)],
  cancelOrExpireNote: [arg("noteCommitPublic", BYTES32), arg("action", { "type-name": "Uint", maxval: "255" }), arg("receiptExpiry", UINT64)],
  acknowledgeRepayment: [arg("receiptExpiry", UINT64)], setStatus: [arg("next", STATUS)],
};
const BYTE_WITNESSES = ["callerSecret", "agentSecret", "salt", "newSalt", "invoiceId", "quoteNonce", "receiptNonce", "paymentRef", "noteNonce", "noteSalt", "noteIdentity", "noteQuoteCommit", "quoteMerchantPk"];
const UINT_WITNESSES = ["lineLimit", "lineOutstanding", "lineEpoch", "quoteAmount", "drawAmount", "redeemAmount", "repayAmount"];
const NAMES = Object.keys(CIRCUITS).sort();
const GENERATED_FILES = ["compiler/contract-info.json", "contract/index.js", "contract/index.d.ts", "contract/index.js.map", ...NAMES.map(name => `zkir/${name}.zkir`)];
const PROVING_FILES = NAMES.flatMap(name => [`zkir/${name}.bzkir`, `keys/${name}.prover`, `keys/${name}.verifier`]);
function check(condition, message) { if (!condition) throw new Error(`Line artifacts: ${message}`); }
function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function json(path, preserveUint = false) {
  const text = readFileSync(path, "utf8");
  // JSON numbers above Number.MAX_SAFE_INTEGER must not lose Uint64 signature precision.
  return JSON.parse(preserveUint ? text.replace(/("maxval"\s*:\s*)([0-9]+)/g, '$1"$2"') : text);
}
function regularFile(path) {
  check(existsSync(path), `Missing ${path}`);
  const stat = lstatSync(path);
  check(stat.isFile() && !stat.isSymbolicLink(), `Expected a regular file: ${path}`);
  check(stat.size > 0, `Empty artifact: ${path}`);
  return { size: stat.size, sha256: sha256(readFileSync(path)) };
}
function artifactFile(artifactDir, path) {
  let parent = dirname(join(artifactDir, path));
  while (contained(artifactDir, parent)) {
    check(!lstatSync(parent).isSymbolicLink(), `Artifact directory must not be a symlink: ${parent}`);
    if (parent === artifactDir) break;
    parent = dirname(parent);
  }
  return regularFile(join(artifactDir, path));
}
function contained(root, path) {
  const rel = relative(root, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
function physicalContained(root, path) {
  let ancestor = path;
  while (!existsSync(ancestor) && dirname(ancestor) !== ancestor) ancestor = dirname(ancestor);
  return contained(realpathSync(root), realpathSync(ancestor));
}
function inputs(projectRoot) {
  const packagePath = join(projectRoot, "package.json");
  const pkg = json(packagePath);
  check(isDeepStrictEqual(pkg.compact, SUPPORTED_COMPACT), "package.json compact pins must be compiler 0.31.1 / language 0.23.0 / runtime 0.16.0 / ledger 8.0.2.");
  check(pkg.dependencies?.["@midnight-ntwrk/compact-runtime"] === "0.16.0", "Direct Compact runtime dependency must be exactly 0.16.0.");
  const source = join(projectRoot, "contracts/line.compact");
  check(/pragma\s+language_version\s+0\.23\s*;/.test(readFileSync(source, "utf8")), "Canonical source pragma must be language 0.23.");
  return {
    source: { path: "contracts/line.compact", ...regularFile(source) },
    compilerWrapper: { path: "scripts/compile-compact.mjs", ...regularFile(join(projectRoot, "scripts/compile-compact.mjs")) },
    compact: { ...pkg.compact }, runtimeDependency: "0.16.0",
  };
}
function exactNames(entries, names, label) {
  check(Array.isArray(entries), `Missing ${label} metadata.`);
  check(isDeepStrictEqual(entries.map(entry => entry.name).sort(), [...names].sort()), `Expected exactly the canonical ${label}; duplicates and additional names are rejected.`);
}
function metadata(info) {
  for (const [key, expected] of [["compiler-version", "0.31.1"], ["language-version", "0.23.0"], ["runtime-version", "0.16.0"]]) {
    check(info[key] === expected, `Unsupported ${key}: expected ${expected}.`);
  }
  exactNames(info.circuits, NAMES, "twelve circuits");
  for (const circuit of info.circuits) {
    check(circuit.pure === false && circuit.proof === true, `Circuit ${circuit.name} must be impure and provable.`);
    check(isDeepStrictEqual(circuit.arguments, CIRCUITS[circuit.name]) && isDeepStrictEqual(circuit["result-type"], EMPTY), `Wrong public signature for ${circuit.name}.`);
  }
  exactNames(info.witnesses, [...BYTE_WITNESSES, ...UINT_WITNESSES], "twenty witnesses");
  for (const witness of info.witnesses) {
    const type = BYTE_WITNESSES.includes(witness.name) ? BYTES32 : UINT64;
    check(isDeepStrictEqual(witness.arguments, []) && isDeepStrictEqual(witness["result type"], type), `Wrong private signature for witness ${witness.name}.`);
  }
}

/** Metadata-only checks can be used after --skip-zk, but deployment defaults require a full release. */
export function validateContractArtifacts({ artifactDir, projectRoot = process.cwd(), requireKeys = true, requireRelease = true } = {}) {
  check(typeof artifactDir === "string" && artifactDir.length > 0, "An artifact directory is required.");
  projectRoot = resolve(projectRoot);
  artifactDir = resolve(projectRoot, artifactDir);
  const currentInputs = inputs(projectRoot);
  check(!existsSync(join(artifactDir, "compiler/contract-manifest.json")), "Obsolete compiler/contract-manifest.json detected. Build a fresh ledger 8 release; do not reuse ledger 9 metadata.");
  const compilerInfo = json(join(artifactDir, "compiler/contract-info.json"), true);
  metadata(compilerInfo);
  const javascript = readFileSync(join(artifactDir, "contract/index.js"), "utf8");
  check(/checkRuntimeVersion\(\s*['"]0\.16\.0['"]\s*\)/.test(javascript), "Generated JS must expect Compact runtime 0.16.0.");
  for (const name of NAMES) {
    const ir = json(join(artifactDir, `zkir/${name}.zkir`));
    check(ir.version?.major === 2 && ir.version?.minor === 0 && Array.isArray(ir.instructions) && ir.instructions.length > 0, `Wrong or incomplete ZKIR v2 for ${name}.`);
  }
  const expectedFiles = [...GENERATED_FILES, ...(requireKeys || requireRelease ? PROVING_FILES : [])].sort();
  const files = Object.fromEntries(expectedFiles.map(path => [path, artifactFile(artifactDir, path)]));
  let release = null;
  if (requireRelease) {
    artifactFile(artifactDir, RELEASE_FILENAME);
    release = json(join(artifactDir, RELEASE_FILENAME));
    check(release.schema === "line-contract-release/v1", "Missing or unsupported Line release schema.");
    check(release.generation?.kind === "fresh-full-compact-compile", "Release must originate from a fresh full compiler run.");
    check(isDeepStrictEqual(release.inputs, currentInputs), "Release source/configuration differs from current canonical inputs.");
    check(isDeepStrictEqual(release.files, files), "Release artifact hashes/sizes differ: keys, bindings or ZKIR are missing, modified or stale.");
  }
  return { artifactDir, compilerInfo, release, inputs: currentInputs, files };
}

/** Resolve a previously validated pointer. Validation of the selected release remains mandatory. */
export function resolveContractRelease({ projectRoot = process.cwd() } = {}) {
  projectRoot = resolve(projectRoot);
  const pointer = json(join(projectRoot, POINTER_FILENAME));
  check(pointer.schema === "line-contract-release-pointer/v1" && typeof pointer.artifactDir === "string" && !isAbsolute(pointer.artifactDir), "Invalid current-release pointer.");
  const artifactDir = resolve(projectRoot, pointer.artifactDir);
  check(contained(projectRoot, artifactDir) && physicalContained(projectRoot, artifactDir), "Current-release pointer escapes the project.");
  check(artifactFile(artifactDir, RELEASE_FILENAME).sha256 === pointer.releaseSha256, "Current-release manifest differs from its published pointer.");
  return artifactDir;
}

async function compileProject({ projectRoot, source, artifactDir }) {
  await new Promise((accept, reject) => {
    // The Windows wrapper changes cwd through wslpath; compiler arguments must
    // remain project-relative Unix paths rather than Windows drive paths.
    const portable = path => relative(projectRoot, path).split(sep).join("/");
    const child = spawn(process.execPath, [join(projectRoot, "scripts/compile-compact.mjs"), portable(source), portable(artifactDir)], { cwd: projectRoot, stdio: "inherit" });
    child.once("error", reject);
    child.once("close", code => code === 0 ? accept() : reject(new Error(`Full Compact compilation failed (exit ${code}).`)));
  });
}

/** Never seals existing keys. The compiler callback is a test seam/trusted tool, not untrusted input. */
export async function buildContractRelease({ projectRoot = process.cwd(), output, compile = compileProject, publishPointer = true } = {}) {
  projectRoot = resolve(projectRoot);
  const before = inputs(projectRoot);
  const artifactDir = output ? resolve(projectRoot, output) : join(projectRoot, ".compact-keys", "releases", `${SUPPORTED_COMPACT.compiler}-${before.source.sha256.slice(0, 12)}-${randomUUID()}`);
  check(contained(projectRoot, artifactDir) && artifactDir !== projectRoot && physicalContained(projectRoot, artifactDir), "Release output must be a new directory inside the project.");
  check(!existsSync(artifactDir), "Release output already exists; refusing to seal old or stale artifacts.");
  mkdirSync(artifactDir, { recursive: true });
  await compile({ projectRoot, source: join(projectRoot, before.source.path), artifactDir });
  check(isDeepStrictEqual(inputs(projectRoot), before), "Canonical source/configuration changed during key generation; release not published.");
  const checked = validateContractArtifacts({ artifactDir, projectRoot, requireKeys: true, requireRelease: false });
  const release = {
    schema: "line-contract-release/v1", createdAt: new Date().toISOString(),
    generation: { kind: "fresh-full-compact-compile", zkirVersion: { major: 2, minor: 0 } },
    inputs: checked.inputs, files: checked.files,
  };
  writeFileSync(join(artifactDir, RELEASE_FILENAME), `${JSON.stringify(release, null, 2)}\n`, { flag: "wx" });
  const verified = validateContractArtifacts({ artifactDir, projectRoot });
  if (publishPointer) {
    const pointerPath = join(projectRoot, POINTER_FILENAME);
    check(physicalContained(projectRoot, pointerPath), "Current-release pointer directory escapes the project.");
    mkdirSync(dirname(pointerPath), { recursive: true });
    const temporaryPath = `${pointerPath}.${randomUUID()}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify({ schema: "line-contract-release-pointer/v1", artifactDir: relative(projectRoot, artifactDir).split(sep).join("/"), releaseSha256: regularFile(join(artifactDir, RELEASE_FILENAME)).sha256 }, null, 2)}\n`, { flag: "wx" });
    renameSync(temporaryPath, pointerPath);
  }
  return verified;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command === "build") {
      check(args.length === 0 || (args.length === 2 && args[0] === "--output"), "Usage: node scripts/contract-artifacts.mjs build [--output <new-directory>]");
      const result = await buildContractRelease({ output: args[1] });
      console.log(`Validated full Line release: ${result.artifactDir}`);
    } else if (command === "validate") {
      check(args.length <= 1, "Usage: node scripts/contract-artifacts.mjs validate [artifact-directory]");
      const result = validateContractArtifacts({ artifactDir: args[0] ?? resolveContractRelease() });
      console.log(`Validated full Line release: ${result.artifactDir}`);
    } else throw new Error("Usage: node scripts/contract-artifacts.mjs build [--output <new-directory>] | validate [artifact-directory]");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
