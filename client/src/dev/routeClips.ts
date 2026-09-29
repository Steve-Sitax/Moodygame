import type { World } from "../world/rijnkaai";
import type { Rect } from "../world/geom";
import { inRect } from "../world/geom";
import { trafficLanes, TRAFFIC_ROUTES } from "../world/traffic";
import { WALL } from "../world/city";

/**
 * Dev check (M6 handcart, Steve: "carts and horses do not pass through walls, stalls, lamp posts
 * or each other"): walk every dray and handcart round (world/traffic.ts) and every omnibus round
 * (world/omnibus.ts) and list the places where the body of the rig would touch a wall or a solid
 * thing that stays put (a stall, a lamp post, a pump, a crate stack). The vehicles' own rects and
 * things that come and go with a hand (job goods, parked carts, velocipedes) are left out:
 * the vehicles stop and wait for those. `__scheldemist.routeClips()` in dev; it should list nothing.
 */
export function routeClips(world: World, skip: Rect[]): Array<{ route: string; x: number; z: number; what: string }> {
  const own = new Set<Rect>(skip);
  const tr = world.traffic();
  const rail = world.railway();
  const bus = world.omnibus();
  for (const r of [...(tr?.colliders() ?? []), ...(rail?.colliders() ?? []), ...(bus?.colliders() ?? [])]) own.add(r);
  const solids = world.solids().filter((r) => !own.has(r) && (r.top === undefined || r.top > 0.3));
  const out: Array<{ route: string; x: number; z: number; what: string }> = [];
  const seen = new Set<string>();
  const hit = (route: string, x: number, z: number, body: number) => {
    const key = `${route}:${Math.round(x / 3)}:${Math.round(z / 3)}`;
    if (seen.has(key)) return;
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const f = world.city.flags(x + Math.cos(a) * body, z + Math.sin(a) * body);
      if (f !== undefined && (f & WALL) !== 0) {
        seen.add(key);
        out.push({ route, x: +x.toFixed(1), z: +z.toFixed(1), what: "a wall" });
        return;
      }
    }
    for (const r of solids) {
      // the body as a round, not a box: a lamp post at the corner of the box is not in the way
      const dx = Math.max(r.minX - x, 0, x - r.maxX);
      const dz = Math.max(r.minZ - z, 0, z - r.maxZ);
      if (inRect(r, x, z, body) && Math.hypot(dx, dz) < body && (!r.surface || r.surface.blocks(x, z, body, 0, 0.36))) {
        seen.add(key);
        out.push({ route, x: +x.toFixed(1), z: +z.toFixed(1), what: `a solid at ${((r.minX + r.maxX) / 2).toFixed(1)}, ${((r.minZ + r.maxZ) / 2).toFixed(1)} (${(r.maxX - r.minX).toFixed(1)} x ${(r.maxZ - r.minZ).toFixed(1)} m)` });
        return;
      }
    }
  };
  // the drays and the handcarts: their lanes as they drive them (a dray is 1.9 m wide, a handcart 1.4 m)
  trafficLanes().forEach((lane, i) => {
    const name = TRAFFIC_ROUTES[i]?.name ?? `round ${i}`;
    const body = lane.half >= 1.9 ? 0.95 : 0.7;
    for (let k = 0; k < lane.x.length; k += 4) hit(name, lane.x[k], lane.z[k], body);
  });
  // The whole omnibus, including the horses and the tail cutting across bends. Ignore other
  // moving rigs: a traffic queue is not a permanent route obstruction. Model bounds alone
  // are not solids (in particular, the Werf's tree crowns leave the road clear underneath).
  const fixedFree = (x: number, z: number): boolean => {
    const f = world.city.flags(x, z);
    if (f === undefined || f !== 0) return false;
    return !solids.some((r) => inRect(r, x, z) && (!r.surface || r.surface.blocks(x, z, 0, 0, 0.36)));
  };
  for (const h of bus?.sweep(fixedFree) ?? []) out.push({ route: `omnibus ${h.line}`, x: h.x, z: h.z, what: h.what });
  return out;
}
