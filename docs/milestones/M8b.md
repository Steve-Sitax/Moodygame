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

## Status

In progress. Server part done (`server/src/mp/street.ts`, `server/test/street.test.ts`).
