// The cathedral's organ and the altar bell (M6 landmark interiors), made in code: no
// recordings. The organ is a soft chord bed: for each note of a chord an 8-foot flue (a sine
// and a soft triangle an octave up), a quiet quint, all through a gentle lowpass, swelling in
// and out; the chords walk slowly through a plain progression in D, as an organist improvises
// under the mass. The altar bell is three quick strikes of a small bell (inharmonic partials).

const NOTE = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
// D major and friends, voiced low (MIDI numbers): I, vi, IV, V, I, IV, ii, V
const CHORDS: number[][] = [
  [50, 57, 62, 66],
  [47, 54, 59, 62],
  [43, 55, 59, 62],
  [45, 52, 57, 61],
  [50, 57, 62, 66],
  [43, 50, 59, 67],
  [52, 55, 59, 64],
  [45, 49, 57, 64],
];

interface Voice {
  oscs: OscillatorNode[];
  gain: GainNode;
}

export class Organ {
  private voices: Voice[] = [];
  private bus: GainNode;
  private lp: BiquadFilterNode;
  private timer: ReturnType<typeof setInterval> | null = null;
  private step = 0;
  on = false;

  constructor(
    private readonly ctx: BaseAudioContext,
    out: AudioNode[],
  ) {
    this.bus = ctx.createGain();
    this.bus.gain.value = 0;
    this.lp = ctx.createBiquadFilter();
    this.lp.type = "lowpass";
    this.lp.frequency.value = 1600;
    this.lp.Q.value = 0.4;
    this.lp.connect(this.bus);
    for (const o of out) this.bus.connect(o);
  }

  /** Play (swell in) or stop (die away). `level` 0..1. */
  set(on: boolean, level = 1): void {
    const t = this.ctx.currentTime;
    if (on && !this.on) {
      this.on = true;
      this.build();
      this.chord(0);
      this.timer = setInterval(() => this.chord(++this.step), 4200);
    } else if (!on && this.on) {
      this.on = false;
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      const old = this.voices;
      this.voices = [];
      for (const v of old) for (const o of v.oscs) o.stop(t + 2.5);
    }
    this.bus.gain.setTargetAtTime(on ? 0.16 * level : 0, t, on ? 1.2 : 0.6);
  }

  private build(): void {
    const t = this.ctx.currentTime;
    for (let i = 0; i < 4; i++) {
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      gain.connect(this.lp);
      const oscs: OscillatorNode[] = [];
      const mk = (type: OscillatorType, mult: number, g: number, detune: number) => {
        const o = this.ctx.createOscillator();
        o.type = type;
        o.detune.value = detune;
        const og = this.ctx.createGain();
        og.gain.value = g;
        o.connect(og).connect(gain);
        o.start(t);
        (o as OscillatorNode & { mult: number }).mult = mult;
        oscs.push(o);
      };
      mk("sine", 1, 0.55, -3 + i);
      mk("triangle", 2, 0.16, 2 - i);
      mk("sine", 3, 0.05, 0);
      this.voices.push({ oscs, gain });
    }
  }

  private chord(i: number): void {
    const c = CHORDS[i % CHORDS.length];
    const t = this.ctx.currentTime;
    this.voices.forEach((v, k) => {
      const f = NOTE(c[k]);
      for (const o of v.oscs) o.frequency.setTargetAtTime(f * (o as OscillatorNode & { mult: number }).mult, t, 0.08);
      // a breath between chords, the bass a little louder
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setTargetAtTime(0.15, t, 0.05);
      v.gain.gain.setTargetAtTime(k === 0 ? 0.34 : 0.24, t + 0.12, 0.35);
    });
  }

  /** The altar bell at the elevation: three quick strikes. */
  bell(out: AudioNode[]): void {
    const t0 = this.ctx.currentTime;
    for (let s = 0; s < 3; s++) {
      const t = t0 + s * 0.22;
      for (const [mult, g] of [[1, 0.14], [2.76, 0.07], [5.4, 0.04]] as const) {
        const o = this.ctx.createOscillator();
        o.type = "sine";
        o.frequency.value = 1320 * mult;
        const og = this.ctx.createGain();
        og.gain.setValueAtTime(0, t);
        og.gain.linearRampToValueAtTime(g, t + 0.004);
        og.gain.exponentialRampToValueAtTime(0.0005, t + 0.9);
        o.connect(og);
        for (const d of out) og.connect(d);
        o.start(t);
        o.stop(t + 1);
      }
    }
  }
}
