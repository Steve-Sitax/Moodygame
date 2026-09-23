import * as THREE from "three";
import type { Surface } from "../world/rijnkaai";

// Web Audio soundscape. Footsteps (Kenney Impact Sounds) and gulls
// (BigSoundBank "Gulls on the Harbor") are CC0 recordings, see
// assets/ATTRIBUTION.md. Everything else is made in code.
//
// Beds: water against the quay, low wind, gas hiss per lamp.
// Events: foghorn every 40-90 s, gulls, rope creak from the ships, footsteps.

const rand = (a: number, b: number) => a + Math.random() * (b - a);

// Parts of the gull recording (seconds) with clean calls and no boat noise.
const GULL_SPANS: Array<[number, number]> = [
  [0, 42],
  [106, 114],
];

export class Soundscape {
  private ctx: AudioContext;
  private master: GainNode;
  private reverbIn: GainNode;
  private noise: AudioBuffer;
  private brown: AudioBuffer;
  private waterPanner: PannerNode;
  private waterGain: GainNode;
  private listenerPos = new THREE.Vector3();
  private nextHorn: number;
  private nextGull: number;
  private nextLap = 0;
  private nextCreak: number;
  hornCount = 0;
  private steps: Record<Surface, AudioBuffer[]> = { stone: [], wood: [] };
  private lastStep = -1;
  private gullBuf: AudioBuffer | null = null;

  constructor(
    private readonly lampPositions: THREE.Vector3[],
    private readonly shipPositions: THREE.Vector3[],
  ) {
    this.ctx = new AudioContext();
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(comp).connect(this.ctx.destination);

    // foggy outdoor space: long soft tail
    const verb = this.ctx.createConvolver();
    verb.buffer = this.impulse(3.8, 2.6);
    this.reverbIn = this.ctx.createGain();
    this.reverbIn.gain.value = 0.55;
    this.reverbIn.connect(verb).connect(this.master);

    this.noise = this.makeNoise(3, "white");
    this.brown = this.makeNoise(4, "brown");

    // water bed: sits on the quay edge nearest the player
    this.waterPanner = this.panner(4, 1.2);
    this.waterGain = this.ctx.createGain();
    this.waterGain.gain.value = 0.5;
    this.waterPanner.connect(this.waterGain).connect(this.master);
    this.loopNoise(this.brown, "lowpass", 380, 0.5, this.waterPanner, 0.13, 0.11);
    this.loopNoise(this.noise, "bandpass", 900, 0.8, this.waterPanner, 0.018, 0.23);

    // wind bed, everywhere
    this.loopNoise(this.brown, "lowpass", 180, 0.7, this.master, 0.06, 0.05);

    // gas hiss per lamp, only heard up close
    for (const p of this.lampPositions) {
      const pan = this.panner(0.6, 2.2);
      pan.positionX.value = p.x;
      pan.positionY.value = p.y;
      pan.positionZ.value = p.z;
      pan.connect(this.master);
      this.loopNoise(this.noise, "highpass", 3800, 0.4, pan, 0.012, 0.9);
    }

    void this.loadSteps();
    void this.loadGulls();

    const now = this.ctx.currentTime;
    this.nextHorn = now + rand(9, 16); // first one early, then 40-90 s
    this.nextGull = now + rand(4, 10);
    this.nextCreak = now + rand(3, 8);
  }

  resume(): void {
    if (this.ctx.state !== "running") void this.ctx.resume();
  }

  get state(): AudioContextState {
    return this.ctx.state;
  }

  update(cam: THREE.Camera): void {
    const ctx = this.ctx;
    const l = ctx.listener;
    cam.getWorldPosition(this.listenerPos);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    l.positionX.value = this.listenerPos.x;
    l.positionY.value = this.listenerPos.y;
    l.positionZ.value = this.listenerPos.z;
    l.forwardX.value = fwd.x;
    l.forwardY.value = fwd.y;
    l.forwardZ.value = fwd.z;
    l.upX.value = up.x;
    l.upY.value = up.y;
    l.upZ.value = up.z;

    // water follows along the edge; pier is water on three sides
    const onPier = this.listenerPos.z < 0.3;
    this.waterPanner.positionX.value = this.listenerPos.x;
    this.waterPanner.positionY.value = -1.2;
    this.waterPanner.positionZ.value = onPier ? this.listenerPos.z : -0.5;

    const now = ctx.currentTime;
    if (now > this.nextLap) {
      this.lap();
      this.nextLap = now + rand(0.25, 1.4);
    }
    if (now > this.nextHorn) {
      this.foghorn();
      this.nextHorn = now + rand(40, 90);
    }
    if (now > this.nextGull) {
      this.gulls();
      this.nextGull = now + rand(12, 35);
    }
    if (now > this.nextCreak) {
      this.creak();
      this.nextCreak = now + rand(5, 14);
    }
  }

