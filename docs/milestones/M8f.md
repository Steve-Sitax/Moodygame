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

## Goods pass 2 (2026-09-27)

Steve: the cargo on the quays is real, shared goods: loose items picked up one by one or put down, a whole pile taken
or brought by someone with a cart, in sync for every player.

### What changed

| Part | How | Where |
|---|---|---|
| The heaps' cargo | Every cask, crate and sack of the quays' heaps is a server item now: 684 at the start (284 casks, 274 sacks, 126 crates), ids `qg:<heap>:<k>`. The heap models made of goods (a pyramid of 6 or 10 casks, a standing group, a column, a tied stack and a block of crates, a heap, a pallet and a mountain of sacks, a cask on chocks) are split in Blender into one node per cask, crate or sack in its own frame, and the rest (the chocks, the pallet, the lashings' ends: static). Single models (a cask, a keg, a hogshead, the crates, a sack) are one item each. What rests on what comes from the heap as laid (a pyramid's upper cask on the two below, a sack laid across on the two under it, a crate on a crate). | `tools/blender/build_quaygoods.py` (`PMesh`, `split_pieces`), `world/quaygoods.ts` (`putItem`, `restsOn`) |
| Same look | The heap models are put together again from their pieces as they were built: every vertex within 0.2 mm of the old model (`quayPiecesCompare`); the tied crates 13 mm (their lashing is split: the loop over the top crate goes with it, the ends stay on the big crates). The same triangles (61,642), quaygoods.glb 1485 KB to 1631 KB. A lying item is drawn inside its heap's own chunk mesh (merged with the static parts, the same material and draw call); a chunk is made again when one comes or goes (all chunks at load 20-35 ms, once). | `world/quaygoods.ts` (`buildChunks`, `rebuild`, `showQuayCargo`) |
| Same places | The heaps were searched for anew on every load against what stood and moved at that moment (the drays, the train, the stalls of the hour, the goods list if it came early), so two PCs, or two loads, could differ. They are baked now: `shared/quaycargo.json` holds every heap as laid (its models, where and how, the random stream after them) and every item for the server. The PCs lay the baked heaps; `?quaybake` searches afresh. The bake equals the heaps as they stood before (116 heaps, 10 taken away near the town's places; the placed list identical). | `tools/bake-quaycargo.mjs`, `shared/quaycargo.json`, `world/quaygoods.ts` (`layBaked`, `quayHeapsBake`) |
| The Rijnkaai's stacks | The six stacks of big packing crates (18 crates, one across the first two) and the two piles of six sacks are server items (`crate:<k>:<i>`, `sack:<k>:<i>`), the same props.glb models, places and turns; merged per material with the piles' casks (goods, sackcloth, barrel, iron: the four meshes the props' batch and the casks had). | `shared/goods.ts` (`CRATE_STACKS`, `SACK_PILES`, `rijnkaaiGoods`), `game/goods.ts` (`drawCasks`), `world/rijnkaai.ts` (holds) |
| Too big to carry | The Rijnkaai's packing crates (1.3 m at 1.1 times) are **cart only**: the server refuses a lift ("Too big to carry: that is a cart's work"), the PC says "too big to carry: a dray's work". **Heavy** (both arms, speed 0.4): the big ANTWERPEN crates and the long MACHINES crates of the heaps, the hogsheads, the sacks over 1.5 m laid across a mountain of sacks (102 items). A long crate held before the eyes is drawn at most 0.95 m wide. | `store.ts`, `game/jobs.ts`, `game/goods.ts` |
| Colliders | Each item its model's own collider (the heap's model shape per piece, props' shape per crate and sack). The heap holds its cargo's ground until the server's item is drawn. The heaps are placed against the town's goods at home and never against the goods' or the drays' colliders of the moment (`goodsRects`). | `world/quaygoods.ts` (`goodsHomes`, `goodsRects`) |
| Carts draw their load | On the dray's bed (in the places of its round), on a handcart of the town, on another player's handcart (his gear names the cart he pushes: `sub` = a hash of its goods holder; `together.gearCart`), and on his own handcart each item's own model (`cartBody`), sorted by id so both PCs lay it the same. | `game/goods.ts` (`cartFrame`, `handcartFrame`), `net/mp/gear.ts`, `together.ts`, `game/handcart.ts`, `main.ts` |
| The carts' rounds | `CART_RUNS`: the Hessenatie's dray with pile "e" (8:00 on, 9:00 down as a pyramid by the lighter berth, now at 24.5, 13; 16:00 back, 17:00 home), and a **handcart with the Rijnkaai's sacks** (10:00 the whole pile on, 11:00 down in the same shape by the berth at 24.0, 19.5, 14:00 back, 15:00 home). Only a whole pile, untouched and with nothing of anyone's on it, goes; what is still on a cart at a new day is set down at home. The drawn dray (a led horse dray, its carter at the horse's head) and the handcart (pushed by a carter) go their round on the game's clock: six legs a day, each timed to be there before the server's stage; where they are follows from the clock (a leg and how far along it), streamed from the world PC as a mover (`goodsCarts`). The dray's loop runs between the omnibus stop and the emigrants' camp (checked with a map of the rig's sweep against the walk map, the colliders and the keep-outs); `paths()` stays empty at 8:30, 10:30 and 13:00. The men are hidden out of view (their skinned meshes are never culled). | `shared/goods.ts` (`CART_RUNS`), `store.ts` (`runTick`, `cartRunsTick`), `world/goodsDrays.ts`, `world/traffic.ts` (`LedDray.pose`, `bedFrame`), `routes.ts` (`POST /api/dev/goods {dray, run}`) |
| The list | `GET /api/goods` carries 735 items now; `placeAt` looks only at what lies within 3 m (the same answers, not every item). | `shared/goods.ts` |

### Checked

- `server/test/m8f-goods.test.ts`: 23 tests (6 new): the heaps' items as the bake has them and resting on what is under
  them; taken top down, a heavy one heavy; the Rijnkaai's crates in their old places and turns, cart only, one across
  two; the sacks on each other and back on the one below after a put; the handcart's round (whole pile on, down in the
  same shape, back, home in place; both rounds on one tick); a touched or burdened pile stays, a load left on a cart
  comes home the next day; each drawn leg starts where the last ended.
- Browser, test stack `syncB` (8966/5366), headless Chrome over CDP, host and `?seat=2` (player 4), played together:
  - The same list on both tabs: 735 lying items, every id, place, height and turn equal (0 different; `qg:45:0` at
    4.904, 29.535 turn 1.547, `crate:0:3` at -19.301, 14 on 1.1 turn 0.2 on both). `cargoCheck()` on both: 684 on the
    server, 684 in this PC's heaps, none off.
  - The host takes the top crate of a crate block (`qg:55:8`, on `qg:55:6`): on the guest it leaves the stack, sits
    on the host's figure (`player_figure`), and the crate under it is free on both tabs; set down 2 m on, at -14.825,
    22.94 turn 0.078 on both.
  - The dray: the casks on its bed on both tabs at the same places (31.73, 1.06, 14.59 ...), and at 25.37 ... once
    it has gone on; the handcart with the six sacks the same on both.
  - Another player's handcart: the host's job crate on his lent cart: on his own cart at -17.46, 0.74, 10.27, on the
    guest's copy of it at -17.46, 0.77, 9.82 (his gear's cart stands 0.95 m before him).
  - Alone: the dray's morning (7:56 by the pile, 8:04 loaded, 8:14 gone on, 9:05 the pyramid down) and the handcart's
    (9:56, 10:04 loaded, 11:05 down) in pictures.
  - Heaps close: the casks' pyramid of ten, the crate block, the sacks' mountain as before.
  - Draw calls of the main pass facing the quay from 4.24, 10.48 (the average over 3 s): before 459 at 300 degrees, 292
    at 180; after 451 and 435, 282 and 282 (two runs; 0 degrees 353 / 359, 90 degrees 500 / 504). The goods' own
    meshes in view: the heaps' chunks as before, the four merged props meshes (the props' batch's two and the casks'
    two before), no dray, cart or man. `shaders()`: problems none (224-226 programs). `paths()`: none.
