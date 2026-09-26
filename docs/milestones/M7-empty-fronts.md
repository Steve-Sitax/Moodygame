# M7 - Empty fronts, 2026-09-26

Why: Steve, 2026-09-26, a night picture of the Rijnkaai: the house right of the bakery had an open doorway into a grey void and a dark window. "Empty glitchy shop here next to the bakery. Make something useful of it." Also open from M7 shops: the grocer by the Werf has no inside.

## The cause
- `shared/inworld_houses.json` lists 28 houses whose insides stand in the world. `tools/city/inworld.mts` writes `shared/inworld_build.json`, and `build_city.py` cuts every listed house open in `city.glb`: the door has no leaf and the windows have no painted glass. It does this for every save.
- The client builds the room only when the house's own use has its door at that house (`game/interiors.ts` buildShops, `game/homes.ts`). No room means no leaf, no lining and no panes: the doorway and the windows show whatever lies behind the facade.
- Steve's save is older than the shop list. When the M7 shops came in (`server/src/shops/town.ts`), four listed houses were someone's already, so four new shops took other doors:

| Listed for | House | Who had it in Steve's save | Where the shop went |
|---|---|---|---|
| barber_lane | 778, next to the bakery on the Rijnkaai (Steve's spot) | the Logement, the emigrants' lodging house (keeper and 9 emigrants) | a house at 6.0, 122.5 |
| colonial_steen | 912, next to the bakery by the Steenplein | Leonard Van Dessel, attendant at the Steen | 9 m up the street |
| hatter_markt | 45, behind the Grote Markt | Gust Laureys, concierge of the town hall | 20 m away |
| roaster_canal | 820, by the canal | Staf Verbiest, the emigrants' ticket runner | 39 m away |

## What each became
Each house gets the shop it was designed for, with the room the M7 shops pass built for it at the house's true size: the counter and keeper, shelves, the window display, lamps, the board over the door and the bracket sign.
- **778 is the barber's.** A shave costs 3 c and a haircut 6 c. It opens 7:00 to 12:00 and 13:00 to 20:00, and on Sunday 7:00 to 10:00. The Logement and its people moved to house 764, on the Rijnkaai by the emigrant berth, 1.5 m from its anchor. The pick is the emigrants' own (`pickLogement`). No free house was left there, so it shares the house.
- **912 is the colonial goods shop**, next to the Steenplein bakery. Leonard moved to the nearest free house.
- **45 is the hatter's.** Gust moved to the nearest free house.
- **820 is the coffee roaster's.** The runner moved by the emigrants' own rule (`pickRunnerHome`).
- **At night** a shut shop puts its shutters up (`client/src/world/shopShutters.ts`). Each window cut in a shop's front gets upright planks, two battens and an iron bar, 3 mm to 5 cm out from the face. They are in the street's scene, so the room's pass never draws over them.
  - From inside, a plank face on the room's side shows dark boards with the day's light in the chinks. The chinks dim at night.
  - The boards are up while the shop is shut, except in the midday break (11:30 to 14:30). So they are up at night and on Sunday.
  - They use the door leaf's shader, and the room's side uses a plain map material. No light is added.
- **The door's transom** (`world/houseInWorld.ts`, one line) no longer glows grey at night. The unlit glass takes the sky's light: 6 % at night, full by day.

## The fix of the cause
- **Server, on every start** (`db.ts` order: emigrants, then shops):
  - `town/emigrants.ts`: `freeDoors` never offers a listed house. The Logement or the runner found in a listed house moves out as a stale one does (`rehouseEmigrants`). Only the Logement's own people go: its keeper, the emigrant households and whoever works at the Logement.
  - `shops/town.ts` `moveIntoOwnHouse` (step 3 of `ensureShopsTown`): a shop whose listed house is not its door moves in. It does not move when a shop, a town place, somebody's workplace or another record (post office, velocipede maker, wheelwright, Logement, homes to let, Poesje) uses that door. The households living there move to the nearest free house that is not listed, keeping `town/kept.ts` and the audit's "shop taken" rule. A new shop's keeper moves with his shop, and an old shop's family keeps its home. Running it again does nothing.
- **Client, the net** (`client/src/world/emptyFronts.ts`): once the shops, taverns, the Poesje and the homes have their first answer from the server, any listed house still without a room gets its own kind of room, shut. The door has its leaf, the lamps are out, and a shop has its shutters. A shop that turns up later leaves the stand-in be. The console says `[fronts] <id> ...`.
- **The check**:
  - `__scheldemist.emptyfronts()` lists every cut house, who built its room (own, stand-in, none), its windows and its shutters, and walks the 24 hours.
  - `problems` must be empty. A problem is any of these:
    - a listed or cut house with no plan or no room;
    - a house cut in `inworld_build.json` but missing from the list;
    - a shop room whose windows have no shutters.
  - **Server test** `server/test/fronts.test.ts`, 3 tests:
    - a new town has every listed shop at its house and no listed house taken by another use (the audit's kept-house findings are empty);
    - an older save with the Logement in the barber's house and a lodger in the colonial goods shop's house is repaired. The shops move in, the Logement's people and the lodger move out, the keepers live above their shops, the audit is clean, and a second run moves nothing;
    - a shop never moves onto another place's door.

## Checks (2026-09-26, test stack `fronts`, a copy of Steve's save)
- The migration on the copy: all 17 listed shops stand at their houses, and the audit finds nothing (as before).
- `emptyfronts()`: 28 fronts, 28 rooms, 0 stand-ins, `problems: []`. At 21:00 all 17 shops have their shutters up. At 10:00 on Sunday 16 are up and the apothecary's are down (it opens 9:30 to 11).
- The net, forced in the tab: the barber's, the widow's and Het Schipke's rooms were taken out of the drawing and the net was run on a fresh copy of its module. It built a shut shop, home and tavern room in those houses, with shutters on the shop. Pictures `standin_*`.
- `paths()` at 10:00 and at 21:00: `[]`. `signs()`: 0 problems (17 shop boards, 11 brackets). `posters()`: 0. `stallcheck()` on a market day at 10:00: 0 problems. `shaders()`: `problems: []`.
- `zfight()` at 21:00, all 17 shops' shutters up (7.5 min on a loaded machine):
  - The rooms add only the two hidden back-to-back faces that every in-world house has.
  - The shutters lie over no house face. They have one fight: 3 small faces (0.08 m2) against a covered shop table by the roaster's, all hidden.
  - Their battens and bar stand 2.5 cm proud of the planks: "close" layers, as the door leaf's panels are.
  - Their thin layers (445 pairs, 6.9 m2) are all hidden.
  - A first build with a backing board over the wall's face gave 16 visible fights; that board is gone.
- Clean export (`git archive HEAD` plus this patch):
  - `npm run build` passes.
  - `npx vitest run` in server passes 949 of 955, including `fronts.test.ts`, `shops.test.ts` and `emigrants.test.ts`.
  - The 6 failures are timeouts while other helpers' stacks ran: ai-setup, router and four hostile-lines loops. Each passes when run alone, and the unpatched HEAD shows the same timeouts under load.

## Pictures (PNG, the helper's scratch folder `fronts/`)
- **Midday, weekday 11:00**: `{barber,colonial,hatter,roaster}_day_{out,win,in}`. Steve's spot is `barber_day_out`, with the bakery on the left.
- **Sunday 10:00, shutters up by day**: `{colonial,roaster}_sunday_{out,win,inwin}`.
- **Night 21:00**: `{barber,colonial,hatter,roaster}_night_{out,win,inwin}`.
- **Contact sheet**: `contact_sheet.png`.

## What is left
- **grocer_werf** still has no inside. Its house (41) is 1 m deep behind the door. Giving it one means listing another house by the Werf and rebuilding `city.glb`.
- **The barber at 778**: in Steve's save the Logement shares house 764 with a household. That is the emigrants' own fallback when no free house faces the berth.
- **Night**: shut shops are dark behind their shutters. There is no lit back room.
