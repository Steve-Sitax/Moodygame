import type { Crowd, Puppet } from "../game/crowd";
import type { Town } from "../game/town";
import type { Rect } from "../world/geom";

// The stuck check (Steve 2026-09-27: "in an alley a person was glitch walking against a wall; there were
// more people all around doing that"). It runs the game for some seconds and watches everyone the crowd
// walks (the town's residents among them): whoever plays a walking clip (walk, carry, push, ride) while
// their body stays on the spot (IN PLACE: 3 s within 0.3 m) or goes to and fro without getting anywhere
// (TO AND FRO: 8 s, under 0.8 m net for over 3 m walked) is listed, with who they are, what they try to do
// (state, role, goal, the next waypoint) and what stands in their way just ahead: the walk map (wall,
// water, outside), the crowd's walk grid, the world's collider test (isFree) and the solid in the way,
// a pushed cart, the narrow stair rule. It must list nothing.
//
// Dev: `await __scheldemist.stuck({ seconds: 12 })` (the tab may be hidden: it steps the game itself).

const WALKING = new Set(["walk", "carry", "push", "ride"]);
const IN_PLACE_S = 3;
const IN_PLACE_M = 0.3;
const FRO_S = 8;
const SAMPLE = 0.25;

export interface StuckHost {
  crowd: Crowd;
  town: Town;
  world: {
    isFree(x: number, z: number, r: number): boolean;
    solids(): Rect[];
    moverAt?(x: number, z: number, r: number): boolean;
    city: { flags(x: number, z: number): number | undefined };
  };
  player: { x: number; z: number };
  step(s: number): void;
  narrow?(x: number, z: number): boolean;
}

interface Sample {
  x: number;
  z: number;
  walk: boolean;
}

export interface StuckRec {
  who: string;
  id: string | null;
  kind: string;
  how: "in place" | "to and fro";
  x: number;
  z: number;
  /** Metres from Jef, and drawn (in view) at the time. */
  d: number;
  shown: boolean;
  /** Seconds listed as stuck in this run. */
  secs: number;
  /** What the crowd does with them, and what the town wants. */
  state: string;
  role: string;
  motion: string | null;
  goal: string | null;
  dest: [number, number] | null;
  next: [number, number] | null;
  replans: number;
  lead: number | null;
  /** Just ahead (0.45 m that way): what the walk map, the grid and the colliders say. */
  ahead: Probe;
  here: Probe;
}

interface Probe {
  flags: number | undefined;
  grid: boolean;
  free: boolean;
  /** A wall of the walk map within the world's 0.4 m ring (what isFree refuses for the crowd's 0.25 m body). */
  wallRing: boolean;
  solid: string | null;
  mover: boolean;
  narrow: boolean;
}

function probe(h: StuckHost, x: number, z: number): Probe {
  const grid = (h.crowd as unknown as { grid: { built: boolean; isOpen(x: number, z: number): boolean } }).grid;
  let wallRing = false;
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const f = h.world.city.flags(x + Math.cos(a) * 0.4, z + Math.sin(a) * 0.4);
    if (f !== undefined && (f & 1) !== 0) wallRing = true;
  }
  const s = h.world.solids().find((c) => x > c.minX - 0.25 && x < c.maxX + 0.25 && z > c.minZ - 0.25 && z < c.maxZ + 0.25);
  return {
    flags: h.world.city.flags(x, z),
    grid: grid.built && grid.isOpen(x, z),
    free: h.world.isFree(x, z, 0.25),
    wallRing,
    solid: s ? `${s.minX.toFixed(1)},${s.minZ.toFixed(1)} to ${s.maxX.toFixed(1)},${s.maxZ.toFixed(1)}${s.top != null ? ` top ${s.top.toFixed(2)}` : ""}` : null,
    mover: !!h.world.moverAt?.(x, z, 0.25),
    narrow: !!h.narrow?.(x, z),
  };
}

