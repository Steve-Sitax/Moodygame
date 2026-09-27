import "reflect-metadata"; // (@peculiar/x509 needs the Reflect polyfill before it loads)
import { execFile } from "node:child_process";
import { createHash, createPrivateKey, createPublicKey, randomBytes, webcrypto, X509Certificate as NodeCert } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as x509 from "@peculiar/x509";
import { DB_FILE } from "../config.ts";

// M8e "outside the house" (docs/milestones/M8e.md): the house certificate.
//
// - A house certificate authority, made once per host on first need (data/tls/house-ca.key + house-ca.crt): EC
//   P-256, 10 years, extended key usage serverAuth only (a guest who trusts it trusts it for websites only, never
//   for code, mail or client logins), with name constraints that permit only this PC's own names (hostname,
//   hostname.local, localhost, the VPN name if known) and this PC's own addresses (127.0.0.1, its home-network and
//   VPN addresses, each a /32). A guest trusts it once; a leaked key still cannot sign for any other site, on the
//   internet or on the guest's own network. Made again when a new address of this PC appears that it does not
//   cover (one that goes away does not remake it), and once for a CA made before these rules (no EKU, or whole
//   private ranges).
// - A server certificate signed by it (data/tls/server.key + server.crt), 397 days, naming localhost, 127.0.0.1,
//   the hostname, hostname.local, every home-network and VPN address and the VPN name. Made again when that set
//   changes or it is within 30 days of its end.
// - The keys never leave data/tls (data/ is gitignored), are never logged or served, and each key file is readable
//   by this Windows user only (icacls; chmod 600 elsewhere). /house-ca.crt serves the CA's public certificate.

x509.cryptoProvider.set(webcrypto as never);

const EC = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGN = { name: "ECDSA", hash: "SHA-256" } as const;
const DAY = 86_400_000;
const CA_DAYS = 3652;
const SERVER_DAYS = 397;
const RENEW_DAYS = 30;

/**
 * The private IPv4 ranges a server certificate may name at all (home networks, the VPN's CGNAT range, this PC). The
 * house CA itself permits only this PC's own addresses inside them (caIps below), never a whole range.
 */
export const PRIVATE_RANGES: ReadonlyArray<readonly [string, number]> = [
  ["10.0.0.0", 8],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
];

export const CA_KEY = "house-ca.key";
export const CA_CRT = "house-ca.crt";
export const SERVER_KEY = "server.key";
export const SERVER_CRT = "server.crt";

/**
 * Where the certificates live, per save: data/tls for the real save (game.sqlite), data/tls-<save name> for any other
 * save file (a test stack's data/test-<name>.sqlite: data/tls-test-<name>), so a test stack never rewrites the real
 * house certificate. SCHELDEMIST_TLS_DIR names the folder by hand.
 */
export function tlsDirFor(dbFile: string): string {
  if (process.env.SCHELDEMIST_TLS_DIR) return path.resolve(process.env.SCHELDEMIST_TLS_DIR);
  const base = path.basename(dbFile);
  if (base.toLowerCase() === "game.sqlite") return path.join(path.dirname(dbFile), "tls");
  const name = base.replace(/\.sqlite$/i, "").replace(/[^A-Za-z0-9._-]/g, "_") || "save";
  return path.join(path.dirname(dbFile), `tls-${name}`);
}
export const tlsDir = (): string => tlsDirFor(DB_FILE);

/** This PC's own name, as a DNS label (lower case). */
export function hostName(): string {
  return (
    os
      .hostname()
      .toLowerCase()
      .replace(/[^a-z0-9.-]/g, "") || "localhost"
  );
}

// ------------------------------------------------------------------ addresses

