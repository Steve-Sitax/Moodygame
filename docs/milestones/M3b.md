# M3b - Paths, paying, pockets, 2026-09-23

Why: after playing M3, Steve could not reach the mate on the ship with the parcel ("always make sure there is a path"), could not pay Fientje for fish, and wanted pockets for small things and a way to eat.

## What is in
| Part | Where | Notes |
|---|---|---|
| Walkable gangway and deck | `client/src/world/rijnkaai.ts` | The gangway is a slope from the quay (z 0.8) to the Anna Maria's deck (y 2.4). The deck is walkable, with the deckhouse and a mast in the way; a gap in the rail lets you on. Goods cannot be set down on the gangway or the deck. |
| Mate on deck | `runs.ts` | A delivery to the ship: the mate waits on deck at the top of the gangway. The sailor stands further along. |
| Path check | `world.reachFrom()`, dev hook `__scheldemist.paths()` | Flood fill on a 0.5 m grid from the start, with slopes and colliders. Lists every job spot, person, the board and the mate's spot that cannot be reached. New project rule in CLAUDE.md: it must list nothing before a milestone ends. |
| Wares and prices | `server/src/trade.ts` | Engine prices. Fientje: salt herring 5 c, smoked eel 12 c. Widow Peeters: ship's biscuit 4 c. Tuur: a nip of jenever 10 c (drunk on the spot: warmth +2, health -1). Sellers know their wares and prices in talk. The seller remembers each sale. |
| Paying | talk window **B**, or **F** next to a seller | The wares list; a number key pays. Refused when money is short or pockets are full. |
| Pockets | `client/src/game/pockets.ts`, `item` table | Six slots, always in view bottom right, with drawn icons. **I** opens them; a number key eats or drinks. Pockets are server state. |
| Needs on screen | HUD | Five loaves (belly) and five flames (warmth), drawn, next to the money. Eating herring +2, eel +4, biscuit +2 (0-10). Needs do not fall yet: that is the M5 day loop. |
| Parcel in the pocket | deliver jobs | The employer hands the parcel over (F); it goes into a pocket, not your hands. Give it to the recipient (E), or sell it to the stranger (F). It leaves the pocket when the job ends. Bigger deliver goods (a sack) are still carried in the hands. |

## Checks done (2026-09-23)
- `npm test`: 34 of 34. New: price taken and item in pocket, refused on short money or wrong seller, six-slot limit, eating clamps at 10, drink taken on the spot, parcel once per job, cannot be eaten, leaves when the job ends.
- Path check in the browser: lists nothing.
- In the browser, by script, sound off: walked up the gangway onto the deck (stood at 2.4 m), walked the deck, stopped at the far rail. F at Fientje opened her wares; paid 5 c for a herring; ate it from the pockets (belly 6 to 8). Took the widow's parcel job: she handed the parcel over, it went into a pocket, walked up the gangway, gave it to the mate on deck, paid 55 c, pocket empty.
- `npm run build` passes.
- Note: these checks ran on Steve's own save. They added a herring bought and eaten and one parcel job done (+55 c).
