import { expect } from "vitest";
import type { Resident } from "../src/town/population.ts";
import { homeLost, homeStands } from "../src/town/store.ts";
import { houseDoors, walkMap } from "../src/town/walkmap.ts";

/**
 * The old-save tests (lively, transport): a save made on an older city map holds homes whose house has no door
 * at the saved step in the current city (stale). The load repairs may move those, and only those: store.ts
 * rehomeLost (no path to the step, or the house pulled down: it must move them) and emigrants.ts
 * rehouseEmigrants (the Logement, its keeper and lodgers, the runner). `staleIds` names them; `plainHome` drops
 * what the repairs own (the home, a work door at the old step, the Logement keeper's post) from such a
 * resident's JSON; `checkRehomed` checks what the repairs did to them.
 */
export function staleIds(before: Map<string, string>): Set<string> {
  return new Set([...before].filter(([, j]) => { const h = (JSON.parse(j) as Resident).home; return h.house >= 0 && !homeStands(h); }).map(([id]) => id));
}

export function plainHome(o: Record<string, unknown>, beforeJson: string): void {
  const b = JSON.parse(beforeJson) as Resident;
  delete o.home;
  const w = o.work as { door?: [number, number]; at?: unknown; place?: string } | undefined;
  if (w && b.work.door && Math.hypot(b.work.door[0] - b.home.sx, b.work.door[1] - b.home.sz) < 0.5) delete w.door;
  // the Logement's keeper: the Logement's own repair moves her post with the house
  if (w && w.place === "logement") delete w.at;
}

export function checkRehomed(before: Map<string, string>, after: Array<{ id: string; data_json: string }>, stale: Set<string>): void {
  const doors = houseDoors();
  const wm = walkMap();
  const now = new Map(after.map((r) => [r.id, JSON.parse(r.data_json) as Resident]));
  const byOldStep = new Map<string, number>();
  for (const id of stale) {
    const old = (JSON.parse(before.get(id)!) as Resident).home;
    const r = now.get(id)!;
    const moved = JSON.stringify(r.home) !== JSON.stringify(old);
    // a lost home (no path to its step, or its house pulled down) must move
    if (homeLost(old)) expect(moved, `${id} lost home kept`).toBe(true);
    if (!moved) continue;
    // a moved home: a door of the current city, its step on reachable ground
    const d = doors.find((q) => q.house === r.home.house);
    expect(d, id).toBeTruthy();
    expect(Math.hypot(d!.sx - r.home.sx, d!.sz - r.home.sz), id).toBeLessThan(1);
    expect(wm.reachable(r.home.sx, r.home.sz), id).toBe(true);
    if (r.work.place === "logement" && r.work.at) expect(Math.hypot(r.work.at[0] - r.home.sx, r.work.at[1] - r.home.sz), id).toBeLessThan(1.5);
    // everyone who lived at one old step moves to the same new house
    const key = `${old.sx},${old.sz}`;
    if (byOldStep.has(key)) expect(r.home.house, id).toBe(byOldStep.get(key));
    else byOldStep.set(key, r.home.house);
  }
}
