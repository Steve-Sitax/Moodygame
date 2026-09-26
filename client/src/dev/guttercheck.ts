import BUILD from "../../../shared/city_build.json";
import { stallThings, thingLocal } from "../game/stallSpots";
import type { Stream } from "../world/alive/eaves";
import type { World } from "../world/rijnkaai";
import { buildWallProbe, type WallProbe } from "../world/wallprobe";
import { allDoors } from "./stallcheck";
import * as THREE from "three";

// The gutter check (dev, __scheldemist.alive.gutters()): every broken gutter's stream (world/alive/eaves.ts)
// against the houses as built (city.glb) and what stands in the street. It must list nothing.
//   - its top on a real eave of its own house: the roof's lip or the gutter just above it, the house's own wall
//     behind it under the eave, and the house behind it its own;
//   - the water's fall clear: nothing of the houses within 5 cm of the line from the eave to the ground,
//     no sign, board or awning of street life across it;
//   - its foot on the ground: not inside a house or landmark, not on the water, the ground where it lands
//     (not a step, a kerb's edge or a stall's top), not in a doorway (the houses', the game's, the shops'),
//     not on a stall, a shop table or goods set out.

type P = [number, number];

let probeCache: { root: THREE.Object3D; probe: WallProbe } | null = null;

function inPoly(poly: number[][], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi || 1e-12) + xi) inside = !inside;
  }
  return inside;
}

export interface GutterProblem {
  house: number;
  x: number;
  z: number;
  problem: string;
}