const ip4 = (s: string): number[] | null => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const b = m.slice(1).map(Number);
  return b.every((x) => x <= 255) ? b : null;
};
const ipNum = (b: number[]) => ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
const maskOf = (bits: number) => (bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0);
const inRange = (ip: string, base: string, bits: number) => {
  const a = ip4(ip);
  const b = ip4(base);
  return !!a && !!b && (ipNum(a) & maskOf(bits)) >>> 0 === (ipNum(b) & maskOf(bits)) >>> 0;
};
/** An IPv4 address in one of the house's private ranges. */
export const privateIp = (ip: string): boolean => PRIVATE_RANGES.some(([b, n]) => inRange(ip, b, n));
/** NetBird's and Tailscale's addresses: 100.64.0.0/10. */
export const vpnIp = (ip: string): boolean => inRange(ip, "100.64.0.0", 10);
/** A DNS name the certificate may carry. */
export const dnsName = (s: string): boolean => /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/.test(s);

// ------------------------------------------------------------------ name constraints (DER, by hand: small)

function tlv(tag: number, body: Buffer): Buffer {
  const n = body.length;
  const len = n < 0x80 ? Buffer.from([n]) : n < 0x100 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 0xff]);
  return Buffer.concat([Buffer.from([tag]), len, body]);
}

/** NameConstraints with permitted subtrees only: dNSName [2] and iPAddress [7] (address + mask). */
export function nameConstraintsDer(dns: string[], ranges: ReadonlyArray<readonly [string, number]>): Buffer {
  const subtrees: Buffer[] = [];
  for (const d of dns) subtrees.push(tlv(0x30, tlv(0x82, Buffer.from(d, "ascii"))));
  for (const [base, bits] of ranges) {
    const m = maskOf(bits);
    subtrees.push(tlv(0x30, tlv(0x87, Buffer.from([...ip4(base)!, m >>> 24, (m >>> 16) & 0xff, (m >>> 8) & 0xff, m & 0xff]))));
  }
  return tlv(0x30, tlv(0xa0, Buffer.concat(subtrees)));
}

function children(buf: Buffer, start: number, end: number): Array<{ tag: number; s: number; e: number }> {
  const out: Array<{ tag: number; s: number; e: number }> = [];
  let i = start;
  while (i < end) {
    const tag = buf[i];
    let len = buf[i + 1];
    let h = 2;
    if (len & 0x80) {
      const k = len & 0x7f;
      len = 0;
      for (let j = 0; j < k; j++) len = (len << 8) | buf[i + 2 + j];
      h = 2 + k;
    }
    out.push({ tag, s: i + h, e: i + h + len });
    i += h + len;
  }
  return out;
}

/** The permitted names and ranges of a NameConstraints value (what nameConstraintsDer wrote). */
export function readNameConstraints(der: Buffer): { dns: string[]; ranges: string[] } {
  const dns: string[] = [];
  const ranges: string[] = [];
  const [outer] = children(der, 0, der.length);
  if (!outer || outer.tag !== 0x30) return { dns, ranges };
  for (const part of children(der, outer.s, outer.e)) {
    if (part.tag !== 0xa0) continue;
    for (const st of children(der, part.s, part.e)) {
      const [gn] = children(der, st.s, st.e);
      if (!gn) continue;
      const v = der.subarray(gn.s, gn.e);
      if (gn.tag === 0x82) dns.push(v.toString("ascii"));
      else if (gn.tag === 0x87 && v.length === 8) {
        const m = v.readUInt32BE(4);
        let bits = 0;
        while (bits < 32 && m & (0x80000000 >>> bits)) bits++;
        ranges.push(`${v[0]}.${v[1]}.${v[2]}.${v[3]}/${bits}`);
      }
    }
  }
  return { dns, ranges };
}

const dnsPermitted = (name: string, bases: string[]) => bases.some((b) => name === b || name.endsWith(`.${b}`));

// ------------------------------------------------------------------ files

const pem = (label: string, der: ArrayBuffer | Buffer) => {
  const b64 = Buffer.from(der as ArrayBuffer).toString("base64");
  return `-----BEGIN ${label}-----\n${b64.match(/.{1,64}/g)!.join("\n")}\n-----END ${label}-----\n`;
};

