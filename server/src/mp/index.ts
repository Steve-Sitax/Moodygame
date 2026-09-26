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
import { decodeState, encodeBatch, FLAG, MP_PROTOCOL, SEND_MS, type MpState, type MpText, type RosterEntry } from "../../../shared/mpProtocol.ts";
import { profileOf, saveProfile, storedProfile } from "../player/profile.ts";
import { TOKEN_HEADER, whoOf, whoOfUpgrade, type Who } from "./auth.ts";
import { closeLan, lanOpen, lanUrls, openLan } from "./lan.ts";
import { Plausible } from "./plausible.ts";
import { addGuest, cleanGuestName, countTry, HOST_ID, listPlayers, mayTry, MAX_PLAYERS, playerById, poseOf, removeGuest, sameCode, savePose, setAdmin } from "./players.ts";
import { mpOn, mpSettings, newCode, setMp } from "./settings.ts";
import { currentManifest, mountStatic, reloadManifest } from "./static.ts";

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
}

interface Conn {
  ws: WebSocket;
  who: Who;
  /** The sent-to state of each other player (their seq), and when each was last sent. */
  sent: Map<number, { seq: number; at: number }>;
  bytesOut: number;
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
  /** Server ms when his socket closed (null: online). */
  goneAt: number | null;
  bytesIn: number;
}

const GRACE_MS = 30_000;
const FAR_M = 150;
const KEEP_MS = 1_000;

const VISITOR = "Visitors can walk, jump, swim and look for now. Work, talk and buying come later (M8c).";

