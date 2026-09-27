import type { DB } from "../db.ts";
import { haulRouteOf } from "../../../shared/hauls.ts";
import type { Resident } from "./population.ts";
import { dropTownCache } from "./store.ts";

// The dockers of an older save onto the carrying routes of shared/hauls.ts (Steve 2026-09-27: loads from nowhere,
// dropped in the street): each haul worker whose ends are a route's old ones (or its new ones already) gets the
// route's ends. In place, on every load (a no-op once done); the mills' men and the wall's navvies keep their own.

export function rerouteHauls(db: DB): number {
  const rows = db.prepare("SELECT id, data_json FROM resident").all() as Array<{ id: string; data_json: string }>;
  const upd = db.prepare("UPDATE resident SET data_json = ? WHERE id = ?");
  let n = 0;
  db.transaction(() => {
    for (const row of rows) {
      const r = JSON.parse(row.data_json) as Resident;
      const w = r.work;
      if (w.kind !== "haul" || !w.a || !w.b) continue;
      const route = haulRouteOf(w.a, w.b);
      if (!route) continue;
      if (w.a[0] === route.a[0] && w.a[1] === route.a[1] && w.b[0] === route.b[0] && w.b[1] === route.b[1]) continue;
      w.a = [route.a[0], route.a[1]];
      w.b = [route.b[0], route.b[1]];
      upd.run(JSON.stringify(r), row.id);
      n++;
    }
  })();
  if (n) dropTownCache(db);
  return n;
}
