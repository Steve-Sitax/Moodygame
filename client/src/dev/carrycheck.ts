import { HAUL_PILE_N, HAUL_ROUTES, haulPileSpot, haulRouteOf } from "../../../shared/hauls";
import type { Town } from "../game/town";

// The carrying check (Steve 2026-09-27: "workers getting items from a crane but no items were on the ground, and
// they drop it off in the middle of the street and the goods disappear; make sure that happens nowhere"). Every
// docker of the town on a route of shared/hauls.ts; at each route's start its own pile of shared goods lying there
// now (and no heap of the quay's on it); at its end a door in a wall, a pile, or a fish bank. Must list nothing.
//
// Dev: `await __scheldemist.carrycheck()`.

export interface CarryDeps {
  town: Town;
  /** The quay's heaps as placed (world/quaygoods.ts quayGoodsInfo), "(gone)" ones marked so. */
  quayPiles(): Array<{ kind: string; x: number; z: number; w: number; d: number }>;
  /** The walk map's flags at a point (1: a wall). */
  flags(x: number, z: number): number | undefined;
}

export async function carryCheck(d: CarryDeps): Promise<{ routes: number; workers: number; problems: string[] }> {
  const problems: string[] = [];
  const goods = ((await fetch("/api/goods").then((r) => r.json()).catch(() => ({ items: [] }))) as { items?: Array<{ id: string; x: number; z: number; by: unknown }> }).items ?? [];
  const piles = d.quayPiles().filter((p) => !p.kind.startsWith("(gone)"));
  const quayPileAt = (x: number, z: number, reach: number) => piles.some((p) => Math.abs(p.x - x) < p.w / 2 + reach && Math.abs(p.z - z) < p.d / 2 + reach);
  // the workers
  let workers = 0;
  for (const s of d.town.netSims()) {
    const w = s.r.work;
    if (w.kind !== "haul" || !w.a || !w.b || w.place.startsWith("mill") || w.place.startsWith("wall")) continue;
    workers++;
    const r = haulRouteOf(w.a, w.b, 0.5);
    if (!r) problems.push(`${s.r.name} (${w.place}): carries between (${w.a}) and (${w.b}), no route of shared/hauls.ts`);
  }
  for (const r of HAUL_ROUTES) {
    // the start: beside a pile
    // (D1 docks: the dockers carry the pile off for real and the crane and the boats bring more; an empty pile is work
    // waiting, so what is checked is that its places lie on open ground and nothing of it lies astray)
    for (let i = 0; i < HAUL_PILE_N; i++) {
      const [x, z] = haulPileSpot(r.pile, i, r.a);
      if (d.flags(x, z) === 1) problems.push(`${r.id}: its pile's place ${i} is in a wall`);
    }
    for (const g of goods) if (g.id.startsWith(`haul:${r.id}a:`) && !g.by && Math.hypot(g.x - r.pile.x, g.z - r.pile.z) > 2) problems.push(`${r.id}: ${g.id} lies ${Math.hypot(g.x - r.pile.x, g.z - r.pile.z).toFixed(1)} m from its pile`);
    if (Math.hypot(r.pile.x - r.a[0], r.pile.z - r.a[1]) > 2.2) problems.push(`${r.id}: the start stands ${Math.hypot(r.pile.x - r.a[0], r.pile.z - r.a[1]).toFixed(1)} m from its pile`);
    // (a heap of the quay's on the route's own pile would stand in it)
    if (quayPileAt(r.pile.x, r.pile.z, 0.2)) problems.push(`${r.id}: a heap of the quay's stands on its own pile`);
    // the end
    if (r.into === "door") {
      if (!r.door) problems.push(`${r.id}: into a door, but no door`);
      else if (d.flags(r.door[0], r.door[1]) !== 1 && d.flags(r.door[0] + (r.door[0] - r.b[0]) * 0.8, r.door[1] + (r.door[1] - r.b[1]) * 0.8) !== 1)
        problems.push(`${r.id}: the door (${r.door}) is not in a wall`);
      else if (Math.hypot(r.door[0] - r.b[0], r.door[1] - r.b[1]) > 1.6) problems.push(`${r.id}: the end is ${Math.hypot(r.door[0] - r.b[0], r.door[1] - r.b[1]).toFixed(1)} m from its door`);
    } else if (r.into === "pile") {
      const dp = r.drop;
      if (!dp) problems.push(`${r.id}: onto a pile, but none`);
      else if (Math.hypot(dp.x - r.b[0], dp.z - r.b[1]) > 3.2) problems.push(`${r.id}: the end stands ${Math.hypot(dp.x - r.b[0], dp.z - r.b[1]).toFixed(1)} m from its pile`);
    }
  }
  return { routes: HAUL_ROUTES.length, workers, problems };
}
