// M8e part B: the jitter buffers on a VPN line (60-120 ms round trips, 30 ms jitter on each leg), simulated with the
// game's own code: the other players (net/mp/remotes.ts, 20 states a second), the townspeople (net/mp/street.ts,
// 10 batches a second) and a job's figures (net/mp/jobfigs.ts, 10 a second). Drawn at 60 frames a second.
// Run: node --test client/test/vpnLine.test.mjs
import './tsHooks.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

const { RemoteTrack, DELAY_MAX } = await import('../src/net/mp/remotes.ts');
const { PuppetTrack, puppetDelayWanted, PUPPET_DELAY_MIN, PUPPET_DELAY_MAX } = await import('../src/net/mp/street.ts');
const { sampleFig, figDelayWanted, FIG_DELAY_MS, FIG_DELAY_MAX } = await import('../src/net/mp/jobfigs.ts');
const { FLAG } = await import('../../shared/mpProtocol.ts');

function rng(seed) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/**
 * A line: states sent every `every` ms from `secs` seconds; each goes sender -> server (`up` ms one way) and
 * server -> receiver (`down` ms), each leg plus 0..`jit` ms; TCP keeps the order. The receiver's clock is off by
 * up to a quarter of the jitter (the offset from the best of 8 pings).
 */
function line({ up, down, jit, every, secs = 60, seed = 7 }) {
  const r = rng(seed);
  const off = (r() - 0.5) * (jit / 2);
  const out = [];
  let last = 0;
  for (let t = 0; t < secs * 1000; t += every) {
    const a = Math.max(last, t + up + r() * jit + down + r() * jit);
    out.push({ t, a });
    last = a;
  }
  return { list: out, off };
}

const LINES = [
  { name: 'guest on the VPN, 60 ms round trip', up: 30, down: 0 },
  { name: 'guest on the VPN, 120 ms round trip', up: 60, down: 0 },
  { name: 'the host seen by a guest on the VPN, 120 ms', up: 0, down: 60 },
  { name: 'two guests on the VPN, 120 ms each', up: 60, down: 60 },
];
const JIT = 30;
const FRAME = 1000 / 60;

for (const L of LINES) {
  test(`players: ${L.name}, ${JIT} ms jitter: drawn smoothly, nothing guessed for long`, (t) => {
    const { list, off } = line({ ...L, jit: JIT, every: 50 });
    const tr = new RemoteTrack();
    let k = 0;
    let frames = 0;
    let guessed = 0;
    let maxGap = 0;
    for (let now = 0; now < 60_000; now += FRAME) {
      while (k < list.length && list[k].a <= now) {
        const { t, a } = list[k];
        if (k) maxGap = Math.max(maxGap, a - list[k - 1].a);
        tr.push({ seq: k + 1, t, x: (t / 1000) * 1.5, y: 0, z: 0, vx: 1.5, vy: 0, vz: 0, yaw: 0, pitch: 0, mode: 0, flags: FLAG.grounded, base: 0, gear: 0, lx: 0, ly: 0, lz: 0, lyaw: 0 }, a + off);
        k++;
      }
      tr.adapt(FRAME);
      const p = tr.sample(now + off);
      if (now < 5000 || !p) continue;
      frames++;
      if (p.stale) guessed++;
    }
    t.diagnostic(`delay ${tr.delay.toFixed(0)} ms, guessed ${guessed} of ${frames} frames, largest gap ${maxGap.toFixed(0)} ms`);
    assert.ok(tr.delay <= DELAY_MAX, `delay ${tr.delay}`);
    assert.equal(tr.stats.starved, 0, 'never stood still for want of a state');
    assert.ok(guessed / frames < 0.01, `guessed ${guessed} of ${frames}`);
    // the server's 5 s freshness of a player's place (setPositionSource) is far from any gap on this line
    assert.ok(maxGap < 500, `largest gap ${maxGap} ms`);
  });

  test(`townspeople: ${L.name}: the delay stays in ${PUPPET_DELAY_MIN}-${PUPPET_DELAY_MAX} ms and no frame waits`, (t) => {
    const { list, off } = line({ ...L, jit: JIT, every: 100 });
    const tr = new PuppetTrack();
    const late = [];
    let delay = 220;
    let k = 0;
    let maxGap = 0;
    for (let now = 0; now < 60_000; now += FRAME) {
      while (k < list.length && list[k].a <= now) {
        const { t, a } = list[k];
        if (k) maxGap = Math.max(maxGap, a - list[k - 1].a);
        tr.push({ t, x: (t / 1000) * 1.4, z: 0, yaw: 0, vx: 1.4, vz: 0, snap: false, size: 1, motion: 'walk', sit: 0, lantern: false, sack: false, bought: false, veh: null }, a + off);
        late.push(a + off - t);
        if (late.length > 60) late.shift();
        k++;
      }
      if (late.length >= 10) {
        const want = puppetDelayWanted(late);
        const step = FRAME * 0.05;
        delay += Math.max(-step, Math.min(step, want - delay));
      }
      if (now > 5000) tr.sample(now + off - delay);
    }
    t.diagnostic(`delay ${delay.toFixed(0)} ms, extrapolated ${tr.stats.extrapolated} frames, largest gap ${maxGap.toFixed(0)} ms`);
    assert.ok(delay >= PUPPET_DELAY_MIN && delay <= PUPPET_DELAY_MAX, `delay ${delay}`);
    assert.equal(tr.stats.starved, 0);
    assert.ok(tr.stats.extrapolated < 60, `extrapolated ${tr.stats.extrapolated} frames of 3300`);
    // the server's 3 s staleness of a PC's townspeople (PUPPETS_STALE_MS) never trips on this line
    assert.ok(maxGap < 1000, `largest gap ${maxGap} ms`);
  });
}

