// Thunder, built as it happens (audio/aliveSounds.ts thunder plays it). Pure code, no audio context: it runs in a
// worker (audio/thunder.worker.ts), so a clap never holds up a frame (20 to 60 ms of sums each).

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/**
 * Thunder `km` off, built as it happens (after Ribner and Roy, "Acoustics of thunder", 1982): the bolt is a crooked
 * channel from the ground up into the cloud, with branches and a long run inside the cloud; every few metres of it
 * sends one short shock (an N-wave, a few milliseconds). The pieces lie at different distances, so their cracks
 * arrive one after the other. Near, the piece by the ground is close: one violent crack, a ripping, and a heavy
 * boom that is over fast. Far, the air has eaten the highs and the arrivals spread out: a long, low, rolling
 * rumble, soft at the start. The caller waits the time the sound takes to come (km / 343 m/s).
 */
export function buildThunder(km: number, sr: number): Float32Array {

  const d0 = Math.max(120, km * 1000);
  // the channel: listener at the origin, the strike's foot d0 away along +x
  const pts: Array<[number, number, number]> = [];
  let x = d0, y = 0, z = 0;
  const top = rand(3000, 4800);
  while (y < top) {
    pts.push([x, y, z]);
    const st = rand(8, 30);
    x += rand(-0.6, 0.6) * st;
    z += rand(-0.6, 0.6) * st;
    y += rand(0.45, 1) * st;
  }
  const trunk = pts.length;
  // branches off the trunk, and the run through the cloud (the long far roll)
  for (let b = 0; b < 4; b++) {
    const s0 = pts[Math.floor(rand(0.1, 0.8) * trunk)];
    let [bx, by, bz] = s0;
    const n = Math.floor(rand(20, 70));
    const dx = rand(-1, 1), dz = rand(-1, 1);
    for (let i = 0; i < n && by > 0; i++) {
      const st = rand(8, 25);
      bx += (dx + rand(-0.5, 0.5)) * st;
      bz += (dz + rand(-0.5, 0.5)) * st;
      by -= rand(-0.2, 0.7) * st;
      pts.push([bx, by, bz]);
    }
  }
  {
    let [cx, cy, cz] = pts[trunk - 1];
    const ang = Math.random() * Math.PI * 2;
    const run = rand(2000, 6000);
    for (let l = 0; l < run; ) {
      const st = rand(15, 40);
      cx += (Math.cos(ang) + rand(-0.6, 0.6)) * st;
      cz += (Math.sin(ang) + rand(-0.6, 0.6)) * st;
      cy += rand(-0.3, 0.3) * st;
      l += st;
      pts.push([cx, cy, cz]);
    }
  }
  // each piece: its arrival, its loudness (1/r, more when it lies across the line of sight), its N-wave's length
  const first = Math.hypot(...pts[0]);
  const arr: Array<{ t: number; a: number; w: number }> = [];
  for (let i = 1; i < pts.length; i++) {
    const [px, py, pz] = pts[i];
    const [qx, qy, qz] = pts[i - 1];
    const r = Math.hypot(px, py, pz);
    const sx = px - qx, sy = py - qy, sz = pz - qz;
    const sl = Math.hypot(sx, sy, sz) || 1;
    const across = Math.sqrt(Math.max(0.05, 1 - ((sx * px + sy * py + sz * pz) / (sl * r)) ** 2));
    // (a shock stretches as it runs: longer, lower N-waves from farther pieces)
    const w = 0.004 * Math.pow(r / 300, 0.35) * rand(0.7, 1.4);
    const t = (r - first) / 343;
    // near: the channel by the ground is right there: its crack outdoes everything after it
    const crack = 1 + 4 * Math.exp(-t / 0.3) * Math.max(0, 1 - d0 / 1500);
    arr.push({ t, a: (sl / r) * across * (i < trunk ? 1 : 0.55) * crack, w });
  }
  // near thunder is over fast (the roll after it is soft); far thunder rolls on
  const len = Math.min(d0 < 1000 ? 9 : 16, Math.max(...arr.map((q) => q.t)) + 1.5 + Math.min(1, Math.max(0, (d0 - 1500) / 5000)) * 6);
  const n = Math.ceil(len * sr);
  const d = new Float32Array(n);
  for (const q of arr) {
    const i0 = Math.floor(q.t * sr);
    if (i0 >= n) continue;
    // the shock: an N-wave
    const L = Math.max(4, Math.floor(q.w * sr));
    for (let k = 0; k < L && i0 + k < n; k++) d[i0 + k] += q.a * 1.5 * (1 - (2 * k) / L);
    // and the crackle of the piece itself (every few metres of it is crooked again): a short burst of noise, longer
    // and softer from farther pieces, so the arrivals run together into a rip near by and a roll far off
    const G = Math.floor((0.02 + 0.07 * Math.random()) * (1 + q.w * 120) * sr);
    const dec = 4 / G;
    for (let k = 0; k < G && i0 + k < n; k++) d[i0 + k] += q.a * (Math.random() * 2 - 1) * Math.exp(-k * dec);
  }
  // the air eats the highs: a one-pole low pass by distance (near 2.5 kHz, far about 200 Hz), and the body of it
  // (a second, slower pass mixed in: the low roll under everything)
  const fc = 2600 / (1 + (d0 / 700) ** 1.3);
  const k1 = 1 - Math.exp((-2 * Math.PI * fc) / sr);
  const k2 = 1 - Math.exp((-2 * Math.PI * 70) / sr);
  let y1 = 0, y1b = 0, y2 = 0;
  for (let i = 0; i < n; i++) {
    y1 += (d[i] - y1) * k1;
    y1b += (y1 - y1b) * k1;
    y2 += (y1b - y2) * k2;
    d[i] = y1b + y2 * (2 + d0 / 1200);
  }
  // far off, the roll comes back off the land and the clouds: echoes, later and duller, for seconds on end
  const far = Math.min(1, Math.max(0, (d0 - 1500) / 5000));
  if (far > 0) {
    const src2 = Float32Array.from(d);
    for (let j = 0; j < 9; j++) {
      const D = Math.floor(rand(0.4, 6) * sr);
      const gj = rand(0.25, 0.6) * far * (1 - j / 12);
      let e = 0;
      const ke = 1 - Math.exp((-2 * Math.PI * 160) / sr);
      for (let i = D; i < n; i++) {
        e += (src2[i - D] - e) * ke;
        d[i] += e * gj;
      }
    }
  }
  // the level by its loudest half second (not by one click): near thunder shakes the windows, far thunder is a murmur
  const W = Math.floor(sr / 2);
  let best = 1e-9, acc = 0;
  for (let i = 0; i < n; i++) {
    acc += d[i] * d[i];
    if (i >= W) acc -= d[i - W] * d[i - W];
    if (i >= W - 1) best = Math.max(best, acc / W);
  }
  const rms = Math.sqrt(best);
  const want = 0.42 / (1 + d0 / 2500);
  const tail = Math.floor(sr * 0.8);
  for (let i = 0; i < tail; i++) d[n - 1 - i] *= i / tail;
  for (let i = 0; i < n; i++) d[i] = Math.tanh((d[i] / rms) * want * 1.3) * 0.95;
  return d;
}
