# Multiplayer plan: the town for the whole house

Written 2026-09-26. Research and design only. No code yet.

Steve (2026-09-26): "Other users in my house must be able to connect to my running server. Copy assets over
that they then use and cache locally. Moving will sync with server. Maybe a hash or calculated key to see if
files need redownload. I might put a new version online and then stuff must be pulled. No pause when
multiplayer mode is selected. Save only saves the part of the player, not other players. Then they can drop
out and in if they want. Research how real games do multiplayer. I want walking, jumping and interacting to be
as smooth as possible and not jerk back or mouse that jumps all over because of lag. So there will be stuff
done locally."

Earlier notes this plan builds on: `docs/milestones/M7-save-pause.md` (Multiplayer notes), the player profile
by id (`server/src/player/profile.ts`, `shared/character.ts` appearance code), warmth by player id
(`server/src/warmth.ts`).

## The short version

1. The host PC runs the server as today. With "Open to the house" on, the server also listens on the home
   network and serves the built game on one port. Others open `http://<host>:8787`.
2. A guest types a join code from the host's screen once. The server gives that browser a player token.
3. The first visit downloads about 66 MB. The browser keeps every file under its SHA-256 hash. Later visits
   download only the files whose hash changed.
4. **Your own walking, jumping, looking, swimming and rowing run on your own PC and are never corrected
   by the network.** The server checks that the moves are possible. It does not pull you back. This is how
   co-op games like Valheim work. The mouse is never touched by the network.
5. Other players are drawn about 100 ms in the past, smoothly between the positions they sent.
6. The server owns everything with a number: money, needs, jobs, trust, the clock, the weather, who holds
   which crate, which door is open.
7. The townspeople in a street are run by one player's PC (the first one there) and shown to the others.
   Far away they follow their day plan, which is the same for everybody.
8. No pause in multiplayer. The menu opens over a running town. Your man stands still and is marked "away".
9. The host's save holds the world and every player. Each player's part is kept by player id, so a
   player can leave and come back to the same man, with the same pockets.
10. The host pays every AI call. The AI setup stays on the host. Each player has a fair share of the calls.

---

## 1. Goals and non-goals

Goals:
- 2 to 6 players on one home network (wired or Wi-Fi).
- Walking, jumping, crouching, stairs, ladders, swimming, rowing and riding feel exactly as in single player.
  No pull-back, no mouse jumps.
- One shared town: the same clock, weather, events, townspeople, doors, boats and goods for all.
- Each player has his own man: look, name, money, needs, pockets, jobs, trust, home, diary.
- Drop in and drop out at any time. The world goes on.
- Assets are copied once and kept in the browser. A new version downloads only what changed.
- Single player stays as it is today (pause, sleep to morning, saves).

Non-goals (for now):
- Play over the internet. (Possible later through a private VPN; see phase M8e.)
- Strangers and cheat-proofing. The players are family. The server checks plausibility, not every step.
- More than 6 players.
- Fights. The backlog's "hate and fights" needs a server-owned hit check; see section 4.9.
- Split screen on one PC.

## 2. Architecture

```
 Host PC                                                    Guest PC / laptop            
 +------------------------------------------+               +-----------------------------+
 | node server (Hono + ws), one port 8787   |  HTTP         | browser                     |
 |  - serves client/dist (the built game)   |<------------->|  loader: manifest, IndexedDB|
 |  - /manifest.json, /a/<sha256>           |  WebSocket    |  game (three.js)            |
 |  - /api/*  (player id from the token)    |<------------->|  own movement: local        |
 |  - /ws     (binary moves + JSON events)  |               |  others: interpolated       |
 |  - SQLite: data/game.sqlite (world+all   |               +-----------------------------+
 |    players), saves, ai-config.json       |
 |  - model calls (host's AI setup)         |
 +------------------------------------------+
```

### 2.1 The host
- New setting on the host (Settings, "Open to the house", off by default). Off: the server binds to
  `127.0.0.1` as today (`server/src/config.ts HOST`). On: it binds to the home network too (`0.0.0.0`, or
  one chosen adapter). Also as an environment variable for the play copy: `SCHELDEMIST_LAN=1`.
- In multiplayer the server serves the **production build** (`client/dist`) itself, on the game port.
  Guests never use the Vite dev server: it sends hundreds of unbundled modules and hot-reload code, and its
  files have no stable names to cache. A new script `npm run host` builds, writes the manifest, and starts
  the server with `NODE_ENV=production` (this also turns `/api/dev/*` off).
- The origin check (`allowedHost`, `allowedOrigin` in `config.ts`) accepts the host's own LAN addresses and
  its computer name on the game port, and nothing else. This keeps the DNS-rebinding guard.
- Windows firewall: Steve adds one inbound rule himself, on the **Private** profile only (the home Wi-Fi
  must be set to "Private network" in Windows). For reference:
  `New-NetFirewallRule -DisplayName "Scheldemist (home network)" -Direction Inbound -Protocol TCP -LocalPort 8787 -Profile Private -Action Allow`.
  Windows may also ask once for node.exe; answer "Private networks" only.
- A stable address: give the host PC a fixed address in the router (DHCP reservation), or use its name
  (`http://pcx:8787`). The browser's file store is kept per address. A new address means a new download.

### 2.2 Joining
- The host's screen (the menu and a small corner note) shows the address and a join code, for example
  `KADE-47` (6 characters, no look-alike letters). The host can make a new code and can remove a player.
- A guest opens the address. The join screen asks for the code once. Then: "New man" (the character
  creator, `client/src/menu/character.ts`) or "Go on as <name>" (a man this browser played before).
