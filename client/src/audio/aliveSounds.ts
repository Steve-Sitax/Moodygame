// M7 alive (world/alive/): the small sounds of the town's life, all made in code, our own work (no
// recording): dry leaves scraping over the stones, pigeons' wings clapping as a flock goes up,
// sparrows' chirps, a jackdaw's "tchak", a drip off the eaves, thunder, a cat's hiss, the bell on a
// buoy in the river, a ship's bilge pump and its water, a tawny owl. Each maker builds its sound
// into `out` from `t0` and returns its length in seconds; audio/soundscape.ts placed() puts it at
// a place with its own reach (the caller picks the reach: see world/alive/*.ts).

import { buildThunder } from "./thunderSynth";

type Make = (ctx: BaseAudioContext, out: AudioNode, t0: number, noise: AudioBuffer) => number;

const rand = (a: number, b: number) => a + Math.random() * (b - a);

function env(ctx: BaseAudioContext, out: AudioNode, t: number, a: number, peak: number, d: number, curve = 0.3): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.setTargetAtTime(0, t + a, d * curve);
  g.connect(out);
  return g;
}

function noiseBurst(ctx: BaseAudioContext, noise: AudioBuffer, out: AudioNode, t: number, type: BiquadFilterType, f: number, q: number, a: number, level: number, d: number): void {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const flt = ctx.createBiquadFilter();
  flt.type = type;
  flt.frequency.value = f;
  flt.Q.value = q;
  src.connect(flt).connect(env(ctx, out, t, a, level, d));
  src.start(t, Math.random() * 2);
  src.stop(t + a + d * 1.6 + 0.05);
}

function tone(ctx: BaseAudioContext, out: AudioNode, t: number, type: OscillatorType, f0: number, f1: number, dur: number, a: number, level: number): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(level, t + a);
  g.gain.linearRampToValueAtTime(0, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
  return o;
}

/** Dry leaves and a scrap of paper scraping over the cobbles in a gust: `k` 0..1 how many. */
export const leaves = (k: number, secs: number): Make => (ctx, out, t0, noise) => {
  const n = Math.round(6 + k * 26);
  for (let i = 0; i < n; i++) {
    const t = t0 + Math.random() * secs;
    noiseBurst(ctx, noise, out, t, "bandpass", rand(2500, 6500), rand(0.8, 2.5), 0.004, rand(0.05, 0.16) * (0.5 + k), rand(0.02, 0.09));
  }
  // the hiss of the lot under it
  noiseBurst(ctx, noise, out, t0, "highpass", 3200, 0.5, secs * 0.4, 0.035 * k, secs * 0.5);
  return secs + 0.3;
};

/** A flock going up: wing claps, fast at first, then the whirr. `n` birds. */
export const wings = (n: number): Make => (ctx, out, t0, noise) => {
  const claps = Math.round(8 + n * 1.5);
  for (let i = 0; i < claps; i++) {
    const t = t0 + Math.pow(Math.random(), 1.6) * 1.4;
    noiseBurst(ctx, noise, out, t, "bandpass", rand(700, 1600), rand(1.2, 2.5), 0.003, rand(0.12, 0.3), rand(0.02, 0.05));
  }
  noiseBurst(ctx, noise, out, t0 + 0.2, "bandpass", 1100, 0.8, 0.3, 0.06 * Math.min(1, n / 12), 1.2);
  return 2.2;
};

/** A sparrow: two to five short chirps, high and a little rough. */
export const chirp = (): Make => (ctx, out, t0) => {
  const n = 2 + Math.floor(Math.random() * 4);
  let t = t0;
  const base = rand(3800, 4800);
  for (let i = 0; i < n; i++) {
    const d = rand(0.04, 0.08);
    tone(ctx, out, t, "sine", base * rand(1.05, 1.25), base * rand(0.75, 0.9), d, 0.005, rand(0.05, 0.09));
    tone(ctx, out, t, "triangle", base * 0.5 * rand(1, 1.1), base * 0.45, d, 0.005, 0.02);
    t += d + rand(0.05, 0.14);
  }
  return t - t0;
};