  // ---------------------------------------------------------------- events

  footstep(surface: Surface, hurry: boolean): void {
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.005;
    const vol = hurry ? 1.25 : 1;
    const out = ctx.createGain();
    out.gain.value = 0.9;
    out.connect(this.master);
    const wet = ctx.createGain();
    wet.gain.value = surface === "wood" ? 0.25 : 0.12;
    out.connect(wet).connect(this.reverbIn);

    const set = this.steps[surface];
    if (set.length > 0) {
      // recorded step (Kenney Impact Sounds, CC0): a bit slower and darker,
      // heavy boots on wet ground rather than shoes on a clean floor
      let i = Math.floor(Math.random() * set.length);
      if (i === this.lastStep && set.length > 1) i = (i + 1) % set.length;
      this.lastStep = i;
      const src = ctx.createBufferSource();
      src.buffer = set[i];
      src.playbackRate.value = rand(0.78, 0.9) * (hurry ? 1.05 : 1);
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = surface === "wood" ? 2600 : 2200;
      lp.Q.value = 0.5;
      const g = ctx.createGain();
      g.gain.value = (surface === "wood" ? 0.8 : 0.65) * vol * rand(0.8, 1.0);
      src.connect(lp).connect(g).connect(out);
      src.start(t);
      return;
    }

    // fallback while the samples load: synthesized step
    if (surface === "stone") {
      // hobnail on wet cobble: short gritty click and a soft heel
      this.burst(t, 0.05, "bandpass", rand(1800, 2600), 1.2, 0.5 * vol, out);
      this.burst(t + 0.012, 0.09, "lowpass", 500, 0.7, 0.35 * vol, out);
      this.burst(t + 0.03, 0.12, "highpass", 5000, 0.5, 0.05 * vol, out); // wet slap
    } else {
      // hollow planks over water
      this.thump(t, rand(95, 120), 0.16, 0.7 * vol, out);
      this.burst(t, 0.14, "bandpass", rand(380, 520), 4, 0.45 * vol, out);
      this.burst(t + 0.01, 0.04, "bandpass", 2200, 1, 0.12 * vol, out);
      if (Math.random() < 0.18) this.creakAt(t + 0.05, rand(260, 380), 0.25, 0.08, out);
    }
  }

  foghorn(): void {
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.05;
    this.hornCount++;
    const pan = this.panner(40, 0.4);
    pan.positionX.value = rand(-160, 160);
    pan.positionY.value = 5;
    pan.positionZ.value = rand(-260, -180);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 520;
    lp.Q.value = 0.6;
    const env = ctx.createGain();
    env.gain.value = 0;
    lp.connect(env).connect(pan);
    pan.connect(this.master);
    const send = ctx.createGain();
    send.gain.value = 1.4;
    env.connect(send).connect(this.reverbIn);

    // diaphone: long low tone, then the grunt drop at the end
    const f = rand(92, 108);
    const hold = rand(3.2, 4.4);
    for (const [mult, type, g, det] of [
      [1, "sawtooth", 0.42, 0],
      [1, "square", 0.18, 6],
      [2, "sawtooth", 0.12, -4],
      [0.5, "sine", 0.35, 0],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.detune.value = det;
      o.frequency.setValueAtTime(f * mult * 0.94, t);
      o.frequency.linearRampToValueAtTime(f * mult, t + 0.35);
      o.frequency.setValueAtTime(f * mult, t + hold);
      o.frequency.exponentialRampToValueAtTime(f * mult * 0.7, t + hold + 0.7);
      const og = ctx.createGain();
      og.gain.value = g;
      o.connect(og).connect(lp);
      o.start(t);
      o.stop(t + hold + 1.2);
    }
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + 0.6);
    env.gain.setValueAtTime(1, t + hold);
    env.gain.linearRampToValueAtTime(0.8, t + hold + 0.5);
    env.gain.linearRampToValueAtTime(0, t + hold + 1.1);
  }