/** Runs the game `seconds` and lists everyone who walks without getting anywhere. */
export function stuckCheck(h: StuckHost, opts: { seconds?: number; near?: number } = {}): { stuck: StuckRec[]; watched: number; walking: number; seconds: number } {
  const seconds = Math.min(30, Math.max(IN_PLACE_S, opts.seconds ?? 12));
  const near = opts.near ?? Infinity;
  const tracks = new Map<Puppet, Sample[]>();
  const found = new Map<Puppet, StuckRec>();
  const sims = h.town.journeyHost().sims() as unknown as Array<{ r: { id: string; name: string; trade: string }; p: Puppet | null; goal: { mode: string; place?: string; x: number; z: number }; held: boolean }>;
  const walkers = new Set<Puppet>();
  const inPlaceN = Math.round(IN_PLACE_S / SAMPLE);
  const froN = Math.round(FRO_S / SAMPLE);
  for (let t = 0; t < seconds; t += SAMPLE) {
    h.step(SAMPLE);
    const simOf = new Map<Puppet, (typeof sims)[number]>();
    for (const s of sims) if (s.p) simOf.set(s.p, s);
    for (const p of h.crowd.walking) {
      if (Math.hypot(p.x - h.player.x, p.z - h.player.z) > near) continue;
      const walk = WALKING.has(p.human.motion ?? "");
      if (walk) walkers.add(p);
      let tr = tracks.get(p);
      if (!tr) tracks.set(p, (tr = []));
      tr.push({ x: p.x, z: p.z, walk });
      if (tr.length > froN) tr.shift();
      let how: StuckRec["how"] | null = null;
      if (tr.length >= inPlaceN) {
        const w = tr.slice(-inPlaceN);
        if (w.every((q) => q.walk)) {
          const mx = w.reduce((a, q) => a + q.x, 0) / w.length;
          const mz = w.reduce((a, q) => a + q.z, 0) / w.length;
          if (w.every((q) => Math.hypot(q.x - mx, q.z - mz) < IN_PLACE_M)) how = "in place";
        }
      }
      if (!how && tr.length >= froN && tr.every((q) => q.walk)) {
        let walked = 0;
        for (let i = 1; i < tr.length; i++) walked += Math.hypot(tr[i].x - tr[i - 1].x, tr[i].z - tr[i - 1].z);
        const net = Math.hypot(tr[tr.length - 1].x - tr[0].x, tr[tr.length - 1].z - tr[0].z);
        if (net < 0.8 && walked > 3) how = "to and fro";
      }
      if (!how) continue;
      const had = found.get(p);
      if (had) {
        had.secs += SAMPLE;
        continue;
      }
      const s = simOf.get(p);
      const q = p as unknown as { state: string; role: string; dest: { x: number; z: number } | null; path: Array<{ x: number; z: number }>; pi: number; replans: number; lead: { id: number } | null; id: number; pmotion?: string };
      const nxt = q.path[q.pi] ?? q.dest ?? null;
      let ux = Math.sin(p.yaw);
      let uz = Math.cos(p.yaw);
      if (nxt) {
        const L = Math.hypot(nxt.x - p.x, nxt.z - p.z);
        if (L > 0.05) {
          ux = (nxt.x - p.x) / L;
          uz = (nxt.z - p.z) / L;
        }
      }
      const r1 = (v: number) => Math.round(v * 10) / 10;
      found.set(p, {
        who: s ? `${s.r.name} (${s.r.trade})` : `crowd #${q.id}`,
        id: s?.r.id ?? null,
        kind: p.kind,
        how,
        x: r1(p.x),
        z: r1(p.z),
        d: r1(Math.hypot(p.x - h.player.x, p.z - h.player.z)),
        shown: p.shown,
        secs: how === "in place" ? IN_PLACE_S : FRO_S,
        state: q.state,
        role: q.role,
        motion: p.human.motion,
        goal: s ? `${s.goal.mode}${s.goal.place ? ` ${s.goal.place}` : ""} at ${r1(s.goal.x)},${r1(s.goal.z)}${s.held ? " (held)" : ""}` : null,
        dest: q.dest ? [r1(q.dest.x), r1(q.dest.z)] : null,
        next: nxt ? [r1(nxt.x), r1(nxt.z)] : null,
        replans: q.replans,
        lead: q.lead?.id ?? null,
        ahead: probe(h, p.x + ux * 0.45, p.z + uz * 0.45),
        here: probe(h, p.x, p.z),
      });
    }
  }
  return { stuck: [...found.values()], watched: tracks.size, walking: walkers.size, seconds };
}
