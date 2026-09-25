import INWORLD from "../../../shared/inworld_houses.json" with { type: "json" };

// Houses kept for one use (2026-09-26, the save audit town/audit.ts): the houses whose insides stand
// in the world (shared/inworld_houses.json: the taverns, the Poesje, the homes to let). The client
// draws their rooms in that house, by id; the door Jef uses is the one the town gave the tavern or
// home. So no household or shop moves into them first: each is taken only by its own tavern, the
// Poesje or its home to let.

const ENTRIES = (INWORLD as { houses: Array<{ id: string; house: number }> }).houses;

/** Every in-world house number. */
export const INWORLD_HOUSES: ReadonlySet<number> = new Set(ENTRIES.map((e) => e.house));

/** The in-world house of this id ("tavern:vliet", "poesje", "home:garret"), if it has one. */
export function inworldHouse(id: string): number | undefined {
  return ENTRIES.find((e) => e.id === id)?.house;
}
