# M8a: two in the fog (walk together)

Phase M8a of `docs/multiplayer-plan.md`, with Steve's decisions (2026-09-26): LAN co-op for the house; the
host runs the server; guests join from their browser with a join code; files copied once and kept by hash;
each player's own PC moves him and nothing on the network pulls him back; a shared clock and weather; no
pause together. Guests walk, jump, swim and look in this phase; work, talk and pockets come in M8c.

## What is in

| Part | What | Where |
|---|---|---|
| Who asks | The host is player 1: the browser on the host PC (a request from 127.0.0.1 or ::1, not forwarded) with no token. A guest sends his player token (header `X-Scheldemist-Player`, and in the hello on the movement socket). Anyone else may only read the join screen's facts and join. | `server/src/mp/auth.ts` |
| Join code, tokens | A code like `KADE-47` (four letters, two digits, no look-alikes; typed in any case, with or without the dash). A right code gives a token of 128 random bits; the save keeps only its SHA-256 (`mp_player`). Wrong codes: 5 a minute per address. At most 6 players online. The host can make a new code, remove a player, mark one "may change settings". | `server/src/mp/players.ts`, `mp/index.ts` |
| Host-only | The AI setup (`/api/ai/*` PUT and test), population settings, together and open to the house, the code, remove, admin, pause all, saves, loads, a new game, `/api/dev/*`. A guest marked admin may change the settings, never save or load. A guest's `GET /api/client-state` is empty (the host's man stays his). | `mp/index.ts`, `ai/routes.ts fromHost` |
| Guests walk | Every call of a guest that would change the game is refused with "Visitors can walk, jump, swim and look for now. Work, talk and buying come later (M8c)." His own look is his: the character sheet saves his profile (`player_profile` by his id), the others see it at once. | `mp/index.ts`, `player/routes.ts` |
| The world's clock | Moved off player 1's row into `world_state` (`clock`). Played together, the server moves it itself every 10 s while anyone is in the game and the host has not paused all: it calls its own `/api/tick`, so every part that hangs its after-tick work on that route runs once per tick, as in single player. A tab's tick is then only its heartbeat (the host's place for the cold). Alone: the tab's tick moves the clock as before. The weather was in `world_state` already. Until M8c the player row keeps a copy (a trigger follows any old write of the row, so tests and old code that set `UPDATE player SET hour` still work). | `server/src/mp/worldClock.ts`, `day.ts`, `db.ts` |
| No pause together | The menu, P and the loading screen never pause (client `pause.setTogether`; the server ignores a tab's `/api/pause`). The menu opens over a running town; the player shows "away" to the others (his name tag: "Jef · away"). Only the host has "Pause all" (the menu, Together): every player gets "Paused by the host". | `client/src/game/pause.ts`, `net/mp/together.ts` |
| Movement | Each PC sends its own man 20 times a second (68-byte binary frame: place, velocity, yaw, pitch, mode, flags, a platform and the place in its frame), stamped with the time it was true on the server's clock (pings: the best of the last 8). The server checks it is possible and passes it on at once to everyone near (a round 20 times a second covers far ones at 2 a second and a standing one once a second). It never sends anything back to the mover. Mouse look is never touched. | `shared/mpProtocol.ts`, `net/mp/session.ts`, `mp/index.ts` |
| The check | Not faster than the mode allows (walk and hurry 3.4 m/s, swim 1.6, ladder 1.0, velocipede 6, boat 3.2, omnibus 8; a quarter more and 0.35 m of slack), judged on the sender's own times, which may not run ahead of the server's. Up: a jump and a step a frame. A jump of place: the host's always, a guest's once in 30 s. A refused move is not passed on (the others see him at his last good place) and is counted and logged; if he then goes on normally from the new place for 2 s it is taken as his new place (a load the flag missed). A speed hack never is. | `server/src/mp/plausible.ts` |
| The others | A jitter buffer each, drawn in the past (100 ms to start, then what the line asks: 80 to 250 ms), cubic Hermite curves with the sent velocities (a jump is a clean arc), turns the short way, 250 ms of guessing at most then he stands; a snap has no in-between; after a stall the difference fades out in about 0.1 s instead of a jump. On the ground his feet are put on this PC's ground. His body from his look code (`PlayerFigure`, `player.glb`), walk, crouch, swim (treading), row, ride; his name over his head; his footsteps, quieter with the distance. A soft push: two players never stand in each other, a late figure cannot block a door. Bridges do not open under another player; carts and trains wait for him. | `net/mp/remotes.ts`, `figures.ts`, `together.ts` |
| Platforms | On an omnibus he is sent in its frame and put on the receiver's own copy of that omnibus. The ferry of a new week lies at its pontoon for all, so world places do there (the tide moves both decks alike). | `together.ts` |
| Open to the house | A switch (menu, Together) or `SCHELDEMIST_LAN=1`: besides 127.0.0.1 the server listens on this PC's own private home-network addresses (10.x, 172.16-31.x, 192.168.x only; never a public or NetBird 100.x address), same port, and accepts those addresses and the computer's name as Host. Off: closed again. The built game (`client/dist`) is then served by the game server itself on one port. The host's screen shows the address and the code in the top right corner. | `mp/lan.ts`, `config.ts LAN_NAMES`, `mp/static.ts` |
| Files kept by hash | `npm run host` builds, writes `client/dist/manifest.json` (every file, its size and SHA-256; gzip copies), and starts the server as the host. A guest's browser keeps every game file in IndexedDB under its hash (a Service Worker needs https); it downloads only the hashes it lacks, four at a time, checks each (SHA-256 in a worker: `crypto.subtle` is missing on plain http), then one hook sends the game's own paths to the stored copies (three.js's URL modifier, `fetch`, an image's `src`). First visit: "Downloading 34 of 71 MB"; a new build: "New version: downloading 0.1 MB"; what no manifest names any more is removed. The code bundle stays in the normal cache (Vite hashes its names). A build during play: "A new version of the game is ready ... reload at a quiet moment". An older client is sent to reload. | `tools/manifest.mjs`, `tools/host.mjs`, `client/src/boot/netboot.ts`, `boot/sha256.ts` |
| The join | `index.html` now starts `boot/netboot.ts`: who this tab is, the join card over the loading screen if needed (code and first name), the files, then `main.ts`. On the host PC nothing changes. `?seat=2` keeps a second token in the same browser (tests); in a dev build it joins by itself. | `boot/netboot.ts`, `net/mp/identity.ts` |

Single player is as before when "Play together" is off: the tab's tick moves the clock, P and the menu pause,
the server listens on 127.0.0.1 only, vite serves the game in dev. (The new entry asks `/api/mp/info` once.)

## Steve: open the game to the house, step by step

On the host PC (PCX), once:

1. Windows: the home Wi-Fi or cable must be a **Private network**. Settings > Network & internet > (your
   connection) > Properties > Network profile type: **Private network**.
2. The firewall rule for the game's port, in an **administrator** PowerShell, only for private networks:

   ```powershell
   New-NetFirewallRule -DisplayName "Scheldemist (home network)" -Direction Inbound -Protocol TCP -LocalPort 8787 -Profile Private -Action Allow
   ```

   To remove it later: `Remove-NetFirewallRule -DisplayName "Scheldemist (home network)"`.
   Note (read-only look on 2026-09-26): this PC already has two rules "Node.js JavaScript Runtime" that let
   `node.exe` in on **Public** networks (none for Private). The rule above is what the game needs. Whether
   to keep node.exe open on public networks is your call; the game does not need it.
3. Optional, a fixed address: in the router, give the PC a fixed address (DHCP reservation). The browser's
   file store is kept per address: a new address means one new download. The PC's name also works
   (`http://pcx:8787`) where the router resolves it.

Each time you host:

4. Stop the dev game (`npm run dev`) if it runs on 8787. In the game folder (your play copy
   `D:\Code\MoodyGame-play` once this batch is there), with the same save your play copy uses:
   `$env:SCHELDEMIST_DB = "D:\Code\MoodyGame\data\game.sqlite"; npm run host` (PowerShell). It builds the game (about 10 s),
   writes the manifest and starts the server, open to the house. It prints the game's address for you.
5. On the host PC open `http://127.0.0.1:8787/` (not the LAN address: that would make you a guest).
   The menu has **Together**: "Play together" and "Open to the house" are on, the address(es) and the
   **join code** are there, and the corner of the screen shows them too. "New code" makes a new one; the
   list of players has "Remove" and "May change settings"; "Pause the town for everyone" is there too.
6. On the other PC (the laptop, STX-PCX01, on the same Wi-Fi): open `http://<the address from the menu>`,
   for example `http://192.168.1.20:8787`. Type the code and a first name, Join. The first visit copies the
   game (about 71 MB; seconds on cable, up to half a minute on weak Wi-Fi), later visits start at once.
   The guest comes into the town next to the host. His look: menu, Together, "Your look".
7. To close the house: Together, "Open to the house" off (or stop the server with Ctrl+C).

Without the LAN, to try it on one PC: Together, "Play together" on, and a second tab with
`http://127.0.0.1:5173/?seat=2` (dev) or `http://127.0.0.1:8787/?seat=2` (npm run host -- --alone).

If the laptop cannot connect: the network is set to Public on the host (step 1), the rule is missing
(step 2), or the laptop is on a guest Wi-Fi that keeps devices apart. The game itself never changes the
firewall.

## Numbers (2026-09-26)

Smoothness: a headless walker (a 5 m circle at 1.55 m/s, a jump every 3 s) and a headless watcher running
the game's own jitter buffer at 60 frames a second, 30 s, measured against where the walker truly was
(`node tools/mp-harness.mjs smooth`); the line through the harness's TCP proxy:

| Line | Round trip | Delay drawn | Position error (m) p95 / max | Jump height error max (m) | Jitter a frame (m) p95 / max | Frames guessed | Corrections to the mover |
|---|---|---|---|---|---|---|---|
| Straight (this PC) | 0.2 ms | 94 ms | 0.000 / 0.000 | 0.034 | 0.000 / 0.032 | 9 of 1241 | 0 |
| Bad Wi-Fi: 5 + 0..30 ms each way, 100 ms stalls 0.1/s | 31 ms | 156 ms | 0.000 / 0.050 | 0.137 | 0.001 / 0.138 | 35 of 1171 | 0 |
| Internet-like: 40 + 0..40 ms, 150 ms stalls 0.2/s | 93 ms | 249 ms | 0.000 / 0.003 | 0.041 | 0.000 / 0.031 | 103 of 1185 | 0 |

(The jitter's max is the landing: the true path has a kink there. The internet line was 82% guessed with the
plan's 150 ms ceiling; with 250 it is clean, so the ceiling is 250.)

In the browser, two players in one tab (the second seat in an iframe, both driven at 60 frames a second),
walking side by side across the Vliet bridge, jumping, the mouse turning all the time, 15 s:

| Line | Own camera snaps | Own camera's largest step a frame | Other's drawn pace | Other's largest step a frame | Buffer empty | Guessed frames |
|---|---|---|---|---|---|---|
| Straight | 0 / 0 | 0.075 / 0.079 m | 1.549 / 1.543 m/s (true 1.55) | 0.030 / 0.030 m | 0 | 0 / 0 of 900 |
| Bad Wi-Fi proxy | 0 / 0 | 0.082 / 0.082 m | 1.548 / 1.543 m/s | 0.043 / 0.057 m | 0 | 16 / 18 of 900 |

The other's jump drawn about 85 ms after his own: peak 0.614 m against his 0.612 m.

Files (built game, served by the host, first visit over this PC's loopback): 240 files, 71 MB (66 MB over
the wire with gzip), all checked, 0.65 s. Second visit (after a new build of the code): 0 files, only the
manifest (35 KB). One texture changed and the manifest rewritten: that one file (68 KB) downloaded, the old
copy removed; the screen said "New version: downloading 0.1 MB".

Cost: the multiplayer part of a frame 0.1 ms (p50), 0.3 ms (p95) with 6 players (the host, a second seat and
four headless walkers), 0.0 / 0.1 ms with 2; the other five bodies add about 45 draw calls. Network: about
1.4 KB/s up per player, about 1.6 KB/s down per other player near. (The whole frame time with 6 figures could
not be measured here: the test pane was hidden, which slows the GPU. Measure it with the pane showing, or on
the laptop: `__scheldemist.perf()` in a dev tab.)

LAN: "Open to the house" on the test server's port opened `10.99.0.194:8961`; the page came over it; `/api/state`
and an AI setting from that address without a token were refused (401), a foreign Host name 403; switched off,
only 127.0.0.1 listened again.

## Tests

- `server/test/mp.test.ts` (16): the join code's letters and checks; tokens (hash only, a wrong one is nobody,
  the host is this computer, a guest's token on this computer is the guest, a forwarded request is not the
  host); the 68-byte frames and batches, junk refused; the plausibility check (walk, hurry, swim, omnibus pass;
  a late frame with the next right behind it passes; a teleport refused then taken after 2 s; a 12 m/s speed
  hack refused 200 times out of 200; a leap onto a roof refused; a clock ahead refused; a guest's snap once in
  30 s, the host's always); the world's clock in `world_state` with the row's copy following an old write; and
  on a real server: join (right code, wrong code, 5 a minute, the token's own profile), everything host-only
  refused from a guest, an unknown PC and a forwarded request (and allowed for an admin guest, save still not),
  the clock (alone: the tab's tick moves it and a tab's pause stops it; together: tabs' ticks and pauses do
  nothing, the server moves it once a player is in, "Pause all" stops it and reaches every socket), the
  movement socket (a walk reaches the host; a teleport and a speed hack do not; the mover hears nothing back;
  an old build is told to reload), and no joining when not together.
- The whole server suite on a clean copy of HEAD with this patch: 64 files, 1037 tests passed. `npm run build`
  passed.
- `tools/mp-harness.mjs`: the smoothness numbers above, the proxy, headless walkers, a second vite through
  the proxy (docs/testing.md, "Together").

## Pictures

In the hand-in folder (`scratchpad/m8a/results`): `m8a_ferry_side_by_side.jpg` (the host sees Anna on the ferry
of a new week, her name over her head), `m8a_ferry_host_sees_anna.jpg` (the same deck before her look
changed: both still in the default man's clothes, among the passengers), `m8a_bridge_host_sees_anna.jpg` (Anna walking over the Vliet bridge), `m8a_six_players.jpg` (six players, five
names), `m8a_walker_seen_by_host.jpg`. The browser's own screenshot of the two side by side (the host's view,
the guest's view in the corner, the same clock on both) was checked in the pane.

## What is not in M8a (known gaps)

- **Each PC runs its own crowd, traffic, boats, bridges and omnibuses** (M8b): two players see the town's
  people at different places; an omnibus on two PCs is in two places (a rider is still put on it).
- **The guest's corner shows the host's money, needs and jobs** (the server has one player row until M8c).
  A guest's calls that would change them are refused, so nothing of the host's moves.
- **A rowing boat, the velocipede, a handcart** are the rower's own; on another PC he is drawn sitting or
  riding without it (M8b: owner-streamed things).
- **The server's check has no walls** (a closed room): speed, height and jumps only.
- **Lantern light** of another player is not drawn yet; his body throws no lantern shadow.
- **A new version during play** is announced; the reload is the player's.
- **Loading an older save** empties `mp_player`: guests join again with the code (their looks too).
- **QR code** on the host's screen: not yet.
- A browser tab that is not the active one runs its timers once a second (Chrome): a guest who switches away
  is "away" and sends once a second; nothing breaks.

## For M8b

One street for all: the owner per cell for the townspeople and remote puppets, the world PC for the omnibus,
river traffic, bridges, the lock and cranes, platforms in their frame for boats and the ferry, shared doors;
then M8c's player id refactor (money, needs, pockets, talk per player; the clock's copy on the player row goes).
