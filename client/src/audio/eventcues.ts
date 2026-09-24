// The sound cues of an event (Steve, 2026-09-24: "let AI create sounds at events"). The director
// composes the sound of a stage from a palette (server/src/director/vocab.ts CUE_SOURCES: what,
// how often, how high, how loud; the engine clamps every number). This file makes each cue: the
// voices (a cheer, laughter, a shout, a child's cry, a hymn), a fiddle, a drum, a whistle, glass,
// wood, fire, all in code, our own, from the same parts as the speech and the sung voice
// (soundscape.speech, ballad.ts singPhrase). The rest plays a slice of a CC0 recording already
// in the game (samples.ts): the bells, the chain, the anvil, the pump, the hooves, the dog.
// No words are ever sung or spoken: the voices are vowels only.

import { singPhrase, type Note } from "./ballad";
import { DOG_SPANS, type SampleName } from "./samples";

export interface CueSpec {
  source: string;
  every_s: number;
  pitch: number;
  level: number;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** A voice: a glottal sawtooth and breath through two formants, into `env` (gain 0 to start). */
function voice(ctx: BaseAudioContext, noise: AudioBuffer, f0: number, vowel: [number, number], formant = 1) {
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.value = f0;
  const breath = ctx.createBufferSource();
  breath.buffer = noise;
  breath.loop = true;
  const bGain = ctx.createGain();
  bGain.gain.value = 0.25;
  const mix = ctx.createGain();
  mix.gain.value = 0.8;
  osc.connect(mix);
  breath.connect(bGain).connect(mix);
  const f1 = ctx.createBiquadFilter();
  f1.type = "bandpass";
  f1.Q.value = 6;
  f1.frequency.value = vowel[0] * formant;
  const f2 = ctx.createBiquadFilter();
  f2.type = "bandpass";
  f2.Q.value = 9;
  f2.frequency.value = vowel[1] * formant;
  const env = ctx.createGain();
  env.gain.value = 0;
  mix.connect(f1).connect(env);
  mix.connect(f2).connect(env);
  return { osc, breath, f1, f2, env, start: (t: number) => (osc.start(t), breath.start(t)), stop: (t: number) => (osc.stop(t), breath.stop(t)) };
}

/** A burst of the noise through a filter with its own envelope. */
function burst(ctx: BaseAudioContext, noise: AudioBuffer, dest: AudioNode, type: BiquadFilterType, freq: number, q: number, t: number, attack: number, decay: number, level: number, hold = 0): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(level, t + attack);
  g.gain.setValueAtTime(level, t + attack + hold);
  g.gain.setTargetAtTime(0, t + attack + hold, decay);
  src.connect(f).connect(g).connect(dest);
  src.start(t);
  src.stop(t + attack + hold + decay * 6 + 0.05);
  return src;
}

/** A struck tone: a sine that decays. */
function ping(ctx: BaseAudioContext, dest: AudioNode, freq: number, t: number, decay: number, level: number, type: OscillatorType = "sine"): void {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(level, t);
  g.gain.setTargetAtTime(0, t + 0.005, decay);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + decay * 6 + 0.05);
}

/** Play a slice of a recording, faded in and out. Returns its seconds, 0 when it is not loaded. */
function slice(ctx: BaseAudioContext, dest: AudioNode, b: AudioBuffer | undefined, t: number, from: number, secs: number, rate: number, level: number, fade = 0.15): number {
  if (!b) return 0;
  const src = ctx.createBufferSource();
  src.buffer = b;
  src.playbackRate.value = rate;
  const len = Math.min(secs, Math.max(0, b.duration - from)) / rate;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(level, t + fade);
  g.gain.setValueAtTime(level, t + Math.max(fade, len - fade));
  g.gain.linearRampToValueAtTime(0, t + len);
  src.connect(g).connect(dest);
  src.start(t, from, secs);
  return len;
}

const AH: [number, number] = [730, 1090];
const OH: [number, number] = [570, 840];
const EH: [number, number] = [530, 1840];

/**
 * Make one hit of a cue into `dest` at `t0`. Returns about how many seconds it lasts, so the
 * caller does not fire it again before it is over.
 */
