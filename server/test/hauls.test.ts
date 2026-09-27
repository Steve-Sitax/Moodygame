import { describe, expect, it } from "vitest";
import { HAUL_ROUTES, haulRouteOf } from "../../shared/hauls.ts";
import { townGoods } from "../../shared/goods.ts";
import { rerouteHauls } from "../src/town/hauls.ts";
import { town } from "../src/town/store.ts";
import { houseDoors, walkMap } from "../src/town/walkmap.ts";
import { wayBetween } from "../src/town/ways.ts";
import { blankSave } from "./blank-save.ts";

// The dockers' carrying routes (shared/hauls.ts, Steve 2026-09-27: loads from nowhere, dropped in the street).

describe("carrying routes", () => {
  it("each goes from a spot a body stands on to a real door's step (or a pile, or a fish bank), with a way between", () => {
    const wm = walkMap();
    const doors = houseDoors({ stores: true });
    for (const r of HAUL_ROUTES) {
      // exactly on ground a body reaches (a new town snaps a point that is not, and loses the route)
      expect(wm.reachable(r.a[0], r.a[1]), `${r.id} start (${r.a})`).toBe(true);
      expect(wm.reachable(r.b[0], r.b[1]), `${r.id} end (${r.b})`).toBe(true);
      expect(wayBetween(r.a[0], r.a[1], r.b[0], r.b[1]), `${r.id} way`).toBeTruthy();
      if (r.into === "door") {
        const d = doors.find((q) => Math.hypot(q.sx - r.b[0], q.sz - r.b[1]) < 0.2);
        expect(d, `${r.id}: its end is a door's step`).toBeTruthy();
        expect(Math.hypot(d!.x - r.door![0], d!.z - r.door![1]), `${r.id}: its door`).toBeLessThan(0.2);
      }
      expect(Math.hypot(r.pile.x - r.a[0], r.pile.z - r.a[1]), `${r.id}: beside its pile`).toBeLessThan(2.2);
      // at least a few metres to carry
      expect(Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]), `${r.id} length`).toBeGreaterThan(4);
    }
  });

  it("the town lays out each route's own pile, five of a kind, stacked", () => {
    const items = townGoods({});
    for (const r of HAUL_ROUTES) {
      expect(items.filter((i) => i.id.startsWith(`haul:${r.id}a:`) && i.kind === r.pile.kind).length, r.id).toBe(5);
      if (r.drop) expect(items.filter((i) => i.id.startsWith(`haul:${r.id}b:`)).length, r.id).toBe(5);
      // none on the spot where the docker stands to take up or set down
      for (const i of items.filter((q) => q.id.startsWith(`haul:${r.id}`))) {
        const stand = i.id.startsWith(`haul:${r.id}a:`) ? r.a : r.b;
        expect(Math.hypot(i.x - stand[0], i.z - stand[1]), `${i.id} off the stand`).toBeGreaterThan(0.8);
      }
    }
  });

  it("a town's dockers all walk a route; an older save's are moved onto them, once", () => {
    const db = blankSave();
    // as an older save had them: every docker back on his route's old ends
    const rows = db.prepare("SELECT id, data_json FROM resident").all() as Array<{ id: string; data_json: string }>;
    let old = 0;
    for (const row of rows) {
      const r = JSON.parse(row.data_json) as { work: { kind: string; a?: [number, number]; b?: [number, number] } };
      const route = r.work.kind === "haul" ? haulRouteOf(r.work.a, r.work.b) : null;
      if (!route) continue;
      r.work.a = route.was[0];
      r.work.b = route.was[1];
      db.prepare("UPDATE resident SET data_json = ? WHERE id = ?").run(JSON.stringify(r), row.id);
      old++;
    }
    expect(old).toBeGreaterThan(20);
    expect(rerouteHauls(db)).toBe(old);
    expect(rerouteHauls(db)).toBe(0);
    for (const r of town(db).town.residents) {
      const w = r.work;
      if (w.kind !== "haul" || w.place.startsWith("mill") || w.place.startsWith("wall")) continue;
      const route = haulRouteOf(w.a, w.b, 0.01);
      expect(route, `${r.id} ${w.place} (${w.a}) (${w.b})`).toBeTruthy();
    }
  });
});