/** A jackdaw's call: a short hard "tchak", once or twice. */
export const jackdaw = (): Make => (ctx, out, t0, noise) => {
  const n = Math.random() < 0.5 ? 1 : 2;
  let t = t0;
  for (let i = 0; i < n; i++) {
    const f = rand(1100, 1400);
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(f * 1.25, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.8, t + 0.09);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1900;
    bp.Q.value = 2.5;
    o.connect(bp).connect(env(ctx, out, t, 0.006, 0.12, 0.07));
    o.start(t);
    o.stop(t + 0.18);
    noiseBurst(ctx, noise, out, t, "bandpass", 2600, 1.5, 0.003, 0.05, 0.05);
    t += rand(0.2, 0.32);
  }
  return t - t0 + 0.1;
};

/** A drop off the eaves into a puddle or on the stone. */
export const drip = (): Make => (ctx, out, t0, noise) => {
  const f = rand(900, 2200);
  tone(ctx, out, t0, "sine", f * 1.6, f * 0.7, 0.06, 0.002, rand(0.05, 0.1));
  noiseBurst(ctx, noise, out, t0, "bandpass", rand(3000, 5000), 2, 0.001, 0.025, 0.015);
  return 0.15;
};

/**
 * Water off a broken gutter landing on the stones, `len` seconds of it: a soft patter of small splashes, more and
 * a little louder when it pours (`strong` 0..1), a few separate drops when it only trickles.
 */
export const gutterSplash = (strong: number, len: number): Make => (ctx, out, t0, noise) => {
  const n = Math.max(2, Math.round(len * (6 + 34 * strong)));
  for (let i = 0; i < n; i++) {
    const t = t0 + Math.random() * len;
    noiseBurst(ctx, noise, out, t, "bandpass", rand(1400, 4200), 1.2, 0.002, rand(0.02, 0.045) * (0.6 + 0.4 * strong), rand(0.02, 0.05));
    if (Math.random() < 0.25) tone(ctx, out, t, "sine", rand(700, 1500) * 1.5, rand(500, 900), 0.05, 0.002, rand(0.015, 0.035));
  }
  // under it, when it pours, a low soft rush
  if (strong > 0.4) noiseBurst(ctx, noise, out, t0, "lowpass", 900, 0.5, len * 0.3, 0.025 * strong, len * 0.5);
  return len + 0.15;
};

/**
 * Thunder `km` off (audio/thunderSynth.ts builds it, after Ribner and Roy: a crooked channel, a shock from every few
 * metres of it): near, one violent crack, a rip and a boom that is over fast; far, a long low rolling rumble. The
 * claps are built ahead in a worker (thunderPrime) and kept by distance; one near enough in distance is played, and
 * the worker makes another. Only if none is ready is one built here, at a low rate. The caller waits km / 343 s.
 */
