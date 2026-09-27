// M8e part B: the movement socket's line (net/mp/link.ts) and the file store's download plan (boot/files.ts).
// Run: node --test client/test/link.test.mjs
import './tsHooks.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

const { retryDelay, Liveness, noteText, DEAD_MS, LONG_MS, RETRY_MAX_MS } = await import('../src/net/mp/link.ts');
const { plan, planWords, planProgress, readAll, WHOLE_KEY } = await import('../src/boot/files.ts');

test('a lost line is tried again after 1, 2, 4, 8, then every 15 s (a tenth either way)', () => {
  const mid = () => 0.5;
  assert.deepEqual([0, 1, 2, 3, 4, 5, 20].map((a) => retryDelay(a, mid)), [1000, 2000, 4000, 8000, 15000, 15000, 15000]);
  assert.equal(retryDelay(0, () => 0), 900);
  assert.equal(retryDelay(9, () => 0.999), Math.round(RETRY_MAX_MS * (0.9 + 0.2 * 0.999)));
});

test('a line is dead only when a ping stays unanswered, however seldom a hidden tab pings', () => {
  const l = new Liveness();
  assert.equal(l.dead(0), false);
  l.pinged(0);
  l.pinged(1000); // (the first unanswered one counts)
  assert.equal(l.dead(DEAD_MS), false);
  assert.equal(l.dead(DEAD_MS + 1), true);
  l.heard();
  assert.equal(l.dead(60_000), false);
  // a hidden tab: its timer runs once a minute, the answer comes in 100 ms: never dead
  const h = new Liveness();
  for (let t = 0; t < 600_000; t += 60_000) {
    assert.equal(h.dead(t), false);
    h.pinged(t);
    h.heard(); // (the pong, 100 ms later)
  }
});

test('the note: a small line, plain after 2 minutes, gone when the line is up', () => {
  assert.equal(noteText(null, true), null);
  assert.equal(noteText(0, true), 'Connection lost, trying again...');
  assert.match(noteText(5000, false), /does not answer yet/);
  assert.match(noteText(LONG_MS, true), /2 minutes/);
});

const F = (n, size) => ({ path: `models/${n}.glb`, size, sha256: n.padEnd(64, '0') });
const files = [F('a', 10e6), F('b', 20e6), F('c', 36e6)];

test('a first visit downloads everything; a reload goes on with what is missing, and shows the bytes', () => {
  const first = plan(files, new Set(), 'v1', null);
  assert.equal(first.kind, 'first');
  assert.equal(first.missing.length, 3);
  assert.equal(first.total, 66e6);
  assert.match(planWords(first, 33e6, 'v1').step, /^Downloading 31 of 63 MB$/);
  // the line dropped after two files; the page reloaded
  const again = plan(files, new Set([files[0].sha256, files[1].sha256]), 'v1', null);
  assert.equal(again.kind, 'resume');
  assert.deepEqual(again.missing.map((f) => f.path), ['models/c.glb']);
  assert.equal(again.kept, 30e6);
  const w = planWords(again, 0, 'v1');
  assert.match(w.step, /^Downloading 29 of 63 MB$/);
  assert.match(w.now, /kept/);
  assert.ok(Math.abs(planProgress(again, 0) - 30 / 66) < 1e-9);
  assert.equal(planProgress(again, 36e6), 1);
  // all there: nothing to do
  assert.equal(plan(files, new Set(files.map((f) => f.sha256)), 'v1', 'v1').kind, 'none');
  assert.equal(WHOLE_KEY, 'scheldemist.files.whole');
});

test('a new version is told as one, and the old files are named for removal', () => {
  const v2 = [files[0], files[1], F('d', 1e5)];
  const p = plan(v2, new Set(files.map((f) => f.sha256)), 'v2', 'v1');
  assert.equal(p.kind, 'new');
  assert.deepEqual(p.stale, [files[2].sha256]);
  assert.match(planWords(p, 0, 'v2').step, /^New version: downloading 0\.0 of 0\.1 MB$/);
  // a store from before M8e (no mark) with an old file in it: a new version too
  assert.equal(plan(v2, new Set(files.map((f) => f.sha256)), 'v2', null).kind, 'new');
});

function stream(chunks, stallAfter = Infinity) {
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i >= stallAfter) return new Promise(() => {}); // (the line stops: nothing more, no end)
      if (i < chunks.length) c.enqueue(new Uint8Array(chunks[i++]));
      else c.close();
    },
  });
}

test('a file is read whole with its bytes counted; a stalled one is given up (not after a fixed time)', async () => {
  let n = 0;
  const buf = await readAll(stream([3, 4, 5]), (k) => (n += k), 200);
  assert.equal(buf.length, 12);
  assert.equal(n, 12);
  let aborted = false;
  n = 0;
  const t0 = Date.now();
  await assert.rejects(readAll(stream([3, 4, 5], 2), (k) => (n += k), 150, () => (aborted = true)), /stalled/);
  assert.ok(Date.now() - t0 >= 140);
  assert.equal(n, 7);
  assert.equal(aborted, true);
});
