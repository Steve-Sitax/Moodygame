# M8b: one street for all

Phase M8b of `docs/multiplayer-plan.md` (section 10): the same townspeople and the same moving things on every
screen. Started 2026-09-27 (Steve: "M8b"), in the worktree `D:\Code\MoodyGame-m8b` on the branch `m8b`.

## The design, and why

The server still walks nobody: the walk grid, the A* and the town's shapes exist only in the browser (plan 5.2,
choice C). What the PCs do, the server passes on.

| Part | Who runs it | What the others do |
|---|---|---|
| A townsperson near a player | One PC, the owner: near the host the host's PC (only the host can talk and work until M8c); else the first player near | Draw him from the owner's batches: no A*, interpolation and the animation only |
| Omnibuses, river traffic, bridges, the lock, the goods train, the cranes, the rail gate, the drays | The world PC: the host's while his tab draws; else the lowest player id whose tab draws | Show them from the world PC's state; take over from the last state if the world PC changes |
| What a player rows, rides or pushes (boat, velocipede, handcart) | His own PC | Drawn with him; their own copy of it hidden |
| Doors | By the clock and the server as before; a rented home's door opens for its key holder on every screen | |

## What the research said (2026-09-27)

Sources: Gaffer on Games (snapshot interpolation, state synchronization, networked physics in VR), Bungie's
GDC 2015 talk on Destiny's hosts, Unity's distributed authority, Unreal's based movement and Iris priorities,
Valve's multiplayer networking, Gambetta. The choices taken from it:

- **Owner per townsperson, decided by the server** (Valheim zones, Unity distributed authority, Fiedler's
  authority scheme): the first PC to ask gets him; ownership sticks until there is a reason (the owner lets go
  beyond 68 m, leaves, or stops sending for 3 s); the host takes those near him from a guest.