/** A job's figures drawn with a fixed delay or the adaptive one: frames where the figure stood on its newest state. */
function figs(L, adaptive) {
  const { list, off } = line({ ...L, jit: JIT, every: 100 });
  const buf = [];
  const late = [];
  const scratch = [];
  let delay = FIG_DELAY_MS;
  let want = FIG_DELAY_MS;
  let k = 0;
  let frames = 0;
  let held = 0;
  for (let now = 0; now < 60_000; now += FRAME) {
    while (k < list.length && list[k].a <= now) {
      const { t, a } = list[k];
      buf.push({ id: 1, kind: 'thief', motion: 'walk', snap: false, carrying: false, x: (t / 1000) * 1.35, y: 0, z: 0, yaw: 0, speed: 1.35, t });
      late.push(a + off - t);
      if (late.length > 50) late.shift();
      if (adaptive) want = figDelayWanted(late, scratch);
      k++;
    }
    const step = FRAME * 0.05;
    delay += Math.max(-step, Math.min(step, want - delay));
    const t = now + off - delay;
    const s = sampleFig(buf, t);
    while (buf.length > 2 && buf[1].t <= t) buf.shift();
    if (now < 5000 || !s) continue;
    frames++;
    if (t > buf[buf.length - 1].t) held++;
  }
  return { share: held / frames, delay };
}

test('job figures: the fixed 200 ms stood them still on a VPN; the adaptive delay does not', (t) => {
  const two = LINES[3];
  const fixed = figs(two, false);
  const adapt = figs(two, true);
  t.diagnostic(`two guests on the VPN: fixed 200 ms held ${(fixed.share * 100).toFixed(1)}% of frames; adaptive ${adapt.delay.toFixed(0)} ms held ${(adapt.share * 100).toFixed(2)}%`);
  assert.ok(fixed.share > 0.05, `fixed: held ${(fixed.share * 100).toFixed(1)}% of frames`);
  assert.ok(adapt.share < 0.01, `adaptive: held ${(adapt.share * 100).toFixed(1)}% of frames at ${adapt.delay.toFixed(0)} ms`);
  assert.ok(adapt.delay <= FIG_DELAY_MAX);
  // on the house's own line it stays at 200 ms, as in M8d
  const home = figs({ up: 2, down: 2 }, true);
  assert.ok(Math.abs(home.delay - FIG_DELAY_MS) < 1, `home delay ${home.delay}`);
  for (const L of LINES) assert.ok(figs(L, true).share < 0.01, L.name);
});
