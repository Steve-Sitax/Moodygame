import type { Server, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { Hono } from "hono";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { allowedHost, allowedOrigin, DEV, PORT } from "../config.ts";
import type { DB } from "../db.ts";
import { gateState, isPaused, setPaused } from "../save/gate.ts";
import { reportWhere, whereNow } from "../warmth.ts";
import { TICK_EVERY_MS } from "../../../shared/clock.ts";
import { appearanceCode, defaultFor } from "../../../shared/character.ts";
import { animalBatchOk, animalKeep, animalNums, decodePuppets, decodeState, encodeBatch, figBatchOk, figSetSender, FLAG, MODES, MP_PROTOCOL, MSG_ANIMALS, MSG_FIGS, MSG_PUPPETS, puppetBatchOk, puppetKeep, puppetNums, SEND_MS, type MpState, type MpText, type RosterEntry } from "../../../shared/mpProtocol.ts";
import { figHolders, jobPins } from "../town/walkup.ts";
import { seekPins } from "../director/families.ts";
import { handPins } from "../town/hire.ts";
import { profileOf, saveProfile, storedProfile } from "../player/profile.ts";
import { asPlayer, setOnlineIds, setPositionSource, setWalkerSource } from "../player/current.ts";
import { ackRest, allAsleep, reportPos, restAcked, restOf, takeWoke, wakeRest } from "../rest.ts";
import { ensurePlayerRow } from "../player/multi.ts";
import { TOKEN_HEADER, whoOf, whoOfUpgrade, type Who } from "./auth.ts";
import { applySecure, closeLan, closeSecure, lanOpen, lanUrls, openLan, secureCerts, secureOpen, secureUrlFor, secureUrls, setAddressWatch } from "./lan.ts";
import { houseCaPem } from "./tls.ts";
import { Plausible } from "./plausible.ts";
import { FLOOD_CODE, FLOOD_S, FLOOD_WHY, HTTP_WHY, HttpLimiter, SeatLimiter, type SocketKind } from "./limits.ts";
import { addGuest, cleanGuestName, countTry, HOST_ID, listPlayers, mayTry, MAX_PLAYERS, MOVE_MS, newMoveCode, playerById, poseOf, removeGuest, rotateToken, sameCode, savePose, setAdmin, takeMoveCode } from "./players.ts";
import { mpOn, mpSettings, newCode, setMp } from "./settings.ts";
import { autoBuild, currentManifest, mountStatic, reloadManifest } from "./static.ts";
import { Owners, WorldPc, type OwnerRow } from "./street.ts";
import type { MapModel } from "../mapview/model.ts";
import { goods } from "../goods/store.ts"; // M8f: a player gone for good sets down what he carried

// M8a multiplayer: "two in the fog" (docs/multiplayer-plan.md, phase M8a; docs/milestones/M8a.md).
//
// - Who asks (auth.ts): the host on the host PC, guests by their token. Guests may walk, jump, swim and look
//   in this phase: they read what the town is like, but every call that changes the game is the host's.
// - Host-only: the server's settings (AI setup, population, together and open to the house, the join code,
//   pause all, remove a player), saves and loads, a new game, the dev routes.
// - The clock is the world's (worldClock.ts). Played together, the server moves it itself, every 10 s while
//   anyone is in the game and the host has not paused all: it calls its own /api/tick, so every part that
//   hangs its after-tick work on that route runs once per tick as in single player. A tab's own tick is then
//   only its heartbeat (where the host stands, for the cold).
// - No pause together: a tab's pause (the menu, P, the loading screen) does not reach the server; only the
//   host's "Pause all" does.
// - The movement socket (/mp): each player's own PC moves him and sends his state 20 times a second; the
//   server checks it is possible (plausible.ts) and passes it on to the others in one batch 20 times a
//   second. It never sends a correction back.

export interface MpDeps {
  db: DB;
  payload: () => Record<string, unknown>;
  broadcast: (m: unknown) => void;
  /** The town map (mapview/, docs/mapview.md): fed with the players, the townspeople, their owners and the world. */
  map?: MapModel;
  /** M8e review 4: close a player's push sockets (/ws), e.g. when he moved and his old token ended. */
  closePush?: (playerId: number) => void;
}

interface Conn {
  ws: WebSocket;
  who: Who;
  /** The sent-to state of each other player (their seq), and when each was last sent. */
  sent: Map<number, { seq: number; at: number }>;
  bytesOut: number;
  /** M8e: the socket answered the last ws ping (the browser answers by itself, even in a hidden tab). */
  alive: boolean;
}

interface Seat {
  id: number;
  plaus: Plausible;
  state: MpState | null;
  /** The last few accepted states (a batch carries every one a receiver has not had: none is skipped). */
  recent: MpState[];
  /** Server ms when the last accepted state came. */
  at: number;
  /** When the state was last saved as his pose. */
  posedAt: number;
  conn: Conn | null;
  /** M8b: when his last states came (the last two seconds): his rate, for choosing the world PC. */
  times: number[];
  /** Server ms when his socket closed (null: online). */
  goneAt: number | null;
  bytesIn: number;
  /** M8e: his rate limits on the movement socket (limits.ts); kept across a reconnect. */
  limits: SeatLimiter;
}

const GRACE_MS = 30_000;
const FAR_M = 150;
const KEEP_MS = 1_000;
/** M8b: a PC that walks townspeople sends them at least once a second; silent this long, it loses them. */
const PUPPETS_STALE_MS = 3_000;
/** M8d: job figure batches a seat may send a second (its PC sends 10 while one walks); the rest are dropped. */
const FIG_RATE = 15;
/** M8d: after his job or call is over, his figures may still be sent this long (they walk off, then go). */
const FIG_HELD_GRACE_MS = 10_000;
/**
 * M8e: a ws ping to every movement socket this often; one that did not answer the last one is closed. Over a VPN
 * a line can die without a word (no FIN): without this his seat stayed "online" and his figure stood there.
 * The browser answers a ping itself (not the page's code), so a hidden tab never misses one. Two missed pings
 * (up to 20 s) end the socket; his seat then waits GRACE_MS for his reconnect as after any close.
 */
const HEARTBEAT_MS = 10_000;
/** M8e: the moving world's state as world.ts writes it (JSON.stringify keeps the key order): sorted before parsing. */
const WORLD_HEAD = Buffer.from('{"type":"world"');
const startsWith = (d: RawData, head: Buffer): boolean => Buffer.isBuffer(d) && d.length >= head.length && d.subarray(0, head.length).equals(head);

const VISITOR = "Visitors can walk, jump, swim and look for now. Work, talk and buying come later (M8c).";

export function mountMultiplayer(app: Hono, deps: MpDeps) {
  const { db } = deps;
  const seats = new Map<number, Seat>();
  const conns = new Set<Conn>();
  let lastWorldTick = 0;
  let hostWhere: unknown = undefined;
  let rosterKey = "";
  // M8b (street.ts): who walks which townsperson, who runs the moving world, the world's last state (for a PC
  // that joins), when each owner last sent his people
  const owners = new Owners();
  const world = new WorldPc();
  let lastWorld: string | null = null;
  const puppetsAt = new Map<number, number>();
  const stStats = { puppetBatches: 0, puppetsIn: 0, worldChanges: 0, skipped: 0, figBatches: 0, figDropped: 0 };
  // M8e (limits.ts): what the rate limits dropped, the seats closed for a flood, the guests' HTTP calls refused
  const limStats = { limitDropped: 0, floodClosed: 0, deadClosed: 0 };
  const httpLimits = new HttpLimiter();
  // M8d: the townspeople called for a player's job or quest are his PC's to walk (town/walkup.ts jobPins): asked
  // fresh for a claim (at most every 250 ms), sent to everyone when they change
  let pins = new Map<string, number>();
  let pinsAt = 0;
  let pinsKey = "[]";
  let pinTick = 0;
  const pinsNow = (now = Date.now()): Map<string, number> => {
    if (now - pinsAt >= 250) {
      pinsAt = now;
      try {
        // (a visit or the police's word to a player, his hired hands and treat guests, his job's people: the job wins)
        const on = onlineNow();
        pins = new Map([...seekPins(db, on), ...handPins(db, on), ...jobPins(db, on)]);
        // (who may send job figures: a job in hand or a walk-up call, and a moment after, for the figures to go)
        for (const id of figHolders(db)) figHeldAt.set(id, now);
      } catch (e) {
        console.warn("[mp] pins", e);
      }
    }
    return pins;
  };
  // M8d: a figure batch is passed on only from a player with a job or a call (or one a moment ago: his last
  // figures walk off and his empty batches end them on the others' screens), at most FIG_RATE a second a seat
  const figHeldAt = new Map<number, number>();
  const figRate = new Map<number, { t0: number; n: number }>();
  const figOk = (seatId: number, empty: boolean, now: number): boolean => {
    const r = figRate.get(seatId);
    if (!r || now - r.t0 >= 1000) figRate.set(seatId, { t0: now, n: 1 });
    else if (++r.n > FIG_RATE) {
      stStats.figDropped++;
      return false;
    }
    if (empty) return true;
    pinsNow(now);
    if (now - (figHeldAt.get(seatId) ?? -Infinity) <= FIG_HELD_GRACE_MS) return true;
    stStats.figDropped++;
    return false;
  };
  const pinsMsg = (): MpText => ({ type: "pins", list: [...pinsNow()].sort((a, b) => (a[0] < b[0] ? -1 : 1)) });

  // ------------------------------------------------------------------ who asks, and what he may do

  const hostOnly = (w: Who) => w.host || w.admin;
  app.use("/api/*", async (c, next) => {
    const who = whoOf(db, c);
    c.set("mpWho", who);
    const p = c.req.path;
    const m = c.req.method;
    if (!who) {
      if ((m === "GET" && p === "/api/mp/info") || (m === "POST" && (p === "/api/mp/join" || p === "/api/mp/move"))) return next();
      return c.json({ error: "Join the game first: the join code is on the host's screen.", join: true }, 401);
    }
    if (who.guest) {
      // M8e (limits.ts): a guest's calls per token; the host and the server's own calls never wait
      if (!httpLimits.take(who.id, Date.now())) return c.json({ error: HTTP_WHY }, 429, { "retry-after": "1" });
      if (p.startsWith("/api/dev/")) return c.json({ error: VISITOR }, 403);
      // M8c: a guest plays his own man: he works, buys, talks, rents, sleeps like the host. The world's own
      // things stay the host's (and an admin guest's for the settings): a new week, loading a save, the server's
      // settings, the house, the join code, pause all
      if (m !== "GET" && m !== "HEAD") {
        const hostThing =
          p === "/api/new-game" ||
          p === "/api/load" ||
          p.startsWith("/api/saves") ||
          (p.startsWith("/api/mp/") && p !== "/api/mp/join") ||
          p === "/api/ai/config" ||
          p === "/api/ai/test" ||
          p.startsWith("/api/settings/");
        const adminOk = who.admin && (p === "/api/ai/config" || p === "/api/ai/test" || p.startsWith("/api/settings/"));
        if (hostThing && !adminOk && !p.startsWith("/api/mp/")) return c.json({ error: "Only the host may do that." }, 403);
      }
    }
    // M8c: the rest of the request is this player's (player/current.ts): the engine's queries of the player's own
    // things ask pid(); a guest's own row is made the first time (and again after a new game or a load)
    if (who.guest) ensurePlayerRow(db, who.id, nameOf(who.id));
    return asPlayer(who.id, async () => {
      if (mpOn() && m === "POST" && p === "/api/pause") {
        // together a tab's pause (its menu, the loading screen) never stops the town; only "Pause all" does
        return c.json(gateState());
      }
      if (mpOn() && m === "POST" && p === "/api/tick" && !who.internal) {
        // together a tab's tick is its heartbeat: the server moves the clock itself (serverTick below)
        const body = (await c.req.json().catch(() => null)) as { where?: unknown; asleep?: unknown; pos?: unknown } | null;
        const where = body && typeof body === "object" ? body.where : undefined;
        if (who.host) hostWhere = where;
        // (M8c: where each player is, for his own cold and the place of his sleep)
        reportWhere(where, Date.now(), who.id);
        if (body?.pos) reportPos(body.pos, Date.now(), who.id);
        // M8c: his sleep goes at the world's pace (day.ts worldTick): how it stands, or how it ended, is told here.
        // Up in his tab (a key, a reload) while the server has him asleep: he wakes; a sleep the server began (he
        // dropped where he stood) waits till his tab has shown it.
        const asleep = body?.asleep === true;
        if (asleep) ackRest(who.id);
        let woke = takeWoke(who.id);
        if (!woke && !asleep && restAcked(who.id)) woke = wakeRest(db, who.id);
        const rest = restOf(db, who.id);
        const w = whereNow(db, Date.now(), who.id);
        return c.json({
          advanced: asleep && !rest && !woke, // (his tab thinks him asleep, the server does not: he gets up)
          together: true,
          ...deps.payload(),
          ...(rest ? { rest } : {}),
          ...(woke ? { woke } : {}),
          where: { shelter: w.shelter, place: w.place, label: w.label, lantern: w.lantern },
        });
      }
      await next();
      // a guest changed his look: the others dress his figure again
      if (p === "/api/player/profile" && m === "PUT" && c.res.ok) sendRoster(true);
    });
  });

  // ------------------------------------------------------------------ the routes

  app.get("/api/mp/info", (c) => {
    const who = c.get("mpWho");
    const man = currentManifest();
    return c.json({
      multiplayer: mpOn(),
      protocol: MP_PROTOCOL,
      version: man?.version ?? (DEV ? "dev" : "unbuilt"),
      you: who ? { id: who.id, host: who.host, guest: who.guest, admin: who.admin, name: nameOf(who.id) } : null,
      pausedAll: isPaused() && gateState().holders.includes("host:all"),
      // M8e: the secure address for the name he came by, the house certificate and its fingerprints (to compare)
      house: houseInfo(c.req.header("host")),
    });
  });

  /** M8e: what a guest needs to trust the house (all public: the CA's certificate, never a key). */
  function houseInfo(host: string | undefined) {
    const certs = secureCerts();
    if (!certs) return null;
    return { https: secureUrlFor(host), ca: "/house-ca.crt", sha256: certs.caSha256, sha1: certs.caSha1 };
  }

  // M8e: the house certificate for the guests (the CA's public certificate only), on every port of the open house
  app.get("/house-ca.crt", (c) => {
    const s = mpSettings();
    if (!(s.lan || s.vpn) || !allowedHost(c.req.header("host"))) return c.text("not found", 404);
    const pem = houseCaPem();
    if (!pem) return c.text("The house certificate is being made: a moment.", 503);
    return c.body(pem, 200, { "content-type": "application/x-x509-ca-cert", "content-disposition": 'attachment; filename="scheldemist-house.crt"', "cache-control": "no-cache", "x-content-type-options": "nosniff" });
  });

  app.post("/api/mp/join", async (c) => {
    const addr = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming?.socket?.remoteAddress ?? "internal";
    if (!mpOn()) return c.json({ error: "The host is playing alone now. Ask him to open the game to the house." }, 409);
    if (!mayTry(addr)) return c.json({ error: "Too many tries. Wait a minute and try again." }, 429, { "retry-after": "60" });
    const b = (await c.req.json().catch(() => ({}))) as { code?: unknown; name?: unknown };
    if (!sameCode(mpSettings().code, b.code)) {
      countTry(addr); // wrong codes: 5 a minute per address
      return c.json({ error: "That is not the code on the host's screen." }, 403);
    }
    const name = cleanGuestName(b.name) ?? "Visitor";
    const online = new Set([...seats.values()].filter((s) => s.goneAt === null && s.conn).map((s) => s.id));
    if (online.size >= MAX_PLAYERS) return c.json({ error: `The town is full: ${MAX_PLAYERS} players at most.` }, 409);
    const g = addGuest(db, name);
    if (!g) return c.json({ error: "No room for another player." }, 409);
    // his own man: today's look for a man, with his name (he may change it in the character sheet)
    // M8c: his own row and starting things (the host's of a new week), then his look with his name
    ensurePlayerRow(db, g.id, name);
    if (!storedProfile(db, g.id)) saveProfile(db, { ...defaultFor("man"), first: name, last: "" } as ReturnType<typeof defaultFor>, g.id);
    console.log(`[mp] player ${g.id} joined: ${name}`);
    sendRoster(true);
    return c.json({ id: g.id, token: g.token, name });
  });

  // M8e review 4: moving to another address of the host (the http page to the secure one) keeps a guest's man. The
  // browser keeps a token per address, so the old page asks for a one-time code (players.ts newMoveCode: random,
  // 60 s, single use, kept hashed in memory) and puts it in the new address's #fragment (never sent to a server,
  // never in a log); the new page redeems it at once.
  app.post("/api/mp/transfer", (c) => {
    const who = c.get("mpWho");
    if (!who?.guest) return c.json({ error: "Only a guest moves to another address: the host plays on his own PC." }, 403);
    return c.json({ code: newMoveCode(who.id), ttl_s: MOVE_MS / 1000 });
  });

  // The new page redeems the code for a new token of the same player; his old token ends here (players.ts
  // rotateToken: it went over plain http). Wrong or old codes count like wrong join codes: 5 a minute per address.
  app.post("/api/mp/move", async (c) => {
    const addr = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming?.socket?.remoteAddress ?? "internal";
    if (!mayTry(addr)) return c.json({ error: "Too many tries. Wait a minute and try again." }, 429, { "retry-after": "60" });
    const b = (await c.req.json().catch(() => ({}))) as { code?: unknown };
    const id = takeMoveCode(b.code);
    const token = id !== null && playerById(db, id) ? rotateToken(db, id) : null;
    if (id === null || !token) {
      countTry(addr);
      return c.json({ error: "That link to the secure address was used already or is too old (it works once, for a minute). Open the secure address again from the old page, or join with the code." }, 403);
    }
    // his sockets on the old token end (his old page, or anyone who read the token on the plain line); his seat
    // waits the grace for the new page's socket as after any drop
    for (const k of conns) if (k.who.id === id) k.ws.close(4005, "moved");
    deps.closePush?.(id);
    console.log(`[mp] player ${id} moved to another address (a new token)`);
    return c.json({ id, token, name: nameOf(id) });
  });

  app.get("/api/mp/host", (c) => {
    const who = c.get("mpWho");
    if (!who || !hostOnly(who)) return c.json({ error: "Only the host sees this." }, 403);
    const s = mpSettings();
    return c.json({ ...houseView(), code: s.code, players: roster(), pausedAll: gateState().holders.includes("host:all") });
  });

  /** The house as the host's Together panel shows it (M8e: the secure addresses, the VPN, the certificate). */
  function houseView() {
    const s = mpSettings();
    const certs = secureCerts();
    return {
      multiplayer: s.multiplayer,
      lan: s.lan,
      vpn: s.vpn,
      open: lanOpen(),
      urls: s.lan ? lanUrls() : [],
      secureOpen: secureOpen(),
      secure: secureUrls(),
      // (spki: the server key's hash, for a test browser's --ignore-certificate-errors-spki-list)
      tls: certs ? { ca: "/house-ca.crt", sha256: certs.caSha256, sha1: certs.caSha1, spki: certs.spki, until: certs.serverUntil } : null,
    };
  }

  app.post("/api/mp/config", async (c) => {
    const who = c.get("mpWho");
    if (!who || !hostOnly(who)) return c.json({ error: "Only the host may change this." }, 403);
    const b = (await c.req.json().catch(() => ({}))) as { multiplayer?: unknown; lan?: unknown; vpn?: unknown };
    const patch: { multiplayer?: boolean; lan?: boolean; vpn?: boolean } = {};
    if (typeof b.multiplayer === "boolean") patch.multiplayer = b.multiplayer;
    if (typeof b.lan === "boolean") patch.lan = b.lan;
    if (typeof b.vpn === "boolean") patch.vpn = b.vpn; // M8e "Open to my VPN"
    const s = setMp(patch);
    await applyLan();
    if (!s.multiplayer && gateState().holders.includes("host:all")) setPaused("host:all", false);
    deps.broadcast({ type: "mp", multiplayer: s.multiplayer });
    return c.json({ ...houseView(), code: s.code });
  });

  app.post("/api/mp/code", (c) => {
    const who = c.get("mpWho");
    if (!who || !hostOnly(who)) return c.json({ error: "Only the host may change this." }, 403);
    return c.json({ code: newCode() });
  });

  app.post("/api/mp/kick", async (c) => {
    const who = c.get("mpWho");
    if (!who || !hostOnly(who)) return c.json({ error: "Only the host may remove a player." }, 403);
    const b = (await c.req.json().catch(() => ({}))) as { id?: unknown };
    const id = Number(b.id);
    if (!Number.isInteger(id) || id === HOST_ID) return c.json({ error: "no such player" }, 400);
    const seat = seats.get(id);
    if (seat?.conn) {
      send(seat.conn, { type: "kicked" });
      seat.conn.ws.close(4003, "removed by the host");
    }
    goods.playerLeft(id, seat?.state ? { x: seat.state.x, z: seat.state.z } : null, db); // (M8f: his load where he stood)
    seats.delete(id);
    httpLimits.forget(id);
    const ok = removeGuest(db, id);
    sendRoster(true);
    return c.json({ ok });
  });

  app.post("/api/mp/admin", async (c) => {
    const who = c.get("mpWho");
    if (!who?.host) return c.json({ error: "Only the host may do this." }, 403);
    const b = (await c.req.json().catch(() => ({}))) as { id?: unknown; on?: unknown };
    const id = Number(b.id);
    if (!playerById(db, id) || typeof b.on !== "boolean") return c.json({ error: "no such player" }, 400);
    setAdmin(db, id, b.on);
    sendRoster(true);
    return c.json({ ok: true });
  });

  app.post("/api/mp/pause-all", async (c) => {
    const who = c.get("mpWho");
    if (!who?.host) return c.json({ error: "Only the host may pause the town." }, 403);
    const b = (await c.req.json().catch(() => ({}))) as { on?: unknown };
    if (typeof b.on !== "boolean") return c.json({ error: "on must be true or false" }, 400);
    setPaused("host:all", b.on);
    const msg: MpText = { type: "pause_all", on: b.on };
    for (const k of conns) send(k, msg);
    deps.broadcast({ type: "mp_pause_all", on: b.on });
    return c.json({ pausedAll: b.on });
  });

  app.get("/api/mp/stats", (c) => {
    const who = c.get("mpWho");
    if (!who || !hostOnly(who)) return c.json({ error: "Only the host sees this." }, 403);
    return c.json(stats());
  });

  // ------------------------------------------------------------------ the roster

  function nameOf(id: number): string {
    const p = profileOf(db, id);
    return p.first || playerById(db, id)?.name || (id === HOST_ID ? "Jef" : "Visitor");
  }

  function roster(): RosterEntry[] {
    const out: RosterEntry[] = [];
    const ids = new Set<number>([HOST_ID, ...listPlayers(db).map((p) => p.id)]);
    for (const id of ids) {
      const seat = seats.get(id);
      const online = !!seat && (seat.goneAt === null || Date.now() - seat.goneAt < GRACE_MS);
      if (!online && id !== HOST_ID && !seat) {
        // a guest who is not here: listed for the host (to remove him), not drawn by anyone
      }
      out.push({
        id,
        name: nameOf(id),
        code: appearanceCode(profileOf(db, id)),
        host: id === HOST_ID,
        admin: id === HOST_ID || !!playerById(db, id)?.admin,
        away: !!seat?.state && (seat.state.flags & FLAG.away) !== 0,
        online: online && !!seat?.state,
      });
    }
    return out;
  }

  function sendRoster(force = false): void {
    const list = roster();
    const key = JSON.stringify(list);
    if (!force && key === rosterKey) return;
    rosterKey = key;
    const msg: MpText = { type: "roster", players: list };
    for (const k of conns) send(k, msg);
  }

  function send(k: Conn, m: MpText): void {
    if (k.ws.readyState !== WebSocket.OPEN) return;
    const s = JSON.stringify(m);
    k.bytesOut += s.length;
    k.ws.send(s);
  }

  // ------------------------------------------------------------------ the movement socket

  const mpWss = new WebSocketServer({
    noServer: true,
    path: "/mp",
    // (M8b: the world's state is JSON and a few KB)
    maxPayload: 64 * 1024,
    verifyClient: (info: { origin: string; req: IncomingMessage }) => allowedHost(info.req.headers.host) && (!info.req.headers.origin || allowedOrigin(info.origin)),
  });

  mpWss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    let conn: Conn | null = null;
    const helloBy = setTimeout(() => {
      if (!conn) ws.close(4001, "no hello");
    }, 5000);
    ws.on("message", (data: RawData, isBinary: boolean) => {
      const now = Date.now();
      if (conn) conn.alive = true; // (M8e: any message says the line is up)
      if (!conn) {
        if (isBinary) return;
        let m: MpText;
        try {
          m = JSON.parse(String(data)) as MpText;
        } catch {
          return;
        }
        if (m.type !== "hello") return;
        clearTimeout(helloBy);
        if (m.protocol !== MP_PROTOCOL) {
          ws.send(JSON.stringify({ type: "old", protocol: MP_PROTOCOL } satisfies MpText));
          ws.close(4002, "old version");
          return;
        }
        if (!mpOn()) {
          ws.send(JSON.stringify({ type: "refused", why: "The host is playing alone now." } satisfies MpText));
          ws.close(4004, "not together");
          return;
        }
        const who = whoOfUpgrade(db, req, typeof m.token === "string" ? m.token : null);
        if (!who) {
          ws.send(JSON.stringify({ type: "refused", why: "Join the game first." } satisfies MpText));
          ws.close(4001, "who");
          return;
        }
        conn = { ws, who, sent: new Map(), bytesOut: 0, alive: true };
        let seat = seats.get(who.id);
        if (!seat) {
          seat = { id: who.id, plaus: new Plausible(who.host), state: null, recent: [], at: 0, posedAt: 0, conn: null, times: [], goneAt: null, bytesIn: 0, limits: new SeatLimiter() };
          seats.set(who.id, seat);
        }
        // one socket a player: a new tab of his takes over (the old one is told and closed)
        if (seat.conn && seat.conn !== conn) {
          seat.conn.ws.close(4005, "taken over");
          conns.delete(seat.conn);
        }
        // a fresh start from where he is now: his first frame is taken as his place
        seat.plaus = new Plausible(who.host);
        seat.recent = [];
        seat.conn = conn;
        seat.goneAt = null;
        conns.add(conn);
        send(conn, { type: "welcome", id: who.id, host: who.host, name: nameOf(who.id), pose: who.host ? null : poseOf(db, who.id), serverNow: now, protocol: MP_PROTOCOL });
        sendRoster(true);
        // M8b: who walks whom, who runs the world, and the world as it last was
        send(conn, { type: "owners", full: true, list: owners.list() });
        send(conn, { type: "worldpc", id: world.id });
        send(conn, pinsMsg()); // (M8d: whose job each called townsperson is)
        if (lastWorld && world.id !== who.id) {
          conn.bytesOut += lastWorld.length;
          ws.send(lastWorld);
        }
        return;
      }
      const seat = seats.get(conn.who.id);
      if (!seat) return;
      // M8e (limits.ts): a guest's messages per kind; over the limit dropped and counted, a flood closes his socket
      // (the host's PC is never limited). Sorted before parsing: the world's state starts as world.ts writes it.
      if (!conn.who.host) {
        if (ws.readyState !== WebSocket.OPEN) return; // (closing: what still comes is not read)
        let kind: SocketKind;
        if (!isBinary) kind = startsWith(data, WORLD_HEAD) ? "world" : "text";
        else {
          const b0 = (data as Buffer)[0];
          kind = b0 === MSG_PUPPETS ? "puppets" : b0 === MSG_FIGS ? "figs" : b0 === MSG_ANIMALS ? "animals" : "state";
        }
        const say = seat.limits.message(kind, now);
        if (say === "drop") {
          limStats.limitDropped++;
          return;
        }
        if (say === "flood") {
          limStats.floodClosed++;
          console.log(`[mp] player ${seat.id}: far too many ${kind} messages for ${FLOOD_S} s: the socket is closed`);
          send(conn, { type: "refused", why: FLOOD_WHY });
          ws.close(FLOOD_CODE, "flood");
          setTimeout(() => ws.terminate(), 1000).unref(); // (one that does not answer the close)
          return;
        }
      }
      if (!isBinary) {
        const text = String(data);
        let m: MpText;
        try {
          m = JSON.parse(text) as MpText;
        } catch {
          return;
        }
        if (m.type === "ping" && typeof m.c === "number") send(conn, { type: "pong", c: m.c, s: Date.now() });
        else if (m.type === "claim" && Array.isArray(m.ids)) {
          const pinned = pinsNow(now);
          const r = owners.claim(seat.id, m.ids, !!m.steal, (pid) => pid === HOST_ID, (id) => pinned.get(id) ?? null);
          if (r.changes.length) {
            puppetsAt.set(seat.id, puppetsAt.get(seat.id) ?? now); // (a fresh owner has a moment to send them)
            sendAll({ type: "owners", list: r.changes });
          }
          if (r.denied.length) send(conn, { type: "owners", list: r.denied });
        } else if (m.type === "release" && Array.isArray(m.ids)) {
          const ch = owners.release(seat.id, m.ids, Array.isArray(m.gone) ? m.gone : []);
          if (ch.length) sendAll({ type: "owners", list: ch });
        } else if (m.type === "ask" && typeof m.what === "string" && Array.isArray(m.args) && m.args.length <= 4) {
          // M8c: to the world PC, with who asks (it checks the rest as if he were there)
          const wpc = [...conns].find((k) => k.who.id === world.id);
          if (wpc && wpc !== conn) send(wpc, { type: "asked", from: seat.id, what: m.what.slice(0, 20), args: m.args });
        } else if (m.type === "world" && typeof m.t === "number" && m.d && typeof m.d === "object") {
          // only the world PC's; passed on as it came
          if (seat.id !== world.id) return;
          world.heard(now);
          deps.map?.world(m.t, m.d);
          lastWorld = text;
          seat.bytesIn += text.length;
          for (const k of conns) {
            if (k === conn || k.ws.readyState !== WebSocket.OPEN || lagging(k)) continue;
            k.bytesOut += text.length;
            k.ws.send(text);
          }
        }
        return;
      }
      const buf = data as Buffer;
      seat.bytesIn += buf.length;
      // M8d: the figures of his job (the thief, the stranger, the foreman ...): passed on with his id written in
      if (buf.length > 0 && buf[0] === MSG_FIGS) {
        const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        if (!figBatchOk(v)) return;
        if (!figOk(seat.id, buf[1] === 0, now)) return;
        const out = new Uint8Array(buf); // (a copy: the sender's id is the server's word)
        figSetSender(out, seat.id);
        stStats.figBatches++;
        for (const k of conns) {
          if (k === conn || k.ws.readyState !== WebSocket.OPEN || lagging(k)) continue;
          k.bytesOut += out.byteLength;
          k.ws.send(out);
        }
        return;
      }
      // M8f sync pass 3: a batch of the animals he runs (and his townspeople's dogs): passed on, only the ones he owns
      if (buf.length > 0 && buf[0] === MSG_ANIMALS) {
        const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        if (!animalBatchOk(v)) return;
        // (its PC is alive: what it runs stays its own, as with a townspeople's batch; an empty batch says just that)
        puppetsAt.set(seat.id, now);
        const nums = animalNums(v);
        const keep: number[] = [];
        nums.forEach((n, i) => owners.owns(seat.id, n) && keep.push(i));
        if (!keep.length) return;
        const out = keep.length === nums.length ? buf : new Uint8Array(animalKeep(v, keep));
        for (const k of conns) {
          if (k === conn || k.ws.readyState !== WebSocket.OPEN || lagging(k)) continue;
          k.bytesOut += out.byteLength;
          k.ws.send(out);
        }
        return;
      }
      // M8b: a batch of the townspeople he walks: passed on to the others (only the ones he owns)
      if (buf.length > 0 && buf[0] === MSG_PUPPETS) {
        const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        if (!puppetBatchOk(v)) return;
        puppetsAt.set(seat.id, now);
        const nums = puppetNums(v);
        const keep: number[] = [];
        nums.forEach((n, i) => owners.owns(seat.id, n) && keep.push(i));
        if (!keep.length) return;
        const out = keep.length === nums.length ? buf : new Uint8Array(puppetKeep(v, keep));
        if (deps.map) {
          // the town map: these people, live, and who walks them
          const b = decodePuppets(new DataView(out.buffer, out.byteOffset, out.byteLength));
          const list = (b?.list ?? []).flatMap(({ num, s }) => {
            const id = owners.idOf(num);
            // (M8f sync pass 3: the town's other walkers, "x:" ids, are no residents: not on the map)
            return id && !id.startsWith("x:") ? [{ id, x: s.x, z: s.z, yaw: s.yaw, speed: Math.hypot(s.vx, s.vz), motion: s.motion, sit: s.sit, lantern: s.lantern, sack: s.sack, bought: s.bought, vehicle: s.veh }] : [];
          });
          deps.map.puppets(seat.id, list);
        }
        stStats.puppetBatches++;
        stStats.puppetsIn += keep.length;
        for (const k of conns) {
          if (k === conn || k.ws.readyState !== WebSocket.OPEN || lagging(k)) continue;
          k.bytesOut += out.byteLength;
          k.ws.send(out);
        }
        return;
      }
      const s = decodeState(buf);
      if (!s) return;
      const v = seat.plaus.check(s, now);
      if (!v.ok) {
        if (v.why !== "old" && (seat.plaus.stats.refused <= 3 || seat.plaus.stats.refused % 50 === 0))
          console.log(`[mp] player ${seat.id}: move refused (${v.why}, ${v.dist.toFixed(1)} m at ${v.speed.toFixed(1)} m/s); ${seat.plaus.stats.refused} refused so far`);
        return;
      }
      if (v.anchored) {
        s.flags |= FLAG.snap; // taken as a new place: the others see him there without an in-between
        console.log(`[mp] player ${seat.id}: taken at a new place after 2 s (${v.dist.toFixed(1)} m)`);
      }
      // M8e: back on a new socket (a reconnect): his PC moved him while the line was down; the others see him at
      // his new place at once, not sliding there from where he stood
      if (seat.state && seat.plaus.stats.accepted === 1) s.flags |= FLAG.snap;
      const first = !seat.state;
      const wasAway = !!seat.state && (seat.state.flags & FLAG.away) !== 0;
      seat.state = s;
      seat.recent.push(s);
      if (seat.recent.length > 8) seat.recent.shift();
      seat.at = now;
      seat.times.push(now);
      while (seat.times.length && now - seat.times[0] > 2000) seat.times.shift();
      if (first || (s.flags & FLAG.away) !== 0 !== wasAway) sendRoster(true); // in the town now, or away
      // passed on at once to everyone near (no wait for the next round: up to 50 ms less behind)
      forward(seat, s, now);
      if (now - seat.posedAt > 5000) {
        seat.posedAt = now;
        savePose(db, seat.id, { x: s.x, y: s.y, z: s.z, yaw: s.yaw });
      }
    });
    ws.on("close", () => {
      clearTimeout(helloBy);
      if (!conn) return;
      conns.delete(conn);
      const seat = seats.get(conn.who.id);
      if (seat && seat.conn === conn) {
        seat.conn = null;
        seat.goneAt = Date.now();
        // M8b: his townspeople go to whoever is near them now; the world to another PC
        const ch = owners.dropAll(seat.id);
        if (ch.length) sendAll({ type: "owners", list: ch });
        chooseWorld();
      }
    });
    ws.on("pong", () => {
      if (conn) conn.alive = true;
    });
    ws.on("error", () => {});
  });

  // M8e: a dead line (a VPN that dropped without a word) is found and closed: see HEARTBEAT_MS
  const heartbeat = setInterval(() => {
    for (const k of conns) {
      if (k.ws.readyState !== WebSocket.OPEN) continue;
      if (!k.alive) {
        limStats.deadClosed++;
        console.log(`[mp] player ${k.who.id}: no answer to the ping: the line is closed (he may come back)`);
        k.ws.terminate();
        continue;
      }
      k.alive = false;
      k.ws.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  /** A new state of `seat` to every other player near him, now. */
  function forward(seat: Seat, s: MpState, now: number): void {
    for (const k of conns) {
      if (k.who.id === seat.id || k.ws.readyState !== WebSocket.OPEN) continue;
      const mine = seats.get(k.who.id)?.state;
      if (mine && Math.hypot(s.x - mine.x, s.z - mine.z) > FAR_M) continue; // far: the round below, twice a second
      const b = encodeBatch(now, [{ id: seat.id, s }]);
      k.bytesOut += b.byteLength;
      k.ws.send(b);
      k.sent.set(seat.id, { seq: s.seq, at: now });
    }
  }

  // the rounds, 20 times a second: far players twice a second, a standing one at least once a second, and
  // anything the forward above did not send
  const relay = setInterval(() => {
    const now = Date.now();
    for (const k of conns) {
      if (k.ws.readyState !== WebSocket.OPEN) continue;
      const mine = seats.get(k.who.id)?.state;
      const list: Array<{ id: number; s: MpState }> = [];
      for (const seat of seats.values()) {
        if (seat.id === k.who.id || !seat.state || seat.goneAt !== null) continue;
        const last = k.sent.get(seat.id);
        const far = mine ? Math.hypot(seat.state.x - mine.x, seat.state.z - mine.z) > FAR_M : false;
        const fresh = !last || last.seq !== seat.state.seq;
        const due = !last || now - last.at >= (far ? 500 : fresh ? 0 : KEEP_MS);
        if (!due) continue;
        // every state he has not had yet (at most 4); far away or unchanged: the newest only
        const since = fresh && !far && last ? seat.recent.filter((r) => r.seq > last.seq).slice(-4) : [];
        const news = since.length ? since : [seat.state];
        for (const r of news) list.push({ id: seat.id, s: r });
        k.sent.set(seat.id, { seq: seat.state.seq, at: now });
      }
      if (!list.length) continue;
      const b = encodeBatch(now, list);
      k.bytesOut += b.byteLength;
      k.ws.send(b);
    }
    // M8b: a PC that walks townspeople but stopped sending them (its tab is hidden, or hangs): they go to the
    // next PC near; and who runs the world
    for (const [pid, at] of puppetsAt) {
      if (now - at < PUPPETS_STALE_MS) continue;
      puppetsAt.delete(pid);
      const ch = owners.dropAll(pid);
      if (ch.length) sendAll({ type: "owners", list: ch });
    }
    chooseWorld();
    feedMapPlayers();
    // M8d: whose job each called townsperson is, when it changes (a look twice a second)
    if (conns.size && ++pinTick % 10 === 0) {
      const m = pinsMsg();
      const key = JSON.stringify(m.type === "pins" ? m.list : []);
      if (key !== pinsKey) {
        pinsKey = key;
        for (const k of conns) send(k, m);
      }
    }
    // gone for good after the grace: "Piet went home"
    for (const seat of [...seats.values()]) {
      if (seat.goneAt !== null && now - seat.goneAt > GRACE_MS) {
        seats.delete(seat.id);
        // M8f: what he carried is set down where he last stood (goods/store.ts playerLeft says why)
        goods.playerLeft(seat.id, seat.state ? { x: seat.state.x, z: seat.state.z } : null, db);
        const msg: MpText = { type: "went", id: seat.id, name: nameOf(seat.id) };
        for (const k of conns) send(k, msg);
        sendRoster(true);
      }
    }
  }, SEND_MS);
  relay.unref();

  function stats() {
    const players = [...seats.values()].map((s) => ({ id: s.id, name: nameOf(s.id), online: s.goneAt === null, bytesIn: s.bytesIn, bytesOut: s.conn?.bytesOut ?? 0, ...s.plaus.stats, walks: owners.count(s.id), limited: { ...s.limits.dropped }, http429: httpLimits.refused.get(s.id) ?? 0 }));
    return { corrections: 0, players, worldPc: world.id, ...stStats, ...limStats, http429: httpLimits.total };
  }

  // ------------------------------------------------------------------ M8b: the street and the world

  function sendAll(m: MpText): void {
    for (const k of conns) send(k, m);
    // the town map follows who walks whom
    if (m.type === "owners") deps.map?.owners(m.list as OwnerRow[], !!m.full);
  }

  /** The town map: where the players are (4 times a second, from the relay's rounds). */
  let mapTick = 0;
  function feedMapPlayers(): void {
    if (!deps.map || ++mapTick % 5 !== 0) return;
    deps.map.players(
      [...seats.values()]
        .filter((s) => s.state)
        .map((s) => {
          const st = s.state!;
          return { id: s.id, name: nameOf(s.id), host: s.id === HOST_ID, x: st.x, y: st.y, z: st.z, yaw: st.yaw, vx: st.vx, vz: st.vz, mode: MODES[st.mode] ?? st.mode, away: (st.flags & FLAG.away) !== 0, online: s.goneAt === null };
        }),
    );
  }

  /**
   * A player whose line cannot keep up (the socket's queue over 64 KB): the next state replaces this one, so a
   * stale one is skipped rather than queued (the owners and other news always go).
   */
  function lagging(k: Conn): boolean {
    if (k.ws.bufferedAmount <= 64 * 1024) return false;
    stStats.skipped++;
    return true;
  }

  function chooseWorld(): void {
    const now = Date.now();
    const list = [...seats.values()].map((s) => ({ id: s.id, host: s.id === HOST_ID, online: s.goneAt === null && !!s.conn, stateAt: s.at, rate: s.times.filter((x) => now - x <= 2000).length / 2 }));
    const id = world.choose(list, now);
    if (id === null) return;
    stStats.worldChanges++;
    console.log(`[mp] the world is run by player ${id || "nobody"} now`);
    sendAll({ type: "worldpc", id });
  }

  // ------------------------------------------------------------------ the server's own clock

  const inGame = () => [...seats.values()].some((s) => s.goneAt === null && s.conn && Date.now() - s.at < 30_000);
  // M8c: the players in the game now (their needs move with the world's hours; one who is gone is frozen till he
  // is back): online, and in the town (his movement state has come)
  const onlineNow = () => [...seats.values()].filter((s) => s.goneAt === null && s.conn && s.state && Date.now() - s.at < 30_000).map((s) => s.id);
  setOnlineIds(() => (mpOn() ? onlineNow() : [1]));
  // M8d: where each player stands, by his movement socket (fresh: 5 s), for the director and the events
  // M8d: whose PC walks a townsperson (a report on his errand is taken only from that PC or the player it is for)
  setWalkerSource((npcId) => {
    if (!mpOn()) return null;
    const n = owners.numOf(npcId);
    return n === null ? 0 : owners.ownerOf(n);
  });
  setPositionSource((id) => {
    if (!mpOn()) return null;
    const s = seats.get(id);
    return s && s.state && s.goneAt === null && Date.now() - s.at < 5_000 ? { x: s.state.x, z: s.state.z } : null;
  });
  let tickBusy = false;
  const clockLoop = setInterval(() => {
    if (!mpOn() || !inGame() || tickBusy) return;
    const now = Date.now();
    // (everyone in the game asleep: the night passes fast, a step every 300 ms: day.ts worldTick)
    if (now - lastWorldTick < (allAsleep() ? 300 : TICK_EVERY_MS)) return;
    lastWorldTick = now;
    tickBusy = true;
    // (the game's own origin rule wants a Host naming this machine)
    void Promise.resolve(app.request("/api/tick", { method: "POST", headers: { host: `127.0.0.1:${PORT}`, "content-type": "application/json" }, body: JSON.stringify({ where: hostWhere }) }))
      .then(async (r) => {
        if (!r.ok) console.warn(`[mp] the world's tick: ${r.status} ${(await r.text()).slice(0, 200)}`);
      })
      .catch((e) => console.warn("[mp] the world's tick failed", e))
      .finally(() => (tickBusy = false));
  }, 250);
  clockLoop.unref();

  // ------------------------------------------------------------------ the house

  let pushWss: WebSocketServer | null = null;
  const upgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const p = (req.url ?? "").split("?")[0];
    if (p === "/mp") mpWss.handleUpgrade(req, socket, head, (ws) => mpWss.emit("connection", ws, req));
    else if (p === "/ws" && pushWss) pushWss.handleUpgrade(req, socket, head, (ws) => pushWss!.emit("connection", ws, req));
    else socket.destroy();
  };
  let lanBusy: Promise<void> = Promise.resolve();
  function applyLan(): Promise<void> {
    lanBusy = lanBusy.then(async () => {
      const { lan, vpn } = mpSettings();
      if (lan) await openLan(app.fetch, upgrade);
      else await closeLan();
      // M8e: https on the next port (the house's addresses, the VPN's), with the house certificate (tls.ts)
      await applySecure(app.fetch, upgrade, { lan, vpn });
      setAddressWatch(lan || vpn ? { lan, vpn } : null, applyLan); // (M8e: a new address opens the listeners and the certificate again)
      if (lan || vpn) void autoBuild.ensure(); // (the house plays the built game: built now if it is missing or old, autobuild.ts)
    });
    return lanBusy;
  }

  // a new build while the game runs: tell everyone (the loader downloads only what changed)
  setInterval(() => {
    if (!reloadManifest()) return;
    const m = currentManifest();
    if (!m) return;
    const msg: MpText = { type: "version", version: m.version, files: m.files.length, bytes: m.total };
    for (const k of conns) send(k, msg);
  }, 5000).unref();

  return {
    /**
     * After every route is mounted (index.ts, at its end): the built game on the game port (host mode), the
     * two sockets on the main server and on the house's listeners.
     */
    attach(server: Server, push: WebSocketServer): void {
      pushWss = push;
      server.on("upgrade", upgrade);
      mountStatic(app, () => mpSettings().lan || mpSettings().vpn || !DEV);
      if (mpSettings().lan || mpSettings().vpn) void applyLan();
      if (mpOn()) console.log(`[mp] played together; join code ${mpSettings().code}`);
    },
    close(): Promise<void> {
      clearInterval(relay);
      clearInterval(clockLoop);
      clearInterval(heartbeat);
      setOnlineIds(null);
      setPositionSource(null);
      setWalkerSource(null);
      autoBuild.stop();
      for (const k of conns) k.ws.close();
      mpWss.close();
      setAddressWatch(null);
      return Promise.all([closeLan(), closeSecure()]).then(() => {});
    },
    stats,
    /** The header a guest's requests carry (for the docs and the tests). */
    TOKEN_HEADER,
  };
}