export function playCue(ctx: BaseAudioContext, dest: AudioNode, noise: AudioBuffer, buf: Map<SampleName, AudioBuffer>, c: CueSpec, t0: number): number {
  const pitch = clamp(c.pitch, 0.6, 1.5);
  const level = clamp(c.level, 0.15, 1);
  switch (c.source) {
    case "cheer": {
      // eight to twelve voices on "ah", each its own pitch, rising a fourth then falling, not together
      const n = 8 + Math.floor(rand(0, 5));
      const dur = rand(1.4, 2.2);
      for (let i = 0; i < n; i++) {
        const man = Math.random() < 0.65;
        const f0 = (man ? rand(105, 160) : rand(190, 260)) * pitch;
        const v = voice(ctx, noise, f0, AH, man ? 1 : 1.15);
        const t = t0 + rand(0, 0.35);
        v.osc.frequency.setValueAtTime(f0, t);
        v.osc.frequency.exponentialRampToValueAtTime(f0 * rand(1.25, 1.5), t + dur * 0.35);
        v.osc.frequency.exponentialRampToValueAtTime(f0 * rand(0.95, 1.15), t + dur);
        v.env.gain.setValueAtTime(0, t);
        v.env.gain.linearRampToValueAtTime(level * 0.16, t + 0.08);
        v.env.gain.setValueAtTime(level * 0.16, t + dur * 0.6);
        v.env.gain.linearRampToValueAtTime(0, t + dur);
        v.env.connect(dest);
        v.start(t);
        v.stop(t + dur + 0.05);
      }
      return dur + 0.4;
    }
    case "laughter": {
      // two or three voices "ha ha ha": pulses that fall in pitch as the breath goes
      const n = 2 + Math.floor(rand(0, 2));
      let longest = 0;
      for (let k = 0; k < n; k++) {
        const man = Math.random() < 0.6;
        const f0 = (man ? rand(120, 175) : rand(200, 280)) * pitch;
        const v = voice(ctx, noise, f0, k % 2 ? EH : AH, man ? 1 : 1.15);
        const pulses = 4 + Math.floor(rand(0, 4));
        let t = t0 + rand(0, 0.3);
        for (let i = 0; i < pulses; i++) {
          const gap = rand(0.15, 0.22);
          v.osc.frequency.setValueAtTime(f0 * (1 - i * 0.025) * rand(0.97, 1.03), t);
          v.env.gain.setValueAtTime(0, t);
          v.env.gain.linearRampToValueAtTime(level * 0.2, t + 0.03);
          v.env.gain.linearRampToValueAtTime(0, t + gap * 0.7);
          t += gap;
        }
        v.env.connect(dest);
        v.start(t0);
        v.stop(t + 0.1);
        longest = Math.max(longest, t - t0);
      }
      return longest + 0.3;
    }
    case "applause": {
      // many hands: the noise through a band, its level a random crackle, swelling then thinning
      const dur = rand(2, 3.5);
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = 2200;
      f.Q.value = 0.7;
      const g = ctx.createGain();
      const steps = Math.floor(dur * 90);
      const curve = new Float32Array(steps);
      for (let i = 0; i < steps; i++) {
        const k = i / steps;
        const swell = k < 0.15 ? k / 0.15 : k > 0.7 ? (1 - k) / 0.3 : 1;
        curve[i] = (Math.random() < 0.35 ? rand(0.4, 1) : rand(0, 0.12)) * swell * level * 0.45;
      }
      g.gain.setValueCurveAtTime(curve, t0, dur);
      src.connect(f).connect(g).connect(dest);
      src.start(t0);
      src.stop(t0 + dur + 0.05);
      return dur;
    }
    case "shout": {
      // one man, loud, two or three syllables, the pitch falling: a call across a square
      const f0 = rand(115, 165) * pitch;
      const v = voice(ctx, noise, f0, AH);
      const syl = 2 + Math.floor(rand(0, 2));
      let t = t0;
      const vowels = [AH, OH, EH];
      for (let i = 0; i < syl; i++) {
        const len = i === syl - 1 ? rand(0.35, 0.55) : rand(0.16, 0.24);
        const vw = vowels[i % vowels.length];
        v.f1.frequency.setTargetAtTime(vw[0], t, 0.02);
        v.f2.frequency.setTargetAtTime(vw[1], t, 0.02);
        v.osc.frequency.setValueAtTime(f0 * (i === syl - 1 ? 1.2 : 1.05), t);
        v.osc.frequency.exponentialRampToValueAtTime(f0 * (i === syl - 1 ? 0.8 : 0.98), t + len);
        v.env.gain.setValueAtTime(0, t);
        v.env.gain.linearRampToValueAtTime(level * 0.5, t + 0.03);
        v.env.gain.setValueAtTime(level * 0.45, t + len * 0.7);
        v.env.gain.linearRampToValueAtTime(0, t + len);
        t += len + 0.04;
      }
      v.env.connect(dest);
      v.start(t0);
      v.stop(t + 0.1);
      return t - t0 + 0.3;
    }
    case "cry": {
      // a child's wail: a high voice with a wide, slow wobble, up then down, twice, a gulp between
      const f0 = rand(330, 420) * pitch;
      const v = voice(ctx, noise, f0, EH, 1.35);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 5.5;
      const depth = ctx.createGain();
      depth.gain.value = f0 * 0.04;
      lfo.connect(depth).connect(v.osc.frequency);
      let t = t0;
      for (let i = 0; i < 2; i++) {
        const len = rand(0.9, 1.4);
        v.osc.frequency.setValueAtTime(f0, t);
        v.osc.frequency.exponentialRampToValueAtTime(f0 * 1.3, t + len * 0.4);
        v.osc.frequency.exponentialRampToValueAtTime(f0 * 0.85, t + len);
        v.env.gain.setValueAtTime(0, t);
        v.env.gain.linearRampToValueAtTime(level * 0.22, t + 0.12);
        v.env.gain.setValueAtTime(level * 0.2, t + len * 0.75);
        v.env.gain.linearRampToValueAtTime(0, t + len);
        t += len + rand(0.3, 0.5);
      }
      v.env.connect(dest);
      v.start(t0);
      lfo.start(t0);
      v.stop(t + 0.1);
      lfo.stop(t + 0.1);
      return t - t0 + 0.3;
    }
    case "hymn": {
      // four voices in slow chords, sung (the ballad voice), a bar of five notes; nobody in tune together
      const beat = 0.8 / pitch;
      const tune: Note[] = [[0, 2], [4, 2], [7, 2], [5, 2], [4, 3]];
      const parts = [
        { f0: 98, semis: 0, formant: 1 },
        { f0: 131, semis: 4, formant: 1 },
        { f0: 220, semis: 0, formant: 1.15 },
        { f0: 262, semis: 4, formant: 1.15 },
      ];
      let end = t0;
      for (const p of parts) {
        const g = ctx.createGain();
        g.gain.value = level * 0.55;
        g.connect(dest);
        const notes: Note[] = tune.map(([s, b]) => [s + p.semis, b]);
        end = Math.max(end, singPhrase(ctx, g, noise, { f0: p.f0 * pitch * rand(0.985, 1.015), formant: p.formant, notes, beat, t0: t0 + rand(0, 0.12) }));
      }
      return end - t0 + 0.5;
    }
    case "murmur": {
      const b = buf.get("murmur");
      return b ? slice(ctx, dest, b, t0, rand(0, Math.max(0, b.duration - 6)), 5, pitch, level * 0.5, 0.8) : 0;
    }
    case "fiddle": {
      // a fiddle: a sawtooth through the body's resonance, a slow wobble, a quick phrase of a dance
      const scale = [0, 2, 4, 5, 7, 9, 11, 12, 14];
      const n = 7 + Math.floor(rand(0, 5));
      const beat = 0.19 / pitch;
      const home = 392 * pitch; // G above middle C
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 6;
      const depth = ctx.createGain();
      depth.gain.value = home * 0.008;
      lfo.connect(depth).connect(o.frequency);
      const body = ctx.createBiquadFilter();
      body.type = "peaking";
      body.frequency.value = 2400;
      body.gain.value = 8;
      body.Q.value = 1.2;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 5200;
      const env = ctx.createGain();
      env.gain.value = 0;
      o.connect(body).connect(lp).connect(env).connect(dest);
      let t = t0;
      let step = Math.floor(rand(0, 3));
      for (let i = 0; i < n; i++) {
        step = clamp(step + pick([-2, -1, -1, 1, 1, 2, 3]), 0, scale.length - 1);
        const f = home * 2 ** (scale[step] / 12);
        const len = i === n - 1 ? beat * 2.5 : Math.random() < 0.25 ? beat * 2 : beat;
        o.frequency.setTargetAtTime(f, t, 0.012);
        env.gain.setValueAtTime(level * 0.08, t);
        env.gain.linearRampToValueAtTime(level * 0.16, t + 0.03);
        env.gain.setValueAtTime(level * 0.14, t + len * 0.85);
        env.gain.linearRampToValueAtTime(i === n - 1 ? 0 : level * 0.06, t + len);
        t += len;
      }
      o.start(t0);
      lfo.start(t0);
      o.stop(t + 0.1);
      lfo.stop(t + 0.1);
      return t - t0 + 0.3;
    }
    case "drum": {
      // a side drum: a low skin thump with a snap of noise, a roll of four
      const beats = [0, 0.42, 0.84, 1.05];
      for (const d of beats) {
        const t = t0 + d / pitch;
        ping(ctx, dest, 160 * pitch, t, 0.09, level * 0.7);
        burst(ctx, noise, dest, "bandpass", 1800, 0.8, t, 0.004, 0.05, level * 0.5);
      }
      return 1.4 / pitch + 0.3;
    }
    case "whistle": {
      // a man's whistle: two notes, up and held, with a little lip wobble
      const o = ctx.createOscillator();
      o.type = "sine";
      const f = 1700 * pitch;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      o.frequency.setValueAtTime(f, t0);
      o.frequency.linearRampToValueAtTime(f * 1.28, t0 + 0.18);
      o.frequency.setValueAtTime(f * 1.28, t0 + 0.35);
      o.frequency.linearRampToValueAtTime(f * 1.22, t0 + 0.6);
      g.gain.linearRampToValueAtTime(level * 0.16, t0 + 0.03);
      g.gain.setValueAtTime(level * 0.16, t0 + 0.5);
      g.gain.linearRampToValueAtTime(0, t0 + 0.62);
      o.connect(g).connect(dest);
      o.start(t0);
      o.stop(t0 + 0.7);
      return 0.9;
    }
    case "glass": {
      // a bottle breaking: a sharp crack, then the shards ring, a few late tinkles on the stones
      burst(ctx, noise, dest, "highpass", 2800, 0.7, t0, 0.003, 0.06, level * 0.8);
      for (const f of [3100, 4650, 6200, 7900]) ping(ctx, dest, f * pitch * rand(0.97, 1.03), t0 + 0.01, rand(0.25, 0.6), level * 0.12, "triangle");
      for (let i = 0; i < 4; i++) ping(ctx, dest, rand(5000, 9000) * pitch, t0 + rand(0.12, 0.6), rand(0.05, 0.14), level * 0.07, "triangle");
      return 1.2;
    }
    case "clatter": {
      // wood on wood: chests set down, a stall knocked; a few hollow thuds with a dry knock in each
      const n = 3 + Math.floor(rand(0, 3));
      let t = t0;
      for (let i = 0; i < n; i++) {
        ping(ctx, dest, rand(140, 220) * pitch, t, 0.07, level * 0.5);
        burst(ctx, noise, dest, "bandpass", 900 * pitch, 2, t, 0.003, 0.03, level * 0.6);
        t += rand(0.07, 0.3);
      }
      return t - t0 + 0.4;
    }
    case "crackle": {
      // a fire: a low roar and the wood snapping, a burst of two or three seconds
      const dur = rand(2, 3.2);
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 260;
      const roar = ctx.createGain();
      roar.gain.setValueAtTime(0, t0);
      roar.gain.linearRampToValueAtTime(level * 0.5, t0 + 0.4);
      roar.gain.setValueAtTime(level * 0.5, t0 + dur - 0.5);
      roar.gain.linearRampToValueAtTime(0, t0 + dur);
      src.connect(lp).connect(roar).connect(dest);
      src.start(t0);
      src.stop(t0 + dur + 0.05);
      for (let t = t0 + rand(0, 0.2); t < t0 + dur; t += rand(0.05, 0.3)) burst(ctx, noise, dest, "bandpass", rand(1200, 3500), 1.5, t, 0.002, rand(0.01, 0.04), level * rand(0.2, 0.6));
      return dur;
    }
    case "horse": {
      // a horse: a neigh (a rough voice with a fast shake, up then down) and a snort after it
      const f0 = 330 * pitch;
      const v = voice(ctx, noise, f0, [900, 1900], 1.3);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 13;
      const depth = ctx.createGain();
      depth.gain.value = f0 * 0.09;
      lfo.connect(depth).connect(v.osc.frequency);
      const len = rand(0.9, 1.3);
      v.osc.frequency.setValueAtTime(f0 * 0.8, t0);
      v.osc.frequency.exponentialRampToValueAtTime(f0 * 1.5, t0 + len * 0.3);
      v.osc.frequency.exponentialRampToValueAtTime(f0 * 0.7, t0 + len);
      v.env.gain.setValueAtTime(0, t0);
      v.env.gain.linearRampToValueAtTime(level * 0.3, t0 + 0.08);
      v.env.gain.setValueAtTime(level * 0.28, t0 + len * 0.7);
      v.env.gain.linearRampToValueAtTime(0, t0 + len);
      v.env.connect(dest);
      v.start(t0);
      lfo.start(t0);
      v.stop(t0 + len + 0.1);
      lfo.stop(t0 + len + 0.1);
      burst(ctx, noise, dest, "lowpass", 700, 0.5, t0 + len + rand(0.3, 0.6), 0.02, 0.12, level * 0.5, 0.1);
      return len + 1.2;
    }
    // ---- the recordings (CC0, samples.ts)
    case "handbell": {
      const b = buf.get("handbell");
      return b ? slice(ctx, dest, b, t0, 0, 2.4, pitch * rand(0.97, 1.03), level * 0.55, 0.01) : 0;
    }
    case "bell": {
      const b = buf.get("hourStroke");
      return b ? slice(ctx, dest, b, t0, 0, 4, 0.82 * pitch, level * 0.6, 0.01) : 0;
    }
    case "ship_bell": {
      const b = buf.get("shipBell");
      return b ? slice(ctx, dest, b, t0, 0, 3, pitch, level * 0.5, 0.01) : 0;
    }
    case "chain": {
      const b = buf.get("chain");
      return b ? slice(ctx, dest, b, t0, 0, 3, pitch, level * 0.5, 0.05) : 0;
    }
    case "anvil": {
      const b = buf.get("anvil");
      return b ? slice(ctx, dest, b, t0, rand(0, 8), 2.2, pitch, level * 0.5, 0.05) : 0;
    }
    case "pump": {
      const b = buf.get("pump");
      return b ? slice(ctx, dest, b, t0, 0, 4, pitch, level * 0.5, 0.1) : 0;
    }
    case "steam_whistle": {
      const b = buf.get("steamWhistleFar");
      return b ? slice(ctx, dest, b, t0, 0, 5, pitch, level * 0.6, 0.2) : 0;
    }
    case "hooves": {
      const b = buf.get("hooves");
      return b ? slice(ctx, dest, b, t0, rand(0, 12), 4, pitch, level * 0.5, 0.6) : 0;
    }
    case "wheels": {
      const b = buf.get("wheels");
      return b ? slice(ctx, dest, b, t0, rand(0, 12), 4, pitch, level * 0.45, 0.6) : 0;
    }
    case "dog": {
      const b = buf.get("dogFar");
      const span = pick(DOG_SPANS);
      return b ? slice(ctx, dest, b, t0, span[0], span[1] - span[0], pitch, level * 0.6, 0.05) : 0;
    }
    default:
      return 0;
  }
}
