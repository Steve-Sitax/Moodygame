// The street cries and the sounds of the street trades (M6 lively), made in code, our own: no
// recordings. A cry is a short sung call (the ballad singer's voice, audio/ballad.ts singPhrase,
// through Soundscape.sing): each trade its own tune, as the criers of the Low Countries had theirs
// ("Versche mosselen, groot en klein!", "Hedde geen oud ijzer?" in a Ghent list of 1752; the
// Mechelen album Den Mechelschen Roep shows 78 sellers, each with a verse). The words stay unsung:
// the voice sings vowels, so no language is heard. The work sounds: the grinder's stone on steel,
// the mussel seller's wooden rattle, the milk cans knocking, the scrubbing brush on stone.

import type { Note } from "./ballad";

export interface Cry {
  notes: Note[];
  /** Seconds a beat. */
  beat: number;
  /** What it says, in plain English (for anyone who reads the sound log). */
  words: string;
}

export const CRIES: Record<string, Cry> = {
  milk_woman: { notes: [[0, 1], [4, 1], [2, 2]], beat: 0.26, words: "Milk! Fresh milk!" },
  baker_boy: { notes: [[0, 0.5], [0, 0.5], [5, 1], [3, 1.5]], beat: 0.22, words: "Bread! Rolls, white rolls!" },
  mussel_seller: { notes: [[7, 1], [7, 0.5], [5, 0.5], [4, 1], [2, 0.5], [0, 0.5], [0, 2]], beat: 0.24, words: "Fresh mussels, big and small!" },
  ragman: { notes: [[0, 1], [0, 0.5], [3, 0.5], [5, 1.5], [3, 0.5], [0, 2]], beat: 0.24, words: "Any old iron? Rags and bones!" },
  grinder: { notes: [[5, 1], [4, 0.5], [2, 0.5], [0, 2]], beat: 0.26, words: "Knives and scissors to grind!" },
  coalman: { notes: [[0, 1.5], [-3, 2]], beat: 0.3, words: "Coal! Good coal!" },
  broom_seller: { notes: [[4, 1], [4, 1], [2, 0.5], [0, 2]], beat: 0.25, words: "Brooms! Birch brooms!" },
  sweep: { notes: [[7, 1], [7, 2], [4, 1], [4, 2]], beat: 0.22, words: "Sweep! Chimney sweep!" },
};

export type StreetWork = "grind" | "rattle" | "clink" | "scrub";

/**
 * Make one work sound into `dest` for about `seconds`. Returns the end time; `onEnd` runs when the
 * nodes have stopped.
 */
export function workSound(ctx: BaseAudioContext, dest: AudioNode, noise: AudioBuffer, kind: StreetWork, seconds: number, onEnd?: () => void): number {
  const t0 = ctx.currentTime + 0.02;
  const dur = Math.max(0.3, Math.min(12, seconds));
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const env = ctx.createGain();
  env.gain.value = 0;
  let last: AudioScheduledSourceNode = src;
  if (kind === "grind") {
    // steel on a turning stone: a hiss through a narrow band, with a whine that rises and falls as the
    // blade is drawn across, and the treadle's rhythm in the level
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 3200;
    bp.Q.value = 3;
    const whine = ctx.createOscillator();
    whine.type = "triangle";
    whine.frequency.setValueAtTime(2400, t0);
    const wg = ctx.createGain();
    wg.gain.value = 0.08;
    src.connect(bp).connect(env);
    whine.connect(wg).connect(env);
    for (let t = t0; t < t0 + dur; t += 0.8) {
      env.gain.setTargetAtTime(0.9, t, 0.05);
      env.gain.setTargetAtTime(0.35, t + 0.45, 0.08);
      whine.frequency.setTargetAtTime(2200 + Math.random() * 900, t, 0.2);
      bp.frequency.setTargetAtTime(2600 + Math.random() * 1400, t, 0.2);
    }
    env.gain.setTargetAtTime(0, t0 + dur, 0.05);
    whine.start(t0);
    whine.stop(t0 + dur + 0.3);
    last = whine;
  } else if (kind === "rattle") {
    // a wooden rattle: quick dry clicks, a burst
    const hp = ctx.createBiquadFilter();
    hp.type = "bandpass";
    hp.frequency.value = 1800;
    hp.Q.value = 1.5;
    src.connect(hp).connect(env);
    for (let t = t0; t < t0 + dur; t += 0.045 + Math.random() * 0.02) {
      env.gain.setValueAtTime(0.9, t);
      env.gain.setTargetAtTime(0, t + 0.004, 0.008);
    }
  } else if (kind === "clink") {
    // two copper cans knocking: a couple of hollow pings
    const o = ctx.createOscillator();
    o.type = "sine";
    const og = ctx.createGain();
    og.gain.value = 0;
    o.connect(og).connect(dest);
    for (let k = 0, t = t0; k < 3 && t < t0 + dur; k++, t += 0.35 + Math.random() * 0.4) {
      o.frequency.setValueAtTime(900 + Math.random() * 300, t);
      og.gain.setValueAtTime(0.35, t);
      og.gain.setTargetAtTime(0, t + 0.01, 0.12);
    }
    o.start(t0);
    o.stop(t0 + dur + 0.4);
    src.connect(env);
    env.gain.setValueAtTime(0, t0);
    last = o;
  } else {
    // a stiff brush on wet stone: a rasp back and forth
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1400;
    bp.Q.value = 0.8;
    src.connect(bp).connect(env);
    for (let t = t0; t < t0 + dur; t += 0.5) {
      env.gain.setTargetAtTime(0.6, t, 0.06);
      env.gain.setTargetAtTime(0.05, t + 0.3, 0.05);
    }
    env.gain.setTargetAtTime(0, t0 + dur, 0.05);
  }
  env.connect(dest);
  src.start(t0);
  src.stop(t0 + dur + 0.3);
  last.onended = () => onEnd?.();
  return t0 + dur;
}
