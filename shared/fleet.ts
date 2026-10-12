import FLEET from "./fleet.json" with { type: "json" };

export interface Vessel {
  id: string;
  kind: string;
  name: string | null;
  port: string | null;
  style: string | null;
  of?: string;
  where: { how: string; at?: number[]; seed?: number; slot?: number; [key: string]: unknown };
}
export const vessels: Vessel[] = FLEET.vessels;
export const vessel = (id: string): Vessel => {
  const v = vessels.find((v) => v.id === id);
  if (!v) throw new Error(`unknown vessel ${id}`);
  return v;
};
export const shipName = (id: string): string => vessel(id).name!;
export const shipType = (kind: string): string => ({ steamer_line: "steamer", barque_grain: "barque", barque_sail: "barque", liner: "liner" })[kind] ?? kind.replaceAll("_", " ");

/** One identity per copy. Exact placing keys win; spare names never borrow another hull's identity. */
export class FleetNames {
  private used = new Set<string>();
  take(kind: string, how: string, x = 0, z = 0, seed?: number, slot?: number): Vessel {
    const candidates = vessels.filter((v) => v.kind === kind && v.where.how === how && !this.used.has(v.id));
    let v = seed === undefined ? undefined : candidates.find((v) => v.where.seed === seed && v.where.slot === slot);
    if (!v && seed === undefined) {
      candidates.sort((a, b) => this.distance(a, x, z) - this.distance(b, x, z));
      v = candidates[0];
    }
    if (!v) {
      const family = (FLEET.family as Record<string, string>)[kind] ?? kind;
      const own = (FLEET.spare as Record<string, string[]>)[family];
      const names = own?.length ? own : FLEET.spare.small;
      const name = names.find((n) => !this.used.has(`spare:${n}`));
      if (!name) throw new Error(`no spare hull name for ${kind}`);
      const details = (FLEET.spare_details as Record<string, { port: string; style: string }>)[name];
      v = { id: `spare:${name}`, kind, name, port: details.port, style: details.style, where: { how: "spare" } };
    }
    this.used.add(v.id);
    return v;
  }
  byId(id: string): Vessel { const v = vessel(id); this.used.add(id); return v; }
  private distance(v: Vessel, x: number, z: number): number {
    const at = v.where.at;
    return at ? (at[0] - x) ** 2 + (at[1] - z) ** 2 : 1e12;
  }
}