export function mountMultiplayer(app: Hono, deps: MpDeps) {
  const { db } = deps;
  const seats = new Map<number, Seat>();
  const conns = new Set<Conn>();
  let lastWorldTick = 0;
  let hostWhere: unknown = undefined;
  let rosterKey = "";

  // ------------------------------------------------------------------ who asks, and what he may do

  const hostOnly = (w: Who) => w.host || w.admin;
  app.use("/api/*", async (c, next) => {
    const who = whoOf(db, c);
    c.set("mpWho", who);
    const p = c.req.path;
    const m = c.req.method;
    if (!who) {
      if ((m === "GET" && p === "/api/mp/info") || (m === "POST" && p === "/api/mp/join")) return next();
      return c.json({ error: "Join the game first: the join code is on the host's screen.", join: true }, 401);
    }
    if (who.guest) {
      if (p.startsWith("/api/dev/")) return c.json({ error: VISITOR }, 403);
      // the host's own saves and his man's browser part are his
      if (m === "GET" && p === "/api/client-state") return c.json({ client: null });
      if (m !== "GET" && m !== "HEAD") {
        const ok =
          p.startsWith("/api/mp/") ||
          p === "/api/tick" ||
          p === "/api/pause" ||
          (p === "/api/player/profile" && m === "PUT") ||
          (who.admin && (p === "/api/ai/config" || p === "/api/ai/test" || p.startsWith("/api/settings/")));
        if (!ok) return c.json({ error: VISITOR }, 403);
      }
    }
    if (mpOn() && m === "POST" && p === "/api/pause") {
      // together a tab's pause (its menu, the loading screen) never stops the town; only "Pause all" does
      return c.json(gateState());
    }
    if (mpOn() && m === "POST" && p === "/api/tick" && !who.internal) {
      // together a tab's tick is its heartbeat: the server moves the clock itself (serverTick below)
      const body = (await c.req.json().catch(() => null)) as { where?: unknown } | null;
      if (who.host) {
        hostWhere = body && typeof body === "object" ? body.where : undefined;
        reportWhere(hostWhere);
      }
      const w = whereNow(db);
      return c.json({ advanced: false, together: true, ...deps.payload(), where: { shelter: w.shelter, place: w.place, label: w.label, lantern: w.lantern } });
    }
    await next();
    // a guest changed his look: the others dress his figure again
    if (p === "/api/player/profile" && m === "PUT" && c.res.ok) sendRoster(true);
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
    });
  });

  app.post("/api/mp/join", async (c) => {
    const addr = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming?.socket?.remoteAddress ?? "internal";
    if (!mpOn()) return c.json({ error: "The host is playing alone now. Ask him to open the game to the house." }, 409);
    if (!mayTry(addr)) return c.json({ error: "Too many tries. Wait a minute and try again." }, 429);
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
    if (!storedProfile(db, g.id)) saveProfile(db, { ...defaultFor("man"), first: name, last: "" } as ReturnType<typeof defaultFor>, g.id);
    console.log(`[mp] player ${g.id} joined: ${name}`);
    sendRoster(true);
    return c.json({ id: g.id, token: g.token, name });
  });

  app.get("/api/mp/host", (c) => {
    const who = c.get("mpWho");
    if (!who || !hostOnly(who)) return c.json({ error: "Only the host sees this." }, 403);
    const s = mpSettings();
    return c.json({ multiplayer: s.multiplayer, lan: s.lan, open: lanOpen(), code: s.code, urls: s.lan ? lanUrls() : [], players: roster(), pausedAll: gateState().holders.includes("host:all") });
  });

  app.post("/api/mp/config", async (c) => {
    const who = c.get("mpWho");
    if (!who || !hostOnly(who)) return c.json({ error: "Only the host may change this." }, 403);
    const b = (await c.req.json().catch(() => ({}))) as { multiplayer?: unknown; lan?: unknown };
    const patch: { multiplayer?: boolean; lan?: boolean } = {};
    if (typeof b.multiplayer === "boolean") patch.multiplayer = b.multiplayer;
    if (typeof b.lan === "boolean") patch.lan = b.lan;
    const s = setMp(patch);
    await applyLan();
    if (!s.multiplayer && gateState().holders.includes("host:all")) setPaused("host:all", false);
    deps.broadcast({ type: "mp", multiplayer: s.multiplayer });
    return c.json({ multiplayer: s.multiplayer, lan: s.lan, open: lanOpen(), code: s.code, urls: s.lan ? lanUrls() : [] });
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
    seats.delete(id);
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
    maxPayload: 4096,
    verifyClient: (info: { origin: string; req: IncomingMessage }) => allowedHost(info.req.headers.host) && (!info.req.headers.origin || allowedOrigin(info.origin)),
  });

  mpWss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    let conn: Conn | null = null;
    const helloBy = setTimeout(() => {
      if (!conn) ws.close(4001, "no hello");
    }, 5000);
    ws.on("message", (data: RawData, isBinary: boolean) => {
      const now = Date.now();
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
        conn = { ws, who, sent: new Map(), bytesOut: 0 };
        let seat = seats.get(who.id);
        if (!seat) {
          seat = { id: who.id, plaus: new Plausible(who.host), state: null, recent: [], at: 0, posedAt: 0, conn: null, goneAt: null, bytesIn: 0 };
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
        return;
      }
      const seat = seats.get(conn.who.id);
      if (!seat) return;
      if (!isBinary) {
        let m: MpText;
        try {
          m = JSON.parse(String(data)) as MpText;
        } catch {
          return;
        }
        if (m.type === "ping" && typeof m.c === "number") send(conn, { type: "pong", c: m.c, s: Date.now() });
        return;
      }
      const buf = data as Buffer;
      seat.bytesIn += buf.length;
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
      const first = !seat.state;
      const wasAway = !!seat.state && (seat.state.flags & FLAG.away) !== 0;
      seat.state = s;
      seat.recent.push(s);
      if (seat.recent.length > 8) seat.recent.shift();
      seat.at = now;
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
      }
    });
    ws.on("error", () => {});
  });

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
    // gone for good after the grace: "Piet went home"
    for (const seat of [...seats.values()]) {
      if (seat.goneAt !== null && now - seat.goneAt > GRACE_MS) {
        seats.delete(seat.id);
        const msg: MpText = { type: "went", id: seat.id, name: nameOf(seat.id) };
        for (const k of conns) send(k, msg);
        sendRoster(true);
      }
    }
  }, SEND_MS);
  relay.unref();

  function stats() {
    const players = [...seats.values()].map((s) => ({ id: s.id, name: nameOf(s.id), online: s.goneAt === null, bytesIn: s.bytesIn, bytesOut: s.conn?.bytesOut ?? 0, ...s.plaus.stats }));
    return { corrections: 0, players };
  }

  // ------------------------------------------------------------------ the server's own clock

  const inGame = () => [...seats.values()].some((s) => s.goneAt === null && s.conn && Date.now() - s.at < 30_000);
  const clockLoop = setInterval(() => {
    if (!mpOn() || !inGame()) return;
    const now = Date.now();
    if (now - lastWorldTick < TICK_EVERY_MS) return;
    lastWorldTick = now;
    // (the game's own origin rule wants a Host naming this machine)
    void Promise.resolve(app.request("/api/tick", { method: "POST", headers: { host: `127.0.0.1:${PORT}`, "content-type": "application/json" }, body: JSON.stringify({ where: hostWhere }) }))
      .then(async (r) => {
        if (!r.ok) console.warn(`[mp] the world's tick: ${r.status} ${(await r.text()).slice(0, 200)}`);
      })
      .catch((e) => console.warn("[mp] the world's tick failed", e));
  }, 1000);
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
      if (mpSettings().lan) await openLan(app.fetch, upgrade);
      else await closeLan();
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
      mountStatic(app, () => mpSettings().lan || !DEV);
      if (mpSettings().lan) void applyLan();
      if (mpOn()) console.log(`[mp] played together; join code ${mpSettings().code}`);
    },
    close(): Promise<void> {
      clearInterval(relay);
      clearInterval(clockLoop);
      for (const k of conns) k.ws.close();
      mpWss.close();
      return closeLan();
    },
    stats,
    /** The header a guest's requests carry (for the docs and the tests). */
    TOKEN_HEADER,
  };
}
