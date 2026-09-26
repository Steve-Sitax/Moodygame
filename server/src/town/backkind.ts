// The kinds of place of a back-of-town day (M7 back of town, backtown.ts). Pure code, no imports:
// the client bundles this file (game/backlife.ts) to know what a place of the day is by its id.

export type BackPlaceKind = "pump" | "corner" | "cards" | "gossip" | "step" | "play" | "park" | "walk" | "lanes" | "knot" | "lovers" | "church" | "kroeg" | "watch" | "drunk" | "round";

/** What kind of back-of-town place this id is (its prefix), or null. */
export function backKind(place: string): BackPlaceKind | null {
  if (place === "park" || place === "walk") return place;
  const k = place.split(":")[0];
  if (k === "play") return place.startsWith("play:bk") ? "play" : null;
  if (k === "visits") return "round"; // the rounds of the sick (the parish priests, the doctor)
  return (["pump", "corner", "cards", "gossip", "step", "lanes", "knot", "lovers", "church", "kroeg", "watch", "drunk"] as const).find((x) => x === k) ?? null;
}
