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
import { allowedHost, allowedOrigin, PORT, TLS_NAMES, TLS_PORT } from "../src/config.ts";
import { parseNetbird } from "../src/mp/lan.ts";
import { mpSettings, resetMpSettings, setMp } from "../src/mp/settings.ts";
import { CA_CRT, CA_KEY, ensureHouseCerts, hostName, nameConstraintsDer, PRIVATE_RANGES, privateIp, readNameConstraints, SERVER_CRT, spkiHash, vpnIp } from "../src/mp/tls.ts";
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

  it("the CA: EC P-256, 10 years, CA:true, keyCertSign + cRLSign, critical name constraints with this PC's names and the private ranges", async () => {
    const dir = tmp();
    dirs.push(dir);
    const c = await ensureHouseCerts(dir, want(), async () => [FAKE_VPN]);
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
    expect(r.ranges).toEqual(["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10", "127.0.0.0/8"]);
    // (what the encoder writes, the reader reads)
    expect(readNameConstraints(nameConstraintsDer(["a.b"], PRIVATE_RANGES)).ranges).toHaveLength(5);
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

  it("an address changes: a new server certificate, the same CA; the CA is made again only for a name it does not cover", async () => {
    const dir = tmp();
    dirs.push(dir);
    const a = await ensureHouseCerts(dir, want(["127.0.0.1", "192.168.1.20"]));
    const b = await ensureHouseCerts(dir, want(["127.0.0.1", "192.168.1.21"]));
    expect(b.madeCa).toBe(false);
    expect(b.madeServer).toBe(true);
    expect(b.caSha256).toBe(a.caSha256);
    expect(new X509Certificate(b.cert).subjectAltName).toContain("IP Address:192.168.1.21");
    expect(new X509Certificate(fs.readFileSync(path.join(dir, SERVER_CRT), "utf8")).subjectAltName).not.toContain("192.168.1.20");
    // a VPN address in the CGNAT range is covered by the CA already
    const v = await ensureHouseCerts(dir, want(["127.0.0.1", "192.168.1.21", "100.99.0.7"]));
    expect(v.madeCa).toBe(false);
    // a VPN name the CA did not permit: a new CA (the guests fetch it again)
    const n = await ensureHouseCerts(dir, { ...want(["127.0.0.1"]), dns: [...want().dns, FAKE_VPN] });
    expect(n.madeCa).toBe(true);
    expect(n.caSha256).not.toBe(a.caSha256);
  });

  it("a leaked CA key cannot sign for the internet: a certificate for another name or a public address is refused", async () => {
    const dir = tmp();
    dirs.push(dir);
    const c = await ensureHouseCerts(dir, want());
    const caPem = fs.readFileSync(path.join(dir, CA_CRT), "utf8");
    const caKey = await webcrypto.subtle.importKey("pkcs8", createPrivateKey(fs.readFileSync(path.join(dir, CA_KEY), "utf8")).export({ type: "pkcs8", format: "der" }), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    const forge = async (names: Array<{ type: "dns" | "ip"; value: string }>) => {
      const keys = (await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as webcrypto.CryptoKeyPair;
      const cert = await x509.X509CertificateGenerator.create({
        subject: [{ CN: ["bank.example"] }],
        issuer: new x509.X509Certificate(caPem).subject,
        notBefore: new Date(Date.now() - 60_000),
        notAfter: new Date(Date.now() + 86_400_000),
        publicKey: keys.publicKey as never,
        signingKey: caKey as never,
        signingAlgorithm: { name: "ECDSA", hash: "SHA-256" },
        extensions: [new x509.SubjectAlternativeNameExtension(names)],
      });
      const der = Buffer.from(await webcrypto.subtle.exportKey("pkcs8", keys.privateKey));
      return { cert: cert.toString("pem"), key: `-----BEGIN PRIVATE KEY-----\n${der.toString("base64")}\n-----END PRIVATE KEY-----\n` };
    };
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
    void c;
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

function req(opts: { secure: boolean; host: string; port: number; path: string; hostHeader?: string; ca?: string; servername?: string; anyName?: boolean; method?: string; body?: unknown; headers?: Record<string, string> }): Promise<Got> {
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