- The server answers a good code with a player token (128 random bits). The browser keeps it in
  `localStorage` and sends it on every request and on the WebSocket. The server keeps only a hash of it.
  Wrong codes: 5 tries a minute per address.
- A dev switch `?seat=2` keeps a second token in the same browser, so two tabs can be two players in tests
  (a cookie would be shared by all tabs; that is why the token is not a cookie).
- The host's own browser on the host PC is player 1 with host rights. Host-only routes: the AI setup
  (`/api/ai/*`, it holds API keys), save, load, new game, population and world settings, "pause all",
  remove a player, `/api/dev/*`. They answer only a loopback request with the host token.
- A protocol number rides on the join. A client of another build is sent to download the new version first.

### 2.3 Why WebSocket, not WebRTC
- WebSocket runs on TCP. One lost packet holds the next ones back until it is sent again (head-of-line
  blocking). On the internet that gives stutters of 50-200 ms. WebRTC data channels and WebTransport can
  send without waiting ([Gaffer on Games][gaffer-udp], [Rune][rune-webrtc]).
- On a home network loss is rare and the round trip is 1-10 ms. The jitter buffer (4.3) hides a late
  packet. The server already uses `ws`, which turns Nagle's delay off.
- WebRTC to a server is a large stack (ICE, DTLS, SCTP) for little gain here. Decision: WebSocket now.
  Binary frames for movement, JSON for events. Look again only for internet play.

### 2.4 Discovery
- Minecraft finds LAN games by UDP multicast ([Minecraft wiki][mc-lan]). A browser cannot listen for UDP.
- So: the address and the code are on the host's screen, with a QR code for a phone or tablet. The guest
  types them once; the browser remembers the address.

## 3. Assets: download once, keep by hash

### 3.1 What there is (measured 2026-09-26)
| Part | Files | Size | Sent with gzip |
|---|---|---|---|
| Models (`public/models`, glb, Draco) | 29 glb (+ draco, json) | 33 MB | 26.5 MB |
| Textures (`public/textures`, jpg + png) | 140 | 30 MB | 30.7 MB (already compressed) |
| Audio (`public/audio`, ogg) | 56 | 7.1 MB | 7.1 MB |
| Code (`dist/assets`: JS, CSS, Draco wasm) | 7 | 4.6 MB (JS 3.4 MB) | about 1.5 MB (JS 1.06 MB) |
| **The built game, `client/dist`** | **236** | **75.2 MB** | **about 66 MB** |

The biggest files: `city.glb` 10.2 MB, `cathedral.glb` 3.5 MB, `churches.glb` 3.0 MB, `people.glb` 2.8 MB.

