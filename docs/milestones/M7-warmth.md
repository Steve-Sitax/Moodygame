# M7 warmth: indoors and with a lantern, 2026-09-26

Why: Steve asked: "does warmth go up in a cafe? With a lantern our warmth should go down slower." Before this,
being indoors changed nothing, a tavern warmed you only when you pressed E at its fire, and the lantern did
nothing for the cold.

## The rules (engine, `server/src/day.ts` applyHour, numbers in `WARMTH`)
| Where Jef is | Warmth by day (7:00 to 20:00) | At night (20:00 to 7:00) |
|---|---|---|
| Outside on foot | -1 every 5 h | -1 every 3 h |
| Outside, a lit lantern in his hand, dry | -1 every 6 h | -1 every 4 h |
| Outside, lantern lit but wet (rain, a gale, or a swim less than two game hours ago) | -1 every 5 h | -1 every 3 h |
| A heated room: an open tavern or cafe (its fire burns while the keeper is at work), the Poesje while its door is open, an open shop with a stove, his own room with a hearth or a stove | no loss; +1 every 2 h up to 7 | the same |
| A big room with no heat, out of the wind: the cathedral, the Carolus, St Paul's and St James's, a landmark hall, the prison in visiting hours, the butcher's, the grocer's, the chandler's, his own room with no stove | -1 every 10 h | -1 every 6 h |
| The omnibus, a rowing boat | as before (their own server records come first) | as before |

- The fire (E in a tavern) and the stove at home still give their +1 once a game hour, up to 10. The room alone
  stops at 7: to get really warm you sit at the fire.
- A swim still costs 1 at once (as before), and makes the coat wet for two game hours.
- Shops with no stove for the customers: the butcher keeps his meat cold, the grocer's front stands open, and
  nobody lights a fire among the chandler's tar and lamp oil (`COLD_SHOPS` in `warmth.ts`).
- The lantern burns no fuel yet (it did not before either).

Why these numbers: a night outside (the ticks from 21:00 to 6:00) costs 4 warmth on foot and 2 with a lantern;
it still takes a man from 4 to 0 without a lantern, and 0 warmth costs health every 3 hours. The lantern helps
but does not save you, and not in the rain. A cafe is a real refuge: no loss at all, and back from 2 to 4 in
four hours by the room alone, to 10 at the fire. A church or a hall is only out of the wind.

## Where Jef is (`server/src/warmth.ts`, the tick route, `client/src/game/day.ts`)
- With each `POST /api/tick` the client sends `where: { at, lantern }`: `at` is a room (`tavern:<id>`,
  `poesje`, `shop:<id>`, `home:<id>`, `landmark:<id>`, `church:carolus`, `church:gothic`, `prison`) or null
  outside; `lantern` is whether the lantern is lit in his hand (`deeds.lantern.lit`). `main.ts` builds it from
  the interiors, the landmarks, the churches and the prison.
- The server believes only what it can check: a room that exists and is open now (the tavern's and the shop's
  keeper at work, the Poesje's hours, his own lease, the landmark's hours, the churches' six to seven, the
  prison's visiting hours), and a lantern in his pockets. A room that does not exist or is shut, a lantern he
  does not have, or anything that does not parse counts as outside. A report is good for 25 real seconds
  (two and a half ticks); older, he is outside. It is kept by player id (multiplayer later).
- The client also sends a tick at once when the report changes (through a door, the lantern up or down), so the
  server knows within a second; the server's tick limit still holds, so the clock does not run faster.
- The reply says what the server believes (`where: { shelter, place, label, lantern }`); `jobs.day.whereNow`.

## Telling the player
- The warmth warnings say it: "You are cold to the bone. A warm room, a bed or a nip of jenever warms you; a
  lantern or a roof slows the cold." and "You are freezing. Get into a warm room, a tavern or a shop with a
  stove, or you will fall ill."
- Coming into a heated room, once per visit, four seconds after the door (the room's own line first): "The
  warmth of the fire gets into your coat." (a tavern, the Poesje) or "The warmth of the stove gets into your
  coat." (a shop, his room).

## Checks (2026-09-26)
- `server/test/warmth.test.ts`: 17 tests: outside as before; the lantern by day and night; a lantern he does not
  have; wet (rain, storm, after a swim); a stale report; the open tavern (gain to 7, no loss, the fire to 10);
  four hours in a cafe; a shut tavern, one that does not exist, garbage reports; the Poesje; heated, cold and
  shut shops; his own room with and without a stove, someone else's room; the cathedral open and shut; the
  churches and the prison; a lantern indoors; the tick route; the numbers; the clamps 0..10.
- In the browser on a test stack (`teststack.mjs start warmth --server 8979 --vite 5379`), each hour driven
  through the real `/api/tick` with the client's own report (dev/set to hh:55, then `jobs.day.tick()`):

| Where | Hours | Warmth | The server believed |
|---|---|---|---|
| Vismarkt, no lantern | 20:00 to 6:00 | 8 to 4 | outside |
| Vismarkt, lantern lit | 20:00 to 6:00 | 8 to 6 | outside + lantern |
| Vismarkt, no lantern | 9:00 to 16:00 | 6 to 4 | outside |
| Vismarkt, lantern lit | 9:00 to 16:00 | 6 to 5 | outside + lantern |
| In de Ankere | 18:00 to 23:00 | 2 to 4 | heated, In de Ankere |
| In de Ankere, E at the fire | 21:00 | 7 to 8, an hour later still 8, the fire again 9 | heated |
| The cathedral's nave | 9:00 to 16:00 | 6 to 5 | sheltered, the cathedral |
| Forged reports (`tavern:nowhere`, `landmark:cathedral; drop`, a bare string) | 12:00 | | outside |

  The warm line showed in the taproom after the room's own line; the cold warning showed at 2.
