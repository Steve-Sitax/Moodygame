import "reflect-metadata";
import { spawn, type ChildProcess } from "node:child_process";
import { createPrivateKey, webcrypto, X509Certificate } from "node:crypto";
import fs from "node:fs";
import https from "node:https";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import { fileURLToPath } from "node:url";
import * as x509 from "@peculiar/x509";
import WebSocket from "ws";
import { afterAll, describe, expect, it } from "vitest";
import { allowedHost, allowedOrigin, OWN_ADDRS, PORT, TLS_NAMES, TLS_PORT } from "../src/config.ts";
import { loopback } from "../src/mp/auth.ts";
import { addressWatchOn, applySecure, closeLan, closeSecure, lanOpen, netbirdPath, openLan, parseNetbird, secureOpen, setAddressWatch } from "../src/mp/lan.ts";
import { mpSettings, resetMpSettings, setMp } from "../src/mp/settings.ts";
import { CA_CRT, CA_KEY, ensureHouseCerts, hostName, nameConstraintsDer, PRIVATE_RANGES, privateIp, readNameConstraints, SERVER_CRT, spkiHash, tlsDirFor, vpnIp } from "../src/mp/tls.ts";
import { MP_PROTOCOL } from "../../shared/mpProtocol.ts";

// M8e part A (docs/milestones/M8e.md): the house certificate authority (made once, name constraints: this PC's
// names and the private ranges only), the server certificate (the right names, chained to the house, made again
// when an address changes), https and wss on the next port, the house certificate for the guests (never a key),
// the Host check on https, and "Open to my VPN" (host-only). Only fake VPN names here.

const FAKE_VPN = "pcx.fake-vpn.test";
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "scheldemist-tls-"));
const dirs: string[] = [];
const kids: ChildProcess[] = [];
afterAll(() => {
  for (const k of kids) k.kill();
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

const want = (ips: string[] = ["127.0.0.1", "192.168.1.20"]) => ({ dns: ["localhost", "pcx-test", "pcx-test.local"], ips });
const tmpDir = () => {
  const d = tmp();
  dirs.push(d);
  return d;
};

const EC = { name: "ECDSA", namedCurve: "P-256" } as const;
const keyPem = async (k: webcrypto.CryptoKey) => `-----BEGIN PRIVATE KEY-----\n${Buffer.from(await webcrypto.subtle.exportKey("pkcs8", k)).toString("base64")}\n-----END PRIVATE KEY-----\n`;

/** A leaf certificate signed with the CA key in `dir` (what a thief with the key could make). */
async function forgeLeaf(dir: string, names: Array<{ type: "dns" | "ip"; value: string }>): Promise<{ cert: string; key: string }> {
  const caPem = fs.readFileSync(path.join(dir, CA_CRT), "utf8");
  const caKey = await webcrypto.subtle.importKey("pkcs8", createPrivateKey(fs.readFileSync(path.join(dir, CA_KEY), "utf8")).export({ type: "pkcs8", format: "der" }), EC, false, ["sign"]);
  const keys = (await webcrypto.subtle.generateKey(EC, true, ["sign", "verify"])) as webcrypto.CryptoKeyPair;
  const cert = await x509.X509CertificateGenerator.create({
    // (the CN a name the CA permits: OpenSSL checks a CN as a DNS name when there is no DNS SAN, and the IP checks
    // below must fail on the address alone)
    subject: [{ CN: ["pcx-test"] }],
    issuer: new x509.X509Certificate(caPem).subject,
    notBefore: new Date(Date.now() - 60_000),
    notAfter: new Date(Date.now() + 86_400_000),
    publicKey: keys.publicKey as never,
    signingKey: caKey as never,
    signingAlgorithm: { name: "ECDSA", hash: "SHA-256" },
    extensions: [new x509.SubjectAlternativeNameExtension(names)],
  });
  return { cert: cert.toString("pem"), key: await keyPem(keys.privateKey) };
}

/** A house CA as the first M8e build made it: no EKU, the whole private ranges. */
async function oldStyleCa(dir: string): Promise<void> {
  const keys = (await webcrypto.subtle.generateKey(EC, true, ["sign", "verify"])) as webcrypto.CryptoKeyPair;
  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: "01",
    name: [{ CN: ["Scheldemist house CA (old)"] }],
    notBefore: new Date(Date.now() - 60_000),
    notAfter: new Date(Date.now() + 3650 * 86_400_000),
    keys: keys as never,
    signingAlgorithm: { name: "ECDSA", hash: "SHA-256" },
    extensions: [
      new x509.BasicConstraintsExtension(true, 0, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign, true),
      new x509.Extension("2.5.29.30", true, nameConstraintsDer(["localhost", "pcx-test", "pcx-test.local", hostName(), `${hostName()}.local`], PRIVATE_RANGES)),
    ],
  });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, CA_KEY), await keyPem(keys.privateKey));
  fs.writeFileSync(path.join(dir, CA_CRT), cert.toString("pem"));
}