  gulls(): void {
    if (!this.gullBuf) return;
    const ctx = this.ctx;
    const pan = this.panner(8, 0.6);
    pan.positionX.value = this.listenerPos.x + rand(-40, 40);
    pan.positionY.value = rand(8, 18);
    pan.positionZ.value = rand(-45, -8);
    // fog muffles them
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 3200;
    lp.connect(pan);
    pan.connect(this.master);
    const send = ctx.createGain();
    send.gain.value = 0.9;
    lp.connect(send).connect(this.reverbIn);

    // a slice of the harbour recording: a few calls, faded in and out
    const [a, b] = GULL_SPANS[Math.floor(Math.random() * GULL_SPANS.length)];
    const dur = rand(3, 6);
    const start = rand(a, Math.max(a, b - dur));
    const src = ctx.createBufferSource();
    src.buffer = this.gullBuf;
    src.playbackRate.value = rand(0.94, 1.0);
    const env = ctx.createGain();
    const t = ctx.currentTime + 0.05;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.9, t + 0.4);
    env.gain.setValueAtTime(0.9, t + dur - 0.8);
    env.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(env).connect(lp);
    src.start(t, start, dur + 0.1);
  }

  creak(): void {
    const p = this.shipPositions[Math.floor(Math.random() * this.shipPositions.length)];
    const pan = this.panner(6, 0.9);
    pan.positionX.value = p.x + rand(-15, 15);
    pan.positionY.value = p.y;
    pan.positionZ.value = p.z;
    pan.connect(this.master);
    const t = this.ctx.currentTime + 0.05;
    this.creakAt(t, rand(140, 240), rand(0.6, 1.3), 0.22, pan);
    if (Math.random() < 0.5) this.creakAt(t + rand(0.9, 1.6), rand(160, 260), rand(0.4, 0.9), 0.15, pan);
  }

  // ---------------------------------------------------------------- parts

  private async loadSteps(): Promise<void> {
    const files: Record<Surface, string> = { stone: "concrete", wood: "wood" };
    for (const surface of ["stone", "wood"] as const) {
      const loaded = await Promise.all(
        [0, 1, 2, 3, 4].map(async (n) => {
          try {
            const res = await fetch(`/audio/kenney-impact/footstep_${files[surface]}_00${n}.ogg`);
            return await this.ctx.decodeAudioData(await res.arrayBuffer());
          } catch {
            return null; // keep the synth fallback for this one
          }
        }),
      );
      this.steps[surface] = loaded.filter((b): b is AudioBuffer => b !== null);
    }
  }

  private async loadGulls(): Promise<void> {
    try {
      const res = await fetch("/audio/bigsoundbank/gulls-harbor-2573-mono.ogg");
      this.gullBuf = await this.ctx.decodeAudioData(await res.arrayBuffer());
    } catch {
      this.gullBuf = null; // no gulls then; better silence than a bad fake
    }
  }

  get gullsLoaded(): boolean {
    return this.gullBuf !== null;
  }

  get stepSamples(): number {
    return this.steps.stone.length + this.steps.wood.length;
  }

  /** Rope or timber creak: friction pulses through a resonant filter. */
  private creakAt(t: number, f: number, dur: number, vol: number, out: AudioNode): void {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(f * 0.12, t);
    o.frequency.linearRampToValueAtTime(f * 0.08 * rand(0.8, 1.5), t + dur);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(f * 4, t);
    bp.frequency.linearRampToValueAtTime(f * 3.2, t + dur);
    bp.Q.value = 9;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vol, t + dur * 0.3);
    env.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(bp).connect(env).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Water slapping the stone. */
  private lap(): void {
    const t = this.ctx.currentTime + 0.01;
    const dur = rand(0.18, 0.5);
    this.burst(t, dur, "bandpass", rand(250, 700), rand(1.5, 4), rand(0.25, 0.6), this.waterPanner, 0.35);
  }

  private burst(
    t: number,
    dur: number,
    type: BiquadFilterType,
    freq: number,
    q: number,
    vol: number,
    out: AudioNode,
    attack = 0.002,
  ): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = rand(0.9, 1.1);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vol, t + attack + dur * 0.05);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(env).connect(out);
    src.start(t, Math.random() * 2);
    src.stop(t + dur + 0.02);
  }

  private thump(t: number, f: number, dur: number, vol: number, out: AudioNode): void {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(f * 1.6, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.03);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vol, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(env).connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private loopNoise(
    buf: AudioBuffer,
    type: BiquadFilterType,
    freq: number,
    q: number,
    out: AudioNode,
    vol: number,
    swellHz: number,
  ): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = vol;
    // slow swell so the bed breathes
    const lfo = ctx.createOscillator();
    lfo.frequency.value = swellHz * rand(0.8, 1.2);
    const lg = ctx.createGain();
    lg.gain.value = vol * 0.45;
    lfo.connect(lg).connect(g.gain);
    src.connect(f).connect(g).connect(out);
    src.start(0, Math.random() * buf.duration);
    lfo.start();
  }

  private panner(ref: number, rolloff: number): PannerNode {
    return new PannerNode(this.ctx, {
      panningModel: "equalpower",
      distanceModel: "inverse",
      refDistance: ref,
      rolloffFactor: rolloff,
      maxDistance: 10000,
    });
  }

  private makeNoise(seconds: number, kind: "white" | "brown"): AudioBuffer {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === "white") d[i] = w;
      else {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
    return buf;
  }

  private impulse(seconds: number, decay: number): AudioBuffer {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const k = i / len;
        // dark tail: average two samples to soften the highs
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - k, decay) * (i < 400 ? i / 400 : 1);
      }
      for (let i = 1; i < len; i++) d[i] = d[i] * 0.4 + d[i - 1] * 0.6;
    }
    return buf;
  }
}
