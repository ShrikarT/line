/** Local checkout recovery. Encryption is custody in this process, not role isolation. */
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scryptSync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, open, readFile, readdir, rename, rm, rmdir, lstat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { encodeVaultJson, decodeVaultJson } from "../src/lib/security/vault-codec.ts";

export interface CheckoutCheckpointStore {
  readonly mode: "encrypted-disk";
  save(id: string, snapshot: unknown): Promise<void>;
  loadAll(): Promise<unknown[]>;
  remove(id: string): Promise<void>;
  close(): Promise<void>;
}
const FORMAT = "line:checkout-checkpoint/v1";
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_FILE = 4_000_000;
export class CheckoutPersistenceError extends Error {}

export async function checkoutBinding(): Promise<string> {
  const hash = createHash("sha256");
  for (const path of ["contracts/line.compact", "contracts/managed/line/contract/index.js", "server/checkout-engine.ts", "server/checkout-storage.ts", "server/checkout-http.ts", "src/lib/line/compact-harness.ts", "src/lib/line/encoding.ts", "src/lib/security/vault-codec.ts"]) {
    hash.update(path).update(await readFile(resolve(path)));
  }
  const pkg = JSON.parse(await readFile(resolve("package.json"), "utf8"));
  hash.update(JSON.stringify({ compact: pkg.compact, runtime: pkg.dependencies["@midnight-ntwrk/compact-runtime"] }));
  for (const dependency of ["compact-runtime", "onchain-runtime-v3"]) {
    const installed = JSON.parse(await readFile(resolve(`node_modules/@midnight-ntwrk/${dependency}/package.json`), "utf8"));
    hash.update(`${dependency}:${installed.version}`);
  }
  return hash.digest("hex");
}

/** Single process owns this directory. Stale locks are reclaimed only for dead PIDs. */
export class EncryptedCheckoutStore implements CheckoutCheckpointStore {
  readonly mode = "encrypted-disk" as const;
  private closed = false;
  private lease = randomUUID();
  private directory: string;
  private password: string;
  private binding: string;
  private constructor(directory: string, password: string, binding: string) { this.directory = directory; this.password = password; this.binding = binding; }