export const thunder = (km: number): Make => (ctx, out, t0, noise) => {
  // the recordings when they are in (audio/soundscape.ts loadStorm): a real clap, by distance
  const rec = km < 1.3 ? recordedThunder.near : recordedThunder.far;
  if (rec.length) return playRecorded(ctx, out, t0, noise, km, rec[Math.floor(Math.random() * rec.length)]);
  let best = -1;
  let bd = 0.45;
  for (let i = 0; i < thunderPool.length; i++) {
    const d = Math.abs(Math.log(thunderPool[i].km / Math.max(0.1, km)));
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  const got = best >= 0 ? thunderPool.splice(best, 1)[0] : { km, sr: 11025, data: buildThunder(km, 11025) };
  thunderPrime();
  const buf = ctx.createBuffer(1, got.data.length, got.sr);
  buf.copyToChannel(got.data as Float32Array<ArrayBuffer>, 0);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(out);
  src.start(t0);
  return got.data.length / got.sr + 0.5;
};

/** The recorded thunderclaps (audio/samples.ts THUNDER_NEAR, THUNDER_FAR), set by the soundscape once loaded. */
export const recordedThunder: { near: AudioBuffer[]; far: AudioBuffer[] } = { near: [], far: [] };

/**
 * A recorded clap `km` off. Near (under 1.3 km): the air tears first (a dense ripping crack, bright and short: the
 * recordings carry little of it) and the boom comes on it, a shade faster; mid-distance the recording as it is;
 * far off, duller and lower, and softer.
 */
function playRecorded(ctx: BaseAudioContext, out: AudioNode, t0: number, noise: AudioBuffer, km: number, b: AudioBuffer): number {
  const src = ctx.createBufferSource();
  src.buffer = b;
  const near = km < 1.3;
  src.playbackRate.value = near ? rand(1.0, 1.08) : km > 3 ? rand(0.82, 0.93) : rand(0.93, 1.0);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = near ? 9000 : 3200 / (1 + km / 2.5);
  const g = ctx.createGain();
  g.gain.value = near ? 1.25 : km > 3 ? 0.55 / (1 + (km - 3) / 6) : 0.85;
  src.connect(lp).connect(g).connect(out);
  let lead = 0;
  if (near) {
    // the tear: noise through a band, roughened fast (the channel's crackle run together), 0.2-0.45 s, then the boom
    const len = rand(0.2, 0.45) * (1.3 - km / 1.3 * 0.5);
    const n = ctx.createBufferSource();
    n.buffer = noise;
    n.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = rand(1800, 3200);
    bp.Q.value = 0.6;
    const ng = ctx.createGain();
    const steps = Math.floor(len * 90);
    ng.gain.setValueAtTime(0, t0);
    for (let i = 0; i < steps; i++) {
      const t = t0 + 0.003 + (i / steps) * len;
      ng.gain.setValueAtTime(rand(0.25, 1) * 0.9 * Math.pow(1 - i / steps, 1.4), t);
    }
    ng.gain.setTargetAtTime(0, t0 + len, 0.03);
    n.connect(bp).connect(ng).connect(out);
    n.start(t0, Math.random());
    n.stop(t0 + len + 0.3);
    // and the blast of it, deep
    const bl = ctx.createBufferSource();
    bl.buffer = noise;
    const blp = ctx.createBiquadFilter();
    blp.type = "lowpass";
    blp.frequency.value = 220;
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0, t0 + len * 0.6);
    bg.gain.linearRampToValueAtTime(1.6, t0 + len * 0.6 + 0.02);
    bg.gain.setTargetAtTime(0, t0 + len * 0.6 + 0.02, 0.35);
    bl.connect(blp).connect(bg).connect(out);
    bl.start(t0 + len * 0.6, Math.random());
    bl.stop(t0 + len * 0.6 + 2);
    lead = len * 0.5;
  }
  src.start(t0 + lead);
  return lead + b.duration / src.playbackRate.value + 0.3;
}

/** Claps built ahead (thunder.worker.ts), by distance. */
const thunderPool: Array<{ km: number; sr: number; data: Float32Array }> = [];
const THUNDER_KMS = [0.3, 0.6, 1.1, 2, 3.5, 6, 9];
let thunderWorker: Worker | null = null;
let thunderAsked = 0;

/** Keep a clap or two of each distance ready (the storm part calls it; cheap when all are there). */
export function thunderPrime(): void {
  if (!thunderWorker) {
    if (typeof Worker === "undefined") return;
    try {
      thunderWorker = new Worker(new URL("./thunder.worker.ts", import.meta.url), { type: "module" });
      thunderWorker.onmessage = (e: MessageEvent<{ km: number; sr: number; data: Float32Array }>) => {
        thunderAsked = Math.max(0, thunderAsked - 1);
        thunderPool.push(e.data);
      };
    } catch {
      return;
    }
  }
  for (const km of THUNDER_KMS) {
    if (thunderAsked >= 3) return;
    if (thunderPool.filter((q) => Math.abs(Math.log(q.km / km)) < 0.3).length >= 2) continue;
    thunderAsked++;
    thunderWorker.postMessage({ km: km * rand(0.85, 1.15), sr: 22050 });
  }
}

