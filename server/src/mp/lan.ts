import os from "node:os";
import type { Server } from "node:http";
import type { Duplex } from "node:stream";
import type { IncomingMessage } from "node:http";
import { createAdaptorServer } from "@hono/node-server";
import { LAN_NAMES, PORT } from "../config.ts";

// M8a "Open to the house" (docs/multiplayer-plan.md 2.1): besides 127.0.0.1 the server listens on the
// PC's own home-network addresses (10.x, 172.16-31.x, 192.168.x: private IPv4 only, never a public or a
// VPN address such as NetBird's 100.x), on the same port, and accepts those addresses and the computer's
// name in the Host header (config.ts LAN_NAMES). Closed again when the setting goes off.
// The Windows firewall rule is Steve's own step (docs/milestones/M8a.md); nothing here touches it.

export type Upgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => void;

/** Private IPv4 addresses of this PC's network adapters. */
export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== "IPv4" || a.internal) continue;
      const [p, q] = a.address.split(".").map(Number);
      const priv = p === 10 || (p === 172 && q >= 16 && q <= 31) || (p === 192 && q === 168);
      if (priv) out.push(a.address);
    }
  }
  return [...new Set(out)];
}

/** The addresses a guest may type (with the port). */
export function lanUrls(port = PORT): string[] {
  const name = os.hostname().toLowerCase();
  return [...lanAddresses().map((a) => `http://${a}:${port}`), `http://${name}:${port}`];
}

const open = new Map<string, Server>();

/** Listen on every home-network address (again). Returns the addresses now open. */
export async function openLan(fetch: (req: Request, env?: unknown) => Response | Promise<Response>, upgrade: Upgrade, port = PORT): Promise<string[]> {
  const want = lanAddresses();
  const name = os.hostname().toLowerCase();
  LAN_NAMES.add(name);
  LAN_NAMES.add(`${name}.local`);
  for (const addr of want) {
    LAN_NAMES.add(addr);
    if (open.has(addr)) continue;
    const s = createAdaptorServer({ fetch: fetch as never }) as Server;
    s.on("upgrade", upgrade);
    await new Promise<void>((ok) => {
      s.once("error", (e) => {
        console.warn(`[mp] cannot listen on ${addr}:${port}: ${(e as Error).message}`);
        ok();
      });
      s.listen(port, addr, () => {
        open.set(addr, s);
        console.log(`[mp] open to the house: http://${addr}:${port}`);
        ok();
      });
    });
  }
  return [...open.keys()];
}

export async function closeLan(): Promise<void> {
  const all = [...open.values()];
  open.clear();
  LAN_NAMES.clear();
  await Promise.all(
    all.map(
      (s) =>
        new Promise<void>((ok) => {
          s.close(() => ok());
          (s as Server & { closeAllConnections?: () => void }).closeAllConnections?.();
        }),
    ),
  );
  if (all.length) console.log("[mp] closed to the house");
}

export const lanOpen = (): string[] => [...open.keys()];
