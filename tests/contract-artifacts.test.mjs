import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { buildContractRelease, validateContractArtifacts, resolveContractRelease, RELEASE_FILENAME, POINTER_FILENAME, SUPPORTED_COMPACT } from "../scripts/contract-artifacts.mjs";

const managed = fileURLToPath(new URL("../contracts/managed/line/", import.meta.url));
const canonicalInfo = readFileSync(join(managed, "compiler/contract-info.json"), "utf8");
const names = JSON.parse(canonicalInfo).circuits.map(circuit => circuit.name);
const generated = ["compiler/contract-info.json", "contract/index.js", "contract/index.d.ts", "contract/index.js.map", ...names.map(name => `zkir/${name}.zkir`)];
// These key bytes are intentionally synthetic fixtures. Tests establish fail-closed
// lifecycle/integrity behavior, not that synthetic bytes are usable proving keys.
function compileFixture({ artifactDir }) {
  for (const path of generated) {
    mkdirSync(dirname(join(artifactDir, path)), { recursive: true });
    cpSync(join(managed, path), join(artifactDir, path));
  }
  for (const name of names) {
    for (const path of [`zkir/${name}.bzkir`, `keys/${name}.prover`, `keys/${name}.verifier`]) {
      mkdirSync(dirname(join(artifactDir, path)), { recursive: true });
      writeFileSync(join(artifactDir, path), `SYNTHETIC TEST FIXTURE: ${path}`);
    }
  }
}
function project(t) {
  const projectRoot = mkdtempSync(join(tmpdir(), "line-release-test-"));
  t.after(() => {
    assert.ok(resolve(projectRoot).startsWith(`${resolve(tmpdir())}${sep}line-release-test-`));
    rmSync(projectRoot, { recursive: true, force: true });
  });
  mkdirSync(join(projectRoot, "contracts"));
  mkdirSync(join(projectRoot, "scripts"));
  writeFileSync(join(projectRoot, "contracts/line.compact"), "pragma language_version 0.23;\n// Test input fingerprint only.\n");
  writeFileSync(join(projectRoot, "package.json"), JSON.stringify({ compact: SUPPORTED_COMPACT, dependencies: { "@midnight-ntwrk/compact-runtime": "0.16.0" } }));
  writeFileSync(join(projectRoot, "scripts/compile-compact.mjs"), "// trusted fixture wrapper\n");
  return projectRoot;
}
async function release(t, options = {}) {
  const projectRoot = project(t);
  return { projectRoot, ...await buildContractRelease({ projectRoot, compile: compileFixture, ...options }) };
}
function mutateMetadata(artifactDir, change) {
  const path = join(artifactDir, "compiler/contract-info.json");
  const info = JSON.parse(readFileSync(path, "utf8").replace(/("maxval"\s*:\s*)([0-9]+)/g, '$1"$2"'));
  change(info);
  writeFileSync(path, JSON.stringify(info));
}

test("full release binds real compiler metadata, all generated files and 36 proving artifacts", async t => {
  const result = await release(t);
  assert.equal(result.compilerInfo["compiler-version"], "0.31.1");
  assert.equal(result.compilerInfo.circuits.length, 12);
  assert.equal(result.compilerInfo.witnesses.length, 20);
  assert.equal(Object.keys(result.files).length, generated.length + 36);
  assert.equal(result.release.generation.kind, "fresh-full-compact-compile");
  assert.equal(resolveContractRelease({ projectRoot: result.projectRoot }), result.artifactDir);
  assert.equal(validateContractArtifacts({ projectRoot: result.projectRoot, artifactDir: result.artifactDir }).artifactDir, result.artifactDir);
  const second = await buildContractRelease({ projectRoot: result.projectRoot, compile: compileFixture });
  assert.notEqual(second.artifactDir, result.artifactDir);
  assert.equal(resolveContractRelease({ projectRoot: result.projectRoot }), second.artifactDir);
  assert.ok(existsSync(join(result.artifactDir, RELEASE_FILENAME)), "previous immutable release remains available");
});

test("metadata-only validation cannot authorize deployment or silently omit binary ZKIR/keys", async t => {
  const projectRoot = project(t);
  const artifactDir = join(projectRoot, "skip-zk");
  mkdirSync(artifactDir);
  compileFixture({ artifactDir });
  for (const name of names) {
    rmSync(join(artifactDir, `zkir/${name}.bzkir`));
    rmSync(join(artifactDir, `keys/${name}.prover`));
    rmSync(join(artifactDir, `keys/${name}.verifier`));
  }
  assert.equal(validateContractArtifacts({ artifactDir, projectRoot, requireKeys: false, requireRelease: false }).release, null);
  assert.throws(() => validateContractArtifacts({ artifactDir, projectRoot }), /Missing/);
  assert.throws(() => validateContractArtifacts({ artifactDir, projectRoot, requireKeys: false }), /Missing/);
});

