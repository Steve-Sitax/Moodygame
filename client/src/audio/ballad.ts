// A voice that sings (M6 ballads), made in code, our own: no recordings. The same parts as the
// speech voice (soundscape.speech): a glottal sawtooth and a little breath through two vowel
// formants, but the pitch follows a tune, one note to a syllable, held, with a slow vibrato and a
// short dip between syllables for the consonant. The tune itself is made by game/ballads.ts.

/** A note: semitones above the singer's home note, and its length in beats. */
export type Note = [semitones: number, beats: number];

/** Sung vowels (first and second formant, Hz, a man's): ah, oh, ee, eh, oo, aw. */
const VOWELS: Array<[number, number]> = [[730, 1090], [570, 840], [300, 2250], [530, 1840], [320, 900], [620, 1000]];

export interface SingOpts {
  /** The home note (Hz): a man about 130, a woman about 220. */
  f0: number;
  /** Formants a little higher for a woman or a child. */
  formant: number;
  notes: Note[];
  /** Seconds a beat. */
  beat: number;
  /** When to start (the context's time). */
  t0: number;
}

/**
 * Sing one line of a ballad into `dest`. Returns the time it ends. The nodes stop themselves;
 * `onEnd` runs when they have.
 */
export function singPhrase(ctx: BaseAudioContext, dest: AudioNode, noise: AudioBuffer, o: SingOpts, onEnd?: () => void): number {
  const t0 = o.t0;
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  const breath = ctx.createBufferSource();
  breath.buffer = noise;
  breath.loop = true;
  const bGain = ctx.createGain();
  bGain.gain.value = 0.18;
  const mix = ctx.createGain();
  mix.gain.value = 0.8;
  osc.connect(mix);
  breath.connect(bGain).connect(mix);
  // a slow vibrato, deeper on the long notes (a singer's wobble)
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 5.3;
  const depth = ctx.createGain();
  depth.gain.value = 0;
  lfo.connect(depth).connect(osc.frequency);
  const f1 = ctx.createBiquadFilter();
  f1.type = "bandpass";
  f1.Q.value = 5;
  const f2 = ctx.createBiquadFilter();
  f2.type = "bandpass";
  f2.Q.value = 8;
  const env = ctx.createGain();
  env.gain.value = 0;
  mix.connect(f1).connect(env);
  mix.connect(f2).connect(env);
  env.connect(dest);
  let t = t0;
  o.notes.forEach(([semi, beats], i) => {
    const len = beats * o.beat;
    const f = o.f0 * 2 ** (semi / 12);
    // semi can be below the home note (the day's shift), so keep the index positive
    const v = VOWELS[(((i * 7 + Math.round(semi)) % VOWELS.length) + VOWELS.length) % VOWELS.length];
    // slide into the note a little, as untrained voices do
    osc.frequency.setTargetAtTime(f, t, i === 0 ? 0.005 : 0.03);
    f1.frequency.setTargetAtTime(v[0] * o.formant, t, 0.025);
    f2.frequency.setTargetAtTime(v[1] * o.formant, t, 0.025);
    depth.gain.setTargetAtTime(len > 0.5 ? f * 0.014 : f * 0.004, t + Math.min(0.2, len * 0.4), 0.08);
    // the consonant: a short dip, then the vowel held
    env.gain.setValueAtTime(i === 0 ? 0 : 0.25, t);
    env.gain.linearRampToValueAtTime(1, t + 0.05);
    env.gain.setValueAtTime(0.9, t + len * 0.8);
    env.gain.linearRampToValueAtTime(i === o.notes.length - 1 ? 0 : 0.35, t + len * 0.98);
    t += len;
  });
  osc.start(t0);
  breath.start(t0);
  lfo.start(t0);
  osc.stop(t + 0.1);
  breath.stop(t + 0.1);
  lfo.stop(t + 0.1);
  osc.onended = () => onEnd?.();
  return t;
}
