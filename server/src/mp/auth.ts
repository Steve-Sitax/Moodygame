import type { Context } from "hono";
import type { IncomingMessage } from "node:http";
import type { DB } from "../db.ts";
import { HOST_ID, playerOfToken } from "./players.ts";

// M8a multiplayer (docs/multiplayer-plan.md 2.2): who is asking. The host's own browser on the host PC is
// player 1 with the host's rights: a request from this computer (the socket's address is 127.0.0.1 or ::1,
// not forwarded for another) without a player token. A guest sends his token (header X-Scheldemist-Player);
// the same browser with ?seat=2 keeps a second token, so two tabs can be two players in tests. Anyone else
// (another PC with no token or a wrong one) may only ask for the join screen's facts and join.

export const TOKEN_HEADER = "x-scheldemist-player";

export interface Who {
  id: number;
  /** The host: player 1 on the host PC (or the server's own internal call). */
  host: boolean;
  /** A guest the host marked admin: may change the server's settings too. */
  admin: boolean;
  guest: boolean;
  /** The server calling itself (its own clock tick). */
  internal: boolean;
  name: string | null;
}

declare module "hono" {
  interface ContextVariableMap {
    mpWho: Who | null;
  }
}

const LOCAL_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/** A socket address and forwarding headers that say: this computer. */
export function loopback(addr: string | undefined, forwarded: string | undefined): boolean {
  if (!addr || !LOCAL_ADDRESSES.has(addr)) return false;
  if (forwarded && forwarded.split(",").some((a) => !LOCAL_ADDRESSES.has(a.trim().replace(/^for=/i, "").replace(/^"?\[?|\]?"?$/g, "")))) return false;
  return true;
}

export function socketAddr(c: Context): string | undefined {
  return (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming?.socket?.remoteAddress;
}

/** Who asks, or null (no token from another PC, or a token the server does not know). */
export function whoOf(db: DB, c: Context): Who | null {
  const incoming = (c.env as { incoming?: unknown } | undefined)?.incoming;
  if (!incoming) return { id: HOST_ID, host: true, admin: true, guest: false, internal: true, name: null }; // app.request from the server itself
  return whoFrom(db, c.req.header(TOKEN_HEADER), socketAddr(c), c.req.header("x-forwarded-for") ?? c.req.header("forwarded"));
}

/** The same rule for the movement socket's hello (a token in the message instead of a header). */
export function whoFrom(db: DB, token: string | undefined | null, addr: string | undefined, forwarded: string | undefined): Who | null {
  if (token) {
    const p = playerOfToken(db, token);
    if (!p) return null;
    return { id: p.id, host: false, admin: p.admin, guest: true, internal: false, name: p.name };
  }
  if (loopback(addr, forwarded)) return { id: HOST_ID, host: true, admin: true, guest: false, internal: false, name: null };
  return null;
}

export function whoOfUpgrade(db: DB, req: IncomingMessage, token: string | null): Who | null {
  const fwd = req.headers["x-forwarded-for"] ?? req.headers.forwarded;
  return whoFrom(db, token, req.socket.remoteAddress, Array.isArray(fwd) ? fwd.join(",") : fwd);
}

/** The requester's player id (1 when nothing says otherwise: single player, the tests). */
export function pidOf(c: Context): number {
  return c.get("mpWho")?.id ?? HOST_ID;
}

/**
 * For the AI setup's host check (ai/routes.ts fromHost): a guest's token is never the host, but a guest the
 * host marked admin may change the settings. Null: no player token on this request (the old rule decides).
 */
export function mpHostRule(c: Context): boolean | null {
  const w = c.get("mpWho");
  if (!w || !w.guest) return null;
  return w.admin;
}