/** A cat's hiss (a cat you came too close to in the dark). */
export const hiss = (): Make => (ctx, out, t0, noise) => {
  noiseBurst(ctx, noise, out, t0, "highpass", 2600, 0.7, 0.03, 0.12, 0.45);
  return 0.9;
};

/** The bell on a buoy: the clapper strikes as the buoy rolls, once or a few times. Inharmonic partials. */
export const buoyBell = (strikes: number): Make => (ctx, out, t0) => {
  let t = t0;
  for (let s = 0; s < strikes; s++) {
    const lvl = rand(0.5, 1) * 0.16;
    const f = 520;
    for (const [m, a, d] of [[0.5, 0.5, 5], [1, 1, 3.5], [1.19, 0.5, 2.5], [1.5, 0.35, 2], [2.0, 0.3, 1.5], [2.74, 0.2, 1], [3.9, 0.1, 0.6]] as const) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = f * m * rand(0.998, 1.002);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(lvl * a, t + 0.004);
      g.gain.setTargetAtTime(0, t + 0.004, d * 0.3);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + d * 1.6);
    }
    t += rand(0.7, 1.8);
  }
  return t - t0 + 5;
};

/** A ship's bilge pump: the handle's clank and a gush of water into the river, `strokes` times. */
export const bilge = (strokes: number, period: number): Make => (ctx, out, t0, noise) => {
  for (let s = 0; s < strokes; s++) {
    const t = t0 + s * period;
    // the iron clank of the brake (the handle) at the top of the stroke
    tone(ctx, out, t, "square", rand(300, 360), 220, 0.05, 0.002, 0.04);
    noiseBurst(ctx, noise, out, t, "bandpass", 1800, 3, 0.002, 0.06, 0.04);
    // wood creak on the way down
    tone(ctx, out, t + period * 0.35, "sawtooth", 140, 110, 0.18, 0.05, 0.015);
    // the water: a gush onto the water below
    noiseBurst(ctx, noise, out, t + period * 0.45, "bandpass", rand(600, 900), 0.8, 0.05, 0.12, period * 0.35);
    noiseBurst(ctx, noise, out, t + period * 0.5, "highpass", 2500, 0.6, 0.05, 0.03, period * 0.3);
  }
  return strokes * period + 0.8;
};

/** A tawny owl: the male's long hoot, a pause, then the wavering "hu-hu-hoooo"; or the female's "ke-wick". */
export const owl = (): Make => (ctx, out, t0) => {
  if (Math.random() < 0.3) {
    // ke-wick
    tone(ctx, out, t0, "sine", 1500, 1100, 0.12, 0.01, 0.06);
    tone(ctx, out, t0 + 0.13, "sine", 1700, 1250, 0.22, 0.01, 0.05);
    return 0.5;
  }
  const f = rand(390, 430);
  const hoot = (t: number, dur: number, lvl: number, wob: number) => {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(f * 0.97, t);
    o.frequency.linearRampToValueAtTime(f, t + 0.08);
    o.frequency.linearRampToValueAtTime(f * 0.93, t + dur);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 11;
    const lg = ctx.createGain();
    lg.gain.value = f * wob;
    lfo.connect(lg).connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(lvl, t + 0.06);
    g.gain.setValueAtTime(lvl, t + dur - 0.1);
    g.gain.linearRampToValueAtTime(0, t + dur);
    const h = ctx.createOscillator();
    h.type = "sine";
    h.frequency.value = f * 2;
    const hg = ctx.createGain();
    hg.gain.value = 0.08;
    o.connect(g).connect(out);
    h.connect(hg).connect(g);
    o.start(t);
    lfo.start(t);
    h.start(t);
    o.stop(t + dur + 0.02);
    lfo.stop(t + dur + 0.02);
    h.stop(t + dur + 0.02);
  };
  hoot(t0, 0.75, 0.09, 0.004);
  const t1 = t0 + 0.75 + rand(2.5, 4);
  hoot(t1, 0.12, 0.06, 0.004);
  hoot(t1 + 0.2, 0.12, 0.06, 0.004);
  hoot(t1 + 0.42, 1.1, 0.08, 0.02);
  return t1 + 1.6 - t0;
};

