export class OrganizationTimeoutError extends Error {
  constructor(message: string) { super(message); this.name = "OrganizationTimeoutError"; }
}

/** The original task may finish later, but this wait never acts on its result. */
export async function withinDeadline<T>(task: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([task, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new OrganizationTimeoutError(message)), milliseconds); })]);
  } finally { clearTimeout(timer); }
}

/** One observation per signed identifier. Timeout never means failure or retry. */
export class OrganizationFinality<T> {
  private readonly read: (id: string) => Promise<T>;
  private readonly timeoutMs: number;
  private observations = new Map<string, Promise<T>>();
  constructor(read: (id: string) => Promise<T>, timeoutMs = 45_000) { this.read = read; this.timeoutMs = timeoutMs; }
  async wait(id: string): Promise<T> {
    let original = this.observations.get(id);
    if (!original) {
      original = Promise.resolve().then(() => this.read(id));
      this.observations.set(id, original);
      void original.catch(() => { this.observations.delete(id); });
    }
    return withinDeadline(original, this.timeoutMs, "Finality has not been observed yet. The original signed transaction is saved. Check it again later; no replacement payment was submitted.");
  }
  forget(id: string) { this.observations.delete(id); }
}
