import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import https from "node:https";
import type { Server } from "node:http";
import type { Duplex } from "node:stream";
import type { IncomingMessage } from "node:http";
import { createAdaptorServer } from "@hono/node-server";
import { LAN_NAMES, OWN_ADDRS, PORT, TLS_NAMES, TLS_PORT } from "../config.ts";
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

const isFile = (f: string) => {
  try {
    return fs.statSync(f).isFile();
  } catch {
    return false;
  }
};

let netbirdExe: string | null | undefined;

/**
 * M8e: the netbird program as an absolute path, looked up once: the absolute folders on the PATH (never the working
 * folder, never a relative PATH entry), then the standard install folder. Null: no netbird on this PC.
 */
export function netbirdPath(): string | null {
  if (netbirdExe !== undefined) return netbirdExe;
  const win = process.platform === "win32";
  const exe = win ? "netbird.exe" : "netbird";
  const onPath = (process.env.PATH ?? process.env.Path ?? "")
    .split(path.delimiter)
    .map((d) => d.trim().replace(/^"(.*)"$/, "$1"))
    .filter((d) => d && path.isAbsolute(d));
  const standard = win ? ["C:\\Program Files\\NetBird", path.join(process.env.ProgramFiles || "C:\\Program Files", "NetBird")] : ["/usr/bin", "/usr/local/bin", "/opt/homebrew/bin"];
  netbirdExe = null;
  for (const d of [...onPath, ...standard]) {
    const f = path.join(d, exe);
    if (isFile(f)) {
      netbirdExe = f;
      break;
    }
  }
  return netbirdExe;
}

let nameCache: { at: number; v: string | null } | null = null;
/** How long a found VPN name is kept (5 min), and how long "no name" is (60 s: NetBird may come up any moment). */
const NAME_KEEP_MS = 5 * 60_000;
const NO_NAME_KEEP_MS = 60_000;

/**
 * M8e: the VPN's name for this PC (NetBird: `netbird status`, 3 s at most; none: null). SCHELDEMIST_VPN_FQDN
 * names it by hand (Tailscale, or netbird not on the PATH). Never asked under the tests.
 */
export async function vpnName(): Promise<string | null> {
  const env = process.env.SCHELDEMIST_VPN_FQDN;
  if (env) return parseNetbird(`FQDN: ${env}`);
  if (process.env.VITEST) return null;
  if (nameCache && Date.now() - nameCache.at < (nameCache.v ? NAME_KEEP_MS : NO_NAME_KEEP_MS)) return nameCache.v;
  const exe = netbirdPath();
  let v: string | null = null;
  if (exe) {
    const out = await run(exe, ["status", "--json"]);
    v = out ? parseNetbird(out) : null;
    if (!v && out !== null) {
      const plain = await run(exe, ["status"]);
      v = plain ? parseNetbird(plain) : null;
    }
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

/** M8e: the addresses the server is bound to now (plain http and https), besides loopback: this PC (config.ts OWN_ADDRS). */
function syncOwn(): void {
  OWN_ADDRS.clear();
  for (const a of [...open.keys(), ...secure.keys()]) if (a !== "127.0.0.1") OWN_ADDRS.add(a);
}

/** Listen on every home-network address (again): new ones opened, ones this PC no longer has closed. Returns the addresses now open. */
export async function openLan(fetch: Fetch, upgrade: Upgrade, port = PORT): Promise<string[]> {
  const want = lanAddresses();
  const name = os.hostname().toLowerCase();
  LAN_NAMES.add(name);
  LAN_NAMES.add(`${name}.local`);
  for (const [addr, s] of [...open]) {
    if (want.includes(addr)) continue;
    open.delete(addr);
    LAN_NAMES.delete(addr);
    await closeServer(s);
    console.log(`[mp] this PC no longer has ${addr}: closed there`);
  }
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
  syncOwn();
  return [...open.keys()];
}

export async function closeLan(): Promise<void> {
  const all = [...open.values()];
  open.clear();
  LAN_NAMES.clear();
  syncOwn();
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
    // (the CA, made once, also permits the VPN's name when it is known and every home-network and VPN address this PC
    // has now, so turning the house or the VPN on later keeps it; a new address it does not cover remakes it)
    certs = await ensureHouseCerts(tlsDir(), { dns: ["localhost", host, `${host}.local`, ...(fqdn ? [fqdn] : [])], ips: addrs }, async () => {
      const f = fqdn ?? (await vpnName());
      return { dns: f ? [f] : [], ips: [...lanAddresses(), ...vpnAddresses()] };
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
  syncOwn();
  return [...secure.keys()];
}

export async function closeSecure(): Promise<void> {
  const all = [...secure.values()];
  secure.clear();
  TLS_NAMES.clear();
  secureCert = "";
  secureState = { lan: false, vpn: false, lanAddrs: [], vpnAddrs: [], fqdn: null, certs: null };
  syncOwn();
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

// ------------------------------------------------------------------ M8e: this PC's addresses change

/** How often the addresses are looked at while the house or the VPN is open (os.networkInterfaces: cheap). */
export const ADDR_WATCH_MS = 30_000;

let watch: { timer: NodeJS.Timeout; on: { lan: boolean; vpn: boolean }; apply: () => Promise<unknown>; tried: string; busy: boolean } | null = null;

const sig = (lanAddrs: string[], vpnAddrs: string[], fqdn: string | null) => JSON.stringify([[...lanAddrs].sort(), [...vpnAddrs].sort(), fqdn]);

async function watchTick(): Promise<void> {
  const w = watch;
  if (!w || w.busy) return;
  w.busy = true;
  try {
    // what the listeners were opened with, against what this PC has now (the VPN name: cached, lan.ts vpnName)
    const s = secureState;
    const applied = sig(s.lanAddrs, s.vpnAddrs, s.fqdn);
    const now = sig(w.on.lan ? lanAddresses() : [], w.on.vpn ? vpnAddresses() : [], w.on.vpn ? await vpnName() : null);
    const httpStale = w.on.lan && JSON.stringify(lanAddresses().sort()) !== JSON.stringify([...open.keys()].sort());
    if (now === applied && !httpStale) return;
    if (now === w.tried) return; // (tried once for exactly these addresses and it did not take: not every 30 s again)
    w.tried = now;
    console.log("[mp] this PC's addresses changed: the house's listeners and certificate follow");
    await w.apply();
  } catch (e) {
    console.warn("[mp] the address watch", e);
  } finally {
    w.busy = false;
  }
}

/**
 * M8e: while the house or the VPN is open, look at this PC's addresses every 30 s; when the home-network or VPN
 * addresses (or the VPN name) change, `apply` opens the listeners again and remakes the server certificate (and the
 * CA, for a new address it does not cover). `on` null (or both off): the watch stops.
 */
export function setAddressWatch(on: { lan: boolean; vpn: boolean } | null, apply?: () => Promise<unknown>, everyMs = ADDR_WATCH_MS): void {
  if (!on || (!on.lan && !on.vpn) || !apply) {
    if (watch) clearInterval(watch.timer);
    watch = null;
    return;
  }
  if (watch) {
    watch.on = on;
    watch.apply = apply;
    return;
  }
  const timer = setInterval(() => void watchTick(), everyMs);
  timer.unref();
  watch = { timer, on, apply, tried: "", busy: false };
}

/** Is the address watch running? (for the tests and /api/mp/host) */
export const addressWatchOn = (): boolean => watch !== null;
