import type { Crowd, Puppet } from "../game/crowd";
import { LIVE_FIGURES, type Figure } from "../game/figures";
import type { Town } from "../game/town";
import { heldForJobs } from "../game/walkup";

// M7 walk-up, the check (Steve 2026-09-26: "a person always pops out of nowhere"). Every frame it looks at
// everyone drawn in the street (the crowd's people, the town's residents among them, and every figure
// made in code) and records each one that became visible within POP_M of Jef without walking in from
// beyond: made (or put) there while in view, or moved there in one jump. People of a job or a quest
// (held by the walk-up layer or by an action, and every made figure) are `pops`: it must list nothing.
// A figure that comes out of something in the story (the stowaway out of his crate, the mate up the
// ship's hatch) is listed under `emerged`, not as a pop. The town's own people stepping out (a door,
// the start of a game) are counted under `town` for information. After Jef himself jumps (the kit's
// go(), a load) nothing counts for a moment: everything is new then.
//
// Dev: `__scheldemist.popcheck()` (the lists since the last reset), `popcheck(true)` resets.

export const POP_M = 20;
const JUMP_M = 3;
const GRACE_S = 2;
/** Made figures whose way into the street is a thing of the story, not a pop. */
const EMERGE = new Set(["crate", "hatch", "dev"]);

export interface PopRec {
  what: string;
  who: string | null;
  x: number;
  z: number;
  d: number;
  how: "new" | "jump";
  origin: string;
  at: number;
}

interface Track {
  x: number;
  z: number;
}

export class PopWatch {
  private tracks = new WeakMap<object, Track>();
  private jef = { x: NaN, z: NaN };
  private grace = GRACE_S;
  private last = 0;
  private frames = 0;
  private since = performance.now();
  pops: PopRec[] = [];
  emerged: PopRec[] = [];
  town: PopRec[] = [];

  constructor(
    private readonly crowd: Crowd,
    private readonly townRef: Town,
    private readonly player: { x: number; z: number },
    /** Residents held by other layers for Jef (the M4 actions: seek, fetch the police ...). */
    private readonly acting: () => Iterable<string>,
  ) {}

  reset(): void {
    this.pops = [];
    this.emerged = [];
    this.town = [];
    this.frames = 0;
    this.since = performance.now();
    this.grace = GRACE_S;
  }

  frame(): void {
    const now = performance.now();
    const dt = this.last ? Math.min(0.2, (now - this.last) / 1000) : 1 / 60;
    this.last = now;
    this.frames++;
    const { x, z } = this.player;
    if (!Number.isFinite(this.jef.x) || Math.hypot(x - this.jef.x, z - this.jef.z) > 4) this.grace = GRACE_S;
    this.jef = { x, z };
    this.grace -= dt;
    // who is out for a job or a quest now
    const job = new Map<Puppet, string>();
    for (const id of heldForJobs) {
      const p = this.townRef.puppet(id);
      if (p) job.set(p, id);
    }
    for (const id of this.acting()) {
      const p = this.townRef.puppet(id);
      if (p) job.set(p, id);
    }
    for (const f of LIVE_FIGURES) this.check(f, f.pos.x, f.pos.z, true, `made ${(f as Figure).kind}`, null, f.origin);
    for (const p of this.crowd.walking) {
      const id = job.get(p) ?? null;
      this.check(p, p.x, p.z, id !== null, id ? (this.townRef.info(id)?.name ?? id) : p.kind, id, id ? "resident" : "town");
    }
  }

  private check(key: object, px: number, pz: number, isJob: boolean, what: string, who: string | null, origin: string): void {
    const t = this.tracks.get(key);
    const d = Math.hypot(px - this.jef.x, pz - this.jef.z);
    if (!t) {
      this.tracks.set(key, { x: px, z: pz });
      if (this.grace <= 0 && d < POP_M && this.crowd.inView(px, pz)) this.record(isJob, { what, who, x: px, z: pz, d, how: "new", origin });
      return;
    }
    const jumped = Math.hypot(px - t.x, pz - t.z) > JUMP_M;
    t.x = px;
    t.z = pz;
    if (jumped && this.grace <= 0 && d < POP_M && this.crowd.inView(px, pz)) this.record(isJob, { what, who, x: px, z: pz, d, how: "jump", origin });
  }

  private record(isJob: boolean, r: Omit<PopRec, "at">): void {
    const rec: PopRec = { ...r, x: +r.x.toFixed(1), z: +r.z.toFixed(1), d: +r.d.toFixed(1), at: Math.round((performance.now() - this.since) / 100) / 10 };
    if (!isJob) this.town.push(rec);
    else if (EMERGE.has(r.origin)) this.emerged.push(rec);
    else this.pops.push(rec);
    if (this.town.length > 200) this.town.shift();
  }

  report(reset = false): { pops: PopRec[]; emerged: PopRec[]; town: number; townSample: PopRec[]; frames: number; seconds: number } {
    const out = { pops: this.pops.slice(), emerged: this.emerged.slice(), town: this.town.length, townSample: this.town.slice(-8), frames: this.frames, seconds: Math.round((performance.now() - this.since) / 1000) };
    if (reset) this.reset();
    return out;
  }
}
