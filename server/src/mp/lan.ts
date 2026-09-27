import { execFile } from "node:child_process";
import os from "node:os";
import https from "node:https";
import type { Server } from "node:http";
import type { Duplex } from "node:stream";
import type { IncomingMessage } from "node:http";
import { createAdaptorServer } from "@hono/node-server";
import { LAN_NAMES, PORT, TLS_NAMES, TLS_PORT } from "../config.ts";
import { dnsName, ensureHouseCerts, hostName, tlsDir, vpnIp, type HouseCerts } from "./tls.ts";

// M8a "Open to the house" (docs/multiplayer-plan.md 2.1): besides 127.0.0.1 the server listens on the
// PC's own home-network addresses (10.x, 172.16-31.x, 192.168.x: private IPv4 only, never a public or a
// VPN address such as NetBird's 100.x), on the same port, and accepts those addresses and the computer's
// name in the Host header (config.ts LAN_NAMES). Closed again when the setting goes off.
// The Windows firewall rule is Steve's own step (docs/milestones/M8a.md); nothing here touches it.
//
// M8e "outside the house" (docs/milestones/M8e.md): while the house (or the VPN) is open the same app is served
// with https on the next port (TLS_PORT, 8788), with the house certificate (tls.ts): on 127.0.0.1, the home-network
// addresses, and with "Open to my VPN" on the VPN's address (100.64.0.0/10, NetBird or Tailscale). The VPN gets
// https only, never plain http. The https port accepts exactly the names its certificate carries (config.ts
// TLS_NAMES).

export type Upgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
type Fetch = (req: Request, env?: unknown) => Response | Promise<Response>;