- `npm run build` passes; the client's tests pass (32, 2 skipped); the whole server suite 1245 of 1246 (84 files): the
  M4 scheduler's "templates all plan" timed out at 20 s while the test browser and stack ran (it takes 13 s alone; the
  M4 file passes alone, 42 of 42). `MP_PROTOCOL` 5 (with sync pass 3): a PC of the build before lays its own heaps with
  their cargo and is sent to download this one.
- The two-tab numbers: a lift in a heap rebuilds one chunk on the other PC in 3.7 ms; the dray drawn on the guest is
  0.3-0.4 m behind the host's (the world stream's 200 ms, as every mover).
- Pictures (`data/shots/`, not in git): `gp2_field_casks`, `gp2_field_crates`, `gp2_field_sacks`, `gp2_rk_crates`,
  `gp2_rk_sacks`, `gp2_dray_*`, `gp2_cart_*`, `gp2_mp_*`.

### To bake again

After a change to the heaps (`V`, `AREAS` in `world/quaygoods.ts`), to the quays, or to what stands on them: a test
stack, then `node tools/bake-quaycargo.mjs --base http://127.0.0.1:<vite>/` (it starts its own headless Chrome), a
server restart, and `__scheldemist.jobs.goods.cargoCheck()` in a tab: `off` must be empty. A heap model gone from
quaygoods.glb makes the PCs search afresh (a warning in the console) until it is baked again.

