import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import type { DB } from "../db.ts";
import { REAL_S_PER_GAME_MIN, TICK_MINUTES } from "../../../shared/clock.ts";
import { clock as dayClock } from "../day.ts";
import type { Town } from "../town/population.ts";
import { town as townOf } from "../town/store.ts";
import type { MapClock, MapModel } from "./model.ts";
import { cityJson, detail, history, peopleJson, readDbNow, snapshot, type DbNow, type ViewDeps } from "./views.ts";

export { MapModel } from "./model.ts";
export type { MapClock, OwnerIn, PlayerIn, PuppetIn } from "./model.ts";

// The town map (docs/mapview.md): a page for the host, on its own port (8790) and on this PC only, that
// shows the whole town from above: the players, the townspeople (live where a PC walks them, else where
// their day plan puts them), their dogs, the moving world, the places and the town's events. Hover for
// what a thing is, click to pin its details, which follow the feed; history where anything is kept.
//
// It has its own small http server bound to 127.0.0.1 (never the house's network), a Host check against
// DNS rebinding, and only GET routes. It reads the save; it never writes to it.

/** The map's port unless SCHELDEMIST_MAP_PORT says otherwise ("0": no map). */
export const MAP_PORT = 8790;
/** Snapshots a second on the feed. */
export const FEED_HZ = 4;

/**
 * What the map needs from the game. Only `model` and `db` are required: the clock and the town are read
 * from the save by default (day.ts clock, town/store.ts town), which is what the game itself uses.
 */
export interface MapViewDeps {
  /** Fed by the multiplayer code (players, puppets, world, owners). */
  model: MapModel;
  /** The open save; read only. */
  db: DB;
  /** The game's clock and weather. Default: day.ts clock(db). */
  clock?: () => MapClock;
  /** The town: residents with homes, work and schedules; places, stalls, shops. Default: town/store.ts town(db).town. */
  townData?: () => Town;
  /** The port. Default: SCHELDEMIST_MAP_PORT, else 8790; null: off. 0: any free port (the tests). */
  port?: number | null;
}

export interface MapView {
  /** http://127.0.0.1:8790/ (empty when the map is off). Filled in once it listens. */
  readonly url: string;
  /** The url once it listens ("" when off or the port is taken). */
  ready: Promise<string>;
  close(): Promise<void>;
}

/** The port the env asks for: null when "0" (off); 8790 when unset or not a port. */
export function mapPortFromEnv(env: Record<string, string | undefined> = process.env): number | null {
  const v = env.SCHELDEMIST_MAP_PORT;
  // (a server the tests start has no map unless they ask: two test servers must not fight over 8790)
  if (v === undefined || v.trim() === "") return env.VITEST ? null : MAP_PORT;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 65535) return MAP_PORT;
  return n === 0 ? null : n;
}

const LOCAL = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Only a Host that names this PC and the map's port (a name that points here from outside: refused). */
export function allowedMapHost(host: string | undefined, port: number): boolean {
  if (!host) return false;
  try {
    const u = new URL(`http://${host}`);
    return LOCAL.has(u.hostname) && Number(u.port || 80) === port && u.username === "" && u.pathname === "/";
  } catch {
    return false;
  }
}

/** A browser's Origin on the feed: the map's own page only (none: a tool, not a page). */
export function allowedMapOrigin(origin: string | undefined, port: number): boolean {
  if (origin === undefined) return true;
  try {
    const u = new URL(origin);
    return u.protocol === "http:" && u.origin === origin && LOCAL.has(u.hostname) && Number(u.port || 80) === port;
  } catch {
    return false;
  }
}

const PUBLIC = fileURLToPath(new URL("./public/", import.meta.url));
const FILES: Record<string, { file: string; type: string }> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/index.html": { file: "index.html", type: "text/html; charset=utf-8" },
  "/map.js": { file: "map.js", type: "text/javascript; charset=utf-8" },
  "/map.css": { file: "map.css", type: "text/css; charset=utf-8" },
};