test("rejects stale ledger 9 compiler manifests even beside otherwise valid ledger 8 files", async t => {
  const result = await release(t);
  writeFileSync(join(result.artifactDir, "compiler/contract-manifest.json"), "{}");
  assert.throws(() => validateContractArtifacts(result), /Obsolete/);
});

test("rejects changed circuits, witness signatures and unsafe UInt64 rounding", async t => {
  const cases = [
    ["additional circuit", info => info.circuits.push({ ...info.circuits[0], name: "extra" }), /twelve circuits/],
    ["duplicate circuit", info => { info.circuits[1].name = info.circuits[0].name; }, /twelve circuits/],
    ["public argument", info => { info.circuits.find(c => c.name === "draw").arguments[0].type.length = 31; }, /public signature/],
    ["missing proof", info => { info.circuits[0].proof = false; }, /provable/],
    ["additional witness", info => info.witnesses.push({ ...info.witnesses[0], name: "extra" }), /twenty witnesses/],
    ["witness type", info => { info.witnesses[0]["result type"].length = 31; }, /private signature/],
    ["rounded UInt64 maximum", info => { info.circuits.find(c => c.name === "fundReserve").arguments[0].type.maxval = "18446744073709551616"; }, /public signature/],
    ["wrong compiler", info => { info["compiler-version"] = "0.34.0"; }, /compiler-version/],
    ["wrong runtime", info => { info["runtime-version"] = "0.19.0"; }, /runtime-version/],
  ];
  for (const [label, mutate, expected] of cases) await t.test(label, async t => {
    const result = await release(t);
    mutateMetadata(result.artifactDir, mutate);
    assert.throws(() => validateContractArtifacts(result), expected);
  });
});

test("rejects missing, empty or swapped proving assets and altered generated bindings", async t => {
  const cases = [
    ["missing binary IR", r => rmSync(join(r.artifactDir, "zkir/draw.bzkir")), /Missing/],
    ["empty prover", r => writeFileSync(join(r.artifactDir, "keys/draw.prover"), ""), /Empty/],
    ["swapped verifier", r => cpSync(join(r.artifactDir, "keys/openLine.verifier"), join(r.artifactDir, "keys/draw.verifier")), /hashes\/sizes differ/],
    ["changed JS", r => writeFileSync(join(r.artifactDir, "contract/index.js"), `${readFileSync(join(r.artifactDir, "contract/index.js"), "utf8")}\n// changed\n`), /hashes\/sizes differ/],
    ["wrong JS runtime", r => writeFileSync(join(r.artifactDir, "contract/index.js"), "checkRuntimeVersion('0.19.0');"), /Generated JS/],
    ["wrong ZKIR", r => writeFileSync(join(r.artifactDir, "zkir/draw.zkir"), JSON.stringify({ version: { major: 3, minor: 0 }, instructions: [] })), /ZKIR v2/],
    ["unsealed artifacts", r => rmSync(join(r.artifactDir, RELEASE_FILENAME)), /Missing/],
  ];
  for (const [label, mutate, expected] of cases) await t.test(label, async t => {
    const result = await release(t);
    mutate(result);
    assert.throws(() => validateContractArtifacts(result), expected);
  });
});

test("source and wrapper drift invalidate release; incompatible package pins fail before compile", async t => {
  for (const path of ["contracts/line.compact", "scripts/compile-compact.mjs"]) await t.test(path, async t => {
    const result = await release(t);
    writeFileSync(join(result.projectRoot, path), `${readFileSync(join(result.projectRoot, path), "utf8")}\n// drift`);
    assert.throws(() => validateContractArtifacts(result), /canonical inputs/);
  });
  for (const field of ["compact", "dependency"]) await t.test(field, async t => {
    const projectRoot = project(t);
    const path = join(projectRoot, "package.json");
    const pkg = JSON.parse(readFileSync(path, "utf8"));
    if (field === "compact") pkg.compact.compiler = "0.34.0";
    else pkg.dependencies["@midnight-ntwrk/compact-runtime"] = "^0.16.0";
    writeFileSync(path, JSON.stringify(pkg));
    let called = false;
    await assert.rejects(buildContractRelease({ projectRoot, compile: () => { called = true; } }), /pins|dependency/);
    assert.equal(called, false);
  });
});

test("failed or incomplete compile leaves previous pointer unchanged and never seals partial output", async t => {
  const result = await release(t);
  const pointerPath = join(result.projectRoot, POINTER_FILENAME);
  const before = readFileSync(pointerPath, "utf8");
  for (const [label, compile] of [
    ["failed", () => { throw new Error("compiler failure"); }],
    ["incomplete", ({ artifactDir }) => { compileFixture({ artifactDir }); rmSync(join(artifactDir, "keys/draw.verifier")); }],
  ]) {
    const output = join(result.projectRoot, label);
    await assert.rejects(buildContractRelease({ projectRoot: result.projectRoot, output, compile }), /compiler failure|Missing/);
    assert.equal(existsSync(join(output, RELEASE_FILENAME)), false);
    assert.equal(readFileSync(pointerPath, "utf8"), before);
  }
});

