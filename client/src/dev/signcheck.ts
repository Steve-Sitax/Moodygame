import * as THREE from "three";
import type { StreetLife } from "../world/streetlife";
import { facadeOpenings, type Opening } from "../world/cityTextures";
import { boxesOverlap, buildWallProbe, signOnWall, wallBox, type WallBox, type WallProbe } from "../world/wallprobe";

// The sign check (dev, __scheldemist.signs()): every street name plate, house number, shop board,
// painted lettering, bill and door sign in the city, tested against the houses as built.
//   - on the wall: level rays against the real geometry (city.glb) behind it, and a margin past its
//     ends, must meet the wall right behind its back (not past a corner, not floating, nothing
//     standing out of the wall there: a gateway, a door surround, the next house);
//   - clear of the windows and the door of its wall (the facade atlas, cityTextures.facadeOpenings);
//   - clear of every other thing on the walls: signs, plates, brackets, awnings, Madonnas.
// Fixes 2026-09-25: also the notices and quay names painted on the storehouse walls
// (world/quayfurniture.ts, on streetlife's list); on a wall that is no house front (a props
// building) only their overlaps are checked.
// It must list nothing.

export interface SignProblem {
  kind: string;
  name: string;
  x: number;
  z: number;
  y: number;
  problem: string;
}

let probeCache: { root: THREE.Object3D; probe: WallProbe } | null = null;

/** The game's own signs over its doors, tagged userData.wallSign (world/rijnkaai.ts, game/interiors.ts). */
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

export function checkSigns(scene: THREE.Scene, city: THREE.Object3D, sl: StreetLife) {
  const t0 = performance.now();
  if (probeCache?.root !== city) probeCache = { root: city, probe: buildWallProbe(city) };
  const probe = probeCache.probe;
  const tProbe = performance.now() - t0;
  const label = (b: WallBox) => {
    const m = /^plate_(\d+)$/.exec(b.name);
    if (m) return `${b.kind} ${sl.streetNames[+m[1]] ?? b.name}`;
    return `${b.kind} ${b.name.replace(/^(board|letters|hang|number)_/, "")}`;
  };
  const items = [...sl.wallItems.filter((b) => b.kind !== "door sign" && b.kind !== "tavern sign"), ...taggedSigns(scene)];

  // the house walls and their openings
  interface W { ax: number; az: number; tx: number; tz: number; ox: number; oz: number; L: number; kind: number; open: Opening[] }
  const walls: W[] = sl.walls.map(([ax, az, bx, bz, ox, oz, H, , kind, style, door]) => {
    const L = Math.hypot(bx - ax, bz - az);
    return { ax, az, tx: (bx - ax) / L, tz: (bz - az) / L, ox, oz, L, kind, open: kind === 0 ? facadeOpenings(L, H, door >= 0, style, sl.ground_h, sl.storey_h) : [] };
  });
  /** The walls in the plane of a flat thing's back that it lies on (a few fronts in the plan run into each other). */
  const hostsOf = (b: WallBox): W[] => {
    const bx = b.cx - b.nx * b.hn, bz = b.cz - b.nz * b.hn;
    const out: W[] = [];
    for (const w of walls) {
      if (w.ox * b.nx + w.oz * b.nz < 0.98) continue;
      const d = Math.abs((bx - w.ax) * w.ox + (bz - w.az) * w.oz);
      const s = (bx - w.ax) * w.tx + (bz - w.az) * w.tz;
      if (d < 0.08 && s + b.hu > 0 && s - b.hu < w.L) out.push(w);
    }
    return out;
  };

  const problems: SignProblem[] = [];
  const say = (b: WallBox, problem: string) => problems.push({ kind: b.kind, name: label(b), x: +b.cx.toFixed(1), z: +b.cz.toFixed(1), y: +((b.y0 + b.y1) / 2).toFixed(2), problem });
  const flat = items.filter((b) => b.flat);
  const grid = new Map<string, WallBox[]>();
  for (const b of items) {
    const k = `${Math.floor(b.cx / 8)},${Math.floor(b.cz / 8)}`;
    let l = grid.get(k);
    if (!l) grid.set(k, (l = []));
    l.push(b);
  }
  const seenPair = new Set<string>();
  const index = new Map<WallBox, number>(items.map((b, i) => [b, i]));
  for (const b of flat) {
    const hosts = hostsOf(b);
    const quay = b.kind === "quay notice" || b.kind === "quay name";
    // on the wall, and the wall there
    const wrong = quay && !hosts.length ? null : signOnWall(b, probe);
    if (wrong) say(b, wrong);
    // clear of the windows and the door of its wall
    let whole = false;
    let over = "";
    for (const w of hosts) {
      const s = (b.cx - w.ax) * w.tx + (b.cz - w.az) * w.tz;
      const hu = b.hu * Math.abs(b.ux * w.tx + b.uz * w.tz) + b.hn * Math.abs(b.nx * w.tx + b.nz * w.tz);
      for (const o of w.open) {
        if (!over && s - hu < o.s1 && o.s0 < s + hu && b.y0 < o.y1 && o.y0 < b.y1) {
          over = `over a ${o.what} (${o.s0.toFixed(2)}-${o.s1.toFixed(2)} m along, ${o.y0.toFixed(2)}-${o.y1.toFixed(2)} m up)`;
        }
      }
      if (s - hu >= -0.01 && s + hu <= w.L + 0.01) whole = true;
    }
    if (over) say(b, over);
    if (!hosts.length) {
      if (b.kind !== "door sign" && !quay) say(b, "on no house wall");
    } else if (!whole) say(b, "not wholly on one house's wall");
    // clear of every other thing on the walls
    const gx = Math.floor(b.cx / 8), gz = Math.floor(b.cz / 8);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        for (const o of grid.get(`${gx + i},${gz + j}`) ?? []) {
          if (o === b || !boxesOverlap(b, o, 0.005)) continue;
          const ia = index.get(b)!, ib = index.get(o)!;
          const key = ia < ib ? `${ia}/${ib}` : `${ib}/${ia}`;
          if (seenPair.has(key)) continue;
          seenPair.add(key);
          say(b, `overlaps ${label(o)}`);
        }
      }
    }
  }
  const byKind: Record<string, number> = {};
  for (const b of items) byKind[b.kind] = (byKind[b.kind] ?? 0) + 1;
  const byProblem: Record<string, number> = {};
  for (const p of problems) {
    const k = `${p.kind}: ${p.problem.replace(/ \(.*$/, "").replace(/overlaps (\S+ ?\S*).*/, "overlaps $1")}`;
    byProblem[k] = (byProblem[k] ?? 0) + 1;
  }
  return {
    things: items.length,
    checked: flat.length,
    byKind,
    problems: problems.length,
    byProblem,
    list: problems,
    ms: { probe: Math.round(tProbe), check: Math.round(performance.now() - t0 - tProbe) },
  };
}
