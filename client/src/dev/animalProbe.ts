import * as THREE from "three";
import { Animal } from "../game/animals";

// Dev probe (2026-09-24, "animals walk on the spot"): for every dog and cat near Jef, how long it
// played its walk or run cycle, how far it really went meanwhile, and the longest stretch it
// walked without getting anywhere. Every Animal is counted (strays, owners' dogs, cart dogs, the
// lost dog, window cats), because it hooks Animal.update itself.
//
// In a dev tab (test stack, docs/testing.md), near Jef, 60 game seconds:
//   const S = __scheldemist, p = (await import("/src/dev/animalProbe.ts")).animalProbe(S.player)
//   p.start(); S.t.run(30); S.t.run(30); p.report(); p.stop()
//
// "stuck" = at least 0.5 s on end in the walk or run cycle while moving slower than 0.15 m/s.
// "slip" = the ground the legs cover (clip pace x stride) against the ground really covered: 1 is right.

const STRIDE: Record<string, { walk: number; run: number }> = { dog: { walk: 0.452, run: 1.125 }, dog_grey: { walk: 0.497, run: 1.24 }, cat: { walk: 0.21, run: 0.531 } };

interface Rec {
  kind: string;
  n: number;
  walkT: number;
  walkD: number;
  legD: number;
  still: number;
  stillMax: number;
  stuckT: number;
  moved: number;
  jumps: number;
  motions: Record<string, number>;
  last: { x: number; z: number } | null;
  near: number;
}

/** What the probe reads off an Animal (its private parts too: this is a dev tool). */
interface Probed {
  __probeId?: number;
  group: THREE.Object3D;
  kind: string;
  motion: string | null;
  current?: { getEffectiveTimeScale(): number } | null;
  key?: string;
  actions: Map<string, { getClip(): { duration: number } }>;
}

let recs = new Map<number, Rec>();
let on = false;
let ids = 0;
let orig: ((dt: number) => void) | null = null;
const v = new THREE.Vector3();

export function animalProbe(player: { x: number; z: number }, radius = 35) {
  const proto = Animal.prototype as unknown as { update(dt: number): void };
  return {
    start(): string {
      recs = new Map();
      if (!orig) orig = proto.update;
      const o = orig;
      on = true;
      proto.update = function (this: Animal, dt: number) {
        o.call(this, dt);
        const a = this as unknown as Probed;
        if (!on || dt <= 0.0005) return;
        const pos = a.group.getWorldPosition(v);
        const near = Math.hypot(pos.x - player.x, pos.z - player.z);
        if (near > radius) return;
        if (a.__probeId === undefined) a.__probeId = ++ids;
        let r = recs.get(a.__probeId);
        if (!r) recs.set(a.__probeId, (r = { kind: a.kind, n: 0, walkT: 0, walkD: 0, legD: 0, still: 0, stillMax: 0, stuckT: 0, moved: 0, jumps: 0, motions: {}, last: null, near }));
        r.near = Math.min(r.near, near);
        const m = a.motion ?? "none";
        r.motions[m] = (r.motions[m] ?? 0) + dt;
        let d = r.last ? Math.hypot(pos.x - r.last.x, pos.z - r.last.z) : 0;
        if (d > 1.5) {
          r.jumps++;
          d = 0;
        }
        r.last = { x: pos.x, z: pos.z };
        r.moved += d;
        r.n++;
        if (m === "walk" || m === "run") {
          r.walkT += dt;
          r.walkD += d;
          const s = STRIDE[a.key ?? "dog"] ?? STRIDE.dog;
          // one loop of the clip is one stride
          r.legD += ((a.current?.getEffectiveTimeScale() ?? 1) * (m === "run" ? s.run : s.walk) * dt) / clipLen(a, m);
          if (d / dt < 0.15) {
            r.still += dt;
            r.stillMax = Math.max(r.stillMax, r.still);
            if (r.still >= 0.5) r.stuckT += dt;
          } else r.still = 0;
        } else r.still = 0;
      };
      return "probe on";
    },
    stop(): void {
      on = false;
      if (orig) proto.update = orig;
      orig = null;
    },
    report() {
      const rows = [...recs.entries()].map(([id, r]) => ({
        id,
        kind: r.kind,
        near: +r.near.toFixed(0),
        seen: +(r.n / 60).toFixed(1),
        walkS: +r.walkT.toFixed(1),
        walkM: +r.walkD.toFixed(1),
        movedM: +r.moved.toFixed(1),
        stillMaxS: +r.stillMax.toFixed(1),
        stuckS: +r.stuckT.toFixed(1),
        slip: r.walkD > 0.2 ? +(r.legD / r.walkD).toFixed(2) : null,
        jumps: r.jumps,
        motions: Object.fromEntries(Object.entries(r.motions).map(([k, sec]) => [k, +sec.toFixed(1)])),
      }));
      const walkers = rows.filter((r) => r.walkS > 0);
      return {
        animals: rows.length,
        walked: walkers.length,
        walksButDoesNotMove: rows.filter((r) => r.stillMaxS >= 0.5).length,
        stuckSeconds: +rows.reduce((a, r) => a + r.stuckS, 0).toFixed(1),
        rows,
      };
    },
  };
}

/** The walk clip's length in seconds: one loop is one stride. */
function clipLen(a: Probed, m: string): number {
  return a.actions.get(m)?.getClip().duration || 1;
}
