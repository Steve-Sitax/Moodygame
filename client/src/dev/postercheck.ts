import * as THREE from "three";
import CITY from "../../../shared/city.json";
import GABLES from "../../../shared/city_gable_windows.json";
import BUILD from "../../../shared/city_build.json";
import INWORLD from "../../../shared/inworld_houses.json";
import { houseWalls, wallOpenings, type BuildData, type PosterWall } from "../../../shared/posterWalls";
import { aiSpotBox, fetchAiSpots, type Posters } from "../world/posters";
import type { StreetLife } from "../world/streetlife";
import { buildFacadeProbe, paintUnder, type FacadeProbe } from "../world/facadeProbe";
import { boxesOverlap, buildWallProbe, signOnWall, wallBox, type WallBox, type WallProbe } from "../world/wallprobe";

// The poster check (dev, __scheldemist.posters()): every bill in town, the town's own (world/posters.ts)
// and every place the engine may paste one of its bills (the server's /api/posters/spots, game/ideas.ts),
// tested against the houses as built (M7 posters, Steve 2026-09-26: "posters are also over windows and
// even a poster over a passage where we can walk through"):
//   - flat on a real wall (rays against city.glb, world/wallprobe.ts signOnWall): not floating, not sunk
//     into the wall, not across a corner or the gap between two houses, not over an archway, a passage,
//     a door surround or anything standing out of the wall;
//   - wholly on one house wall that is open to the street or the air (shared/posterWalls.ts), none of a
//     church, a landmark or a house whose inside stands in the world;
//   - clear of that wall's windows (the street fronts', the painted ones on the backs over the yards, the
//     alley cottages'), its doorway and a covered passage's mouth, with a hand's width to spare;
//   - clear of every other thing on the walls (signs, plates, numbers, brackets, awnings, Madonnas,
//     quay notices, the other bills) and of the door lanterns;
//   - the house behind it and the street open before it on the walk map, not in a passage;
//   - at a height a bill paster reaches, under the first floor.
// It must list nothing.

export interface PosterProblem {
  what: string;
  x: number;
  z: number;
  y: number;
  problem: string;
}

/** The signs tagged userData.wallSign in the scene, as boxes (as dev/signcheck.ts reads them). */
function taggedSigns(scene: THREE.Object3D): WallBox[] {
  const out: WallBox[] = [];
  scene.traverse((o) => {
    const ws = o.userData.wallSign as { kind: string; name: string; flat: boolean } | undefined;
    const g = (o as THREE.Mesh).geometry;
    if (!ws || !g) return;
    o.updateWorldMatrix(true, false);
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    const n = new THREE.Vector3(0, 0, 1).transformDirection(o.matrixWorld);
    const p = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
    out.push(wallBox(ws.kind, ws.name, ws.flat, [bb.min.x, bb.min.y, Math.min(bb.min.z, -0.005), bb.max.x, bb.max.y, Math.max(bb.max.z, 0.005)], p.x, p.y, p.z, Math.atan2(n.x, n.z)));
  });
  return out;
}

let probeCache: { root: THREE.Object3D; probe: WallProbe; facade: FacadeProbe | null } | null = null;

/**
 * `only`: check these flat things instead of the town's bills and the engine's places (dev: the bills of an
 * older build, as boxes, to count what was wrong before).
 */
