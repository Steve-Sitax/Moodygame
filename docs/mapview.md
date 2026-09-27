# The town map

A live map of the whole town for the host: every player, every townsperson, the dogs, the moving world
(omnibuses, boats, the train, the cranes, the drays, the bridges and the lock), the places and the town's
events, on a sepia map of 1873. Hover a thing to see what it is, what it does and where it goes; click it to
pin a card on the right that follows it live, with its day plan and its history.

It only listens. It never changes the game or writes to the save.

## Opening it

- The game's server opens it on **http://127.0.0.1:8790/** when it starts (the log says
  `[map] the town map: ...`).
- Another port: `SCHELDEMIST_MAP_PORT=8795`. No map: `SCHELDEMIST_MAP_PORT=0`.
- It listens on 127.0.0.1 only: the host PC, never the house's network, even when the game is open to the
  house. A request whose Host header does not name this PC and this port gets a 403 (against DNS
  rebinding); the feed also refuses another page's Origin. Only GET.
- A try without the game: `node src/mapview/demo.ts` in `server/` starts it on port 8799 with a new game's
  save in memory and a made-up feed, and stops after 5 minutes (`MAP_DEMO_PORT`, `MAP_DEMO_SECONDS`).

Drag to move, wheel to zoom, **F** fits the town, **Esc** unpins the open card. The categories and the view
are remembered in the browser.

## The categories

| Category | What it shows |
|---|---|
| Players | Each player at his place with his view's direction; the host red, guests in their own colours. "(away)": his menu is open; "(lost)": his connection dropped (30 s of grace). |
| Townspeople, live | Townspeople a player's PC walks now (sent at least once a second); faded out 3 s after the last batch. A tick shows which way they face. |
| Townspeople, by day plan | Everyone nobody walks live, where the engine's schedule puts them now (open circles): at work, at the market, the tavern, church, play. Marked "by the day plan, not seen live". |
| Indoors, by day plan | The same, for those the plan has indoors (at home, or working inside): at their door, dashed. Off at first. |
| Dogs | A dog beside each owner who has one (live or planned, as the owner). |
| Cats | The doorsteps where the game puts a cat (every third resident's step). Static. Off at first. |
| Omnibuses, Boats and ships, Train and cranes, Carts and drays, Bridges and lock, Other moving things | The moving world as the world PC last sent it. Any list of things with x and z is drawn; the name of the list picks the category and the icon. The bridges of the map show open (filled) or closed when the world says so. |
| Town events | The director's events of today: running ones solid, planned ones dashed, with their title. |
| Places | Workplaces, squares, shops (brown), taverns (dark red): the town's places with their names. |
| Names on the map | The names of the squares, quays, water, gates and landmarks. |
| Owners overlay | Colours each live townsperson by the player whose PC walks him. |
| Trails | The last two minutes of every live mover as a thin line, and the open card's full trail. |

The counts beside the categories are the numbers in the town now, shown or not.

## Live and planned

The server walks nobody (docs/multiplayer-plan.md 5.2): a townsperson's true place is known only while a
player's PC walks him and sends him. Everyone else is drawn where his day plan says: `activityAt` of his
schedule (server/src/town/schedule.ts) at the game's clock, at his home door, his workplace (his stall, shop,
post, the round he walks or the haul between quay and door), or a spot in the place of the hour. That is where
the game would put him if a player came near, but not a sighting.

Played alone, the movement socket is not open: no player is drawn and every townsperson is shown by the plan.

## The cards

- **Now**: live from the feed (four times a second): seen live or by the plan, the motion and speed, what he
  carries, the plan's part of the day and the next, who walks him, where. Below, from the save every 2 s: who
  he is (trade, age, household, home, work, dog, nature), what he feels about the host's player, an action the
  director or a talk gave him, and links to his family.
- **Day plan**: his schedule for today, the part now marked.
- **History**: his trail (red on the map, older paler), what the map noted of him, and what the save holds.
- **Follow** keeps the map centred on him; **Centre** jumps there once.

Several cards can be pinned (tabs at the top of the panel, up to 8).

## The history kept

In memory, since the server started (gone on a restart):

- a trail per thing: one point a second, the last 15 minutes (players, live townspeople, the world's movers);
- a list of notable changes per thing (the last 200): came into the town, left, lost the connection, away;
  seen live, walked by whom, not seen live any more; sat down, a lantern, a cart, bought something; each
  change of the day plan's part ("day plan: at the tavern De Vliet").

From the save (read only, the most recent of each): `world_event` (through `world_event_who`, actor or
target), `npc_memory`, `npc_action`, `family_news`, `deed` (goods taken from him), `town_event` he was in; for
the host's player the events he did, his money, needs and jobs; for a guest when he joined and was last seen;
for a place the events that happened there.

## For the code

- `server/src/mapview/index.ts`: `mountMapView({ model, db })`, its own http server and the `/feed` socket.
  Routes: `/` (the page), `/city` (the drawing, from `shared/city.json`, `city_build.json`,
  `townplaces.json`), `/people` (residents, places, stalls, cats), `/feed`, `/detail?kind=&id=`,
  `/history?kind=&id=`. Kinds: `player`, `resident`, `dog` (by its owner's id), `world` (`key:id`),
  `place`, `event`.
- `server/src/mapview/model.ts`: `MapModel`, fed by the multiplayer code: `players(list)`,
  `puppets(ownerId, entries)`, `world(t, d)`, `owners(rows, full)`; `plannedSpot` for the day plan.
- `server/src/mapview/views.ts`: the snapshot, the details and the history.
- `server/src/mapview/public/`: the page (plain JS, canvas 2D, no library, no CDN).
- Tests: `server/test/mapview.test.ts`.