/** Only this Windows user may read a key file (no inherited rights); chmod 600 elsewhere. */
function tighten(file: string): Promise<void> {
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      /* best effort */
    }
    return Promise.resolve();
  }
  const user = process.env.USERNAME ? (process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}` : process.env.USERNAME) : os.userInfo().username;
  // (the absolute program, never a bare name a folder could shadow)
  const icacls = path.join(process.env.SystemRoot || process.env.windir || "C:\\Windows", "System32", "icacls.exe");
  return new Promise((ok) => {
    execFile(icacls, [file, "/inheritance:r", "/grant:r", `${user}:F`], { timeout: 5000, windowsHide: true }, (e) => {
      if (e) console.warn(`[tls] could not narrow the rights on ${path.basename(file)} (${e.message.split("\n")[0]})`);
      ok();
    });
  });
}

async function writeKey(file: string, text: string): Promise<void> {
  fs.writeFileSync(file, "", { mode: 0o600 }); // (empty first: its rights are narrowed before the key goes in)
  await tighten(file);
  fs.writeFileSync(file, text, { mode: 0o600 });
}

const read = (file: string): string | null => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
};

const serial = () => {
  const b = randomBytes(16);
  b[0] &= 0x7f;
  if (b[0] === 0) b[0] = 1;
  return b.toString("hex");
};

const fingerprint = (der: Buffer, algo: "sha256" | "sha1") =>
  createHash(algo)
    .update(der)
    .digest("hex")
    .toUpperCase()
    .match(/../g)!
    .join(":");

/** The base64 SHA-256 of a public key's SubjectPublicKeyInfo (Chrome's --ignore-certificate-errors-spki-list). */
export function spkiHash(keyPem: string): string {
  const spki = createPublicKey(createPrivateKey(keyPem)).export({ type: "spki", format: "der" });
  return createHash("sha256").update(spki).digest("base64");
}

// ------------------------------------------------------------------ the two certificates

export interface HouseWant {
  /** DNS names for the server certificate (localhost, the hostname, hostname.local, the VPN name). */
  dns: string[];
  /** IPv4 addresses for it (127.0.0.1, the home-network and VPN addresses). */
  ips: string[];
}

export interface HouseCerts {
  /** The server's key and certificate (PEM) for https: never sent anywhere but to node's TLS. */
  key: string;
  cert: string;
  /** The CA's public certificate (PEM): what /house-ca.crt serves. */
  caPem: string;
  caSha256: string;
  /** Windows shows this one as the "Thumbprint". */
  caSha1: string;
  /** The server key's SPKI hash (base64 SHA-256). */
  spki: string;
  /** The names the server certificate carries. */
  names: string[];
  serverUntil: string;
  madeCa: boolean;
  madeServer: boolean;
}

const norm = (w: HouseWant): HouseWant => ({
  dns: [...new Set(w.dns.map((d) => d.toLowerCase().replace(/\.$/, "")).filter(dnsName))].sort(),
  ips: [...new Set(w.ips.filter((i) => !!ip4(i) && privateIp(i)))].sort(),
});

interface Ca {
  pem: string;
  keyPem: string;
  node: NodeCert;
}

/** The CA's extended key usage: serverAuth and nothing else. */
function serverAuthOnly(px: x509.X509Certificate): boolean {
  const eku = px.getExtension(x509.ExtendedKeyUsageExtension);
  return !!eku && eku.usages.length === 1 && String(eku.usages[0]) === x509.ExtendedKeyUsage.serverAuth;
}

function loadCa(dir: string, want: HouseWant): Ca | null {
  const certPem = read(path.join(dir, CA_CRT));
  const keyPem = read(path.join(dir, CA_KEY));
  if (!certPem || !keyPem) return null;
  const again = (why: string) => {
    console.log(`[tls] the house certificate authority ${why}: a new one is made (guests fetch /house-ca.crt again)`);
    return null;
  };
  try {
    const node = new NodeCert(certPem);
    if (!node.ca || !node.checkPrivateKey(createPrivateKey(keyPem))) return null;
    if (node.validToDate.getTime() - Date.now() < RENEW_DAYS * DAY) return null;
    const px = new x509.X509Certificate(certPem);
    const nc = px.getExtension("2.5.29.30");
    if (!nc) return null;
    // (made before the review-4 rules: no EKU, or whole private ranges: remade once)
    if (!serverAuthOnly(px)) return again("is not limited to websites");
    const { dns, ranges } = readNameConstraints(Buffer.from(nc.value));
    if (ranges.some((r) => !r.endsWith("/32"))) return again("permits whole address ranges");
    if (!want.dns.every((d) => dnsPermitted(d, dns))) return again("does not cover a new name of this PC");
    if (!want.ips.every((ip) => ranges.includes(`${ip}/32`))) return again("does not cover a new address of this PC");
    return { pem: certPem, keyPem, node };
  } catch {
    return null;
  }
}

async function makeCa(dir: string, dns: string[], ips: string[]): Promise<Ca> {
  const keys = (await webcrypto.subtle.generateKey(EC, true, ["sign", "verify"])) as webcrypto.CryptoKeyPair;
  const now = Date.now();
  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: serial(),
    name: [{ CN: [`Scheldemist house CA (${hostName()})`] }],
    notBefore: new Date(now - 3600_000),
    notAfter: new Date(now + CA_DAYS * DAY),
    keys,
    signingAlgorithm: SIGN,
    extensions: [
      new x509.BasicConstraintsExtension(true, 0, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign, true),
      // (websites only: Windows, Chrome and OpenSSL hold every certificate under it to serverAuth)
      new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.serverAuth], false),
      new x509.Extension(
        "2.5.29.30",
        true,
        nameConstraintsDer(
          dns,
          ips.map((ip) => [ip, 32] as const),
        ),
      ),
      await x509.SubjectKeyIdentifierExtension.create(keys.publicKey),
    ],
  });
  const keyPem = pem("PRIVATE KEY", await webcrypto.subtle.exportKey("pkcs8", keys.privateKey));
  const certPem = cert.toString("pem").replace(/\r\n/g, "\n") + "\n";
  await writeKey(path.join(dir, CA_KEY), keyPem);
  fs.writeFileSync(path.join(dir, CA_CRT), certPem);
  console.log(`[tls] a new house certificate authority for ${[...dns, ...ips].join(", ")}: ${path.join(dir, CA_CRT)}`);
  return { pem: certPem, keyPem, node: new NodeCert(certPem) };
}

/** The names a certificate carries (Node's text form: "DNS:x, IP Address:y"). */
function sanOf(c: NodeCert): { dns: string[]; ips: string[] } {
  const dns: string[] = [];
  const ips: string[] = [];
  for (const part of (c.subjectAltName ?? "").split(/,\s*/)) {
    if (part.startsWith("DNS:")) dns.push(part.slice(4));
    else if (part.startsWith("IP Address:")) ips.push(part.slice(11));
  }
  return { dns: dns.sort(), ips: ips.sort() };
}

function loadServer(dir: string, ca: Ca, want: HouseWant): { key: string; cert: string; node: NodeCert } | null {
  const cert = read(path.join(dir, SERVER_CRT));
  const key = read(path.join(dir, SERVER_KEY));
  if (!cert || !key) return null;
  try {
    const node = new NodeCert(cert);
    if (!node.checkPrivateKey(createPrivateKey(key))) return null;
    if (!node.checkIssued(ca.node) || !node.verify(ca.node.publicKey)) return null;
    if (node.validToDate.getTime() - Date.now() < RENEW_DAYS * DAY) return null;
    const has = sanOf(node);
    if (JSON.stringify(has) !== JSON.stringify({ dns: want.dns, ips: want.ips })) return null;
    return { key, cert, node };
  } catch {
    return null;
  }
}

async function makeServer(dir: string, ca: Ca, want: HouseWant): Promise<{ key: string; cert: string; node: NodeCert }> {
  const keys = (await webcrypto.subtle.generateKey(EC, true, ["sign", "verify"])) as webcrypto.CryptoKeyPair;
  const caKey = await webcrypto.subtle.importKey("pkcs8", createPrivateKey(ca.keyPem).export({ type: "pkcs8", format: "der" }), EC, false, ["sign"]);
  const caX = new x509.X509Certificate(ca.pem);
  const now = Date.now();
  const cert = await x509.X509CertificateGenerator.create({
    serialNumber: serial(),
    subject: [{ CN: [hostName()] }],
    issuer: caX.subject,
    notBefore: new Date(now - 3600_000),
    notAfter: new Date(now + SERVER_DAYS * DAY),
    publicKey: keys.publicKey,
    signingKey: caKey,
    signingAlgorithm: SIGN,
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true),
      new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.serverAuth]),
      new x509.SubjectAlternativeNameExtension([...want.dns.map((value) => ({ type: "dns" as const, value })), ...want.ips.map((value) => ({ type: "ip" as const, value }))]),
      await x509.SubjectKeyIdentifierExtension.create(keys.publicKey),
      await x509.AuthorityKeyIdentifierExtension.create(caX.publicKey),
    ],
  });
  const key = pem("PRIVATE KEY", await webcrypto.subtle.exportKey("pkcs8", keys.privateKey));
  const certPem = cert.toString("pem").replace(/\r\n/g, "\n") + "\n";
  await writeKey(path.join(dir, SERVER_KEY), key);
  fs.writeFileSync(path.join(dir, SERVER_CRT), certPem);
  console.log(`[tls] a new server certificate for ${[...want.dns, ...want.ips].join(", ")}`);
  return { key, cert: certPem, node: new NodeCert(certPem) };
}

let busy: Promise<unknown> = Promise.resolve();
let last: HouseCerts | null = null;

/** Names and addresses the CA should permit besides the ones wanted now (e.g. the VPN's while it is off). */
export interface CaExtra {
  dns?: string[];
  ips?: string[];
}

/**
 * The house's certificates for `want`: the CA made once (again only when it ends or does not cover a name or an
 * address of this PC: `caExtra` gives the names and addresses it should permit too when it is made, e.g. the VPN's
 * before the VPN is on), the server certificate made again when its names change or it ends within 30 days.
 */
export function ensureHouseCerts(dir: string, wantIn: HouseWant, caExtra: () => Promise<CaExtra> = async () => ({})): Promise<HouseCerts> {
  const run = async (): Promise<HouseCerts> => {
    const want = norm(wantIn);
    fs.mkdirSync(dir, { recursive: true });
    let madeCa = false;
    let ca = loadCa(dir, want);
    if (!ca) {
      const extra = await caExtra().catch((): CaExtra => ({}));
      const more = norm({ dns: extra.dns ?? [], ips: extra.ips ?? [] });
      const dns = [...new Set(["localhost", hostName(), `${hostName()}.local`, ...want.dns, ...more.dns])];
      const ips = [...new Set(["127.0.0.1", ...want.ips, ...more.ips])].sort();
      ca = await makeCa(dir, dns, ips);
      madeCa = true;
    }
    let madeServer = false;
    let srv = madeCa ? null : loadServer(dir, ca, want);
    if (!srv) {
      srv = await makeServer(dir, ca, want);
      madeServer = true;
    }
    const der = ca.node.raw;
    last = {
      key: srv.key,
      cert: srv.cert,
      caPem: ca.pem,
      caSha256: fingerprint(der, "sha256"),
      caSha1: fingerprint(der, "sha1"),
      spki: spkiHash(srv.key),
      names: [...want.dns, ...want.ips],
      serverUntil: srv.node.validToDate.toISOString(),
      madeCa,
      madeServer,
    };
    return last;
  };
  const p = busy.then(run, run);
  busy = p.catch(() => {});
  return p;
}

/** The last certificates made or loaded (null: the house has not needed them yet). */
export const houseCerts = (): HouseCerts | null => last;

/** The CA's public certificate from disk (null: none made yet). Never the key. */
export function houseCaPem(dir = tlsDir()): string | null {
  const t = read(path.join(dir, CA_CRT));
  return t && /^-----BEGIN CERTIFICATE-----/.test(t) && !/PRIVATE KEY/.test(t) ? t : null;
}

/** Test helper: forget what was loaded. */
export function resetHouseCerts(): void {
  last = null;
}
