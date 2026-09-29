import type { DB } from "../db.ts";
import { pid } from "../player/current.ts";
import { GANG_CAFE, GANG_CAFE_TRUST } from "../../../shared/neighbourhoodCafes.ts";

export function tavernWelcome(db: DB, place: string): boolean {
  if (place !== GANG_CAFE) return true;
  const r = db.prepare("SELECT trust FROM faction_trust WHERE faction='smokkelaars' AND player_id=?").get(pid()) as { trust: number } | undefined;
  return (r?.trust ?? 0) >= GANG_CAFE_TRUST;
}