export function mountMapView(deps: MapViewDeps): MapView {
  const port = deps.port === undefined ? mapPortFromEnv() : deps.port;
  if (port === null) return { url: "", ready: Promise.resolve(""), close: () => Promise.resolve() };
  const { model, db } = deps;
  // The world's clock moves in ticks (5 game minutes every 10 s): the dots walked by the day plan's sum would jump
  // 60 m a tick. Between ticks the map runs the clock on by the real time since the last one (at most one tick),
  // so they glide (Steve 2026-09-27).
  let lastTick = { key: "", at: 0 };
  const clockNow = (): MapClock | null => {
    try {
      const c = deps.clock ? deps.clock() : dayClock(db);
      const key = `${c.day}:${c.hour}:${c.minute}`;
      const now = Date.now();
      if (key !== lastTick.key) lastTick = { key, at: now };
      const frac = Math.min(TICK_MINUTES, (now - lastTick.at) / (REAL_S_PER_GAME_MIN * 1000));
      return { ...c, frac };
    } catch {
      return null;
    }
  };
  const townNow = (): Town | null => {
    try {
      return deps.townData ? deps.townData() : townOf(db).town;
    } catch {
      return null;
    }
  };
  model.gameTime = () => {
    const c = clockNow();
    return c ? `day ${c.day}, ${String(c.hour).padStart(2, "0")}:${String(c.minute).padStart(2, "0")}` : null;
  };
  let bound = port;
  let url = "";
  let dbNow: DbNow | null = null;
  const views = (): ViewDeps => ({ model, db, town: townNow(), clock: clockNow() });

  const send = (res: ServerResponse, status: number, type: string, body: string | Buffer, extra: Record<string, string> = {}) => {
    res.writeHead(status, {
      "content-type": type,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "x-frame-options": "DENY",
      "content-security-policy": `default-src 'self'; connect-src 'self' ws://127.0.0.1:${bound} ws://localhost:${bound}; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'`,
      ...extra,
    });
    res.end(body);
  };
  const json = (res: ServerResponse, status: number, v: unknown) => send(res, status, "application/json; charset=utf-8", typeof v === "string" ? v : JSON.stringify(v));

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!allowedMapHost(req.headers.host, bound)) return json(res, 403, { error: "forbidden" });
    if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "the map only reads" });
    const u = new URL(req.url ?? "/", `http://127.0.0.1:${bound}`);
    const f = FILES[u.pathname];
    if (f) {
      try {
        return send(res, 200, f.type, await readFile(PUBLIC + f.file));
      } catch {
        return json(res, 404, { error: "not found" });
      }
    }
    const kind = (u.searchParams.get("kind") ?? "").slice(0, 20);
    const id = (u.searchParams.get("id") ?? "").slice(0, 80);
    switch (u.pathname) {
      case "/city":
        return json(res, 200, cityJson());
      case "/people": {
        const t = townNow();
        return t ? json(res, 200, peopleJson(t)) : json(res, 503, { error: "no town yet" });
      }
      case "/detail": {
        const d = detail(views(), kind, id);
        return d ? json(res, 200, d) : json(res, 404, { error: "no such thing now" });
      }
      case "/history":
        return json(res, 200, history(views(), kind, id));
      case "/favicon.ico":
        return send(res, 204, "image/x-icon", "");
      default:
        return json(res, 404, { error: "not found" });
    }
  }

  const server: Server = createServer((req, res) => {
    handle(req, res).catch((e: unknown) => {
      console.warn("[map]", e);
      if (!res.headersSent) json(res, 500, { error: "map error" });
      else res.end();
    });
  });

  // the feed: four snapshots a second to every open map
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = (req.url ?? "").split("?")[0];
    if (path !== "/feed" || !allowedMapHost(req.headers.host, bound) || !allowedMapOrigin(req.headers.origin, bound)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });
  const snapNow = () => JSON.stringify(snapshot(model, townNow(), clockNow(), dbNow));
  wss.on("connection", (ws: WebSocket) => {
    ws.on("error", () => {});
    ws.on("message", () => {}); // the page sends nothing that matters
    try {
      ws.send(snapNow());
    } catch {
      /* closed already */
    }
  });

  const feed = setInterval(() => {
    if (!wss.clients.size) return;
    let s: string;
    try {
      s = snapNow();
    } catch (e) {
      console.warn("[map] snapshot failed", e);
      return;
    }
    for (const c of wss.clients) {
      // a map that cannot keep up skips a snapshot (the next replaces it)
      if (c.readyState === WebSocket.OPEN && c.bufferedAmount < 1024 * 1024) c.send(s);
    }
  }, 1000 / FEED_HZ);
  feed.unref();

  // once a second: the database's actions and events, the stale townspeople, the day plan's changes
  const sweep = setInterval(() => {
    const c = clockNow();
    dbNow = c ? readDbNow(db, c.day) : null;
    try {
      model.sweep(townNow(), c);
    } catch (e) {
      console.warn("[map] sweep failed", e);
    }
  }, 1000);
  sweep.unref();

  const ready = new Promise<string>((resolve) => {
    server.once("error", (e: NodeJS.ErrnoException) => {
      console.warn(`[map] the town map could not open on port ${port}: ${e.code ?? e.message}`);
      clearInterval(feed);
      clearInterval(sweep);
      resolve("");
    });
    // this PC only: never the house's network
    server.listen(port, "127.0.0.1", () => {
      bound = (server.address() as AddressInfo).port;
      url = `http://127.0.0.1:${bound}/`;
      console.log(`[map] the town map: ${url}`);
      resolve(url);
    });
  });

  return {
    get url() {
      return url;
    },
    ready,
    close(): Promise<void> {
      clearInterval(feed);
      clearInterval(sweep);
      for (const c of wss.clients) c.terminate();
      wss.close();
      return new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      });
    },
  };
}
