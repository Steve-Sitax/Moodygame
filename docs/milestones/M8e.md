# M8e: outside the house

Phase M8e of `docs/multiplayer-plan.md` (section 10). Part A: https with a house certificate, and play over a
private VPN (NetBird) instead of an open router port. Plain http on the home network stays (plan, question 4).

## Part A: https and the VPN

| Part | What | Where |
|---|---|---|
| The house CA | Made once per host, the first time the house or the VPN opens: `data/tls/house-ca.key` + `house-ca.crt`. EC P-256, 10 years, "Scheldemist house CA (<hostname>)", CA with path length 0, keyCertSign + cRLSign, **extended key usage serverAuth only** (a guest who trusts it trusts it for websites only, never for code signing, mail or client logins). **Name constraints** (critical) permit only this PC's names (hostname, hostname.local, localhost, and the VPN name if NetBird knows it then) and only this PC's own addresses, each a /32: 127.0.0.1, its home-network addresses and its VPN addresses (all it has when the CA is made, the VPN's too while the VPN is off). A leaked key cannot sign for any other site, on the internet or on the guest's own network (tested: a certificate it signs for another name, a public address, or another private address such as 10.0.0.1 is refused; a certificate under it used as a client login is refused). Made again when it ends, when a new name or a **new address** of this PC is not covered (an address that goes away does not remake it), and once for a CA made before these rules (no EKU, or whole private ranges): **every guest then fetches `/house-ca.crt` again and trusts it as below**. A home network that hands out a new address to the host (DHCP) therefore means a new CA; a fixed address (a DHCP reservation for PCX) avoids that. | `server/src/mp/tls.ts` |
| The server certificate | `data/tls/server.key` + `server.crt`, signed by the house CA, 397 days, names: localhost, 127.0.0.1, the hostname, hostname.local, every home-network address and, with the VPN on, the VPN's name and addresses. Made again when that set changes or within 30 days of its end. | `tls.ts ensureHouseCerts` |
| The keys | Never leave `data/tls` (`data/` is gitignored), never logged, never served. Each key file is readable by this Windows user only (`%SystemRoot%\System32\icacls.exe /inheritance:r /grant:r <user>:F`, the absolute program; chmod 600 elsewhere). | `tls.ts` |
| The folder per save | `data/tls` for the real save `game.sqlite`; `data/tls-<save name>` for any other save file (a test stack's `data/test-<name>.sqlite`: `data/tls-test-<name>`, deleted by `teststack.mjs stop`); `SCHELDEMIST_TLS_DIR` names it by hand. A test stack never rewrites the real `data/tls`. | `tls.ts tlsDirFor` |
| Addresses that change | While the house or the VPN is open, every 30 s the server looks at this PC's addresses (`os.networkInterfaces()`; the NetBird name kept 5 min, "no name" 60 s). When the home-network or VPN addresses or the VPN name change, the listeners are opened again (new addresses opened, gone ones closed, http and https) and the server certificate is made again (the CA too for a new address it does not cover). The watch stops when both are closed. | `lan.ts setAddressWatch`, `mp/index.ts applyLan` |
| The host on his own secure name | A request or socket from one of this PC's own addresses the server is bound to (home network or VPN) is this PC, like 127.0.0.1: the host's browser on `https://pcx:8788` is the host, not a stranger. Host and Origin checks as before; a forwarding header naming another address is not the host. | `config.ts OWN_ADDRS`, `mp/auth.ts loopback`, `ai/routes.ts fromHost` |
| netbird | Run by its absolute path only: the first `netbird.exe` in an absolute folder on the PATH (looked up once; never the working folder or a relative PATH entry), else `C:\Program Files\NetBird\netbird.exe`. None: no VPN name. | `lan.ts netbirdPath` |
| The https port | While the house (or the VPN) is open, the same app on the next port: **8788** for 8787 (`config.ts TLS_PORT`), on 127.0.0.1 and the home-network addresses, both sockets as `wss://` (`/mp`, `/ws`). The https port takes exactly the names its certificate carries as Host and https Origin (`config.ts TLS_NAMES`); anything else gets 403. | `server/src/mp/lan.ts applySecure`, `config.ts` |
| Open to my VPN | A new host-only setting `vpn` (off by default; menu, Together; or `SCHELDEMIST_VPN=1`), like "Open to the house": it turns playing together on. On: https only (never plain http) on this PC's VPN addresses (100.64.0.0/10: NetBird, Tailscale). The VPN name comes from `netbird status --json` (3 s at most; no netbird: none), or `SCHELDEMIST_VPN_FQDN` by hand. | `mp/settings.ts`, `lan.ts vpnAddresses, vpnName` |
| The house certificate for guests | `GET /house-ca.crt`: the CA's public certificate only (`application/x-x509-ca-cert`), on the house's http and https ports while the house or VPN is open. | `mp/index.ts` |
| The join card, the panel | On an http page the join card offers the secure address (the same name the guest used, on 8788) and "How to trust it": the download and the steps for Windows, Firefox, Android, iPhone, with the fingerprints to compare. The host's Together panel shows the secure and VPN addresses, the VPN switch, and the house certificate (SHA-256 and SHA-1, the one Windows calls "Thumbprint"). A guest's panel shows the same offer. | `client/src/net/mp/househelp.ts`, `boot/netboot.ts`, `net/mp/together.ts` |
| wss | The client picks `wss://` when the page is https (`session.ts`, `api.ts`: `location.protocol`). | client |
| Facts | `/api/mp/info` has `house: { https, ca, sha256, sha1 }` (public). `/api/mp/host` (host only) has `vpn`, `secure: { house, vpn }`, `secureOpen`, and `tls: { sha256, sha1, spki, until }`: `spki` is the server key's SPKI hash for a test browser. | `mp/index.ts` |

Tests: `server/test/m8e-tls.test.ts` (the CA once, its EKU and constraints (/32 addresses), the server
certificate's names and chain, made again on a new address (and the CA for an address it does not cover, not for
one that went away), an old CA remade once, a forged certificate refused (another name, a public address, another
private address), a client login under it refused, the TLS folder per save, the vpn setting, the Host check, the
own addresses as this PC; the address watch moving the http and https listeners and the certificate to a new
address and stopping when closed; a real server with https and wss trusted by the CA, `/house-ca.crt` without any
key, a foreign name refused, the VPN https-only and host-only, the host from his own LAN address). Only fake VPN
names in tests.

### A guest trusts the house certificate (once per device)

1. On the http address (for example `http://pcx:8787`) the join card says **Safer: https://pcx:8788** with
   "How to trust it". Click **Get the house certificate** (or open `http://pcx:8787/house-ca.crt`).
2. Compare the fingerprint with the one in the host's Together panel.
3. Windows (Chrome, Edge): open the file, Install Certificate, Current User, "Place all certificates in the
   following store", Browse, **Trusted Root Certification Authorities**, Next, Finish, Yes.
   Firefox has its own store: Settings, Privacy & Security, View Certificates, Authorities, Import, tick "Trust
   this CA to identify websites".
   Android: Settings, Security, Encryption & credentials, Install a certificate, CA certificate.
   iPhone: open it in Safari, Allow; Settings, Profile Downloaded, Install; Settings, General, About,
   Certificate Trust Settings: on.
4. Open the secure address. The browser store is kept per address, so the guest joins once more there and the
   game is copied once more.

### Play over NetBird

1. Host (PCX): NetBird connected (`netbird status`). Menu, Together: **Open to my VPN** on. The panel shows
   `https://<pcx's NetBird name>:8788` and the 100.x address.
2. Restrict who may reach the port: in the NetBird dashboard, Access Control, a policy from a group of the
   players' peers to PCX only, TCP **8788** only; the default all-to-all policy must not cover these peers.
   Mind network routes: if NetBird routes the host's home subnet (e.g. 192.168.1.0/24) to peers, those peers
   reach the home-network addresses directly, including **plain http on 8787** ("Open to the house"). Give the
   players' group no such route, or keep the access rule to TCP 8788 to PCX only (a routed subnet needs its own
   rule for the route's resource; allow nothing but TCP 8788 to PCX there either).
3. Windows firewall on the host (Steve's own step, like M8a): allow TCP 8788 in on the NetBird interface only,
   for example
   `New-NetFirewallRule -DisplayName "Scheldemist https (NetBird)" -Direction Inbound -Protocol TCP -LocalPort 8788 -InterfaceAlias "wt0" -RemoteAddress 100.64.0.0/10 -Action Allow`
   (and, for https on the home network, the M8a rule with `-LocalPort 8788`).
4. The guest (with NetBird): gets the house certificate from the host (over the home network, or once through
   the https address past the browser's warning, comparing the fingerprint), trusts it as above, opens the
   secure address and joins with the code.

### For a test browser

A headless Chrome can skip trusting the CA with `--ignore-certificate-errors-spki-list=<spki>`. The host's
`/api/mp/host` gives it as `tls.spki`, or from the public certificate:

```sh
openssl x509 -in data/tls/server.crt -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | openssl base64
```

It changes whenever the server certificate is made again.

## Part B: the Service Worker, limits per seat, a VPN's line

| Part | What | Where |
|---|---|---|
| The Service Worker | Only a built game, never under vite dev, only in a secure context (https, or this computer), only with a manifest. Registered 15 s after the page loaded (then at an idle moment), so its copies come from the browser's cache and never compete with the first download. Its address carries the build's version (`/sw.js?v=<version>`): a new build is a new worker, which takes over at once (skipWaiting, clients.claim). One cache per version (`scheldemist-shell-<version>`); on taking over it deletes all but its own and the one before (a tab still running the old code may yet ask for one of its code chunks). It never reloads a page: the version push and its note stay the game's. | `client/public/sw.js`, `client/src/boot/sw.ts` (one line in `boot/netboot.ts`) |
| What it keeps, and why | **Only the app shell**: the page, the manifest, Vite's code and styles (`assets/*`), the loading picture (`boot/*`); about 5.5 MB. The game's own files (66 MB) are the IndexedDB loader's (it works on plain http too, where no worker can); a second copy in Cache Storage would hold them twice, so `/a/<sha256>` and every file the loader keeps go to the network untouched. The page, the manifest and `boot/*`: the network first (a new build must reach the player), the cache only when the network fails or hangs 6 s, never over an error answer (the host's "being built" page goes through). `assets/*`: the cache first (a hashed name is always the same bytes). Never `/api/*`, `/ws`, `/mp`, `/house-ca.crt`, `/sw.js`, a POST or another origin. With it a reload on a shaky VPN still gets the page, the code and the manifest. | `public/sw.js` |
| Limits per seat (movement socket) | Per guest seat and kind, a token bucket: states 40/s (burst 120: a 6 s stall let through whole), townspeople batches 30/s (burst 60), the world's state 20/s (burst 40), other text (pings, claims, releases, asks) 60/s (burst 120); job figures keep their M8d cap of 15/s. Over the limit: dropped (not passed on) and counted. Ten times a kind's normal rate for 5 s in a row: the seat is told "The host's game closed the line: this PC sent far more than the game ever sends. Reload the page to come back." and closed (code 4006; the client does not knock again). The host's PC is never limited. The numbers are all in one file with the client's real rates beside them. | `server/src/mp/limits.ts`, `mp/index.ts` |
| Limit per guest (HTTP) | `/api/*` per token: burst 60, then 20 a second; over it 429 "Too many requests from this PC at once. Wait a moment and try again." (`Retry-After: 1`). The host and the server's own calls never wait. (The lead's e.g. was 30/10; 60/20 because the start of a guest's game asks a few dozen routes at once, and a model call has its own budget anyway.) | `mp/index.ts` middleware |
| Stats | `/api/mp/stats` (host): `limitDropped`, `floodClosed`, `deadClosed`, `http429`; per player `limited: { state, puppets, world, figs, text }` and `http429`. | `mp/index.ts` |
| A dead line | Over a VPN a socket can die without a word (no FIN). The server pings every movement socket every 10 s (the browser answers by itself, even in a hidden tab) and closes one that did not answer the last ping (10-20 s); his seat then waits the 30 s grace as after any close. The client gives up a socket whose ping had no answer for 8 s (counted from the first unanswered ping, so a hidden tab's once-a-minute timer never trips it), and a connect that is not open after 10 s. | `mp/index.ts` heartbeat, `client/src/net/mp/link.ts`, `session.ts` |
| Reconnect | A dropped socket comes back by itself with the same token: 1, 2, 4, 8, then every 15 s (a tenth either way), at once when the browser says it is online again. The same seat (no second figure, nobody hears "went home" within the 30 s grace); his first state on the new socket goes to the others as a snap, so he is at his new place at once instead of sliding there. The player sees a small note at the top, never a dialog: "Connection lost, trying again...", then "Connected again." for 3 s; after 2 minutes "The host's game has not answered for 2 minutes. Is it still running there, and is the VPN on? Still trying every 15 s." | `session.ts`, `link.ts`, `mp/index.ts` |
| The jitter buffers on a VPN | Simulated with the game's own code on 60 and 120 ms round trips with 30 ms jitter a leg, drawn at 60 frames a second (table below). Players (80-250 ms) and townspeople (200-350 ms) need no change. Job figures had a fixed 200 ms: on two VPN legs they stood still on their newest state 41% of the frames and jumped. They now follow the line as the townspeople do (200-350 ms, the 95th percentile of how late plus 110 ms; on the house's own line it stays 200). The 5 s freshness of a player's place and the 3 s staleness of a PC's townspeople are far from any gap on these lines (largest 105 and 155 ms). | `net/mp/jobfigs.ts` (`figDelayWanted`), `street.ts` (`puppetDelayWanted`, same numbers), `remotes.ts` (comment) |
| The first download | Already per file: each file is stored in IndexedDB the moment it is whole and checked, so a reload keeps what came. Fixed: a reload in the middle said "New version: downloading 38 MB" with no count; it now says "Downloading 29 of 63 MB" and "Going on where the last visit stopped: 29 MB were kept", the bar going on from there, with "12 of 40 files". A file was given up after 120 s whatever came (a 10 MB model over a slow VPN takes longer), then fetched again uncached at play time: now given up only when no byte came for 30 s, and tried 4 times (waits 1, 2, 4 s); the bytes of a failed try no longer count as done. A new version is still told as one (the version of the last whole download is kept in localStorage). | `client/src/boot/files.ts`, `boot/netboot.ts` |

### Numbers (simulated, `client/test/vpnLine.test.mjs`)

| Line (30 ms jitter a leg) | Players: delay, guessed frames | Townspeople: delay, guessed frames | Job figures |
|---|---|---|---|
| Guest on the VPN, 60 ms round trip | 142 ms, 0 of 3301 | 200 ms, 0 | 0 held |
| Guest on the VPN, 120 ms | 171 ms, 0 | 216 ms, 0 | 0 held |
| The host seen by a guest on the VPN, 120 ms | 171 ms, 0 | 216 ms, 0 | 0 held |
| Two guests on the VPN, 120 ms each | 231 ms, 0 | 276 ms, 0 | 276 ms, 0 held (the old fixed 200 ms: 41% held) |

### Tests

- `server/test/m8e-limits.test.ts` (8): the bucket; a whole minute of normal play (20 states, 2 batches, world and
  figures 10 a second, pings, a burst of claims at 144 frames a second, a 6 s stall let through at once) never cut;
  a flood dropped and counted, 10x for 5 s closes, 4 s and a pause does not; the HTTP limit per guest. On a real
  server: two players walking 3 s, every state passed on, nothing dropped, no 429; 150 calls at once from the guest
  get 429s with the plain English error over the burst, 150 from the host none, a second later the guest is served;
  1000 states at once from the guest are cut to the burst and counted, the host's own flood is not limited, junk at
  30x closes the guest's socket with 4006 and the reason, the host stays; a socket ended without a word comes back
  on the same token and seat, one roster entry, no "went", his new place a snap; a socket that answers no ping is
  closed within 20 s, the host's stays.
- `client/test/link.test.mjs` (6): the waits, the liveness with a hidden tab's timers, the note's words, the
  download plan (first visit, a reload in the middle, a new version, an old store without the mark), a stalled
  file given up with its bytes counted. `client/test/sw.test.mjs` (5): the worker run in node against a stand-in
  cache and network. `client/test/vpnLine.test.mjs` (9): the table above. Run with
  `node --test client/test/link.test.mjs client/test/sw.test.mjs client/test/vpnLine.test.mjs`.
- `server/test/mp.test.ts` and `m8d-jobs.test.ts` pass as before.

### Review round 4 fixes (sockets)

| Finding | Fix | Where |
|---|---|---|
| The push socket `/ws` had no dead-line check (M3) | As on `/mp`: the server pings every push socket every 10 s and closes one that missed the last pong; it answers the page's `{type:"ping"}` with `{type:"pong"}` (a page cannot see a ws ping). The client pings every 10 s on the untouched timers, gives up a socket that heard nothing for 25 s after a ping (counted from the first unanswered one: a hidden tab never trips it) or a connect not open after 10 s, and comes back after 1, 2, 4, 8, then every 15 s (at once when the browser is online again). Back after a drop it asks again for the job board and sends a `resync` push: the actions and events, the hired hands' steps, the ballads, the ideas, the emigrants, the paper and a gang ask the server again. (The families' visit or menace pushed while the line was down is not asked again: its load builds the fortune teller's table a second time.) Alone on this PC: one small message every 10 s, nothing else changes. | `server/src/index.ts`, `client/src/net/api.ts connectPush`, `net/mp/link.ts` (`PUSH_PING_MS`, `PUSH_DEAD_MS`), `main.ts` |
| A 429 reached the player as "HTTP 429" or not at all | The fetch hook (`boot/netboot.ts`) tries a 429'd `/api` call again after its `Retry-After` (at most twice, waits up to 5 s; a longer one, the join tries' minute, is not retried). Then the host's own words ("Too many requests from this PC at once...") reach the caller; `api.ts call` has a plain line if none came. The guests' limit already sent `Retry-After: 1`; the join's "Too many tries" now sends `Retry-After: 60`. | `netboot.ts`, `link.ts retryAfterMs`, `api.ts`, `mp/index.ts` |
| The Service Worker kept any navigation as the offline page | Only `/` and `/index.html` (any query) are kept as the page; `/manifest.json` or `/boot/x.jpg` opened in a tab are their own shell files, anything else goes to the network untouched. | `client/public/sw.js`, `client/test/sw.test.mjs` |
| Moving to the secure address lost the guest's man (M5) | The browser keeps a token per address, so the move carries one: a guest's click on "Safer: https://..." (join card, Together panel) asks `POST /api/mp/transfer` (guest token only) for a one-time code (128 random bits, 60 s, single use, only its SHA-256 kept, in memory; a newer code of his ends the older one) and opens `https://<host>:8788/#move=<code>` (with `?seat=N` for a test seat). The fragment never reaches a server or a log. The new page takes `#move=` out of the address at once (`history.replaceState`) and redeems it with `POST /api/mp/move {code}`: a new token of the same player. Wrong, used or old codes: 403 "That link to the secure address was used already or is too old...", counted with the join tries (5 a minute per address, then 429, `Retry-After: 60`). **The old token ends** (its sockets are closed: `/mp` 4005, `/ws` 4001): it went over plain http, where anyone on the line could read it, and kept valid it would go on playing his man after he moved. The price: back on the http address he joins again as a new man; the secure address is his home now. A middle click or a copied link is the plain address (no code): there he joins again. | `server/src/mp/players.ts` (`newMoveCode`, `takeMoveCode`, `rotateToken`), `mp/index.ts`, `client/src/net/mp/househelp.ts`, `boot/netboot.ts` |

Tests: `server/test/m8e-move.test.ts` (5: a code once, its end after 60 s, a newer code ends the older; on a real
server the same id after the move, the old token refused with its sockets closed, one roster entry, the code
refused a second time, 5 wrong codes then 429 with `Retry-After: 60` shared with the join);
`m8e-limits.test.ts` (+1: `/ws` answers a ping with a pong, a push socket that answers no ws ping is closed within
20 s, the other stays); `client/test/sw.test.mjs` (+1), `client/test/link.test.mjs` (+2: the push liveness, the
429 waits).

To check in a browser (lead): (a) a guest on `http://pcx:8787` in the game clicks the secure address in the
Together panel: the https page opens without `#move=` in the address bar, no join card, the same man at his place
and money; the http tab's token no longer works. (b) The push line: a guest in the game, the host's server stopped
for 30 s and started again: the job board and the events come back without a reload (DevTools, Network, WS:
a `ping`/`pong` every 10 s). (c) `/manifest.json` opened in a tab on https, then the game offline: the page, not
the manifest.

### To check in a browser (not done here: no browser in this part)

1. The limits in normal play: host and a guest (test stack, `?seat=2`, or the laptop) play 5 minutes: the start,
   a talk, a shop, walking into a crowd, a job. `/api/mp/stats` on the host: `limitDropped` 0 and `http429` 0.
2. The Service Worker on https (part A's address, the house certificate trusted): after 15 s of play,
   DevTools > Application > Service Workers shows `sw.js?v=<version>` activated; Cache Storage has one
   `scheldemist-shell-<version>` with the page, the manifest, `assets/*`, `boot/*` and no model or texture. Reload:
   the page and the code come "(ServiceWorker)", the models from `blob:` (IndexedDB). New build on the host
   (`npm run host`): the version note comes; reload: the new version runs, the worker has the new `?v=`, the older
   caches but one are gone. On plain http (the house's address) no worker is registered.
3. Reconnect: a guest in the game, then the host's server stopped for 10 s (or the guest's network off): the guest
   sees "Connection lost, trying again..." at the top and can go on walking; server back: "Connected again.", the
   host sees one figure of him at his new place (no slide, no second one), nobody "went home". Offline 2 minutes:
   the plain message. A NetBird round trip if possible (`netbird down`, `netbird up`).
4. The first download resumed: a guest with an empty store (a new browser profile), reload in the middle of
   "Downloading x of 66 MB": after the reload "Downloading 29 of 63 MB" (on from what was kept) and "Going on
   where the last visit stopped"; `__scheldemistCache` shows `resumed: true`, the downloaded count only the rest.