export async function checkPosters(city: THREE.Object3D, flags: (x: number, z: number) => number | undefined, sl: StreetLife, posters: Posters | null, only?: Array<{ what: string; b: WallBox }>, scene?: THREE.Object3D) {
  const t0 = performance.now();
  if (probeCache?.root !== city) probeCache = { root: city, probe: buildWallProbe(city), facade: buildFacadeProbe(city) };
  const probe = probeCache.probe;
  const facade = probeCache.facade;
  const walls = posters?.walls ?? houseWalls(BUILD as unknown as BuildData, (INWORLD as { houses: Array<{ house: number }> }).houses.map((h) => h.house));
  const at = (x: number, z: number) => flags(x, z) ?? 1;
  const lamps = (GABLES as unknown as { lamps?: number[][] }).lamps ?? [];
  const poorts = ((CITY as unknown as { poorts?: number[][][] }).poorts ?? []).map((p) => p.map((q) => [q[0], q[1]]));
  const inPoly = (poly: number[][], x: number, z: number) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i];
      const [xj, zj] = poly[j];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi || 1e-12) + xi) c = !c;
    }
    return c;
  };
  const segD = (x: number, z: number, a: number[], b: number[]) => {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2));
    return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
  };
  const nearPoort = (x: number, z: number, r: number) => poorts.some((p) => inPoly(p, x, z) || p.some((q, i) => segD(x, z, q, p[(i + 1) % p.length]) < r));

  // the house walls in a grid, to find the one a bill lies on
  const G = 8;
  const grid = new Map<string, PosterWall[]>();
  for (const w of walls) {
    const seen = new Set<string>();
    for (let d = 0; d <= w.L + G; d += G / 2) {
      const s = Math.min(d, w.L);
      const k = `${Math.floor((w.ax + w.tx * s) / G)},${Math.floor((w.az + w.tz * s) / G)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      let l = grid.get(k);
      if (!l) grid.set(k, (l = []));
      l.push(w);
    }
  }
  const problems0: string[] = [];
  const hostsOf = (b: WallBox): PosterWall[] => {
    const bx = b.cx - b.nx * b.hn, bz = b.cz - b.nz * b.hn;
    const out: PosterWall[] = [];
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (const w of grid.get(`${Math.floor(bx / G) + i},${Math.floor(bz / G) + j}`) ?? []) {
          if (out.includes(w) || w.ox * b.nx + w.oz * b.nz < 0.98) continue;
          const d = Math.abs((bx - w.ax) * w.ox + (bz - w.az) * w.oz);
          const s = (bx - w.ax) * w.tx + (bz - w.az) * w.tz;
          if (d < 0.08 && s + b.hu > 0 && s - b.hu < w.L) out.push(w);
        }
    return out;
  };

  // the engine's places: as they were reserved at load (the same box objects), and any the server has now besides
  const spots = only ? [] : ((await fetchAiSpots()) ?? []);
  const reserved = new Map((posters?.aiSpots ?? []).map((a) => [`${a.spot.id}@${a.spot.x},${a.spot.z}`, a.box]));
  const list: Array<{ what: string; b: WallBox }> = only ?? [
    ...(posters?.items ?? []).map((p) => ({ what: `${p.what} ${p.key}${p.state ? ` (${p.state})` : ""}, ${p.district}`, b: p.box })),
    ...spots.map((s) => ({ what: `the engine's bill at ${s.label} (${s.id})`, b: reserved.get(`${s.id}@${s.x},${s.z}`) ?? aiSpotBox(s) })),
  ];
  if (!only && (spots.length !== reserved.size || spots.some((s) => !reserved.has(`${s.id}@${s.x},${s.z}`)))) problems0.push("the server's bill places changed since the town's bills went up: reload");
  const mine = new Set(list.map((l) => l.b));
  // (and the signs the game hangs up later: the shops' boards and brackets, world/shopSigns.ts)
  const others = [...sl.wallItems, ...(scene ? taggedSigns(scene).filter((t) => !sl.wallItems.some((o) => Math.abs(o.cx - t.cx) < 0.01 && Math.abs(o.cz - t.cz) < 0.01 && o.kind === t.kind)) : [])];
  const problems: PosterProblem[] = problems0.map((problem) => ({ what: "the engine's bills", x: 0, z: 0, y: 0, problem }));
  const PAD = 0.06;
  for (const { what, b } of list) {
    const say = (problem: string) => problems.push({ what, x: +b.cx.toFixed(1), z: +b.cz.toFixed(1), y: +((b.y0 + b.y1) / 2).toFixed(2), problem });
    // on a real wall, flat
    const wrong = signOnWall(b, probe);
    if (wrong) say(wrong);
    // on one open house wall, clear of its openings
    const hosts = hostsOf(b);
    if (!hosts.length) say("on no house wall open to the street (a church, a landmark, a party wall?)");
    let whole = false;
    for (const w of hosts) {
      if (w.inWorld) say("on the wall of a house whose inside is in the world");
      const s = (b.cx - w.ax) * w.tx + (b.cz - w.az) * w.tz;
      if (s - b.hu >= -0.01 && s + b.hu <= w.L + 0.01) whole = true;
      const o = wallOpenings(w).find((q) => s - b.hu < q.s1 + PAD && q.s0 - PAD < s + b.hu && b.y0 < q.y1 + PAD && q.y0 - PAD < b.y1);
      if (o) say(`over a ${o.what} (${o.s0.toFixed(2)}-${o.s1.toFixed(2)} m along, ${o.y0.toFixed(2)}-${o.y1.toFixed(2)} m up)`);
    }
    if (hosts.length && !whole) say("not wholly on one house's wall");
    // the paint on the wall as built (the facade atlas: windows, sashes, lintels, sills, plinths), finely
    if (facade) {
      const pu = paintUnder(facade, b, 0.03, 0.06);
      if (pu.painted) say(`over paint: ${pu.painted} of ${pu.of} points meet a painted window, sill or lintel`);
    }
    // clear of the other things on the walls, and of the door lanterns
    for (const o of others) {
      if (o === b || Math.abs(o.cx - b.cx) > 4 || Math.abs(o.cz - b.cz) > 4) continue;
      if (boxesOverlap(b, o, 0.005)) say(`overlaps ${mine.has(o) ? "another bill" : `${o.kind} ${o.name}`}`);
    }
    const mx = b.cx, mz = b.cz;
    if (lamps.some(([lx, ly, lz]) => Math.hypot(lx - mx, lz - mz) < b.hu + 0.3 && b.y1 > ly - 0.7)) say("by a door lantern");
    // the walk map: the house behind, the street before, no passage
    for (const e of [-b.hu, 0, b.hu]) {
      const x = mx + b.ux * e - b.nx * b.hn, z = mz + b.uz * e - b.nz * b.hn;
      if (!(at(x - b.nx * 0.3, z - b.nz * 0.3) & 1)) say("no house behind it on the walk map");
      if (at(x + b.nx * 0.45, z + b.nz * 0.45) !== 0) say("no open street before it on the walk map");
    }
    if (nearPoort(mx, mz, 0.6)) say("in or at a passage through a house");
    if (b.y0 < 0.25) say("down in the dirt");
    if (b.y1 > 3.4) say("up past the ground storey");
  }
  // (a problem said twice for one bill counts once)
  const seen = new Set<string>();
  const uniq = problems.filter((p) => {
    const k = `${p.what}|${p.x}|${p.z}|${p.problem.replace(/\(.*\)/, "")}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const byProblem: Record<string, number> = {};
  for (const p of uniq) {
    const k = p.problem.replace(/ \(.*$/, "").replace(/overlaps (\S+ \S+).*/, "overlaps $1").replace(/^over paint:.*/, "over paint (a window, a sill, a lintel)").replace(/ by [0-9.]+ m$/, "");
    byProblem[k] = (byProblem[k] ?? 0) + 1;
  }
  if (!facade) uniq.push({ what: "the check", x: 0, z: 0, y: 0, problem: "could not read the facade atlas: painted windows not tested" });
  return {
    bills: posters?.items.length ?? 0,
    engineSpots: spots.length,
    checked: list.length,
    stats: posters?.stats ?? null,
    problems: uniq.length,
    byProblem,
    list: uniq,
    ms: Math.round(performance.now() - t0),
  };
}