/** A horse blowing out through its nose (a cold morning). */
export const snort = (): Make => (ctx, out, t0, noise) => {
  noiseBurst(ctx, noise, out, t0, "bandpass", rand(500, 800), 1.2, 0.02, 0.08, 0.25);
  noiseBurst(ctx, noise, out, t0 + 0.05, "lowpass", 300, 1, 0.01, 0.05, 0.2);
  return 0.7;
};

// ------------------------------------------------------------------ the great storm (world/alive/gale.ts)

/** A shutter or a loose door slammed by the wind against its frame: one to four hard wooden knocks, the last ones weaker. */
export const shutterBang = (knocks: number): Make => (ctx, out, t0, noise) => {
  let t = t0;
  for (let i = 0; i < knocks; i++) {
    const k = i === 0 ? 1 : rand(0.35, 0.8);
    // the slam: a dull thud of the board and the rattle of the frame
    noiseBurst(ctx, noise, out, t, "lowpass", rand(500, 900), 0.8, 0.002, 0.5 * k, 0.09);
    noiseBurst(ctx, noise, out, t, "bandpass", rand(1400, 2600), 1.5, 0.001, 0.22 * k, 0.05);
    tone(ctx, out, t, "triangle", rand(140, 210), rand(90, 120), 0.12, 0.002, 0.18 * k);
    t += rand(0.12, 0.55);
  }
  return t - t0 + 0.4;
};

/** A slate off a roof: a scrape down the tiles, then it breaks on the stones in pieces. */
export const slateCrash = (): Make => (ctx, out, t0, noise) => {
  const slide = rand(0.25, 0.7);
  noiseBurst(ctx, noise, out, t0, "bandpass", rand(2200, 3400), 2.5, slide * 0.6, 0.05, slide * 0.4);
  const t = t0 + slide + rand(0.35, 0.6); // (the fall from the eaves)
  noiseBurst(ctx, noise, out, t, "highpass", 2500, 0.7, 0.001, 0.5, 0.12);
  tone(ctx, out, t, "square", rand(1800, 2600), rand(1200, 1600), 0.05, 0.001, 0.05);
  const bits = 5 + Math.floor(Math.random() * 7);
  for (let i = 0; i < bits; i++) {
    const tt = t + 0.03 + Math.pow(Math.random(), 1.5) * 0.6;
    noiseBurst(ctx, noise, out, tt, "bandpass", rand(3000, 7000), rand(2, 5), 0.001, rand(0.05, 0.16), rand(0.015, 0.04));
    if (Math.random() < 0.4) tone(ctx, out, tt, "sine", rand(2500, 4800), rand(2000, 3500), 0.03, 0.001, 0.03);
  }
  return t - t0 + 1;
};

/** A shop sign swinging on its iron bracket: the hinge's squeal as it goes, and back. */
export const signCreak = (): Make => (ctx, out, t0) => {
  const swings = 2 + Math.floor(Math.random() * 3);
  let t = t0;
  const f = rand(380, 620);
  for (let i = 0; i < swings; i++) {
    const d = rand(0.35, 0.7);
    const up = i % 2 === 0;
    tone(ctx, out, t, "sawtooth", up ? f : f * 1.35, up ? f * 1.4 : f * 0.95, d, d * 0.3, 0.018);
    tone(ctx, out, t, "sine", up ? f * 2.02 : f * 2.7, up ? f * 2.8 : f * 1.9, d, d * 0.3, 0.02);
    t += d + rand(0.1, 0.4);
  }
  return t - t0 + 0.2;
};

