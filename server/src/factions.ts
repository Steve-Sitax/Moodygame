// The five factions (docs/01). In a file of their own with no imports, so every module can
// read them at load time: db.ts pulls in many town modules, and a cycle back through db.ts
// would leave the list undefined while npcs.ts builds its schema.
export const FACTIONS = ["naties", "kerk", "politie", "smokkelaars", "burgerij"] as const;
export type Faction = (typeof FACTIONS)[number];
