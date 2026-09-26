// M7 alive (world/alive/): the small sounds of the town's life, all made in code, our own work (no
// recording): dry leaves scraping over the stones, pigeons' wings clapping as a flock goes up,
// sparrows' chirps, a jackdaw's "tchak", a drip off the eaves, thunder, a cat's hiss, the bell on a
// buoy in the river, a ship's bilge pump and its water, a tawny owl. Each maker builds its sound
// into `out` from `t0` and returns its length in seconds; audio/soundscape.ts placed() puts it at
// a place with its own reach (the caller picks the reach: see world/alive/*.ts).

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

/** Thunder `km` off: a crack (near only), then the long roll, lower and softer far away. */
export const thunder = (km: number): Make => (ctx, out, t0, noise) => {
  const near = Math.max(0, 1 - km / 2.5);
  const len = 4 + km * 1.6 + Math.random() * 3;
  if (near > 0.2) noiseBurst(ctx, noise, out, t0, "lowpass", 3500, 0.4, 0.01, 0.35 * near, 0.35);
  // the roll: a few swells of low noise
  const swells = 3 + Math.floor(Math.random() * 4);
  for (let i = 0; i < swells; i++) {
    const t = t0 + (i / swells) * len * 0.7 + Math.random() * 0.4;
    noiseBurst(ctx, noise, out, t, "lowpass", rand(90, 260) * (1 + near), 0.7, rand(0.1, 0.5), rand(0.35, 0.7) / (1 + km * 0.35), rand(0.8, 2.2));
  }
  return len + 2;
};

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