- **Hysteresis against ping-pong**: taken at 55 m, let go at 68 m (the crowd's own spawn and let-go ranges).
- **The new owner goes on from the last received state**, never from a fresh start; a small difference is kept
  as an offset that fades in a few frames (Fiedler); the target is a jump under 10 cm at a handover.
- **The server drops a batch from anyone but the owner**: a late batch from the old owner cannot pull him back
  (what Fiedler's ownership sequence does).
- **Townspeople drawn about 200 ms in the past** (sent 10 times a second: two packets of margin, Fiedler and
  Valve), players 100 ms as in M8a.
- **The walk's pace from the drawn speed** on the receiving PC (no sliding feet); the standing motion (sit,
  talk, scrub, ...) is sent as its number.
- **Standing people once a second, moving ones 10 times a second** (Unity's static ghosts, Fiedler's priority
  accumulator); all of one owner's people in one binary batch.
- **The moving world streamed from one PC** (Photon's master client, Destiny's physics host) rather than made
  a pure function of the clock (the research's first choice for timetabled things): every mover here waits for
  the people and the carts in its way, which differ per PC; a rewrite of each mover as a function of time is a
  larger job, kept for later where it pays (plan 5.2 already says so).
- **Backpressure**: a player's socket queue over 64 KB skips a stale state instead of queueing it (the next
  replaces it); news (owners, the world PC) always goes.
- WebSocket stays (the research: WebTransport needs HTTP/3 and TLS on the LAN; worth it only if Wi-Fi shows
  gaps over 250 ms).

## What is in

| Part | What | Where |
|---|---|---|
| Owners | The server keeps who walks each townsperson (a small number per resident id for the batches). Claim when the town is about to bring him into the street (55 m); let go beyond 68 m; the host takes those within 50 m of him from a guest, not again within 5 s of a handover; a PC silent for 3 s loses them all; one who leaves loses them at once. A person let go **in the street** (out of range) is free for the next PC near; one let go **at a door** (in, on a boat, an action) is nobody's (owner -1): no taking over what just went in (that was the ping-pong). | `server/src/mp/street.ts` `Owners`, `mp/index.ts`, `client/src/net/mp/street.ts` |
| Townspeople | The owner sends his people 10 times a second (standing ones once a second) in one binary batch (24 bytes each: place, heading, velocity, motion, sit, lantern, sack, bought, vehicle and its load, size). The others draw them about 200 ms in the past (200 to 350 ms by how late they come), a Hermite curve between states, the walk's pace from the drawn speed; the same figure all along: a handover keeps it where it stands and fades any difference out. The town keeps planning their day (a handover knows where they were going) but never moves, dresses or directs one another PC walks; on a guest's PC the town's layers (actions, police, market) cannot take them; the host's can (his actions are the game's). | `shared/mpProtocol.ts` (puppet batch), `street.ts`, `game/town.ts` (remote sims, `TownNet`), `game/crowd.ts` (role "remote") |
| The moving world | One PC (the host's while it draws; else the lowest id that draws) runs the omnibuses, the quay drays and handcarts, the goods train and the ten cranes, the rail gate, the river traffic and the anchorage tows, the four opening bridges with their passages, and the lock, and sends their state 10 times a second (JSON, about 3 KB). The others stop running them and show them from it, about 200 ms in the past, eased between two states; every mover keeps the state it was sent in its own fields, so a new world PC goes on from there. Colliders, decks, the lock's water and the sounds (bells, clacks, signals, hooves) follow the state on every PC. The choice is steady: a tab counts as drawing by its rate (4 states a second or more over 2 s); the world stays at least 10 s with a new PC; it moves on when its PC is silent 3 s or leaves; the host takes it back after drawing 3 s. | `client/src/net/mp/world.ts` (`NetMover`, `lerpState`), each mover's `netState`/`netApply`, `server/src/mp/street.ts` `WorldPc` |
| Gear | What a player rows, rides or pushes goes with him on the others' screens: a boat of the same kind on the water, a velocipede whose wheels turn with the ground he covers, a handcart before him (kind and heading in his own state frame). | `net/mp/gear.ts`, `together.ts` |
| Others in the way | The rail gate's leaves and the lock's balance beams wait for every player in their sweep, as the bridges, the train, the omnibus and the drays already did (M8a). | `world/railgate.ts`, `world/rijnkaai.ts` |
| Doors | A rented home's door opens for its key holder on every screen (until M8c only the host rents). Shop, tavern and landmark doors were the server's and the clock's already. | `game/homes.ts` |
| The town map | Its own page on the host's PC (port 8790, 127.0.0.1 only; test copies take their server port plus 1000), a "Town map" button in the menu on the host's PC: players, townspeople (live, or by their day plan), dogs, the moving world, places, events; hover, pin, follow; a person's home, workplace and family; houses to click; trails and history. | `server/src/mapview/`, `docs/mapview.md` |
| The game for the house builds itself | A missing or old build is made by the server when the house opens and when a guest asks; the guest waits on a page that reloads itself. | `server/src/mp/autobuild.ts` |

## Numbers (2026-09-27, two tabs on this PC in a headless browser, host and guest side by side)

| What | Measured |
|---|---|
| The same townsperson on both screens, apart | p50 0.22 to 0.47 m, p95 0.41 to 0.81 m (walking pace times the 200 ms delay) |
| Handovers bouncing within 10 s (ping-pong) | 22 to 28 before the door fix; 0 and 0 in two runs after |
| Handover difference (faded out, not a jump) | p95 0.04 to 0.75 m |
| The omnibuses, the drays, the train, the ships along their ways | within 0.8, 0.35, 0.35 and 0.6 m; bridges, the lock, the gate and the cranes the same |
| The world PC leaving | the guest takes over within 3 s; buses and train go on; host back: one change back after 10 s |
| World PC changes with slow tabs (2 to 11 frames a second) | 5 in 24 s before the rate rule; 2 (the start, and the host back) after |
| Corrections sent to a mover | 0 |
| The world's state | about 3 KB, 10 a second from the world PC |
| `__scheldemist.shaders()` | problems: none, on both tabs |
| `__scheldemist.paths()` | one: "home of Father Norbert Stessens", from main (not this work): flagged as its own task |

Tests: `server/test/street.test.ts` (owners, the batches, the world PC, no flapping with a slow tab), `autobuild.test.ts`,
`mapview.test.ts`; the whole server suite 1078 of 1078 after merging main.

## Review round 1: what is still missing (2026-09-27)

For M8c (the player's own part):
- A guest's requests to the world PC: to hold the omnibus while he boards (and his fare), a bridge or the lock for his
  boat, a crane to climb (refused on a remote PC for now: "The crane is at work").
- Event people without a resident (the market's shoppers, the Steen's visitors) and job figures are still each PC's own.
- Props a layer hangs on a townsperson (an instrument, a broom, wear) are not sent; the motion is.
- A dray on a townsperson's errand shows on its owner's PC only.
Smaller, later:
- The world's state could be trimmed (3 KB at 10 a second: send only what changed, or the path movers at 5 a second).
- The anonymous nameless crowd is off in the town (residents only), so nothing to share there.
