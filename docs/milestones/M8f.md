# M8f: shared goods

Built 2026-09-27 in the worktree `D:\Code\MoodyGame-m8f` (branch `m8f`). Steve saw it with two PCs: the crates,
barrels and sacks you can lift were each PC's own. Owned goods lay at the same spots with a random turn, a lift on
one PC was never seen on another, a job's goods existed only on its holder's PC, and a man carrying a crate showed
empty hands.

## The design, and why

**The server owns the goods** (Steve's change of the first plan). It keeps one list of every liftable item: id,
kind, owner, job, place, turn, what it rests on, who holds it (a player, a townsperson, a cart). A PC only draws that
list and asks. The server checks each request and tells every PC what changed.

| Question | Choice | Why |
|---|---|---|
| How a PC asks | HTTP, `POST /api/goods` (`GET` for the whole list) | Played alone there is no movement socket, and alone and together must be one path. A request already carries the player's token (M8c), and its answer is what the PC needs to keep or undo what it showed. Goods change a few times a minute; the LAN answers in 1-10 ms. |
| How every PC hears | The push channel, `{type: "goods", v, items, gone, why, who}` | Numbered: a PC that misses one (`v` jumps) fetches the whole list. A new week or a load sends the whole list, marked `full`. |
| Feel | Optimistic | His own lift and put down show at once; a refusal puts the item where the server has it ("Someone was quicker."). Alone this feels as before. |
| Ids | `own:<owner>:<n>`, `pile:<pile>:<n>`, `job:<job>:<n>` (made by the server in a fixed order), `spawn:<n>` | The same on every PC and after a reload. |
| Turns | `rotFor(id, n)`: a hash of the id and the put-down count, 0 to 0.4 rad | Never `Math.random`; the same on every PC. The quay's casks keep their old `i * 1.7`, the watch pile its `i * 0.4`. |
| When a player leaves | What he carried is set down **where he last stood** (after the seat's 30 s grace; also a removed guest, a new man on the ferry) | The others saw him carry it there, and his job's crate stays near his work for when he comes back. "Back where it came from" would make it jump across the map on everyone's screen. If nobody knows where he stood, it goes back where it came from. |

## The rules the server checks (`server/src/goods/store.ts`)

- A lift of an item someone else holds: refused, "Someone was quicker." One thing in the hands at a time. Nothing may
  rest on it.
- A job's goods: only its holder lifts, takes or lays them out ("That is another man's work."). Owned goods: anyone
  (a theft stays a deed, as `town/deeds.ts` has it; the owner still shouts). Another player's job goods are not
  offered to lift at all (`game/jobs.ts`).
- Only the holder puts an item down. Played together, a lift or a put down further than 4 m from where his movement
  socket has him is refused. (Alone the tab's own place is too old to check against.)
- Stacks: straight up, three high, as before; barrels also between two barrels of one row (a pyramid): `placeAt` in
  `shared/goods.ts`, run the same on the server and the PCs.
- A carry job's goods set down by its goal are delivered, the employer's (as `HaulRun.onPlaced`).
- A job that ends (done, held for the box, failed, dropped by the server) takes its goods away, in hands too; a
  watch's pile stays, the employer's. The tick sweeps jobs the server closed without the PC.
- A townsperson's goods are reported only by the PC that walks him (M8b owners, `walkerOf`), or, nobody walking him,
  by the player whose errand he is on. He may lift only his errand's goods.
- Limits: 10 requests a second per player, bursts of 30 (on top of M8e's per-guest HTTP limit); a body over 8 KB is
  refused; 6 items at most in one request.

## What is in

| Part | Where |
|---|---|
| The shared rules and data: kinds, heights, ids, `rotFor`, `placeAt` (stacks and pyramids), the owned goods (was `OWNED` in `game/jobs.ts`), the quay's casks (`PILES`), the dray's run, the requests | `shared/goods.ts` |
| The store, the checks, the town's own work (`spawnGoods`, `moveGoods`, `removeGoods`, `cartTake`, `cartUnload`, `playerLeft`, the sweep, the dray) | `server/src/goods/store.ts` |
| The routes, the tick, `POST /api/dev/goods` (`dray: out/down/back/home`, `back: <id>`, `move`, `reset`) | `server/src/goods/routes.ts`, `index.ts` (new week, load, job done/held), `mp/index.ts` (a player gone) |
| One use by townspeople: an owned item left more than 2.5 m off its place for 20 game minutes is carried back by a working man of the quay (a routine of the M6 step executor, pinned to the nearest player's PC; the server puts it back itself if the time runs out) | `server/src/goods/carryBack.ts`, `town/hire.ts` (pins), `director/steps.ts` (`gid`) |
| One use by a cart: on weekdays the Hessenatie's dray takes the three casks by the Hessenatie (pile `e`) at 8:00, sets them down as a pyramid by the lighter berth at 9:00, takes them back at 16:00 and sets them down at home at 17:00; only a whole, untouched pile goes | `store.ts drayTick`, `shared/goods.ts DRAY_RUN` |
| Jef's handcart carries the same items (`gid` on each load): onto the cart by id, off into his hands the same item, tipped off at the goal by the server on the goal's slots; a load left on the ground is set down by the server | `server/src/town/handcart.ts`, `handcartRoutes.ts`, `client/src/game/handcart.ts` |
| The PC: draws the list, asks, undoes a refusal; another player's load before his chest (his figure plays the dockers' carry clip), a townsperson's on his shoulder (a barrel on its side), on whichever PC | `client/src/game/goods.ts`, `net/mp/figures.ts`, `together.ts` (`figureOf`), `player/look.ts` (carry clip), `main.ts` |
| Jobs, runs, hired hands: the server lays a job's goods out (`jobGoods`), swings the ship's cargo down (`lower`), hands a deliver's goods over (`handover`), takes a thief's (`take`), restores after a load (`restore`); the hands lift and set down through `npcLift`/`npcPut`/`npcDrop` | `game/jobs.ts`, `runs.ts`, `steps.ts` |
| The quay's casks are loose goods now: each its own item at the same place and turn, the same model (props.glb `barrel`), a model-shaped collider each; their ground is held until the list is in | `world/rijnkaai.ts` (`pileHold`), `game/goods.ts` |
| A player's pinned townsperson (his hired hand, the man carrying goods back for him) may now be taken by his PC from whoever walks him (the server allowed it; the client did not ask) | `net/mp/street.ts` |
| `MP_PROTOCOL` 4: a PC of an older build is sent to download this one (it would lay out goods of its own) | `shared/mpProtocol.ts` |

Drawing: the lying casks are merged into one mesh per part of the barrel model (iron, wood), made again when one
moves (0.9 ms for ten). The static piles were the same two merged meshes, so no draw call and no shader changed.
An InstancedMesh was tried first: two new shader programs (241 against 239), so the merge was kept (rendering.md
rule 3).

## Checked (2026-09-27)

- `server/test/m8f-goods.test.ts`: 17 tests (ids and turns agree between two stores and the shared list; Sooi's
  third crate on the first; the pyramid; a lift of a held item refused and the answer carrying the item; only the
  holder puts down; the stack's lower item and a full stack refused; the 4 m reach together; a job's goods laid out
  once, another man's refused, delivered at the goal; a job's end and the sweep; the watch pile stays; a thief's
  take; into the Schelde with where; leaving; restore; a hand reported by the wrong PC refused, by the walker or his
  hirer taken; the carry-back from start to home; the dray's day, a touched pile left, Sundays; spawn/move/remove
  pushed with who; the handcart by id and tipped off at the goal; the route: the late list, 409 with the item, 400,
  413, 429; a reset sent whole).
- `server/test/mp.test.ts`, a real server: the same list for host and guest; the host's lift in the guest's push;
  her lift of it refused; a late list has it in his hands; his put down in her push; then hers to take.
- Browser, test stack `goods` (8958/5358), headless Chrome over CDP, host tab and `?seat=2` (player 4):
  - The same list on both tabs: 21 items, every id, place, height and turn equal (`own:sooi:1` at 9.13, 42.5, turn
    0.253 on both).
  - The host lifts `own:sooi:1`: on the guest's screen it is on the host's figure (parent `player_figure`), held before
    his chest (picture: the host carrying, from the guest). The guest's lift of it: shown at once, then undone,
    "Someone was quicker." The host sets it down 3.01 m on: 9.33, 45.5, turn 0.251 on both tabs.
  - Both lift `own:sooi:3` at the same moment: the guest's request came first and won; the host's was undone.
  - The guest takes a carry job (by id, from the board): the host sees `job:49:0` at 51, 8, turn 0.253, the same as
    the guest; the host's lift of it is refused ("That is another man's work.").
  - The dray: pile `e` onto the cart on both tabs; set down as a pyramid (22.025 and 22.775, 14.2 below; 22.4, 14.2 at
    0.95 on both) on both (pictures from both tabs); back home at 30, 30.75, 31.5 / 13. A change reached the other tab
    in about 50 ms.
  - The carry-back: Emiel Smets lifted the widow's barrel 5.9 m off its place, carried it on his shoulder (on the
    walker's PC and on the other's, parent his puppet) and set it down at home (-26.83, 42.8, turn 0.103) on both.
    Once walked by the host's PC, once by the guest's (pinned to her).
  - The handcart (a cart job, the lent cart): two job crates and two casks onto it by id (`hc:1:cart:lent1`), one
    crate and one cask off into the hands again as the same items; the guest agreed on each.
  - Alone (together off): a lift shows at once, the put down lands where the server puts it (6.9, -5.2, turn 0.022).
    Only the turn changed from before: the old placing code run in the tab gives the same place and height for all
    21 items (largest difference 0); the owned goods' turns come from the id now (were random), the casks' are as
    before.
  - Draw calls facing the quay (4 views): 359/357, 314/312, 377/375, 378/376 with the casks / without; the same
    casks were two merged meshes before. `shaders()`: problems none on both tabs (239 programs). `paths()`: none,
    with the piles at home and with the dray's pyramid down.
- `npm run build` passes; the client's tests pass (32, 2 skipped); the whole server suite 1240 of 1240 (84 files).
  Two handcart tests now look for a load left on the stones in the goods list (the server sets it down), not in the
  cart's `dropped` list. `m8e-limits` failed once while the test browser and stack still ran (CPU), and passes
  alone and in the whole suite after.
- Pictures (`data/shots/`, not in git): `m8f_pile_e`, `m8f_pyramid`, `m8f_guest_sees_host_carry`,
  `m8f_dray_pyramid_host` and `_guest`, `m8f_npc_carry_host` and `_guest`.

## Not yet (next)

- The cask pyramids, crate stacks and sack piles of the quay heaps (`world/quaygoods.ts`, merged per chunk) and the
  big crate stacks and sack piles of `world/rijnkaai.ts` are still props: next, the same way as the casks.
- Goods on a cart are not drawn with it (the dray is the world PC's mover; another player's handcart is drawn empty).
- More of the town's work through the same store: a morning delivery to a merchant's pile, goods loaded onto a ship,
  the dockers' own carrying.
- The list lives in memory: a restart of the server lays the town's goods out afresh, as a reload did before.
- The server has no ground to check a put down against (water, walls): the PC's own check (`canPlace`) stands.
