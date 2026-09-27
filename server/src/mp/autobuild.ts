import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// The built game for the house, kept up to date by the server itself (Steve, 2026-09-27: "If I join the
// laptop I get 'run npm' again, can't you fix it forever?"). Guests play the built game (client/dist and its
// manifest, static.ts); before, someone had to run `npm run host` or the desktop icon after every change of
// code, or the laptop saw "The game is not built on this PC". Now, while the house may join:
// - the build is checked against the code (client/src, client/public, client/index.html, shared): missing or
//   older, the server builds it (`npm --prefix client run build`, then tools/manifest.mjs), one build at a time;
// - meanwhile a guest's page says "the game is being built, a moment" and reloads by itself; a guest who has
//   an older build keeps playing it and is told when the new one is ready (static.ts's version push).
// Off when the dist is not this checkout's own (SCHELDEMIST_DIST) and under the tests (unless asked).

const SOURCES = ["client/src", "client/public", "shared", "client/index.html", "client/vite.config.ts", "client/package.json"];
/** How long the newest source time is trusted before the folders are looked at again. */
const LOOK_MS = 5000;
/** A build that takes longer than this is stopped (a hang): the next request tries again. */
const BUILD_MAX_MS = 8 * 60_000;
/** A failed build is tried again after this (or at once when the code changed since). */
const RETRY_MS = 60_000;

export interface BuildState {
  state: "ready" | "building" | "failed" | "off";
  /** What the build is doing, in a few words. */
  step: string;
  startedAt: number;
  error: string | null;
}

export class AutoBuild {
  private job: Promise<boolean> | null = null;
  private child: ChildProcess | null = null;
  private lookedAt = 0;
  private newest = 0;
  private failedAt = 0;
  private failedSource = 0;
  readonly status: BuildState;

  private readonly root: string;
  private readonly dist: string;
  readonly enabled: boolean;

  constructor(root: string, dist: string, enabled: boolean) {
    this.root = root;
    this.dist = dist;
    this.enabled = enabled;
    this.status = { state: enabled ? "ready" : "off", step: "", startedAt: 0, error: null };
  }

  /** The newest change time of the game's code and files (ms), looked at once every few seconds. */
  newestSource(now = Date.now()): number {
    if (now - this.lookedAt < LOOK_MS) return this.newest;
    this.lookedAt = now;
    let newest = 0;
    const walk = (p: string) => {
      let st: fs.Stats;
      try {
        st = fs.statSync(p);
      } catch {
        return;
      }
      if (st.isDirectory()) {
        for (const name of fs.readdirSync(p)) if (name !== "node_modules" && !name.startsWith(".")) walk(path.join(p, name));
      } else if (st.mtimeMs > newest) newest = st.mtimeMs;
    };
    for (const s of SOURCES) walk(path.join(this.root, s));
    this.newest = newest;
    return newest;
  }

  /** The manifest's time (0: no build). */
  builtAt(): number {
    try {
      return fs.statSync(path.join(this.dist, "manifest.json")).mtimeMs;
    } catch {
      return 0;
    }
  }

  /** No build, or one older than the code. */
  stale(now = Date.now()): boolean {
    const b = this.builtAt();
    return b === 0 || this.newestSource(now) > b;
  }

  /** Build now if it is missing or old (one at a time). Resolves true when a good build is there. */
  ensure(): Promise<boolean> {
    if (!this.enabled) return Promise.resolve(this.builtAt() > 0);
    if (this.job) return this.job;
    if (!this.stale()) return Promise.resolve(true);
    // a build that failed is not tried again on every request: after a minute, or when the code changed since
    if (this.status.state === "failed" && Date.now() - this.failedAt < RETRY_MS && this.newestSource() <= this.failedSource) return Promise.resolve(false);
    this.job = this.run().finally(() => {
      this.job = null;
      this.lookedAt = 0; // (look again: code may have changed while it built)
    });
    return this.job;
  }

  get building(): boolean {
    return this.job !== null;
  }

  private async run(): Promise<boolean> {
    const s = this.status;
    s.state = "building";
    s.startedAt = Date.now();
    s.error = null;
    console.log("[mp] building the game for the house (client/dist): the code changed or there was no build");
    try {
      s.step = "building the game";
      await this.step(process.platform === "win32" ? "npm.cmd" : "npm", ["--prefix", "client", "run", "build"]);
      s.step = "listing the files";
      await this.step(process.execPath, [path.join(this.root, "tools", "manifest.mjs")]);
      s.state = "ready";
      s.step = "";
      console.log(`[mp] the game for the house is built (${Math.round((Date.now() - s.startedAt) / 1000)} s)`);
      return true;
    } catch (e) {
      s.state = "failed";
      s.error = String((e as Error)?.message ?? e).slice(0, 500);
      this.failedAt = Date.now();
      this.failedSource = this.newestSource(0);
      console.warn(`[mp] building the game for the house failed: ${s.error}`);
      return false;
    }
  }

  private step(cmd: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      let tail = "";
      const c = spawn(cmd, args, { cwd: this.root, windowsHide: true, shell: process.platform === "win32" && cmd.endsWith(".cmd"), stdio: ["ignore", "pipe", "pipe"] });
      this.child = c;
      const keep = (d: Buffer) => (tail = (tail + d.toString()).slice(-2000));
      c.stdout?.on("data", keep);
      c.stderr?.on("data", keep);
      const timer = setTimeout(() => {
        c.kill();
        reject(new Error(`${path.basename(cmd)} took over ${BUILD_MAX_MS / 60000} minutes`));
      }, BUILD_MAX_MS);
      c.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      c.on("exit", (code) => {
        clearTimeout(timer);
        this.child = null;
        if (code === 0) resolve();
        else reject(new Error(`${path.basename(cmd)} ${args.join(" ")} ended with ${code}: ${tail.trim().split("\n").slice(-6).join(" / ")}`));
      });
    });
  }

  /** The server stops: a build under way goes with it. */
  stop(): void {
    this.child?.kill();
  }
}

/** The page a guest gets while the game is being built: it reloads by itself. */
export function buildingPage(st: BuildState): string {
  const secs = st.startedAt ? Math.round((Date.now() - st.startedAt) / 1000) : 0;
  const failed = st.state === "failed";
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Scheldemist</title>
${failed ? "" : '<meta http-equiv="refresh" content="4">'}
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#2a241d;font:18px Georgia,serif;color:#221b15}
.p{background:#e6d9b8;padding:28px 36px;max-width:30em;box-shadow:0 4px 18px rgba(0,0,0,.5);border:1px solid #8a7650}
h1{margin:0 0 .4em;font-size:28px;letter-spacing:.04em}p{margin:.4em 0}.s{font-style:italic;color:#5a4a36}</style></head>
<body><div class="p"><h1>Scheldemist</h1>
${
  failed
    ? `<p>The game could not be built on the host's PC.</p><p class="s">${esc(st.error ?? "")}</p><p>Tell the host. This page tries again when you reload it.</p>`
    : `<p>The host's PC is building the game for the house. This takes about half a minute.</p><p class="s">${st.step ? esc(st.step) + ", " : ""}${secs} s so far. This page reloads by itself.</p>`
}
</div></body></html>`;
}