describe("the house certificate authority and the server certificate", () => {
  it("the CA is made once and used again; the key files stay in the folder", async () => {
    const dir = tmp();
    dirs.push(dir);
    const a = await ensureHouseCerts(dir, want());
    expect(a.madeCa).toBe(true);
    expect(a.madeServer).toBe(true);
    const keyAt = fs.statSync(path.join(dir, CA_KEY)).mtimeMs;
    const b = await ensureHouseCerts(dir, want());
    expect(b.madeCa).toBe(false);
    expect(b.madeServer).toBe(false);
    expect(b.caSha256).toBe(a.caSha256);
    expect(b.spki).toBe(a.spki);
    expect(fs.statSync(path.join(dir, CA_KEY)).mtimeMs).toBe(keyAt);
    expect(a.caSha256).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    expect(a.caPem).toMatch(/^-----BEGIN CERTIFICATE-----/);
    expect(a.caPem).not.toContain("PRIVATE KEY");
    expect(fs.readdirSync(dir).sort()).toEqual(["house-ca.crt", "house-ca.key", "server.crt", "server.key"]);
  });

  it("the CA: EC P-256, 10 years, CA:true, keyCertSign + cRLSign, EKU serverAuth only, critical name constraints with this PC's names and its own addresses (/32)", async () => {
    const dir = tmp();
    dirs.push(dir);
    const c = await ensureHouseCerts(dir, want(), async () => ({ dns: [FAKE_VPN], ips: ["100.90.1.2", "192.168.1.20", "8.8.8.8"] }));
    const ca = new X509Certificate(c.caPem);
    expect(ca.ca).toBe(true);
    expect(ca.subject).toContain(`Scheldemist house CA (${hostName()})`);
    expect(ca.publicKey.asymmetricKeyDetails?.namedCurve).toBe("prime256v1");
    const years = (ca.validToDate.getTime() - Date.now()) / (365.25 * 86_400_000);
    expect(years).toBeGreaterThan(9.9);
    expect(years).toBeLessThan(10.1);
    const px = new x509.X509Certificate(c.caPem);
    const ku = px.getExtension(x509.KeyUsagesExtension)!;
    expect(ku.critical).toBe(true);
    expect(ku.usages).toBe(x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign);
    const bc = px.getExtension(x509.BasicConstraintsExtension)!;
    expect(bc.ca).toBe(true);
    expect(bc.critical).toBe(true);
    const nc = px.getExtension("2.5.29.30")!;
    expect(nc.critical).toBe(true);
    const r = readNameConstraints(Buffer.from(nc.value));
    expect(r.dns.sort()).toEqual(["localhost", "pcx-test", "pcx-test.local", FAKE_VPN, hostName(), `${hostName()}.local`].filter((v, i, a) => a.indexOf(v) === i).sort());
    // only this PC's own addresses, one each; never a whole range, never a public address
    expect(r.ranges).toEqual(["100.90.1.2/32", "127.0.0.1/32", "192.168.1.20/32"]);
    // websites only
    const eku = px.getExtension(x509.ExtendedKeyUsageExtension)!;
    expect(eku.usages).toEqual([x509.ExtendedKeyUsage.serverAuth]);
    // (what the encoder writes, the reader reads)
    expect(readNameConstraints(nameConstraintsDer(["a.b"], PRIVATE_RANGES)).ranges).toHaveLength(5);
  });

  it("a CA made before the review-4 rules (no EKU, whole private ranges) is made again once", async () => {
    const dir = tmp();
    dirs.push(dir);
    await oldStyleCa(dir);
    const oldSha = new X509Certificate(fs.readFileSync(path.join(dir, CA_CRT), "utf8")).fingerprint256;
    const a = await ensureHouseCerts(dir, want());
    expect(a.madeCa).toBe(true);
    expect(new X509Certificate(a.caPem).fingerprint256).not.toBe(oldSha);
    const b = await ensureHouseCerts(dir, want());
    expect(b.madeCa).toBe(false);
    expect(b.caSha256).toBe(a.caSha256);
  });

  it("the server certificate names exactly the wanted names and addresses, 397 days, and chains to the house CA", async () => {
    const dir = tmp();
    dirs.push(dir);
    const c = await ensureHouseCerts(dir, { dns: ["localhost", "pcx-test", "pcx-test.local", FAKE_VPN, "Bad Name!"], ips: ["127.0.0.1", "192.168.1.20", "100.70.1.2", "8.8.8.8"] });
    const s = new X509Certificate(c.cert);
    const ca = new X509Certificate(c.caPem);
    expect(s.subjectAltName).toBe(`DNS:localhost, DNS:pcx-test, DNS:pcx-test.local, DNS:${FAKE_VPN}, IP Address:100.70.1.2, IP Address:127.0.0.1, IP Address:192.168.1.20`);
    expect(c.names).not.toContain("8.8.8.8"); // (a public address is never asked for)
    expect(s.ca).toBe(false);
    expect(s.checkIssued(ca)).toBe(true);
    expect(s.verify(ca.publicKey)).toBe(true);
    const days = (s.validToDate.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(396);
    expect(days).toBeLessThan(398);
    expect(new x509.X509Certificate(c.cert).getExtension(x509.ExtendedKeyUsageExtension)!.usages).toContain(x509.ExtendedKeyUsage.serverAuth);
    expect(c.spki).toBe(spkiHash(c.key));
    expect(c.spki).toMatch(/^[A-Za-z0-9+/]{43}=$/);
  });

  it("an address goes away: a new server certificate, the same CA; a new address or name it does not cover: a new CA", async () => {
    const dir = tmp();
    dirs.push(dir);
    // the CA is made with every address this PC has (the VPN's too, while the VPN is off)
    const a = await ensureHouseCerts(dir, want(["127.0.0.1", "192.168.1.20", "192.168.1.21"]), async () => ({ ips: ["100.99.0.7"] }));
    expect(a.madeCa).toBe(true);
    const b = await ensureHouseCerts(dir, want(["127.0.0.1", "192.168.1.21"]));
    expect(b.madeCa).toBe(false);
    expect(b.madeServer).toBe(true);
    expect(b.caSha256).toBe(a.caSha256);
    expect(new X509Certificate(b.cert).subjectAltName).toContain("IP Address:192.168.1.21");
    expect(new X509Certificate(fs.readFileSync(path.join(dir, SERVER_CRT), "utf8")).subjectAltName).not.toContain("192.168.1.20");
    // the VPN turned on later: its address was covered when the CA was made
    const v = await ensureHouseCerts(dir, want(["127.0.0.1", "192.168.1.21", "100.99.0.7"]));
    expect(v.madeCa).toBe(false);
    expect(v.caSha256).toBe(a.caSha256);
    // a new home-network address (DHCP): the CA does not cover it, a new CA (the guests fetch it again)
    const d = await ensureHouseCerts(dir, want(["127.0.0.1", "192.168.1.30"]));
    expect(d.madeCa).toBe(true);
    expect(d.caSha256).not.toBe(a.caSha256);
    expect(readNameConstraints(Buffer.from(new x509.X509Certificate(d.caPem).getExtension("2.5.29.30")!.value)).ranges).toContain("192.168.1.30/32");
    // a VPN name the CA did not permit: a new CA
    const n = await ensureHouseCerts(dir, { ...want(["127.0.0.1"]), dns: [...want().dns, FAKE_VPN] });
    expect(n.madeCa).toBe(true);
    expect(n.caSha256).not.toBe(d.caSha256);
  });

  it("a leaked CA key cannot sign for any other site: a certificate for another name, a public address or another private address is refused", async () => {
    const dir = tmp();
    dirs.push(dir);
    const c = await ensureHouseCerts(dir, want());
    const caPem = fs.readFileSync(path.join(dir, CA_CRT), "utf8");
    const forge = (names: Array<{ type: "dns" | "ip"; value: string }>) => forgeLeaf(dir, names);
    const tryWith = async (leaf: { cert: string; key: string }, servername: string) => {
      const srv = tls.createServer({ cert: leaf.cert, key: leaf.key }, (s) => s.end("ok"));
      await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
      const port = (srv.address() as net.AddressInfo).port;
      const r = await new Promise<string>((ok) => {
        const s = tls.connect({ host: "127.0.0.1", port, servername, ca: caPem, checkServerIdentity: () => undefined }, () => ok("trusted"));
        s.on("error", (e) => ok(`${(e as NodeJS.ErrnoException).code}: ${e.message}`));
      });
      srv.close();
      return r;
    };
    // the control: a name the CA permits is trusted
    expect(await tryWith(await forge([{ type: "dns", value: "pcx-test" }]), "pcx-test")).toBe("trusted");
    expect(await tryWith(await forge([{ type: "dns", value: "bank.example" }]), "bank.example")).toMatch(/permitted subtree violation/);
    expect(await tryWith(await forge([{ type: "ip", value: "8.8.8.8" }]), "x")).toMatch(/permitted subtree violation/);
    // this PC's own address: trusted; any other private address (a router, a NAS, another PC): refused
    expect(await tryWith(await forge([{ type: "ip", value: "192.168.1.20" }]), "x")).toBe("trusted");
    expect(await tryWith(await forge([{ type: "ip", value: "10.0.0.1" }]), "x")).toMatch(/permitted subtree violation/);
    expect(await tryWith(await forge([{ type: "ip", value: "192.168.1.1" }]), "x")).toMatch(/permitted subtree violation/);
    expect(await tryWith(await forge([{ type: "ip", value: "100.64.0.1" }]), "x")).toMatch(/permitted subtree violation/);
    void c;
  });

  it("websites only: a certificate under the house CA used as a client login is refused (an old CA without EKU would pass)", async () => {
    const tryLogin = async (dir: string) => {
      const caPem = fs.readFileSync(path.join(dir, CA_CRT), "utf8");
      const leaf = await forgeLeaf(dir, [{ type: "dns", value: "pcx-test" }]);
      const own = await ensureHouseCerts(tmpDir(), want());
      const srv = tls.createServer({ cert: own.cert, key: own.key, ca: caPem, requestCert: true, rejectUnauthorized: false });
      const seen = new Promise<string>((ok) =>
        srv.once("secureConnection", (s: tls.TLSSocket) => {
          s.on("error", () => {});
          ok(s.authorized ? "authorized" : String(s.authorizationError));
          s.destroy();
        }),
      );
      await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
      const port = (srv.address() as net.AddressInfo).port;
      const cl = tls.connect({ host: "127.0.0.1", port, cert: leaf.cert, key: leaf.key, rejectUnauthorized: false });
      cl.on("error", () => {});
      const r = await seen;
      cl.destroy();
      srv.close();
      return r;
    };
    const house = tmpDir();
    await ensureHouseCerts(house, want());
    expect(await tryLogin(house)).toMatch(/INVALID_PURPOSE|UNSUPPORTED_CERTIFICATE_PURPOSE|unsupported certificate purpose/i);
    // (the control: the same leaf under a CA without EKU is taken as a client login)
    const old = tmpDir();
    await oldStyleCa(old);
    expect(await tryLogin(old)).toBe("authorized");
  });

  it("the TLS folder per save: data/tls for the real save, data/tls-<name> for any other, SCHELDEMIST_TLS_DIR by hand", () => {
    const keep = process.env.SCHELDEMIST_TLS_DIR;
    delete process.env.SCHELDEMIST_TLS_DIR;
    try {
      const data = path.resolve("/x/data");
      expect(tlsDirFor(path.join(data, "game.sqlite"))).toBe(path.join(data, "tls"));
      expect(tlsDirFor(path.join(data, "test-check.sqlite"))).toBe(path.join(data, "tls-test-check"));
      expect(tlsDirFor(path.join(data, "Other Save.sqlite"))).toBe(path.join(data, "tls-Other_Save"));
      process.env.SCHELDEMIST_TLS_DIR = path.resolve("/y/tls");
      expect(tlsDirFor(path.join(data, "game.sqlite"))).toBe(path.resolve("/y/tls"));
    } finally {
      if (keep === undefined) delete process.env.SCHELDEMIST_TLS_DIR;
      else process.env.SCHELDEMIST_TLS_DIR = keep;
    }
  });

  it("the private ranges, the VPN range, a DNS name", () => {
    expect(["10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.10", "100.64.0.1", "100.127.255.254", "127.0.0.1"].every(privateIp)).toBe(true);
    expect(["8.8.8.8", "172.32.0.1", "100.128.0.1", "100.63.255.255", "1.1.1.1"].some(privateIp)).toBe(false);
    expect(vpnIp("100.100.1.2")).toBe(true);
    expect(vpnIp("192.168.1.2")).toBe(false);
  });
});

describe("the VPN setting and the https Host check", () => {
  it("netbird's answer: the fqdn from --json or from the plain status; junk is nothing", () => {
    expect(parseNetbird(JSON.stringify({ fqdn: `${FAKE_VPN}.`, netbirdIp: "100.90.1.2/16" }))).toBe(FAKE_VPN);
    expect(parseNetbird(`Daemon version: 0.30\nFQDN: ${FAKE_VPN}\nNetBird IP: 100.90.1.2/16\n`)).toBe(FAKE_VPN);
    expect(parseNetbird("Daemon status: NeedsLogin")).toBeNull();
    expect(parseNetbird(JSON.stringify({ fqdn: "evil name; rm -rf /" }))).toBeNull();
    expect(parseNetbird(JSON.stringify({ fqdn: "" }))).toBeNull();
  });

  it("the vpn setting is off by default and turns playing together on", () => {
    resetMpSettings();
    expect(mpSettings().vpn).toBe(false);
    setMp({ vpn: true });
    expect(mpSettings()).toMatchObject({ vpn: true, multiplayer: true });
    setMp({ vpn: false, multiplayer: false });
    expect(mpSettings()).toMatchObject({ vpn: false, multiplayer: false });
    resetMpSettings();
  });

  it("the https port takes only the names its certificate carries; the VPN's name never on the http port", () => {
    TLS_NAMES.clear();
    expect(allowedHost(`localhost:${TLS_PORT}`)).toBe(false); // (closed: nothing)
    for (const n of ["localhost", "127.0.0.1", "pcx-test", FAKE_VPN, "100.90.1.2"]) TLS_NAMES.add(n);
    expect(allowedHost(`${FAKE_VPN}:${TLS_PORT}`)).toBe(true);
    expect(allowedHost(`100.90.1.2:${TLS_PORT}`)).toBe(true);
    expect(allowedHost(`evil.example:${TLS_PORT}`)).toBe(false);
    expect(allowedHost(`${FAKE_VPN}.evil.example:${TLS_PORT}`)).toBe(false);
    expect(allowedHost(`${FAKE_VPN}:${PORT}`)).toBe(false);
    expect(allowedOrigin(`https://${FAKE_VPN}:${TLS_PORT}`)).toBe(true);
    expect(allowedOrigin(`http://${FAKE_VPN}:${TLS_PORT}`)).toBe(false);
    expect(allowedOrigin(`https://evil.example:${TLS_PORT}`)).toBe(false);
    expect(allowedOrigin(`https://localhost:${PORT}`)).toBe(false);
    TLS_NAMES.clear();
  });

  it("this PC's own bound addresses are this PC (the host on his secure name); anything else, or forwarded for another, is not", () => {
    OWN_ADDRS.clear();
    expect(loopback("127.0.0.1", undefined)).toBe(true);
    expect(loopback("192.168.1.20", undefined)).toBe(false);
    OWN_ADDRS.add("192.168.1.20");
    OWN_ADDRS.add("100.90.1.2");
    expect(loopback("192.168.1.20", undefined)).toBe(true);
    expect(loopback("::ffff:192.168.1.20", undefined)).toBe(true);
    expect(loopback("100.90.1.2", undefined)).toBe(true);
    expect(loopback("192.168.1.21", undefined)).toBe(false);
    expect(loopback("10.0.0.1", undefined)).toBe(false);
    expect(loopback("192.168.1.20", "192.168.1.55")).toBe(false);
    expect(loopback("127.0.0.1", "for=192.168.1.20")).toBe(true);
    OWN_ADDRS.clear();
    expect(loopback("192.168.1.20", undefined)).toBe(false);
  });

  it("netbird is run by an absolute path only (or not at all)", () => {
    const p = netbirdPath();
    expect(p === null || (path.isAbsolute(p) && /netbird(\.exe)?$/i.test(p))).toBe(true);
  });
});

// ------------------------------------------------------------------ this PC's addresses change

describe("the address watch: a new address moves the listeners and the certificate", () => {
  it("opens the new address (http and https), closes the gone one, remakes the certificate (the CA for a new address only), and stops when closed", async () => {
    const dir = tmpDir();
    const keep = { lan: process.env.SCHELDEMIST_TEST_LAN_ADDRS, vpn: process.env.SCHELDEMIST_TEST_VPN_ADDRS, tls: process.env.SCHELDEMIST_TLS_DIR };
    process.env.SCHELDEMIST_TLS_DIR = dir;
    process.env.SCHELDEMIST_TEST_VPN_ADDRS = "127.0.0.9"; // (a stand-in for the VPN's address: covered by the CA, the VPN stays off)
    process.env.SCHELDEMIST_TEST_LAN_ADDRS = "127.0.0.4,127.0.0.6";
    const port = await freePair();
    const sport = port + 1;
    const fetch = () => new Response("ok");
    const upgrade = (_r: unknown, s: { destroy(): void }) => s.destroy();
    const on = { lan: true, vpn: false };
    let applied = 0;
    const apply = async () => {
      await openLan(fetch, upgrade, port);
      await applySecure(fetch, upgrade, on, sport);
      setAddressWatch(on, apply, 100);
      applied++;
    };
    const ca = () => fs.readFileSync(path.join(dir, CA_CRT), "utf8");
    const san = () => new X509Certificate(fs.readFileSync(path.join(dir, SERVER_CRT), "utf8")).subjectAltName ?? "";
    const until = async (ok: () => boolean, what: string) => {
      for (let i = 0; i < 100 && !ok(); i++) await new Promise((r) => setTimeout(r, 50));
      expect(ok(), what).toBe(true);
    };
    const get = (secure: boolean, host: string) => req({ secure, host, port: secure ? sport : port, path: "/", ca: secure ? ca() : undefined }).then((g) => g.status);
    try {
      await apply();
      expect(addressWatchOn()).toBe(true);
      expect(lanOpen().sort()).toEqual(["127.0.0.4", "127.0.0.6"]);
      expect(secureOpen().sort()).toEqual(["127.0.0.1", "127.0.0.4", "127.0.0.6"]);
      expect([...OWN_ADDRS].sort()).toEqual(["127.0.0.4", "127.0.0.6"]);
      const ca1 = new X509Certificate(ca()).fingerprint256;
      expect(await get(true, "127.0.0.4")).toBe(200);
      // nothing changed: nothing is applied again
      const n = applied;
      await new Promise((r) => setTimeout(r, 400));
      expect(applied).toBe(n);

      // an address goes away: closed there, a new server certificate, the same CA
      process.env.SCHELDEMIST_TEST_LAN_ADDRS = "127.0.0.6";
      await until(() => lanOpen().length === 1 && !secureOpen().includes("127.0.0.4"), "127.0.0.4 closed");
      await until(() => !san().includes("127.0.0.4"), "a new server certificate without 127.0.0.4");
      expect(lanOpen()).toEqual(["127.0.0.6"]);
      expect(secureOpen().sort()).toEqual(["127.0.0.1", "127.0.0.6"]);
      expect([...OWN_ADDRS]).toEqual(["127.0.0.6"]);
      expect(new X509Certificate(ca()).fingerprint256).toBe(ca1);
      await expect(get(false, "127.0.0.4")).rejects.toThrow();
      expect(await get(true, "127.0.0.6")).toBe(200);

      // a new address: opened on http and https, in the server certificate, and a new CA (it did not cover it)
      process.env.SCHELDEMIST_TEST_LAN_ADDRS = "127.0.0.6,127.0.0.7";
      await until(() => secureOpen().includes("127.0.0.7") && lanOpen().includes("127.0.0.7"), "127.0.0.7 opened");
      expect(san()).toContain("IP Address:127.0.0.7");
      expect(new X509Certificate(ca()).fingerprint256).not.toBe(ca1);
      expect(await get(true, "127.0.0.7")).toBe(200);
      expect(await get(true, "127.0.0.6")).toBe(200); // (the old listener serves the new certificate)
      expect(await get(false, "127.0.0.7")).toBe(200);

      // both closed: the watch stops, nothing is this PC but loopback
      on.lan = false;
      await closeLan();
      await applySecure(fetch, upgrade, on, sport);
      setAddressWatch(null);
      expect(addressWatchOn()).toBe(false);
      expect(secureOpen()).toEqual([]);
      expect(OWN_ADDRS.size).toBe(0);
    } finally {
      setAddressWatch(null);
      await closeLan();
      await closeSecure();
      for (const [k, v] of [
        ["SCHELDEMIST_TEST_LAN_ADDRS", keep.lan],
        ["SCHELDEMIST_TEST_VPN_ADDRS", keep.vpn],
        ["SCHELDEMIST_TLS_DIR", keep.tls],
      ] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  }, 60_000);
});

// ------------------------------------------------------------------ a real server: https, wss, the certificate

async function freePair(): Promise<number> {
  for (let i = 0; i < 20; i++) {
    const s = net.createServer();
    await new Promise<void>((ok) => s.listen(0, "127.0.0.1", ok));
    const p = (s.address() as net.AddressInfo).port;
    await new Promise<void>((ok) => s.close(() => ok()));
    if (p > 65000) continue;
    const t = net.createServer();
    const free = await new Promise<boolean>((ok) => {
      t.once("error", () => ok(false));
      t.listen(p + 1, "127.0.0.1", () => ok(true));
    });
    if (free) {
      await new Promise<void>((ok) => t.close(() => ok()));
      return p;
    }
  }
  throw new Error("no two free ports");
}

interface Got {
  status: number;
  type: string;
  body: string;
}

function req(opts: { secure: boolean; host: string; port: number; path: string; hostHeader?: string; ca?: string; servername?: string; anyName?: boolean; method?: string; body?: unknown; headers?: Record<string, string>; localAddress?: string }): Promise<Got> {
  return new Promise((ok, bad) => {
    const lib = opts.secure ? https : http;
    const data = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    const r = lib.request(
      {
        host: opts.host,
        port: opts.port,
        path: opts.path,
        method: opts.method ?? "GET",
        agent: false,
        localAddress: opts.localAddress,
        ca: opts.ca,
        servername: opts.servername,
        // (a foreign Host header: the chain is still checked, not the name, so the server's answer is seen)
        ...(opts.anyName ? { checkServerIdentity: () => undefined } : {}),
        headers: { host: opts.hostHeader ?? `${opts.host}:${opts.port}`, ...(data ? { "content-type": "application/json" } : {}), ...opts.headers },
        timeout: 8000,
      } as https.RequestOptions,
      (res) => {
        let b = "";
        res.setEncoding("utf8");
        res.on("data", (d) => (b += d));
        res.on("end", () => ok({ status: res.statusCode ?? 0, type: String(res.headers["content-type"] ?? ""), body: b }));
      },
    );
    r.on("timeout", () => r.destroy(new Error("timeout")));
    r.on("error", bad);
    if (data) r.write(data);
    r.end();
  });
}

describe("M8e on a real server: https and wss with the house certificate", () => {
  it("serves the game's api and both sockets over https, the certificate to guests, refuses a foreign name, and keeps the VPN https-only and host-only", async () => {
    const dir = tmp();
    dirs.push(dir);
    const port = await freePair();
    const sport = port + 1;
    const cfg = path.join(dir, "mp.json");
    fs.writeFileSync(cfg, JSON.stringify({ version: 1, multiplayer: true, lan: true, vpn: true, code: "KADE-47" }));
    const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    let log = "";
    const child = spawn(process.execPath, ["src/index.ts"], {
      cwd: serverDir,
      env: {
        ...process.env,
        VITEST: "true",
        SCHELDEMIST_DB: path.join(dir, "mp.sqlite"),
        SCHELDEMIST_PORT: String(port),
        SCHELDEMIST_MP_CONFIG: cfg,
        SCHELDEMIST_AI_CONFIG: path.join(dir, "ai.json"),
        SCHELDEMIST_SAVES: path.join(dir, "saves"),
        SCHELDEMIST_TLS_DIR: path.join(dir, "tls"),
        // (the house's and the VPN's addresses: loopback stand-ins; a fake VPN name)
        SCHELDEMIST_TEST_LAN_ADDRS: "127.0.0.2",
        SCHELDEMIST_TEST_VPN_ADDRS: "127.0.0.3",
        SCHELDEMIST_VPN_FQDN: FAKE_VPN,
        NODE_ENV: "development",
        SCHELDEMIST_LAN: "",
        SCHELDEMIST_MP: "",
        SCHELDEMIST_VPN: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    kids.push(child);
    child.stdout?.on("data", (d) => (log += d));
    child.stderr?.on("data", (d) => (log += d));
    try {
      // wait for the https port (the certificate is made at start)
      let ca = "";
      for (let i = 0; i < 300 && !ca; i++) {
        await new Promise((r) => setTimeout(r, 200));
        try {
          const g = await req({ secure: false, host: "127.0.0.1", port, path: "/house-ca.crt" });
          if (g.status === 200) {
            const ok = await req({ secure: true, host: "127.0.0.1", port: sport, path: "/api/mp/info", ca: g.body }).catch(() => null);
            if (ok?.status === 200) ca = g.body;
          }
        } catch {
          /* not up yet */
        }
      }
      expect(ca, log).toMatch(/^-----BEGIN CERTIFICATE-----/);
      const caFile = new X509Certificate(fs.readFileSync(path.join(dir, "tls", CA_CRT), "utf8"));
      expect(new X509Certificate(ca).fingerprint256).toBe(caFile.fingerprint256);

      // the house certificate: the public certificate only, on the house's http port and on https
      const lanCa = await req({ secure: false, host: "127.0.0.2", port, path: "/house-ca.crt" });
      expect(lanCa.status).toBe(200);
      expect(lanCa.type).toBe("application/x-x509-ca-cert");
      expect(lanCa.body).toBe(ca);
      const sCa = await req({ secure: true, host: "127.0.0.2", port: sport, path: "/house-ca.crt", ca });
      expect(sCa.body).toBe(ca);

      // https with the house certificate trusted: the api; the join page's facts name the secure address
      const info = JSON.parse((await req({ secure: false, host: "127.0.0.2", port, path: "/api/mp/info" })).body) as { house: { https: string; ca: string; sha256: string; sha1: string } };
      expect(info.house.https).toBe(`https://127.0.0.2:${sport}`);
      expect(info.house.ca).toBe("/house-ca.crt");
      expect(info.house.sha256).toBe(caFile.fingerprint256);
      expect(info.house.sha1).toBe(caFile.fingerprint);
      const sInfo = await req({ secure: true, host: "127.0.0.1", port: sport, path: "/api/mp/info", ca });
      expect(sInfo.status).toBe(200);
      expect(JSON.parse(sInfo.body).you).toMatchObject({ host: true });
      // the host's own browser on his home-network address (his secure name) is the host; another address is not
      const own = await req({ secure: true, host: "127.0.0.2", port: sport, path: "/api/mp/host", ca, localAddress: "127.0.0.2" });
      expect(own.status, own.body).toBe(200);
      expect((await req({ secure: true, host: "127.0.0.2", port: sport, path: "/api/mp/host", ca, localAddress: "127.0.0.5" })).status).toBe(401);
      expect((await req({ secure: false, host: "127.0.0.2", port, path: "/api/mp/host", localAddress: "127.0.0.2" })).status).toBe(200);
      expect((await req({ secure: true, host: "127.0.0.2", port: sport, path: "/api/mp/host", ca, localAddress: "127.0.0.2", headers: { "x-forwarded-for": "127.0.0.5" } })).status).toBe(401);
      // the VPN's name, on the VPN's address, https
      const vpn = await req({ secure: true, host: "127.0.0.3", port: sport, path: "/api/mp/info", ca, servername: FAKE_VPN, hostHeader: `${FAKE_VPN}:${sport}` });
      expect(vpn.status).toBe(200);
      // not trusted: the browser's own store does not know the house
      await expect(req({ secure: true, host: "127.0.0.1", port: sport, path: "/api/mp/info" })).rejects.toThrow();
      // a foreign name on https: refused (api, the page, the certificate)
      expect((await req({ secure: true, host: "127.0.0.1", port: sport, path: "/api/mp/info", ca, anyName: true, hostHeader: `evil.example:${sport}` })).status).toBe(403);
      expect((await req({ secure: true, host: "127.0.0.1", port: sport, path: "/house-ca.crt", ca, anyName: true, hostHeader: `evil.example:${sport}` })).status).toBe(404);
      expect((await req({ secure: true, host: "127.0.0.1", port: sport, path: "/api/mp/info", ca, headers: { origin: "https://evil.example" } })).status).toBe(403);
      // the VPN gets https only: no plain http on its address
      await expect(req({ secure: false, host: "127.0.0.3", port, path: "/api/mp/info" })).rejects.toThrow();

      // wss: the movement socket and the push channel on the https port
      const origin = `https://127.0.0.1:${sport}`;
      const mp = new WebSocket(`wss://127.0.0.1:${sport}/mp`, { ca, headers: { origin } });
      const texts: Array<Record<string, unknown>> = [];
      mp.on("message", (d, bin) => {
        if (!bin) texts.push(JSON.parse(String(d)));
      });
      await new Promise<void>((ok, bad) => (mp.once("open", () => ok()), mp.once("error", bad)));
      mp.send(JSON.stringify({ type: "hello", protocol: MP_PROTOCOL }));
      for (let i = 0; i < 60 && !texts.some((t) => t.type === "welcome"); i++) await new Promise((r) => setTimeout(r, 50));
      expect(texts.find((t) => t.type === "welcome")).toMatchObject({ id: 1, host: true });
      mp.close();
      const push = new WebSocket(`wss://127.0.0.1:${sport}/ws?client=tls-test`, { ca, headers: { origin } });
      const pushed: unknown[] = [];
      push.on("message", (d) => pushed.push(JSON.parse(String(d))));
      await new Promise<void>((ok, bad) => (push.once("open", () => ok()), push.once("error", bad)));
      for (let i = 0; i < 60 && !pushed.length; i++) await new Promise((r) => setTimeout(r, 50));
      expect(pushed.length).toBeGreaterThan(0);
      push.close();
      // a wss from a foreign page: refused
      const evil = new WebSocket(`wss://127.0.0.1:${sport}/mp`, { ca, headers: { origin: "https://evil.example" } });
      expect(await new Promise<string>((ok) => (evil.once("open", () => ok("open")), evil.once("error", () => ok("refused"))))).toBe("refused");

      // the host's view: the secure addresses, the VPN, the fingerprints and the SPKI hash; never a key
      const host = await req({ secure: true, host: "127.0.0.1", port: sport, path: "/api/mp/host", ca });
      const h = JSON.parse(host.body) as { vpn: boolean; secure: { house: string[]; vpn: string[] }; secureOpen: string[]; tls: { sha256: string; spki: string } };
      expect(h.vpn).toBe(true);
      expect(h.secure.house).toContain(`https://127.0.0.2:${sport}`);
      expect(h.secure.vpn).toEqual([`https://${FAKE_VPN}:${sport}`, `https://127.0.0.3:${sport}`]);
      expect(h.secureOpen.sort()).toEqual(["127.0.0.1", "127.0.0.2", "127.0.0.3"]);
      expect(h.tls.sha256).toBe(caFile.fingerprint256);
      expect(h.tls.spki).toBe(spkiHash(fs.readFileSync(path.join(dir, "tls", "server.key"), "utf8")));
      for (const g of [host, lanCa, sCa, sInfo, vpn]) expect(g.body).not.toMatch(/PRIVATE KEY/);

      // "Open to my VPN" is the host's: a guest can neither see nor change it
      const join = JSON.parse((await req({ secure: true, host: "127.0.0.2", port: sport, path: "/api/mp/join", ca, method: "POST", body: { code: "KADE-47", name: "Anna" } })).body) as { token: string };
      const guest = { "x-scheldemist-player": join.token };
      expect((await req({ secure: true, host: "127.0.0.2", port: sport, path: "/api/mp/host", ca, headers: guest })).status).toBe(403);
      expect((await req({ secure: true, host: "127.0.0.2", port: sport, path: "/api/mp/config", ca, method: "POST", body: { vpn: false }, headers: guest })).status).toBe(403);
      expect(JSON.parse((await req({ secure: true, host: "127.0.0.1", port: sport, path: "/api/mp/host", ca })).body).vpn).toBe(true);

      // the host turns the VPN off: its address closes, the certificate is made again without its name, the CA stays
      const off = JSON.parse((await req({ secure: false, host: "127.0.0.1", port, path: "/api/mp/config", method: "POST", body: { vpn: false } })).body) as { vpn: boolean; secureOpen: string[]; tls: { sha256: string } };
      expect(off.vpn).toBe(false);
      expect(off.secureOpen.sort()).toEqual(["127.0.0.1", "127.0.0.2"]);
      expect(off.tls.sha256).toBe(caFile.fingerprint256);
      await expect(req({ secure: true, host: "127.0.0.3", port: sport, path: "/api/mp/info", ca, servername: FAKE_VPN, hostHeader: `${FAKE_VPN}:${sport}` })).rejects.toThrow();
      const again = new X509Certificate(fs.readFileSync(path.join(dir, "tls", SERVER_CRT), "utf8"));
      expect(again.subjectAltName).not.toContain(FAKE_VPN);
      expect(again.subjectAltName).not.toContain("127.0.0.3");
    } finally {
      child.kill();
      await new Promise((r) => child.once("exit", r));
    }
  }, 90_000);
});