## Not yet (next)

- A player cannot load a whole pile onto his handcart at once (one by one, from his hands, as before); the Rijnkaai's
  packing crates are moved by no cart yet (only a dray could).
- More of the town's work through the same store: a morning delivery to a merchant's pile, goods loaded onto a ship,
  the dockers' own carrying.
- The list lives in memory: a restart of the server lays the town's goods out afresh, as a reload did before.
- The server has no ground to check a put down against (water, walls): the PC's own check (`canPlace`) stands.
- The drawn carts do not wait for people in their way (they go by the clock, as the goods do); their loop keeps to
  open ground.

## Sync pass 2 (2026-09-27): the last per-PC differences

The check: two tabs (host and `?seat=2`) at one spot; every mesh that stands still in both tabs is compared (world
matrix, geometry size, instance matrices). The lead's audit (15 s after the guest arrives), before: 1636 groups on
both, 17 different, 10 only on the host, 2 only on the guest. After: 1640 on both, 11 different, 1 only on the host,
0 only on the guest; every one left is listed below.

| What differed | Why | Now |
|---|---|---|
| Who rides the omnibus, where they sit, their look (a shopwife on one PC, a priest on the other); the people waiting at the stops | The world PC streamed the omnibuses, but every PC rolled its own passengers and waiters (waiters only near its own camera); a townsperson's seat was a dice roll; each PC's trips put their own townspeople on | The world PC's state carries them (`omnibus.ts` `OmnibusNet`): `_a` the nameless passengers (number, seat, look), `_r` the townspeople aboard (id, seat, look, stop), `_wt` the waiters (number, post, place, look, the omnibus they go to). The others draw exactly these (a waiter walks to the step, the passenger gets on; one who leaves walks off), about 60 bytes an omnibus. The world PC lets people wait near any player (`others`, set by `main.ts`). A townsperson another PC's trip puts on the omnibus rides there in the book (`riders`, what `journeys.ts` asks) and is boarded by the world PC for all (`netAsk("bus_board")`, `world.ts` ASKS). His seat comes from his id; the horses' step from the omnibus's number. Checked: 12 looks 10 s apart, passengers, townspeople and waiters the same on both tabs every time (7 boardings asked by the guest). |
| A lantern in the hand of four figures on the host only (`Group/<kind>/.../handR/Group/Mesh` + Sprite) | Not job figures (they carry no lantern): the night-work givers of `town.ts` (fence, smuggler, night carter, cracksman: stranger, sailor_b, carter, thief). Gone home (hidden), they kept the lantern; a PC that loaded the game at night had four hidden lanterns another never had | `postEmployers`: gone home, the lantern goes too |
| The gutter stains (`alive_gutter_stains`): 51 on one PC, none on the other | The houses' wear was read once, as soon as 20 city meshes were in: if the landmarks came in before the houses, no house had a wear and no gutter broke, for good | Read once the city's `ready` has come (`eaves.ts`). The stains were seeded by house already; the drops and splashes stay random (short particles) |
| The cart ruts (`ruts`) | Not made by vehicles: the ruts are the cart roads, found once from fixed waypoints on the walk map, the same on every PC. One seen on one tab only was still being built (a road a frame) | Nothing to change |
| The far lamp glow (`far_glow`) | The same code on every PC; what it shows is chosen from the camera (the nearest lit lights past half the fog), so per player. The audit read the points past the draw range too: left there from the night before `t.light()` | Nothing to change (the audit variant below reads the draw range) |
| A cat on a sill turned two ways | `lively.ts`: its turn was a dice roll | By its house (`h01`) |
| Parked velocipedes' handlebars straight on one PC | The model came after the list: `stand()` had not turned them | Stood again when the model comes (`velocipedes.ts`) |
| Scan of the code: things that stay, placed by `Math.random` | | Seeded: the event props' turns (`events.ts`, by place), a lost bundle's or notebook's turn (`ideas.ts`, by place), a market seller's size (`market.ts`, by his place; `crowd.addPuppet` takes a size), when a farrier or caulker is at his second place (`trades.ts`: the game clock, 20 s at his own place; was 14-26 s), when a moored ship pumps her bilge (`alive/water.ts`: a run of 14-33 strokes placed in each 4 minutes of the game clock by the pump and the round; was 90-290 s apart) |

