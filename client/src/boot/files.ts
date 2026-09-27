// M8e part B (docs/milestones/M8e.md): the pure parts of the file store's download (boot/netboot.ts), for a
// first visit over a VPN (about 66 MB). No DOM, no IndexedDB here: client/test/files.test.mjs runs them in node.
//
// - Each file is stored the moment it is whole and checked, so a reload (or a line that dropped) keeps every
//   file already in and downloads only the rest: `plan` says which, and whether this is a first visit, a
//   download taken up again, or a new version.
// - A file is given up when no byte came for STALL_MS (not after a fixed time: a 10 MB model over a slow VPN
//   may take minutes and still be coming), and tried again after a short wait, up to TRIES times; one that
//   never comes is fetched from the network at play time as before.

export const STALL_MS = 30_000;
export const TRIES = 4;
/** The waits before the second, third and fourth try. */
export const RETRY_WAITS_MS = [1_000, 2_000, 4_000];
/** localStorage: the version whose files were last all downloaded and checked. */
export const WHOLE_KEY = "scheldemist.files.whole";

export interface PlanFile {
  path: string;
  size: number;
  sha256: string;
}

export type PlanKind = "first" | "resume" | "new" | "none";

export interface Plan<F extends PlanFile> {
  missing: F[];
  kind: PlanKind;
  /** Bytes of this version already stored. */
  kept: number;
  /** Bytes to download. */
  total: number;
  /** Stored hashes no file of this version names (a new version: removed after a whole download). */
  stale: string[];
}

/**
 * What to download: the files whose hash is not stored. `whole`: the version last downloaded whole (null: none
 * yet, or a store from before M8e).
 */
export function plan<F extends PlanFile>(files: F[], have: Set<string>, version: string, whole: string | null): Plan<F> {
  const missing = files.filter((f) => !have.has(f.sha256));
  const names = new Set(files.map((f) => f.sha256));
  const stale = [...have].filter((h) => !names.has(h));
  const total = missing.reduce((n, f) => n + f.size, 0);
  const kept = files.reduce((n, f) => n + (have.has(f.sha256) ? f.size : 0), 0);
  let kind: PlanKind;
  if (!missing.length) kind = "none";
  else if (!have.size) kind = "first";
  // a whole download of another version, or files of another one still stored: a new version
  else if ((whole !== null && whole !== version) || stale.length) kind = "new";
  else kind = "resume";
  return { missing, kind, kept, total, stale };
}

const mb = (n: number) => (n / 1048576).toFixed(n < 10 * 1048576 ? 1 : 0);

/** The loading screen's words for a plan, `done` bytes in. */
export function planWords(p: Plan<PlanFile>, done: number, version: string): { step: string; now: string } {
  if (p.kind === "new") return { step: `New version: downloading ${mb(done)} of ${mb(p.total)} MB`, now: `A new version (${version}): only the files that changed.` };
  if (p.kind === "resume")
    return { step: `Downloading ${mb(p.kept + done)} of ${mb(p.kept + p.total)} MB`, now: `Going on where the last visit stopped: ${mb(p.kept)} MB were kept. Later visits start at once.` };
  return { step: `Downloading ${mb(done)} of ${mb(p.total)} MB`, now: "The first visit copies the game from the host's PC. Later visits start at once." };
}

/** The bar: the share of this version's bytes in the store. */
export function planProgress(p: Plan<PlanFile>, done: number): number {
  if (p.kind === "resume") return (p.kept + done) / Math.max(1, p.kept + p.total);
  return p.total ? done / p.total : 1;
}

/**
 * Read a response body to the end, `onChunk` for each part; rejects when no byte came for `stallMs` (the
 * reader is cancelled, and `abort` called to end the request).
 */
export async function readAll(body: ReadableStream<Uint8Array>, onChunk: (n: number) => void, stallMs = STALL_MS, abort?: () => void): Promise<Uint8Array> {
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stall = new Promise<never>((_, bad) => {
      timer = setTimeout(() => bad(new Error("stalled")), stallMs);
    });
    let r: ReadableStreamReadResult<Uint8Array>;
    try {
      r = await Promise.race([reader.read(), stall]);
    } catch (e) {
      abort?.();
      void reader.cancel().catch(() => {});
      throw e;
    } finally {
      clearTimeout(timer);
    }
    if (r.done) break;
    parts.push(r.value);
    got += r.value.length;
    onChunk(r.value.length);
  }
  const buf = new Uint8Array(got);
  let o = 0;
  for (const p of parts) (buf.set(p, o), (o += p.length));
  return buf;
}