  static async open(directory: string, password: string): Promise<EncryptedCheckoutStore> {
    if (password.length < 16) throw new CheckoutPersistenceError("Checkout storage password must contain at least 16 characters.");
    const target = resolve(directory);
    try { await mkdir(target, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    const stat = await lstat(target);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new CheckoutPersistenceError("Checkout storage must be a private directory, not a link.");
    const entries = await readdir(target);
    if (entries.some(entry => entry !== ".lease" && entry !== ".recovery" &&
        !/^[0-9a-f-]{36}\.checkpoint$/.test(entry) && !/^\.[0-9a-f-]{36}\.[0-9a-f-]{36}\.tmp$/.test(entry))) {
      throw new CheckoutPersistenceError("Checkout storage must be a dedicated directory without unrelated files.");
    }
    if (process.platform === "win32") {
      // Node chmod does not enforce Windows ACLs. Protect this dedicated directory.
      const user = execFileSync("whoami.exe", ["/user", "/fo", "csv", "/nh"], { encoding: "utf8", windowsHide: true });
      const sid = user.match(/S-1-5-[0-9-]+/)?.[0];
      if (!sid) throw new CheckoutPersistenceError("Could not identify the checkout storage owner.");
      execFileSync("icacls.exe", [target, "/inheritance:r", "/grant:r", `*${sid}:(OI)(CI)F`, "*S-1-5-18:(OI)(CI)F"], { windowsHide: true, stdio: "pipe" });
      // An existing directory may contain unrelated explicit ACL entries: reject them.
      const escaped = target.replaceAll("'", "''");
      const acl = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `(Get-Acl -LiteralPath '${escaped}').Access | ForEach-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value }`], { encoding: "utf8", windowsHide: true });
      if (acl.trim().split(/\r?\n/).some(entry => entry !== sid && entry !== "S-1-5-18")) throw new CheckoutPersistenceError("Checkout directory has unrelated explicit access. Use a new private directory.");
    } else if ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()) {
      throw new CheckoutPersistenceError("Checkout directory must be owned by this user with mode 0700.");
    }
    const store = new EncryptedCheckoutStore(target, password, await checkoutBinding());
    const leasePath = join(target, ".lease");
    await store.acquire(leasePath);
    return store;
  }
  private async acquire(path: string) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const handle = await open(path, "wx", 0o600);
        try { await handle.writeFile(JSON.stringify({ pid: process.pid, lease: this.lease })); await handle.sync(); }
        finally { await handle.close(); }
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST" || attempt) throw new CheckoutPersistenceError("Checkout directory already has an owner or cannot acquire its lease.");
        const recovery = join(this.directory, ".recovery");
        try { await mkdir(recovery, { mode: 0o700 }); }
        catch { throw new CheckoutPersistenceError("Another checkout recovery is active. A stale recovery guard requires operator inspection."); }
        try {
          const stat = await lstat(path);
          if (!stat.isFile() || stat.isSymbolicLink()) throw new CheckoutPersistenceError("Invalid checkout directory lease.");
          const raw = await readFile(path, "utf8");
          let owner: { pid: number };
          try { owner = JSON.parse(raw); } catch { throw new CheckoutPersistenceError("Malformed checkout directory lease. Inspect it before recovery."); }
          if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) throw new CheckoutPersistenceError("Invalid checkout directory lease owner.");
          try { process.kill(owner.pid, 0); throw new CheckoutPersistenceError("Checkout directory is already owned by a live process."); }
          catch (probe) { if ((probe as NodeJS.ErrnoException).code !== "ESRCH") throw probe; }
          if (await readFile(path, "utf8") !== raw) throw new CheckoutPersistenceError("Checkout directory lease changed during recovery.");
          await rm(path);
          // Publish our new lease while holding recovery exclusion: no other
          // reclaimer can remove this new owner after reading the stale lease.
          const handle = await open(path, "wx", 0o600);
          try { await handle.writeFile(JSON.stringify({ pid: process.pid, lease: this.lease })); await handle.sync(); }
          finally { await handle.close(); }
          return;
        } finally { await rmdir(recovery); }
      }
    }
  }
  private file(id: string) {
    if (this.closed || !SESSION_ID.test(id)) throw new CheckoutPersistenceError("Checkout checkpoint store is closed or session ID is invalid.");
    return join(this.directory, `${id}.checkpoint`);
  }
  private aad(id: string) { return Buffer.from(`${FORMAT}\0${id}\0${this.binding}`); }
  async save(id: string, snapshot: unknown) {
    const destination = this.file(id);
    const salt = randomBytes(16), iv = randomBytes(12);
    const key = scryptSync(this.password, salt, 32);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(this.aad(id));
    const ciphertext = Buffer.concat([cipher.update(encodeVaultJson(snapshot), "utf8"), cipher.final()]);
    key.fill(0);
    const envelope = JSON.stringify({ format: FORMAT, id, binding: this.binding, salt: salt.toString("hex"), iv: iv.toString("hex"), tag: cipher.getAuthTag().toString("hex"), ciphertext: ciphertext.toString("base64") });
    if (Buffer.byteLength(envelope) > MAX_FILE) throw new CheckoutPersistenceError("Checkout checkpoint exceeds storage bounds.");
    const temporary = join(this.directory, `.${id}.${randomUUID()}.tmp`);
    let published = false;
    try {
      const handle = await open(temporary, "wx", 0o600);
      try { await handle.writeFile(envelope); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, destination);
      published = true;
      await this.syncDirectory();
    } catch {
      throw new CheckoutPersistenceError(published ? "Checkpoint publication is uncertain; restart and recover before further work." : "Checkout checkpoint could not be committed.");
    } finally { await rm(temporary, { force: true }); }
  }
  private async syncDirectory() {
    // Windows refuses opening a directory handle. File FlushFileBuffers + same-volume
    // rename protects process-restart recovery; power-loss durability is not asserted there.
    if (process.platform === "win32") return;
    const directory = await open(this.directory, "r");
    try { await directory.sync(); } finally { await directory.close(); }
  }
  async loadAll(): Promise<unknown[]> {
    if (this.closed) throw new CheckoutPersistenceError("Checkout checkpoint store is closed.");
    const snapshots: unknown[] = [];
    const files = await readdir(this.directory);
    if (files.filter(file => file.endsWith(".checkpoint")).length > 20) throw new CheckoutPersistenceError("Checkout checkpoint capacity exceeded.");
    for (const file of files.filter(file => file.endsWith(".checkpoint"))) {
      const id = file.slice(0, -".checkpoint".length);
      const path = this.file(id), stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE || (process.platform !== "win32" && (stat.mode & 0o077))) throw new CheckoutPersistenceError("Unsafe checkout checkpoint file.");
      try {
        const envelope = JSON.parse(await readFile(path, "utf8"));
        if (envelope.format !== FORMAT || envelope.id !== id || envelope.binding !== this.binding || !/^[0-9a-f]{32}$/.test(envelope.salt) || !/^[0-9a-f]{24}$/.test(envelope.iv) || !/^[0-9a-f]{32}$/.test(envelope.tag) || typeof envelope.ciphertext !== "string") throw new Error();
        const key = scryptSync(this.password, Buffer.from(envelope.salt, "hex"), 32);
        const cipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "hex"));
        cipher.setAAD(this.aad(id)); cipher.setAuthTag(Buffer.from(envelope.tag, "hex"));
        const plain = Buffer.concat([cipher.update(Buffer.from(envelope.ciphertext, "base64")), cipher.final()]).toString("utf8");
        key.fill(0);
        snapshots.push(decodeVaultJson(plain));
      } catch { throw new CheckoutPersistenceError("Checkout recovery rejected an unauthenticated or incompatible checkpoint."); }
    }
    return snapshots;
  }
  async remove(id: string) { await rm(this.file(id), { force: true }); await this.syncDirectory(); }
  async close() {
    if (this.closed) return;
    this.closed = true;
    const path = join(this.directory, ".lease");
    const owner = JSON.parse(await readFile(path, "utf8"));
    if (owner.lease !== this.lease) throw new CheckoutPersistenceError("Checkout lease ownership changed.");
    await rm(path); this.password = "";
  }
}

export function checkoutStorageFromEnvironment(): Promise<CheckoutCheckpointStore | undefined> {
  const directory = process.env.LINE_CHECKOUT_STORAGE_DIR, password = process.env.LINE_CHECKOUT_STORAGE_PASSWORD;
  if (!directory && !password) return Promise.resolve(undefined);
  if (!directory || !password) return Promise.reject(new CheckoutPersistenceError("Configure both LINE_CHECKOUT_STORAGE_DIR and LINE_CHECKOUT_STORAGE_PASSWORD."));
  return EncryptedCheckoutStore.open(directory, password);
}