export function checkGutters(world: World, streams: Stream[]): { streams: number; houses: number; ms: number; problems: GutterProblem[] } {
  const t0 = performance.now();
  if (probeCache?.root !== world.city.group) probeCache = { root: world.city.group, probe: buildWallProbe(world.city.group) };
  const probe = probeCache.probe;
  const b = BUILD as unknown as { houses: Array<{ fp: number[][]; gone?: boolean }>; landmarks: Record<string, { fp: number[][] }> };
  const polys: Array<{ fp: number[][]; name: string; house: number }> = [
    ...b.houses.map((h, i) => ({ fp: h.fp, name: `house ${i}`, house: h.gone ? -2 : i })).filter((p) => p.house >= 0),
    ...Object.entries(b.landmarks ?? {}).map(([k, l]) => ({ fp: l.fp, name: k, house: -1 })),
  ];
  const town = (window as unknown as { __scheldemist?: { town?: { data?: unknown } } }).__scheldemist?.town?.data ?? null;
  const doors = allDoors(town as Parameters<typeof allDoors>[0]);
  const stalls = stallThings.map((t) => {
    const L = thingLocal(t);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i + 2 < L.length; i += 3) {
      u0 = Math.min(u0, L[i]);
      u1 = Math.max(u1, L[i]);
      v0 = Math.min(v0, L[i + 2]);
      v1 = Math.max(v1, L[i + 2]);
      y1 = Math.max(y1, L[i + 1]);
    }
    return { t, u0, u1, v0, v1, y1, c: Math.cos(t.yaw), s: Math.sin(t.yaw) };
  });
  const wallItems = world.streetLife()?.wallItems ?? [];
  const problems: GutterProblem[] = [];
  for (const s of streams) {
    const say = (problem: string) => problems.push({ house: s.house, x: +s.x.toFixed(2), z: +s.z.toFixed(2), problem });
    const { ox, oz } = s;
    // 1. the eave: the lip (roof or gutter) just over the top, the wall behind it under the eave, its own house
    const lip = probe(s.x + ox * 0.3, s.top + 0.06, s.z + oz * 0.3, -ox, -oz, 1.2);
    if (lip === null || lip > 0.3 + 0.2) say(`no eave over its top (a level ray at the top meets the roof ${lip === null ? "nowhere" : `${(lip - 0.3).toFixed(2)} m in`})`);
    const wall = probe(s.x + ox * 0.3, s.top - 0.3, s.z + oz * 0.3, -ox, -oz, 2);
    if (wall === null) say("no wall behind the stream under the eave");
    else if (wall - 0.3 < 0.08) say(`something stands at the stream under the eave (${(wall - 0.3).toFixed(2)} m)`);
    else if (wall - 0.3 > s.over + 0.35) say(`its wall is ${(wall - 0.3).toFixed(2)} m back (the eave stands out ${s.over.toFixed(2)})`);
    const bx = s.x - ox * (s.over + 0.15), bz = s.z - oz * (s.over + 0.15);
    const owner = polys.find((p) => inPoly(p.fp, bx, bz));
    if (!owner || owner.house !== s.house) say(`the house behind it is ${owner ? owner.name : "none"}, not house ${s.house}`);
    // the damp streak on its wall: at its two edges, top to bottom, the wall a hand behind it (not air, not a window's recess)
    {
      const hw = 0.4;
      const a0 = Math.min(hw, s.l0 - 0.02), a1 = Math.min(hw, s.l1 - 0.02);
      const wx = s.x - ox * (s.over - 0.03), wz = s.z - oz * (s.over - 0.03);
      let bad = "";
      for (const u of [-a0 * 0.8, 0, a1 * 0.8]) {
        for (let y = s.ground + 0.4; y < s.stainTop - 0.1 && !bad; y += 0.6) {
          const d = probe(wx + s.ux * u + ox * 0.3, y, wz + s.uz * u + oz * 0.3, -ox, -oz, 0.8);
          if (d === null || d < 0.3 - 0.12 || d > 0.3 + 0.15) bad = `the damp streak leaves its wall at ${(y - s.ground).toFixed(1)} m, ${u.toFixed(2)} along (${d === null ? "no wall" : `wall ${(d - 0.3).toFixed(2)} m back`})`;
        }
      }
      if (bad) say(bad);
    }
    // 2. the fall clear of the houses and street life
    for (let y = s.ground + 0.3; y < s.top - 0.4; y += 0.45) {
      for (const [dx, dz] of [[ox, oz], [-ox, -oz], [s.ux, s.uz], [-s.ux, -s.uz]] as P[]) {
        const d = probe(s.x - dx * 0.05, y, s.z - dz * 0.05, dx, dz, 0.1);
        if (d !== null) {
          say(`a wall or ledge in the fall at ${(y - s.ground).toFixed(1)} m`);
          y = 1e9;
          break;
        }
      }
    }
    for (const w of wallItems) {
      if (w.y1 < s.ground || w.y0 > s.top) continue;
      const dx = s.x - w.cx, dz = s.z - w.cz;
      if (Math.abs(dx * w.ux + dz * w.uz) < w.hu + 0.05 && Math.abs(dx * w.nx + dz * w.nz) < w.hn + 0.05) say(`through street life's ${w.kind} (${w.name})`);
    }
    // 3. the foot
    const inside = polys.find((p) => inPoly(p.fp, s.x, s.z));
    if (inside) say(`its foot is inside ${inside.name}`);
    const f = world.city.flags(s.x + ox * 0.3, s.z + oz * 0.3);
    if (f !== undefined && (f & 2) !== 0) say("its foot is on the water");
    // (the coarse walk map may count the foot, a hand from the wall, as wall: then the ground just beyond it)
    let g = world.groundAt(s.x, s.z, 0.05, s.ground + 0.4);
    if (!(g > -5)) g = world.groundAt(s.x + ox * 0.35, s.z + oz * 0.35, 0.05, s.ground + 0.4);
    if (!Number.isFinite(g) || Math.abs(g - s.ground) > 0.2) say(`the ground where it lands is at ${g.toFixed(2)}, the stream thinks ${s.ground.toFixed(2)}`);
    for (const d of doors) {
      if (Math.hypot(d.ox, d.oz) < 0.5) continue; // (a home without a way out given: no doorway to keep clear)
      const dx = s.x - d.x, dz = s.z - d.z;
      const along = Math.abs(dx * -d.oz + dz * d.ox);
      const out = dx * d.ox + dz * d.oz;
      if (along < d.half + 0.3 && out > -0.4 && out < 1.2) {
        say(`in the doorway of ${d.label}`);
        break;
      }
    }
    for (const st of stalls) {
      const dx = s.x - st.t.x, dz = s.z - st.t.z;
      if (Math.abs(dx) > 10 || Math.abs(dz) > 10) continue;
      // (the thing's frame: u along (cos yaw, -sin yaw), v out (sin yaw, cos yaw))
      const u = dx * st.c - dz * st.s;
      const v = dx * st.s + dz * st.c;
      if (u > st.u0 - 0.1 && u < st.u1 + 0.1 && v > st.v0 - 0.1 && v < st.v1 + 0.1) say(`onto ${st.t.kind} ${st.t.label}`);
    }
  }
  return { streams: streams.length, houses: new Set(streams.map((s) => s.house)).size, ms: Math.round(performance.now() - t0), problems };
}