First join, 66 MB over the wire:
| Network | Real speed | Time |
|---|---|---|
| Cable (gigabit) | 500-900 Mbit/s | 1-2 s (the host's disk is then the limit) |
| Good Wi-Fi 5/6, same room | about 200 Mbit/s | about 3 s |
| Normal Wi-Fi, another room | about 80 Mbit/s | about 7 s |
| Weak Wi-Fi, 2.4 GHz, far away | about 25 Mbit/s | about 20 s |
| 6 players join at once on one 100 Mbit/s Wi-Fi | shared | about 30 s each |

Then the normal start (the city build, the shader warm-up) as today. A later join with no new version
downloads nothing: only the manifest (about 30 KB).

### 3.2 The manifest
- After `vite build`, a small script (`tools/manifest.mjs`) reads every file in `client/dist` and writes
  `client/dist/manifest.json`: `{ version, protocol, built, files: [{ path, size, sha256 }], total }`.
- `version` is Steve's number plus the short hash of the file list (for example `0.8.3+a41c9e`).
- The server sends `/manifest.json` with "no-cache", and every file also at `/a/<sha256>` with
  "cache for a year, immutable". The same bytes always have the same name, so a cache can never be wrong.
- The server serves only files listed in the manifest. No folder lists. Nothing from `data/`.
- Gzip or Brotli copies of the models and the code are made at build time, so the server does not zip on
  the fly.

### 3.3 Where the browser keeps the files
- A Service Worker with Cache Storage is the usual way ([Workbox][workbox]). **But both work only in a
  "secure context": HTTPS or localhost** ([MDN][mdn-secure]). `http://192.168.1.20:8787` is not one.
  `crypto.subtle` is not there either (the game's two dev uses already check for it).
- IndexedDB works on plain http. So the store is **IndexedDB, one entry per SHA-256**, holding the file.
- A small loader runs before the game:
  1. Fetch the manifest.
  2. List the hashes that are not in IndexedDB. Download them from `/a/<sha256>`, four at a time, with a
     progress bar in bytes (the loading screen being built now gets a "Downloading 34 of 66 MB" stage).
  3. Check each file's size and its SHA-256 (a small hash library as a declared dependency, run in a
     worker, because `crypto.subtle` is missing on http). A bad file is fetched again.
  4. Make a `blob:` URL for each file. One hook sends every asset request to its blob:
     `THREE.DefaultLoadingManager.setURLModifier` for the loaders (GLTF, textures, the Draco files), and
     the one `fetch` wrapper the game has already (`game/pause.ts`) for the sounds (`soundscape.ts` fetches
     and decodes). The 147 asset paths in the code stay as they are.
  5. After a full, checked download, entries that no manifest names any more are deleted.
- The code bundle (`dist/assets/*.js`, names already hashed by Vite) can stay in the normal browser cache.
- The browser may drop IndexedDB when the disk is full (`navigator.storage.persist()` also needs HTTPS). Then
  the loader simply downloads again.
- Later, if HTTPS on the LAN is wanted (a local certificate made with mkcert and trusted on each device), the
  same manifest can drive a Service Worker. Not needed now.

### 3.4 A new version
- Steve builds a new version on the host and restarts the server (or the server sees the new manifest).
- Players in the game get a push: "A new version is ready: 12 files, 8.4 MB." It downloads in the
  background. The game asks to restart at a quiet moment (not in a talk, not carrying). The player's man is
  kept on the server, so the restart is short.
- A client with an old protocol number cannot join. It downloads first.
- What never leaves the host: `data/*.sqlite`, the saves, `data/ai-config.json` (API keys), the logs,
  `.claude/`, the source. Only `client/dist` is served.

## 4. Netcode: what runs where

### 4.1 How real games do it (short)
- **Server authority with prediction and correction** (Valve Source, Overwatch, most shooters). The client
  moves at once from its own input, sends each input with a sequence number, and the server runs the same
  move. When the server's answer comes, the client starts from the server's position and plays again the
  inputs the server has not seen yet ([Gambetta, part II][gambetta-pred]). If they differ, the client is
  pulled to the server's answer. That is the "jerk back". Valve runs the server at 66 ticks a second
  ([Valve][valve-net]); Overwatch runs the same movement code on both sides so they rarely differ
  ([Ford, GDC 2017][ow-gdc]).
- **Entity interpolation**: other players are drawn between two positions already received, about 100 ms
  in the past ([Gambetta, part III][gambetta-interp]). Fiedler: at 30 packets a second a 150 ms buffer
  survives two lost packets in a row ([Gaffer, snapshot interpolation][gaffer-snap]).
- **Lag compensation**: for a hit, the server turns the others back to where the shooter saw them
  ([Gambetta, part IV][gambetta-lag]).
- **Delta compression**: send only what changed since the last state the other side confirmed
  ([Gaffer, snapshot compression][gaffer-delta]).
- **Owner authority in co-op**: Valheim gives each zone to one player's PC, which simulates its creatures;
  the others see them relayed ([Valheim zones][valheim-zones], [Edgegap][valheim-edgegap]). Fiedler's
  co-op cubes: whoever touches an object takes authority over it, and conflicts are rare
  ([Gaffer, networked physics][gaffer-authority]). It is not cheat-proof; it is lag-free.
- **Hiding corrections**: keep a visual error offset and let it fade over a few frames, never snap
  ([Gaffer, state synchronization][gaffer-state]).
- **Interest management**: send each player only what is near him ([Dynetis][aoi]).

### 4.2 The choice for Scheldemist: your own man is yours
The walk code (`client/src/player/firstPerson.ts`: collisions with the city, crates, carts, bridges,
stairs, quay edges, water, ladders, the omnibus platform, rowing, the velocipede) runs on the client against
geometry only the client has. To make the server own movement, all of that would have to run in Node too.
That is a large job, and it would bring the pull-back Steve does not want.

So:
- **Own movement is owner-authoritative.** Your PC moves your man and sends where he is. The server never
  sends a correction for normal moves. No reconciliation, so nothing can jerk back.
- **Mouse look is always local.** It is sent out, never received back. Nothing on the network moves the
  camera.
- **The server checks plausibility** from what it has (`shared/city.json`, the door states, the speed per
  mode): not faster than the mode allows (walk 1.55, hurry 3.4, swim 1.6 m/s, the velocipede, the
  omnibus), no jumps of position except the known ones (a load, the prison, a ladder, getting into a boat,
  the ferry), not inside a closed room. A small miss is only logged. A big one (more than 5 m) moves him
  back to the last good place, with a short fade to black, never a snap.
- **Actions are checked where he is on the server.** Talk, take, buy and steal need him within reach of the
  thing in the server's last good position (with a margin for 200 ms of movement).
- An upgrade path stays open: the movement messages carry input sequence numbers from the start. If fights
  come, or players from outside the house, the server can run the movement for combat and use lag
  compensation for hits (4.9).

### 4.3 Other players: interpolation
- Each client sends its own state **20 times a second** (every 50 ms): position, velocity, yaw, pitch,
  mode (walk, crouch, swim, climb, row, ride, bike, sit, sleep), the ground under the feet (a platform id),
  what is in the hands, and one-off flags (jumped, landed, stepped: for sounds and animation).
- The server sends each client one batch of the others' states 20 times a second.
- The receiver keeps a **jitter buffer** and draws others **100 ms in the past** (adaptive: 80-150 ms, from the
  measured jitter). Positions use Hermite curves with the sent velocity, so a jump is a clean arc. Turns use
  slerp.
- If packets stop, extrapolate up to 250 ms, then stand still. Never run on through walls.
- "Snap" flag for moves that are not a path (onto a ladder, into a boat, a seat, a load): no in-between.
- On stairs and slopes, a man on the ground is put on the receiver's own ground height at his x, z. No
  floating or sinking.
- A clock offset to the server is measured with pings (the best of the last 8), so all clients use the same
  timeline for interpolation and for the game clock.
- Other players are PlayerFigures from their appearance code (`shared/character.ts`, `player/body.ts`),
  with the walk, run, crouch, swim, row, climb, carry and ride animations picked from the mode and speed.
  Their footsteps and lantern light are local effects placed at their figure.
- You do not collide hard with another player's figure: a soft push, so a late figure can never block a
  door.

### 4.4 Moving platforms
Boats, the ferry, the omnibus, the opening bridges, the lock, a crane's jib: a man standing on something that
moves is sent **in that thing's frame**: `{ base: "rowboat:7", local x, y, z, yaw }`. The receiver puts him
on its own copy of the thing. If the boat on two PCs is 20 cm apart, the man still stands in the boat, not in
the water. (Unreal's character movement does the same with its "movement base".) The thing itself is owned
by one PC (4.6) and interpolated like a player.

### 4.5 Interactions that feel instant
| Kind | How | If the server says no |
|---|---|---|
| Doors | Open at once on your screen; the server keeps which doors are open and tells the others | Very rare (a locked door): it closes again with its sound |
| Take a crate, a lantern, a velocipede, a handcart, a boat | Shown in your hands at once; a request with a number goes to the server; the first request the server gets wins; you then own it and stream it | "Someone was quicker." It goes back to where it lay, in 0.3 s |
| Put down, stack | Local at once; the server records where it lies; others see it land | Never refused (only where it may lie, as today) |
| Money, needs, trust, pay, prices, buying | Server only, as today. The window waits for the answer (1-10 ms on the LAN) | The server's answer is the truth |
| Talk | Opens at once with the person turning to you; the line comes from the server as today | Busy: "Maria is talking with Anna." |
| Swimming, climbing, sitting | Local, sent as a mode | Not checked beyond speed |

### 4.6 Who owns what
| Thing | Owner | Sent |
|---|---|---|
| Your man, your look, your camera | Your PC | 20/s |
| A boat you row, the handcart you push, the velocipede you ride, a crate you carry | Your PC while you hold it | 20/s while held |
| Townspeople in a street near players | The PC of the first player in that area (4.7) | 10/s, only changes |
| Omnibuses, river traffic, bridges, the lock, cranes, drays | The "world PC": the host's browser if it plays, else the lowest player id online | 5-10/s |
| Clock, weather, tide level, events, the director | Server | On change; the clock as an anchor |
| Money, needs, trust, jobs, pockets, rent, homes, deeds, police | Server | On change, to that player |
| Which door is open, who holds which thing | Server | On change, to all near |
| Birds, leaves, smoke, river heave, lamp flicker, rain, eaves | Every PC for itself | Nothing |

Ownership moves when the owner leaves: the next player near takes over from the last state sent.

### 4.7 Interest management
- The town is split into cells of 64 m. Each player gets townspeople and things of the cells within about
  90 m (the crowd spawns at 55 m and lets go at 68 m today: `client/src/game/town.ts`).
- Other players: always sent (6 at most), but at 2/s when more than 150 m away (the fog hides them anyway).
- Speech bubbles and sounds of others: only within hearing, about 30 m. World news (the paper, events): all.

### 4.8 Numbers
- Send rates: own state 20/s up; others 20/s down; townspeople 10/s (standing ones 1/s); world movers 5-10/s.
- Interpolation delay: 100 ms (80-150 adaptive). Extrapolation: 250 ms at most.
- One player's state: about 32 bytes (position as floats, velocity and angles as 16-bit numbers, flags, base
  id), plus frame and TCP headers.
- Bandwidth for 6 players, all in the same street (the worst case):
  - each client up: own state 20 x ~80 B = 1.6 KB/s; the owner of the street also sends 50 people x ~16 B
    x 10/s = 8 KB/s;
  - each client down: 5 others 20 x ~200 B = 4 KB/s, plus the street 8 KB/s;
  - the server out, all clients: about 75 KB/s (0.6 Mbit/s).
  A home Wi-Fi gives 50-500 Mbit/s. Bandwidth is not the problem; Wi-Fi jitter is, and the buffer handles it.
- The server CPU: relaying 6 x 20 messages a second is nothing for Node. The model calls are the only heavy
  part, as today.

### 4.9 Later: fights
The backlog plans street fights after a spike. For fights, owner authority is not enough (who hit whom must
be fair). Then: the server keeps the last 1 s of every player's positions; a punch is checked against where
the target was on the puncher's screen (now minus the interpolation delay minus half the round trip), the
way Source and Overwatch do it. The movement messages already carry sequence numbers, so this can be added.

## 5. Townspeople and the world

### 5.1 What the code does today
- The server makes the residents (`/api/town`: homes, work, family, a day plan `sched`). The client works out
  where each one should be at a game hour with `activityAt(schedule, day, hour)`
  (`server/src/town/schedule.ts`, imported by the client). **This layer is the same on every PC** if the
  clock is the same.
- Near the player, residents become "puppets" of the crowd (`client/src/game/crowd.ts`): up to 50, spawned at
  55 m, let go at 68 m, walked with A* on a walk grid built round the player, keeping round the player,
  standing, talking in pairs, playing tag. This uses `Math.random` (14 places in `town.ts`, 32 in `crowd.ts`)
  and frame time. **This layer is not the same on two PCs.** Two players side by side would see Maria at two
  different places.
- Other moving things are local too: river traffic (`world/river.ts`, waits and speeds by frame time),
  bridges and the lock (`world/bridges.ts`, `world/lock.ts`), drays and carts (`world/traffic.ts`, with a
  "stuck" watchdog), the omnibus (a timetable from `shared/omnibusLines.ts`, but held up by local traffic).
  The tide is from the clock (`world/tide.ts`), so it is already shared.

### 5.2 Choices
| Way | For | Against |
|---|---|---|
| A. Make the crowd deterministic (seeded random, fixed steps) | No traffic | Breaks as soon as a person steps round a player, a crate or a cart that is not on every PC. Fragile. |
| B. The server runs the street for all | One truth | The walk grid, A*, the carts, the crates must all run in Node. Large. |
| **C. Owner per area (Valheim)** | Reuses `crowd.ts` as it is; the owner sees and avoids everyone | Traffic from the owner; a handover when he leaves |

**Choice: C.** The first player in a cell owns its puppets. His crowd code runs as today (it now also keeps
round the other players' figures). It sends each puppet's id, position, facing and animation. The other PCs
draw those puppets as "remote puppets": no A*, only interpolation and the animation. When the owner leaves,
another player there takes over from the last state. With nobody near, the people go back to the day plan,
which all PCs agree on.

- Talk: when a player talks to someone, the server marks the resident "held by player 2" and tells all; the
  owner's crowd stops the puppet and turns it to him (the `held` flag exists today).
- Street talks (`npc_convo` bubbles), stalls, thieves, police walking up: the server decides, as today; the
  owner's crowd plays it; all see it.
- Witnesses of a theft: the thief's PC reports who saw it (`client/src/game/deeds.ts witnesses`), from the
  now shared puppets. The server clamps it, as today. Other players can be witnesses too (a new line: "You
  saw Anna take the lantern.").
- River traffic, omnibuses, bridges, the lock, cranes and drays: owned by the "world PC" (4.6) and sent at
  5-10/s. Later, where a timetable exists, make them follow the shared clock exactly and send nothing.

### 5.3 The clock
- Today the clock is in the `player` row and moves when a tab asks (`POST /api/tick` every 10 s,
  `server/src/day.ts tick`). With two tabs that must change.
- The world clock moves to `world_state` and the server moves it itself, every 10 s, while at least one
  player is in the game and the host has not paused. The tick route stays as each player's heartbeat (where
  he is, the lantern: `warmth.ts`), and his needs move with the world hours.
- Every client shows the time from the server's anchor plus the measured offset. All clocks, bells and
  omnibuses agree.

## 6. No pause in multiplayer

- `client/src/game/pause.ts` freezes `performance.now`, the timers, `fetch` and the sound. In multiplayer
  mode it does none of that. The server pause (`save/gate.ts` holders) is not used by guests.
- The Esc menu opens over the running town. Your keys go to the menu; your man stands still. Others see him
  "away": he takes out a pipe or leans on a wall, and a small note shows when they look at him.
- Losing the mouse to another window is also "away", not a pause.
- An away man is safe from thieves and the police for 10 real minutes. After that he counts as present again
  (he is still in the street). A man who is away for 30 real minutes goes home by himself (he leaves the
  world, 7.3).
- The host has one "Pause all" button. It uses the existing gate: every player sees "Paused by the host".
  Nothing else can pause the world.
- Saving by the host while others play: the quiet autosave way (`save/saves.ts quiet`): wait for a moment
  with no model call, never freeze the town. The hourly autosave runs on the server's own clock.

### 6.1 Sleep
The clock is shared, so one player cannot jump the night alone.
- **Everyone online is in a bed (or dropped where he stood): the night passes at once**, as in single player.
  This is the rule of Stardew Valley and Valheim ([Stardew wiki][stardew-mp]); Minecraft lets the server
  choose a share ([Minecraft game rules][mc-rules]).
- **Only some sleep:** the sleeper's screen fades. He lies in the bed; the others see him there. The world
  goes on at its normal pace (a night of 8 game hours is 16 real minutes). His sleep need fills as it would.
  He can get up at any time (a short sleep, part of the rest), or leave the game from the bed. The screen
  says who is still up: "Anna and Piet are still out."
- The night's summary, the home's night talk and the dream are per player, written when his sleep ends.
- A player who drops dead tired sleeps rough where he stands, as today; the gangs may find him.

## 7. Saves

### 7.1 What is in the save
- One file, on the host, as today: `data/game.sqlite` and the slots in `data/saves/`. It holds the world
  **and** every player's part, each by player id (as Stardew keeps its farmhands in the host's save).
- World part: the clock, the weather, the town and residents, NPC personas and memories, events, the director,
  the board, shops and prices, the boats, stealables, the paper, the log.
- Player part (by `player_id`): the profile (look, name), money, needs, pockets (`item`), jobs he holds,
  faction trust, relationships with each NPC, deeds and police record, rent and home, carts and velocipedes he
  owns, letters and diary, the arrival stage, and `client_state` (pose, boat, what is in his hands, the run of
  his job; the table already has `player_id`).

### 7.2 "Save only saves the part of the player"
- A guest's "Save" writes only his own part at once: his `client_state` (where he stands, what he holds). His
  money, needs and pockets are already on the server; nothing to send. It never writes the world and never
  touches other players.
- Only the host saves or loads the world (the slots). A load in multiplayer asks "This sends everybody back
  to <time>. Go on?" and every guest's page restarts, as the `loaded` push does today.
- Later, if wanted: "Take my man with me" exports a player's part as a small file, for another host. Not in
  the first phases.

### 7.3 Dropping out and back in
- The WebSocket closes. For 30 s nothing happens (a Wi-Fi hiccup; a reconnect goes on as before).
- After 30 s he "goes home": his figure leaves the street; the others see "Piet went home."
- What he held: the goods of his job and his handcart stay with him (off the street); a boat he rowed is
  moored where it was; a hired thing counts on as hired.
- A job in progress is put on hold (the `/api/jobs/:id/hold` route exists) and its time limit waits while he
  is gone, up to the end of that game day. Then it expires as today.
- A talk is closed. A reply still on its way is kept in the NPC's memory, not shown.
- His needs do not move while he is gone. The rent day still comes; the week still ends.
- Back in: the loader, then "Go on as Piet". He comes back where he left (his pose), with a fade in. If that
  place is not safe now (a closed room, a boat that left) he stands at the nearest door or on the quay.
- A new man arrives on the ferry at the Werf, as a new week does (`arrival.ts`, `ferryArrival.ts`), on his
  own ferry that the others can see come in.

### 7.4 Single player
Stays as it is: pause, sleep to morning, five slots and two autosaves, `127.0.0.1` only. A save is
single-player or multiplayer by a world setting. Turning "Open to the house" on in a single-player save makes
Jef player 1, the host.

## 8. Conversations and AI

- Talks are per player. The talk state (`hooks/dialogue.ts`, `town/talk.ts`) is kept by player and NPC.
  An NPC talks with one player at a time; a second one sees "busy" and can wait.
- Players near a talk see it as street bubbles (`game/bubbles.ts`): the NPC's lines and the player's
  chosen lines. Typed lines show as bubbles too, after the regex gate (open question 5).
- Every NPC has one memory for all players. Each memory names which player it is about ("Anna gave the
  widow her purse back"). Relationships (trust, affection, favours, grudges, "how I see him") are per player.
  Gossip carries a player's deeds to other people, with his name. This is the same idea Mantella uses: an NPC
  knows only what it saw or heard ([PC Gamer on Mantella][mantella]).
- Prompts: the engine text says "Jef" today and the profile middleware (`player/prompt.ts shownJson`) turns
  it into the player's name. In multiplayer the actor in the log and in memories is a player id, and each
  prompt names the player being spoken to and, where it matters, the others near.
- The director is one for the world. Its prompt has a short line for each player online. It places events
  and leads near players, fairly: no player gets two leads before each has one.
- The board is one for the town. More players, more jobs (3-5 plus 2 per extra player, still clamped). A job
  one player takes is gone for the others.
- **The host pays.** Every call runs on the host's AI setup (`docs/ai-setup.md`), on the host's login or
  keys. Guests cannot see or change it. Walk-around mode works in multiplayer too.
- **Budget.** Today 120 calls a game day (`config.ts CALLS_PER_DAY`). Proposal: the world hooks (director,
  board, paper, ballads, town routines) keep their shares once; the per-player hooks (talk, typed lines,
  outcomes, the home at night, letters, diary, epilogue) get a share per player (for example 30 talks a day
  each). The day's total grows with players: 120 + 60 per extra player, set by the host. A player whose share
  is gone gets the hand-written lines; the others are not affected.
- **At the same time.** Several players may talk at once. At most 3 model calls run together; the rest wait in
  a queue, talk first, world hooks last. The 20 s limit counts from the start of the call, not from the queue.

## 9. What each system needs

S: a day or less. M: a few days. L: a week or more.

| System | What changes | Size |
|---|---|---|
| Server player id (all routes) | The request's player from its token; `player(db)` becomes `player(db, pid)`; 117 queries with `WHERE id = 1` in 54 files; the `player` table loses `CHECK (id = 1)`; a test that fails on a new `id = 1` | L |
| World clock | From the `player` row to `world_state`; the server moves it; per-player needs per hour | M |
| Push channel | `broadcast` (86 calls) splits into "to all" and "to player N"; `jobsPayload` is per player; binary movement frames | M |
| Hosting | LAN bind setting, serve `client/dist`, origin check for LAN names, join code, tokens, host-only routes, `npm run host` | M |
| Assets | `tools/manifest.mjs`, `/a/<sha256>`, the IndexedDB loader, the URL hook, the version push | M |
| Loading screen | A download stage with bytes and version; "new version" banner | S |
| Movement net | Send own state, jitter buffer, interpolation, platforms in their frame, the plausibility check | L |
| Other players' figures | PlayerFigure from the look code, animations from mode and speed, footsteps, lantern, soft push | M |
| Townspeople | Owner per cell, remote puppets, handover, `held` by player, keeping round all players | L |
| Talk | Talk state per player; busy NPCs; bubbles for bystanders; memories name the player | M |
| Jobs | Job taken by a player id; board size by players; goods owned while carried; hold on leave | M |
| Twists and job figures | The figures of a twist (the thief running off, the foreman, the briber) are made by the job holder's PC and sent like puppets | M |
| Deeds, thieves, police | Deeds by player; witnesses from shared puppets and players; the police come for the right man; a cell per player | M |
| Boats and rowing | The rower owns the boat; a second player can sit in it (in its frame); hire per player | M |
| The omnibus | Owned by the world PC; riders in its frame; fare and seat per player | M |
| The ferry arrival | Arrival stage per player; each new man gets his own ferry; others see it dock | S |
| Interiors and halls | Door states shared; interiors are real rooms (never instanced), so all see the same room; tavern seats and dice per player | M |
| The gang and the night | Night jobs per player; gangs pick a player who sleeps rough | S |
| Needs and warmth | Per player (warmth already has a player id); frozen while he is gone | S |
| Homes and rent | Lease and rent per player; two players may share a rented home and split the rent (decide in M8c) | M |
| Sleep | The rule in 6.1; the night summary per player | M |
| Menus and settings | Host / Join screens; the address, code and QR on the host; world settings host-only; own settings (mouse, sound, graphics) stay per browser | M |
| Saves | Player part by id; guest "Save" writes only his `client_state`; world save host-only; server-clock autosave | M |
| AI budget | Shares per player; a queue with at most 3 calls at once | S |
| Director and events | All players in its prompt; fair leads | S |
| Testing | A multi-client harness (below) | M |

### Testing
- A test stack in LAN mode (`teststack.mjs start mp`): the production build, a copy of the save, host on
  `127.0.0.1`.
- Two to four tabs, each with `?seat=N`, so each is its own player. The kit gets `t.players()`, `t.seat()`,
  `t.as(n, fn)`.
- A small Node bot client that joins, walks a set path and jumps, for load and for smoothness numbers.
- A delay proxy between the tabs and the server: 20-150 ms delay, jitter, short stalls, to test the jitter
  buffer on purpose.
- Numbers to watch: corrections sent (must be 0 in normal play), the largest jump of a remote figure between
  frames, the interpolation buffer never empty, bytes per second per client.
- A real LAN check on two machines: the desktop as host, the laptop on Wi-Fi as guest.
- The path check (`__scheldemist.paths()`) as before; and a check that every player can reach the ferry
  landing and his home.

## 10. Phases

Each phase ends with a run in the browser, as every milestone.

### M8a: two in the fog (the first playable)
Two players on the LAN walk the town and see each other smoothly.
- "Open to the house", production build served by the server, join code, tokens, host-only routes.
- The manifest, the IndexedDB store, the download stage on the loading screen, the version check.
- The server's world clock and weather for all; no pause in multiplayer mode; "away".
- Own state sent at 20/s; other players drawn with the jitter buffer and interpolation; their look, walk,
  jump, crouch, swim animations and footsteps.
- Guests are visitors in this phase: they walk, jump, swim and look; they cannot yet work, buy or talk.
  The townspeople are still each PC's own (a known gap, fixed in M8b).
- Checks: two tabs on the test stack (`?seat=2`) and the desktop and the laptop over Wi-Fi. A guest's first join shows
  "Downloading N of 66 MB" and then the town; the second join downloads 0 files; one changed texture after a
  rebuild downloads that file only. Two players walk together, jump on crates, go up the quay stairs, swim:
  0 corrections, no jumps of the other figure. The same time and weather on both screens. Esc on one does
  not stop the other.

### M8b: one street for all
The same townspeople and moving things on every screen.
- Owner per cell for townspeople; remote puppets; handover.
- The world PC for the omnibus, river traffic, bridges, the lock, cranes, drays.
- Platforms in their frame: a player on the omnibus platform, in a rowing boat, on the ferry.
- Doors shared, with instant opening.
- Checks: two players side by side see Maria at the same stall and the same omnibus pass; the owner leaves the
  street and the people walk on for the other without a jump; one rows, the other stands on the quay and sees
  the boat move smoothly; both ride the omnibus; one opens a door, the other sees it open.

### M8c: each his own man
Player ids everywhere on the server; per-player saves; drop out and in.
- The player id refactor (section 9, first row), the player part in the save, `client_state` per player.
- Money, needs, warmth, pockets, shops, rent, homes, sleep (6.1) per player.
- Talk per player with shared NPC memories; busy NPCs; bubbles for bystanders.
- Take and carry with owner authority (crates, lanterns, velocipedes, the handcart).
- Checks: Anna buys bread, Piet's money does not move; Piet leaves in the middle of a job and comes back 10
  minutes later where he was, with the crate in his hands; both talk to different people at the same time;
  both reach for one lantern and one gets it, the other sees "someone was quicker" and no jump; everyone
  in bed passes the night; one alone in bed does not.

### M8d: shared work
- Jobs, twists and job figures per player; the board sized by players.
- Deeds, thieves and the police with players as witnesses; the prison per player.
- The director and events for all players; the AI budget per player and the call queue.
- The night: night work, gangs; the week's end with an epilogue per player.
- Checks: two players on two jobs at once, each with a twist; one steals, the other sees it and is asked by
  the police; the director's lead goes to the player who has none yet; one player's talk share runs out and
  the other still gets model lines.

### M8e (later, maybe): outside the house
- HTTPS (a local certificate) and a Service Worker; play over a private VPN rather than an open router port.
- Server-owned movement for combat and lag compensation, if fights come.

## 11. Open questions for Steve

1. **Trust the guests' movement?** Recommendation: yes (owner authority with plausibility checks). It is
   the only way to be free of pull-back without moving all the walking code into the server. Revisit only for
   strangers or fights.
2. **Sleep when not everyone sleeps?** Recommendation: the night passes only when all players online sleep; a
   lone sleeper rests in bed while the world goes on (6.1).
3. **A player's week ends (health 0) while the others play on?** Recommendation: he gets his epilogue and may
   start a new man on the ferry; the world goes on. The world's own week ends for all on day 7, with an
   epilogue each; then the host starts a new week.
4. **Plain http on the LAN?** Recommendation: yes, with IndexedDB for the files (3.3). HTTPS needs a
   certificate trusted on every device; add it only for internet play.
5. **Show other players' typed lines as bubbles?** Recommendation: yes, after the regex gate; they are family.
   Their typed lines go to the host's AI setup, with the host's "typed lines" setting (`docs/ai-setup.md`).
6. **AI calls:** Recommendation: the host pays everything; 120 calls a day plus 60 per extra player, with a
   talk share per player so one chatty player cannot use up the day.

## Sources

- [valve-net]: Valve, Source Multiplayer Networking. https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking
- [gambetta-pred]: G. Gambetta, Fast-Paced Multiplayer II: Client-Side Prediction and Server Reconciliation. https://www.gabrielgambetta.com/client-side-prediction-server-reconciliation.html
- [gambetta-interp]: G. Gambetta, Fast-Paced Multiplayer III: Entity Interpolation. https://www.gabrielgambetta.com/entity-interpolation.html
- [gambetta-lag]: G. Gambetta, Fast-Paced Multiplayer IV: Lag Compensation. https://www.gabrielgambetta.com/lag-compensation.html
- [gaffer-snap]: G. Fiedler, Snapshot Interpolation. https://gafferongames.com/post/snapshot_interpolation/
- [gaffer-delta]: G. Fiedler, Snapshot Compression. https://gafferongames.com/post/snapshot_compression/
- [gaffer-state]: G. Fiedler, State Synchronization. https://gafferongames.com/post/state_synchronization/
- [gaffer-authority]: G. Fiedler, Networked Physics (the authority scheme of the co-op cubes demo). https://gafferongames.com/categories/networked-physics/
- [gaffer-udp]: G. Fiedler, Why can't I send UDP packets from a browser? https://gafferongames.com/post/why_cant_i_send_udp_packets_from_a_browser/
- [ow-gdc]: T. Ford, Overwatch Gameplay Architecture and Netcode, GDC 2017. https://www.gdcvault.com/play/1024001/-Overwatch-Gameplay-Architecture-and
- [valheim-zones]: Valheim wiki, Zones. https://valheim.fandom.com/wiki/Zones
- [valheim-edgegap]: Edgegap, Valheim multiplayer backend deep dive. https://edgegap.com/blog/valheim-multiplayer-game-backend-deep-dive
- [rune-webrtc]: Rune, WebRTC vs WebSockets for multiplayer games. https://developers.rune.ai/blog/webrtc-vs-websockets-for-multiplayer-games
- [mc-lan]: Minecraft wiki, Setting up a LAN world. https://minecraft.fandom.com/wiki/Tutorials/Setting_up_a_LAN_world
- [mc-rules]: Minecraft wiki, Game rule (playersSleepingPercentage). https://minecraft.fandom.com/wiki/Game_rule
- [stardew-mp]: Stardew Valley wiki, Multiplayer. https://stardewvalleywiki.com/Multiplayer
- [workbox]: Chrome for Developers, workbox-precaching (manifest with revisions). https://developer.chrome.com/docs/workbox/modules/workbox-precaching
- [mdn-secure]: MDN, Features restricted to secure contexts. https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts/features_restricted_to_secure_contexts
- [aoi]: Dynetis Games, Interest management for multiplayer online games. https://www.dynetisgames.com/2017/04/05/interest-management-mog/index.html
- [mantella]: PC Gamer, the Mantella Skyrim mod (NPCs know only what they were there for). https://www.pcgamer.com/games/the-elder-scrolls/this-skyrim-mod-that-makes-npcs-ai-chatterboxes-just-got-a-massive-overhaul/
- Unreal Engine, Networked movement in the Character Movement Component (movement bases). https://dev.epicgames.com/documentation/unreal-engine/understanding-networked-movement-in-the-character-movement-component-for-unreal-engine

[valve-net]: https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking
[gambetta-pred]: https://www.gabrielgambetta.com/client-side-prediction-server-reconciliation.html
[gambetta-interp]: https://www.gabrielgambetta.com/entity-interpolation.html
[gambetta-lag]: https://www.gabrielgambetta.com/lag-compensation.html
[gaffer-snap]: https://gafferongames.com/post/snapshot_interpolation/
[gaffer-delta]: https://gafferongames.com/post/snapshot_compression/
[gaffer-state]: https://gafferongames.com/post/state_synchronization/
[gaffer-authority]: https://gafferongames.com/categories/networked-physics/
[gaffer-udp]: https://gafferongames.com/post/why_cant_i_send_udp_packets_from_a_browser/
[ow-gdc]: https://www.gdcvault.com/play/1024001/-Overwatch-Gameplay-Architecture-and
[valheim-zones]: https://valheim.fandom.com/wiki/Zones
[valheim-edgegap]: https://edgegap.com/blog/valheim-multiplayer-game-backend-deep-dive
[rune-webrtc]: https://developers.rune.ai/blog/webrtc-vs-websockets-for-multiplayer-games
[mc-lan]: https://minecraft.fandom.com/wiki/Tutorials/Setting_up_a_LAN_world
[mc-rules]: https://minecraft.fandom.com/wiki/Game_rule
[stardew-mp]: https://stardewvalleywiki.com/Multiplayer
[workbox]: https://developer.chrome.com/docs/workbox/modules/workbox-precaching
[mdn-secure]: https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts/features_restricted_to_secure_contexts
[aoi]: https://www.dynetisgames.com/2017/04/05/interest-management-mog/index.html
[mantella]: https://www.pcgamer.com/games/the-elder-scrolls/this-skyrim-mod-that-makes-npcs-ai-chatterboxes-just-got-a-massive-overhaul/

## Steve's decisions (2026-09-26)

- Movement: each player's own PC moves them; the server only checks that a move is possible. Revisit for strangers or fights.
- Sleep: the night passes only when every player online is in bed; a lone sleeper rests while the world goes on.
- Death: the player gets his ending, then may start a new character arriving on the ferry; the world goes on.
- AI calls: the host pays; no daily limit by default, with a limit available in the settings.
- Server settings (AI setup, limits, world settings, open to the house, join code): only a session on the host PC or a player marked admin can change them.
- Taken as recommended (not asked): plain http on the home network with files kept in IndexedDB; guests' typed lines shown as speech bubbles after the filter.