/** A gust of the great storm coming down the street: a rising roar with a howl in it, `k` 0..1 how hard, `secs` long. */
export const gustRoar = (k: number, secs: number): Make => (ctx, out, t0, noise) => {
  // the roar: low noise swelling and falling with the gust
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(300, t0);
  lp.frequency.linearRampToValueAtTime(900 + 900 * k, t0 + secs * 0.45);
  lp.frequency.linearRampToValueAtTime(350, t0 + secs);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(0.35 * k, t0 + secs * 0.4);
  g.gain.linearRampToValueAtTime(0, t0 + secs);
  src.connect(lp).connect(g).connect(out);
  src.start(t0, Math.random() * 2);
  src.stop(t0 + secs + 0.1);
  // the howl round the corners: a narrow band that bends up and down
  const src2 = ctx.createBufferSource();
  src2.buffer = noise;
  src2.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 14;
  const f = rand(420, 700);
  bp.frequency.setValueAtTime(f, t0);
  bp.frequency.linearRampToValueAtTime(f * rand(1.4, 1.9), t0 + secs * 0.5);
  bp.frequency.linearRampToValueAtTime(f * rand(0.9, 1.2), t0 + secs);
  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(0, t0);
  g2.gain.linearRampToValueAtTime(0.5 * k, t0 + secs * 0.5);
  g2.gain.linearRampToValueAtTime(0, t0 + secs);
  src2.connect(bp).connect(g2).connect(out);
  src2.start(t0, Math.random() * 2);
  src2.stop(t0 + secs + 0.1);
  return secs + 0.2;
};

/** Something rolling and knocking over the stones in the wind: an empty cask, a bucket. */
export const rollingCask = (secs: number): Make => (ctx, out, t0, noise) => {
  noiseBurst(ctx, noise, out, t0, "lowpass", 220, 0.7, secs * 0.2, 0.18, secs * 0.6);
  const knocks = Math.round(secs * rand(3, 6));
  for (let i = 0; i < knocks; i++) {
    const t = t0 + Math.random() * secs;
    tone(ctx, out, t, "triangle", rand(110, 170), rand(70, 100), 0.08, 0.002, rand(0.08, 0.2));
    noiseBurst(ctx, noise, out, t, "bandpass", rand(600, 1100), 1.2, 0.002, rand(0.05, 0.12), 0.05);
  }
  return secs + 0.4;
};

/** A storm wave slamming into the quay wall: the deep thump of the water on the stone, the roar of it going up, and the spray falling back in a hiss of drops. `k` 0..1 how big. */
export const waveSlam = (k: number): Make => (ctx, out, t0, noise) => {
  noiseBurst(ctx, noise, out, t0, "lowpass", 140, 0.8, 0.01, 0.7 * k, 0.35);
  tone(ctx, out, t0, "sine", 70, 38, 0.4, 0.005, 0.35 * k);
  noiseBurst(ctx, noise, out, t0 + 0.04, "bandpass", 900, 0.6, 0.05, 0.35 * k, 0.6);
  noiseBurst(ctx, noise, out, t0 + 0.1, "highpass", 2500, 0.5, 0.2, 0.18 * k, 1.1);
  const drops = Math.round(20 + 40 * k);
  for (let i = 0; i < drops; i++) {
    const t = t0 + 0.6 + Math.random() * 1.4;
    noiseBurst(ctx, noise, out, t, "bandpass", rand(1500, 5000), 1.5, 0.002, rand(0.02, 0.06) * k, rand(0.02, 0.05));
  }
  return 2.4;
};