/** Under the tests only: addresses given instead of this PC's adapters (never a real VPN name in a test). */
function testAddrs(name: string): string[] | null {
  if (!process.env.VITEST) return null;
  const v = process.env[name];
  if (v === undefined || v === "") return null;
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Private IPv4 addresses of this PC's network adapters. */
export function lanAddresses(): string[] {
  const t = testAddrs("SCHELDEMIST_TEST_LAN_ADDRS");
  if (t) return t;
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

/** M8e: this PC's VPN addresses (NetBird, Tailscale: 100.64.0.0/10). */
export function vpnAddresses(): string[] {
  const t = testAddrs("SCHELDEMIST_TEST_VPN_ADDRS");
  if (t) return t;
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list ?? []) if (a.family === "IPv4" && !a.internal && vpnIp(a.address)) out.push(a.address);
  return [...new Set(out)];
}

/** The FQDN out of `netbird status --json` (field fqdn) or plain `netbird status` (line "FQDN: ..."). */
export function parseNetbird(out: string): string | null {
  let v: unknown = null;
  try {
    v = (JSON.parse(out) as { fqdn?: unknown }).fqdn;
  } catch {
    v = /^\s*FQDN:\s*(\S+)\s*$/im.exec(out)?.[1] ?? null;
  }
  if (typeof v !== "string") return null;
  const name = v.trim().toLowerCase().replace(/\.$/, "");
  return dnsName(name) && name.includes(".") ? name : null;
}

function run(cmd: string, args: string[]): Promise<string | null> {
  return new Promise((ok) => {
    execFile(cmd, args, { timeout: 3000, windowsHide: true, maxBuffer: 1 << 20 }, (e, stdout) => ok(e ? null : String(stdout)));
  });
}

let nameCache: { at: number; v: string | null } | null = null;

/**
 * M8e: the VPN's name for this PC (NetBird: `netbird status`, 3 s at most; none: null). SCHELDEMIST_VPN_FQDN
 * names it by hand (Tailscale, or netbird not on the PATH). Never asked under the tests.
 */
export async function vpnName(): Promise<string | null> {
  const env = process.env.SCHELDEMIST_VPN_FQDN;
  if (env) return parseNetbird(`FQDN: ${env}`);
  if (process.env.VITEST) return null;
  if (nameCache && Date.now() - nameCache.at < 5 * 60_000) return nameCache.v;
  let out = await run("netbird", ["status", "--json"]);
  if (out === null && process.platform === "win32") out = await run("C:\\Program Files\\NetBird\\netbird.exe", ["status", "--json"]);
  let v = out ? parseNetbird(out) : null;
  if (!v && out !== null) {
    const plain = await run("netbird", ["status"]);
    v = plain ? parseNetbird(plain) : null;
  }
  nameCache = { at: Date.now(), v };
  return v;
}

/** The addresses a guest may type (with the port). */
export function lanUrls(port = PORT): string[] {
  const name = os.hostname().toLowerCase();
  return [...lanAddresses().map((a) => `http://${a}:${port}`), `http://${name}:${port}`];
}

const closeServer = (s: Server) =>
  new Promise<void>((ok) => {
    s.close(() => ok());
    (s as Server & { closeAllConnections?: () => void }).closeAllConnections?.();
  });

const open = new Map<string, Server>();

/** Listen on every home-network address (again). Returns the addresses now open. */
export async function openLan(fetch: Fetch, upgrade: Upgrade, port = PORT): Promise<string[]> {
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
  await Promise.all(all.map(closeServer));
  if (all.length) console.log("[mp] closed to the house");
}

export const lanOpen = (): string[] => [...open.keys()];

// ------------------------------------------------------------------ M8e: https for the house and the VPN

const secure = new Map<string, https.Server>();
let secureCert = "";
let secureState: { lan: boolean; vpn: boolean; lanAddrs: string[]; vpnAddrs: string[]; fqdn: string | null; certs: HouseCerts | null } = { lan: false, vpn: false, lanAddrs: [], vpnAddrs: [], fqdn: null, certs: null };

/**
 * Open (or close, or change) the https port: on 127.0.0.1 and the home-network addresses while `lan`, on the VPN's
 * addresses while `vpn`. Makes the house certificate on first need. Returns the addresses now open.
 */
export async function applySecure(fetch: Fetch, upgrade: Upgrade, want: { lan: boolean; vpn: boolean }, port = TLS_PORT): Promise<string[]> {
  if (!want.lan && !want.vpn) {
    await closeSecure();
    return [];
  }
  const lanAddrs = want.lan ? lanAddresses() : [];
  const vpnAddrs = want.vpn ? vpnAddresses() : [];
  const fqdn = want.vpn ? await vpnName() : null;
  const host = hostName();
  const addrs = [...new Set(["127.0.0.1", ...lanAddrs, ...vpnAddrs])];
  let certs: HouseCerts;
  try {
    // (the CA, made once, also permits the VPN's name when it is known, so turning the VPN on later keeps it)
    certs = await ensureHouseCerts(tlsDir(), { dns: ["localhost", host, `${host}.local`, ...(fqdn ? [fqdn] : [])], ips: addrs }, async () => {
      const f = fqdn ?? (await vpnName());
      return f ? [f] : [];
    });
  } catch (e) {
    console.warn(`[tls] no house certificate, the https port stays closed: ${(e as Error).message}`);
    await closeSecure();
    return [];
  }
  TLS_NAMES.clear();
  for (const n of certs.names) TLS_NAMES.add(n);
  for (const [a, s] of [...secure]) {
    if (addrs.includes(a)) continue;
    secure.delete(a);
    await closeServer(s as unknown as Server);
  }
  if (secureCert !== certs.cert) {
    for (const s of secure.values()) s.setSecureContext({ key: certs.key, cert: certs.cert });
    secureCert = certs.cert;
  }
  for (const addr of addrs) {
    if (secure.has(addr)) continue;
    const s = createAdaptorServer({ fetch: fetch as never, createServer: https.createServer, serverOptions: { key: certs.key, cert: certs.cert, minVersion: "TLSv1.2" } }) as unknown as https.Server;
    s.on("upgrade", upgrade);
    s.on("tlsClientError", () => {}); // (a guest's browser that does not trust the house yet: nothing to log)
    await new Promise<void>((ok) => {
      s.once("error", (e) => {
        console.warn(`[mp] cannot listen on ${addr}:${port} (https): ${(e as Error).message}`);
        ok();
      });
      s.listen(port, addr, () => {
        secure.set(addr, s);
        if (addr !== "127.0.0.1") console.log(`[mp] open ${vpnAddrs.includes(addr) ? "to the VPN" : "to the house"}: https://${addr}:${port}`);
        ok();
      });
    });
  }
  secureState = { lan: want.lan, vpn: want.vpn, lanAddrs, vpnAddrs, fqdn, certs };
  return [...secure.keys()];
}

export async function closeSecure(): Promise<void> {
  const all = [...secure.values()];
  secure.clear();
  TLS_NAMES.clear();
  secureCert = "";
  secureState = { lan: false, vpn: false, lanAddrs: [], vpnAddrs: [], fqdn: null, certs: null };
  await Promise.all(all.map((s) => closeServer(s as unknown as Server)));
  if (all.length) console.log("[mp] the https port is closed");
}

export const secureOpen = (): string[] => [...secure.keys()];

/** The secure addresses a guest may type: the house's (the computer's name first), then the VPN's. */
export function secureUrls(port = TLS_PORT): { house: string[]; vpn: string[] } {
  const on = (a: string) => secure.has(a);
  const s = secureState;
  if (!secure.size) return { house: [], vpn: [] };
  return {
    house: s.lan ? [`https://${hostName()}:${port}`, ...s.lanAddrs.filter(on).map((a) => `https://${a}:${port}`)] : [],
    vpn: s.vpn ? [...(s.fqdn ? [`https://${s.fqdn}:${port}`] : []), ...s.vpnAddrs.filter(on).map((a) => `https://${a}:${port}`)] : [],
  };
}

/** The secure address for a guest who came by `host` (a Host header), when the https port carries that name. */
export function secureUrlFor(host: string | undefined, port = TLS_PORT): string | null {
  if (!host || !secure.size) return null;
  try {
    const name = new URL(`http://${host}`).hostname.toLowerCase();
    return TLS_NAMES.has(name) ? `https://${name}:${port}` : null;
  } catch {
    return null;
  }
}

/** What the house certificate is now (null: the https port is closed). */
export const secureCerts = (): HouseCerts | null => (secure.size ? secureState.certs : null);
