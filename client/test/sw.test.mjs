// M8e part B: the Service Worker (public/sw.js) run in node against a stand-in CacheStorage and network: what it
// keeps (the app shell only, never the loader's files, the game's calls, its sockets or the house certificate),
// network first for the page, cache first for Vite's hashed code, one cache per version, older ones removed.
// Run: node --test client/test/sw.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const ORIGIN = 'https://pcx.test:8787';

class FakeCache {
  map = new Map();
  async put(k, r) { this.map.set(typeof k === 'string' ? k : new URL(k.url).pathname, r); }
  async match(k) { return this.map.get(typeof k === 'string' ? k : new URL(k.url).pathname); }
}
class FakeCaches {
  all = new Map();
  async open(n) { if (!this.all.has(n)) this.all.set(n, new FakeCache()); return this.all.get(n); }
  async keys() { return [...this.all.keys()]; }
  async delete(n) { return this.all.delete(n); }
  async match(k) { for (const c of this.all.values()) { const r = await c.match(k); if (r) return r; } }
}

const basic = (body, status = 200) => {
  const r = new Response(body, { status });
  Object.defineProperty(r, 'type', { value: 'basic' });
  return r;
};

function load(version, net) {
  const on = {};
  const calls = [];
  const self = {
    location: { href: `${ORIGIN}/sw.js?v=${encodeURIComponent(version)}`, origin: ORIGIN },
    addEventListener: (t, f) => (on[t] = f),
    skipWaiting: () => (self.skipped = true),
    clients: { claim: async () => (self.claimed = true) },
  };
  const caches = new FakeCaches();
  const fetch = async (req) => {
    const url = typeof req === 'string' ? req : req.url;
    const p = new URL(url, ORIGIN).pathname;
    calls.push(p);
    return net(p);
  };
  vm.runInNewContext(SRC, { self, caches, fetch, URL, AbortController, setTimeout, clearTimeout, Response, console });
  const fire = async (type, request) => {
    let responded = null;
    const waits = [];
    on[type]({ request, respondWith: (p) => (responded = p), waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
    return responded;
  };
  return { self, caches, calls, fire };
}

const man = (version) => ({
  version,
  files: ['index.html', 'sw.js', 'assets/main-abc.js', 'assets/main-abc.css', 'boot/loading.jpg', 'models/city.glb', 'textures/brick.jpg'].map((path) => ({ path, size: 1, sha256: 'f'.repeat(64) })),
});
const req = (path, o = {}) => ({ url: ORIGIN + path, method: 'GET', mode: 'cors', ...o });

test('install keeps the shell of its version only: the page, the manifest, assets/ and boot/, never the loader\'s files', async () => {
  const w = load('0.1.0+abc', (p) => (p === '/manifest.json' ? basic(JSON.stringify(man('0.1.0+abc'))) : basic('x')));
  await w.fire('install');
  assert.equal(w.self.skipped, true);
  const c = w.caches.all.get('scheldemist-shell-0.1.0+abc');
  assert.deepEqual([...c.map.keys()].sort(), ['/assets/main-abc.css', '/assets/main-abc.js', '/boot/loading.jpg', '/index.html', '/manifest.json']);
  assert.ok(!w.calls.includes('/models/city.glb') && !w.calls.includes('/sw.js'));
});

test('never the game\'s calls, sockets, the house certificate, /a/<sha256> or the files IndexedDB keeps; nor a POST or another origin', async () => {
  const w = load('v', () => basic('x'));
  for (const p of ['/api/state', '/api/mp/info', '/ws', '/mp', '/house-ca.crt', '/a/' + 'e'.repeat(64), '/models/city.glb', '/textures/brick.jpg', '/sw.js'])
    assert.equal(await w.fire('fetch', req(p)), null, p);
  assert.equal(await w.fire('fetch', req('/assets/main-abc.js', { method: 'POST' })), null);
  assert.equal(await w.fire('fetch', { url: 'https://cdn.example/x.js', method: 'GET', mode: 'cors' }), null);
});

test('the page: the network first (a new build reaches the player), the cache when the line is down, never over an error answer', async () => {
  let mode = 'up';
  const w = load('v', (p) => {
    if (mode === 'down') throw new TypeError('Failed to fetch');
    if (mode === 'building') return basic('being built', 503);
    return basic(`page ${p}`);
  });
  const nav = req('/?seat=2', { mode: 'navigate' });
  assert.equal(await (await w.fire('fetch', nav)).text(), 'page /');
  mode = 'down';
  assert.equal(await (await w.fire('fetch', nav)).text(), 'page /', 'the kept page');
  mode = 'building';
  assert.equal((await w.fire('fetch', nav)).status, 503, "the host's being-built page goes through");
  // the manifest too
  mode = 'up';
  await (await w.fire('fetch', req('/manifest.json'))).text();
  mode = 'down';
  assert.equal(await (await w.fire('fetch', req('/manifest.json'))).text(), 'page /manifest.json');
});

test('hashed code from the cache first (any kept version), fetched and kept when missing', async () => {
  const w = load('v2', () => basic('code'));
  const old = await w.caches.open('scheldemist-shell-v1');
  await old.put('/assets/old-111.js', basic('old code'));
  const n = w.calls.length;
  assert.equal(await (await w.fire('fetch', req('/assets/old-111.js'))).text(), 'old code');
  assert.equal(w.calls.length, n, 'no network for a kept hashed file');
  assert.equal(await (await w.fire('fetch', req('/assets/new-222.js'))).text(), 'code');
  assert.ok(w.caches.all.get('scheldemist-shell-v2').map.has('/assets/new-222.js'));
});

test('a new version takes over at once: its cache and the one before stay, older ones and nothing else go', async () => {
  const w = load('v3', () => basic('x'));
  for (const n of ['scheldemist-shell-v1', 'other-app', 'scheldemist-shell-v2', 'scheldemist-shell-v3']) await w.caches.open(n);
  await w.fire('activate');
  assert.deepEqual(await w.caches.keys(), ['other-app', 'scheldemist-shell-v2', 'scheldemist-shell-v3']);
  assert.equal(w.self.claimed, true);
});