Played alone nothing else changes in look: the waiters, the nameless passengers and the townspeople ride as before;
only the dice named above are now seeded (a townsperson's seat, the horses' step, the sill cat, the props' and lost
things' turns, the seller's size, the second place's timing, the pumps' timing).

Left as they are (per player by design): your own hand and lantern (`PerspectiveCamera/...`), the sky dome that
follows the camera (`cloud_sky`), the gas lamps' halos pulled toward the camera (`Sprite` at 3.6 m), the far glow,
breath, the fog's view distance (a setting) and what it culls (city chunks, a sill cat beyond it), townspeople hidden by
the camera's own culling. Moving things mid-move: the omnibus lamps, the ships' lights (drawn 200 ms behind the world
PC; by day hidden, with the night's points in them). The audit's clock hands: the same vertices on both tabs; the
difference is a bounding box cached at another minute (checked by reading the hands).

Left, and why (each needs its own design, not a seed):
- Ambient life spawned round each player's own camera: leaves and paper on the ground (`alive/leaves.ts`), sparrows,
  jackdaws, the square's pigeons, homing pigeons (`alive/sparrows.ts`, `jackdaws.ts`, `ambient.ts`, `lofts.ts`), cats'
  eyes at night (`alive/night.ts`), river mist (`alive/water.ts`), stray dogs and street cats (`game/animals.ts`), hens
  and goats wandering (`lively.ts`). Each is a pool kept round one camera; the same for two players needs places tied
  to the map (grid cells by the clock) or streaming, as the townspeople.
- Walkers of no resident, local to each PC: the market's shoppers (`market.ts`), the Steen's visitors
  (`steenlife.ts`), as M8b's review already listed.
- The washing on the lines (`backlife.ts`): built only on the PC that walks its townsperson (props a layer hangs on a
  townsperson are not sent, M8b review).
- The quay heaps (`quaygoods`) differed between the tabs while helper B was reworking them in the same tree.

Checks: the lead's audit as above; an audit variant (`fresh`: the box of what is drawn now, 60 s to settle) left 12
different and 3 only on the host, all of the kinds above. `__scheldemist.shaders()`: problems none on both tabs.
Alone (together off): waiters, passengers and the stains as before, no errors. Client tests 32 pass (2 skipped);
`npm run build`: the client's type check stopped on helper B's goods files in progress (`game/goods.ts`,
`world/goodsDrays.ts`), not these; `vite build` and the server's type check pass.

## Sync pass 3 (2026-09-27): the town's animals, walkers, birds and props, the same for every player

Steve: what pass 2 left for its own design must be the same for every player too.

| What | How it is shared now, and why | Where |
|---|---|---|
| Stray dogs and street cats | Fixed by the town, not spawned round one player: a cat on about 9 doorsteps in 20, a stray haunting about 1 in 3 of the rest (a third of those at night only), kind, pose and turn by the doorstep (the same on every PC). One is made when a player comes within 60 m of it; the PC of the nearest player runs it (claimed with the townspeople's claims, `server/src/mp/street.ts` Owners, ids `a:cat:`/`a:dog:`), lets it go beyond 75 m, and the next PC near runs it on from where it was drawn. Cats run from any player; a stray trots over to any player. Shown within the fog, 50 m at most, and in view. | `game/animals.ts` |
| A townsperson's dog | Sent by the PC that walks him, under his number (flag DOG): no claim of its own | `game/animals.ts`, `net/mp/extras.ts` |
| Hens and goats of the courts | Their places by the court's dice; run by the nearest player's PC (`a:hen:`/`a:goat:`), they run from any player; the others draw them | `game/lively.ts` |
| The animals' states | `MSG_ANIMALS`: 8 bytes each (number, x and z in 2 cm, turn in 1/256, motion and flags), 10 a second while one moves, every 2 s while they stand; a standing one is put on that grid by its own PC, so the others have it exactly. About 200 bytes a second from a PC that runs a dozen. An empty batch each second says a PC that runs something is alive (else the server's 3 s silence rule gave its animals away). | `shared/mpProtocol.ts`, `server/src/mp/index.ts`, `limits.ts` (kind `animals`) |
| The market's shoppers, the Steen's visitors | Streamed, not made from the clock: they walk the crowd's grid round a player and wait for stalls and people, which a pure function of the clock cannot do alike on two PCs. The PC of the player nearest the market (the Steen) runs its group (claims `g:mk:<place>`, `g:st`): it brings them in where no player sees, walks them, and sends each (its id carries its look, `x:ms:<kind>:...`, `x:sv:<kind>:...`) in the townspeople's puppet batch; the others draw them as remote puppets (with what they bought). One let go near another player (its PC walked off) is taken on by his PC (`onAdopt`). | `net/mp/extras.ts`, `game/market.ts`, `world/steenlife.ts`, `game/share.ts` |
| Washing lines and the back's other props | The result of the townsperson's routine, built on every PC that draws him: once his figure (another PC walks him) stands still at his place, the tub and basket, the washing line by the pump, the card players' crates and table, the old man's chair and pipe, the lad's pipe, the doctor's bag, the drunk's bottle are set as his own PC set them (his spot and facing; the line's spot once per pump, from the walk map and the fixed things, no longer from the crowd's grid round one player). Likewise the round's gear (the dog cart and its dogs, the grinder's barrow, the broom bundle, the flowers) and the door work (the bucket, the brush and the wet step, the lace chair and stand). | `game/backlife.ts`, `game/lively.ts` |
| Sparrows | Their patches fixed by the town (a cell of 24 m, its own dice); about while any player is within 38 m; any player flushes them; the landing, each hop and peck from the flock, the bird and the clock every PC shares | `world/alive/sparrows.ts` |
| Jackdaws | Their ridges by cells of 70 m; a four to a cell goes up once in 150 s of the shared clock (its time by the cell's dice) and comes down on the ridge the dice give: where each is at any moment follows from the clock, so a PC that comes by later has the same bird on the same ridge | `world/alive/jackdaws.ts` |
| The square's pigeons, the gulls on the posts | Flushed by any player; landing, flight and walking by the bird and the shared clock | `world/ambient.ts` |
| Homing pigeons | A round by the game clock near any player (a player who comes by in the middle of it finds them up); the flock's circle by the shared clock (it no longer turns the other way now and then) | `world/alive/lofts.ts` |
| Cats' eyes at night, bats at dusk | Spots and haunts fixed by the town (cells of 10 m and 20 m), on in stretches of the shared clock; a player within 5 m sends a cat off for the rest of its stretch, on every PC; each PC shows the nearest to its own eye | `world/alive/night.ts` |
| Leaves and scraps on the ground | Lasting, so shared: each cell of 6 m has its own, where its dice put them, made when a player comes within reach; the wind and its gusts now run on the shared clock (`world/alive/wind.ts`; the chimney smoke leans with it, `world/ambient.ts`), so the same leaves lift the same way | `world/alive/leaves.ts` |
| River mist | Each cell of the water raises its wisps in rounds of the shared clock where the round's dice put them | `world/alive/water.ts` |
| The shared clock and the other players | `game/share.ts`: the server's clock and every player's place when together (net/mp/together.ts fills it in); alone this PC's own | |

Left local, and why: the drops, splashes, bilge water and sparks (particles of a second or two), the chirps and calls
(sounds), the pecks and head bobs (animation), a blown leaf's flight (each PC integrates it with the same wind: where it
comes to rest can differ by some centimetres), the market sellers' calls (seconds). The wheeling gulls high over the
roofs follow each player, as the sky does. A seller of the market is drawn only while his PC's player can see him
(the same seller at the same stall on every PC). An animal between 60 and 75 m of one player and beyond 60 m of all
others is run by nobody: it stands where it was last seen.

Played alone the look is the same apart from the seeding: the strays and cats sit at their doorsteps (about as many
round the player as before, no longer out of sight only), the sparrows' patches, the jackdaws' ridges, the cats' eyes
and bats, the leaves and the wisps lie where the town's dice put them, the homing pigeons no longer reverse, the
washing line's spot by a pump is found on the walk map (it was the crowd's grid), a scrubbing woman's bucket stands by
her spot at the door (it was where she stood on arriving).

`MP_PROTOCOL` 5: an older build is sent to download this one (it would make its own animals).

Checked (2026-09-27, test stack `syncA` 8962/5362, headless Chrome, host tab and `?seat=2`):
- The lead's audit (15 s, a fresh test stack): 1649 groups on both, 11 different, 0 only on the host, 0 only on the
  guest (after pass 2: 1640 / 11 / 1 / 0). The 11: the own hand, arm and lantern (3), the sky dome, the gas lamps'
  halos pulled toward the camera, the far glow (per camera), breath and the bilge's water (particles), the omnibus
  lamps mid-move, and two boxes the audit caches (the prison clock: the same vertices; the ship lights, hidden by day).
  The 60 s drawn-now variant (my copy, the guest placed again after its own last place came in): 1653 on both, 7
  different, 1 only on the host, 0 only on the guest: the own hand (3), the sky, the halos, the bilge's water, and
  crowd figures kept hidden for reuse (a shopwife, a customs man). A tab that loads where it last was also keeps,
  hidden, what it made there.
- Animals on both tabs, 5 s apart: the same strays, cats and dogs (sitting ones exactly; walking ones within their
  200 ms). The host walked 300 m off: the guest's PC ran them on from where they were drawn. Hens and goats the same.
- Vismarkt, both tabs: 8 shoppers on both, the same looks, places (within 200 ms of walking) and parcels; the Steen's
  visitors the same. The host walked off: his leaving shoppers stayed his until gone.
- Pump 15 (six washerwomen walked by the host): tubs, the line and the rest at the same places and turns on both.
- Sparrows, jackdaws, cats' eyes (at 23:00) the same on both tabs.
- `__scheldemist.shaders()`: problems none on both tabs. Draw calls facing the quay (4.24, 10.48): before 540-547
  (300 degrees) and 827-844 (180 degrees); after 502-531 and 823-842.
- Alone (together off): 17 animals near, 3 sparrow flocks, 8 shoppers at the Vismarkt, no errors.
- Client tests 32 pass (2 skipped); the client's and the server's type checks pass; `m8e-limits`, `street`, `mp`
  tests 41 of 41.