test("source mutation during key generation prevents publication", async t => {
  const result = await release(t);
  const pointerPath = join(result.projectRoot, POINTER_FILENAME);
  const before = readFileSync(pointerPath, "utf8");
  await assert.rejects(buildContractRelease({ projectRoot: result.projectRoot, output: "source-race", compile: options => {
    compileFixture(options);
    writeFileSync(join(result.projectRoot, "contracts/line.compact"), "pragma language_version 0.23;\n// raced\n");
  } }), /changed during key generation/);
  assert.equal(existsSync(join(result.projectRoot, "source-race", RELEASE_FILENAME)), false);
  assert.equal(readFileSync(pointerPath, "utf8"), before);
});

test("never seals existing output or permits output escaping the project", async t => {
  const projectRoot = project(t);
  mkdirSync(join(projectRoot, "old"));
  for (const output of ["old", "..", "."]) await assert.rejects(buildContractRelease({ projectRoot, output, compile: compileFixture }), /already exists|inside the project/);
});

test("published pointer rejects traversal and manifest tampering", async t => {
  const result = await release(t);
  const pointerPath = join(result.projectRoot, POINTER_FILENAME);
  const pointer = JSON.parse(readFileSync(pointerPath, "utf8"));
  writeFileSync(pointerPath, JSON.stringify({ ...pointer, artifactDir: "../escape" }));
  assert.throws(() => resolveContractRelease(result), /escapes/);
  writeFileSync(pointerPath, JSON.stringify(pointer));
  writeFileSync(join(result.artifactDir, RELEASE_FILENAME), `${readFileSync(join(result.artifactDir, RELEASE_FILENAME), "utf8")} `);
  assert.throws(() => resolveContractRelease(result), /published pointer/);
});

test("output and pointer cannot escape through a junction", async t => {
  const projectRoot = project(t);
  const externalRoot = project(t);
  symlinkSync(externalRoot, join(projectRoot, "redirect"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(buildContractRelease({ projectRoot, output: "redirect/release", compile: compileFixture }), /inside the project/);
  mkdirSync(join(projectRoot, ".compact-keys"));
  writeFileSync(join(projectRoot, POINTER_FILENAME), JSON.stringify({ schema: "line-contract-release-pointer/v1", artifactDir: "redirect/release", releaseSha256: "invalid" }));
  assert.throws(() => resolveContractRelease({ projectRoot }), /escapes/);
});

test("key directory junctions and external pointer publication fail closed", async t => {
  const result = await release(t);
  const externalRoot = project(t);
  const externalKeys = join(externalRoot, "keys");
  cpSync(join(result.artifactDir, "keys"), externalKeys, { recursive: true });
  rmSync(join(result.artifactDir, "keys"), { recursive: true });
  symlinkSync(externalKeys, join(result.artifactDir, "keys"), process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => validateContractArtifacts(result), /must not be a symlink/);
  const projectRoot = project(t);
  symlinkSync(externalRoot, join(projectRoot, ".compact-keys"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(buildContractRelease({ projectRoot, output: "local-release", compile: compileFixture }), /pointer directory escapes/);
  assert.equal(existsSync(join(externalRoot, "current-release.json")), false);
});

test("default compile invokes wrapper with portable relative paths and without --skip-zk", async t => {
  const projectRoot = project(t);
  // A child-process wrapper fixture lets this test exercise spawn/cwd/arguments
  // without running expensive key generation or claiming production-valid keys.
  const wrapper = `import {cpSync,mkdirSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
const args=process.argv.slice(2); writeFileSync('invocation.json',JSON.stringify(args));
const output=args[1], generated=${JSON.stringify(generated)}, names=${JSON.stringify(names)};
for(const path of generated){mkdirSync(dirname(join(output,path)),{recursive:true});cpSync(join(${JSON.stringify(managed)},path),join(output,path));}
for(const name of names) for(const path of ['zkir/'+name+'.bzkir','keys/'+name+'.prover','keys/'+name+'.verifier']){mkdirSync(dirname(join(output,path)),{recursive:true});writeFileSync(join(output,path),'SYNTHETIC TEST FIXTURE: '+path);}
`;
  writeFileSync(join(projectRoot, "scripts/compile-compact.mjs"), wrapper);
  const result = await buildContractRelease({ projectRoot, output: "fresh release/output", publishPointer: false });
  assert.deepEqual(JSON.parse(readFileSync(join(projectRoot, "invocation.json"), "utf8")), ["contracts/line.compact", "fresh release/output"]);
  assert.equal(existsSync(join(projectRoot, POINTER_FILENAME)), false);
  assert.equal(result.artifactDir, resolve(projectRoot, "fresh release/output"));
  assert.equal(relative(projectRoot, result.artifactDir).split(sep).join("/"), "fresh release/output");
});
