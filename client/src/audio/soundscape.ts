import * as THREE from "three";
import type { Surface } from "../world/rijnkaai";
import { cartRoutes, cityEmitters, nearestQuay, overWater, type Emitter, type EmitterKind } from "./emitters";
import { CARILLON_SHORT, DOG_SPANS, SAMPLES, TOOT_SPANS, type SampleName } from "./samples";

// Web Audio soundscape. Recorded CC0 sounds wherever we have them (footsteps:
// Kenney; gulls, bells, street and harbour sounds: BigSoundBank and Freesound;
// see assets/ATTRIBUTION.md and audio/samples.ts). Made in code: the water and
// wind beds under the recordings, gas hiss, the foghorn, the reverb.
//
// Beds: water at the nearest quay edge, wind, crowd murmur (setCrowd), rain (setRain).
// Positioned loops (emitters): bridges, pontoons, smithy, ships, taverns, markets, lamps.
// Events: hour bells and carillon (setClock), watch bells on the ships, foghorn,
// gulls, dogs, steam whistles, cranes, cooper, pumps, carts in the fog, footsteps.
// Day and night (setClock): fewer street sounds at night, more water and wind.

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const ramp = (v: number, a: number, b: number) => clamp01((v - a) / (b - a));

// Parts of the gull recording (seconds) with clean calls and no boat noise.
const GULL_SPANS: Array<[number, number]> = [
  [0, 42],
  [106, 114],
];

export type Weather = "fog" | "mist" | "clear" | "rain" | "storm";
/** How far sounds carry: fog dulls and softens everything far off. The foghorn only in fog (Steve). */
const WEATHER_FAR: Record<Weather, { lp: number; gain: number; horn: number }> = {
  fog: { lp: 1300, gain: 0.6, horn: 1 },
  mist: { lp: 2300, gain: 0.8, horn: 0 },
  clear: { lp: 6000, gain: 1, horn: 0 },
  rain: { lp: 2000, gain: 0.75, horn: 0 },
  storm: { lp: 1600, gain: 0.7, horn: 0 },
};
/** Before the first setWeather: a soft far bus and no foghorn (start silent, not "fog"). */
const WEATHER_UNKNOWN = { lp: 2300, gain: 0.8, horn: 0 };
/**
 * Every positioned sound runs source -> fog gain -> air lowpass -> panner -> master
 * (plus a reverb send after the panner that grows with distance). The panner
 * does the inverse-distance fall-off (refDistance, rolloff per kind); the air
 * lowpass and the fog gain follow the distance four times a second:
 * - lowpass: 14 kHz up close, down to the weather's cutoff at `reach` metres, duller beyond;
 * - fog gain: in fog (mist, rain) far sounds lose up to 4.4 dB (2 dB, 2.5 dB) by 300 m.
 */
interface Spot {
  x: number;
  y: number;
  z: number;
  /** Metres at which the sound is as dull as the weather makes things. */
  reach: number;
  /** Highest cutoff (a tavern heard through its door stays at 750 Hz). */
  cap: number;
  wetBase: number;
  fog: GainNode;
  lp: BiquadFilterNode;
  pan: PannerNode;
  wet: GainNode;
}
/** Where the bells are hung: loud at the tower's foot (63 m below them), clearly distant but heard across town. */
const BELL = { ref: 60, rolloff: 1, reach: 500 };
/** Foghorn level: peaks under -3 dBFS even from the pontoon, the nearest place to it. */
const FOGHORN_GAIN = 0.8;
/** Every horn or whistle (foghorn, ships) keeps this far from the one before, in seconds. */
const HORN_GAP: [number, number] = [40, 90];

/** Positioned loops by emitter kind: layers (sample, gain), audible radius, panner. */
interface LoopDef {
  layers: Array<[SampleName | "hiss", number]>;
  radius: number;
  ref: number;
  rolloff: number;
  lowpass?: number;
  wet?: number;
  /** Metres at which it is as dull as the weather makes things (default 150). */
  reach?: number;
}
const LOOPS: Partial<Record<EmitterKind, LoopDef>> = {
  bridge: { layers: [["waterBridge", 0.9]], radius: 40, ref: 3, rolloff: 1.3, wet: 0.3 },
  pontoon: { layers: [["waterPontoon", 1.3]], radius: 40, ref: 3, rolloff: 1.3, wet: 0.2 },
  smithy: { layers: [["anvil", 0.6]], radius: 90, ref: 5, rolloff: 1.1, wet: 0.35 },
  ship: { layers: [["shipCreak", 0.3]], radius: 30, ref: 3, rolloff: 1.4, wet: 0.2 },
  tavern: { layers: [["tavernCrowd", 0.5], ["tavernSong", 0.55]], radius: 45, ref: 3, rolloff: 1.2, lowpass: 750, wet: 0.15 },
  market: { layers: [["market", 0.6]], radius: 100, ref: 10, rolloff: 1, wet: 0.2 },
  lamp: { layers: [["hiss", 0.012]], radius: 12, ref: 0.6, rolloff: 2.2 },
};
/** A horse and cart: hooves on the setts and iron-shod wheels, on one panner. */
const CART: LoopDef = { layers: [["hooves", 0.9], ["wheels", 0.55]], radius: 120, ref: 5, rolloff: 1, wet: 0.25 };
/** A handcart: just the wheels, smaller. */
const HANDCART: LoopDef = { layers: [["wheels", 0.4]], radius: 50, ref: 3, rolloff: 1.2, wet: 0.2 };

/** A vehicle the world shows (world/traffic.ts info()): its sound follows it. */
export interface VehicleSound {
  kind: "dray" | "handcart";
  x: number;
  z: number;
  /** "go" rolls; anything else stands still (silent). */
  state: string;
}

/**
 * A ship under way on the river (world/boats.ts moving()). `steam`: it has an
 * engine (steamer, paddle steamer, tug, paddle tug); otherwise it sails.
 */
export interface MovingShip {
  id: string | number;
  kind: string;
  x: number;
  z: number;
  heading?: number;
  /** m/s */
  speed: number;
  steam: boolean;
  /** Lying at anchor (the liner, world/anchorage.ts): no engine, a deep blast now and then. */
  anchored?: boolean;
}
/** Engine and wheels of a steam ship: paddle kinds churn, screw kinds thump and wash. */
const PADDLE_LOOP: LoopDef = { layers: [["paddleWheels", 0.8], ["shipEngine", 0.3]], radius: 120, ref: 8, rolloff: 1, lowpass: 6000, wet: 0.3 };
const SCREW_LOOP: LoopDef = { layers: [["shipEngine", 0.6], ["waterBridge", 0.35]], radius: 120, ref: 8, rolloff: 1, lowpass: 6000, wet: 0.3 };
const isTug = (k: string) => k.includes("tug");
const isPaddle = (k: string) => k.includes("paddle");

interface ShipSound {
  ship: MovingShip;
  voice: Voice | null;
  d: number;
  level: number;
  /** Came within 150 m this pass (reset past 220 m). */
  approached: boolean;
  /** Sailing ships: next bell or shout. */
  nextCall: number;
}

/** A running positioned loop. */
interface Voice {
  srcs: AudioScheduledSourceNode[];
  gain: GainNode;
  panner: PannerNode;
  spot: Spot;
}
interface Live {
  e: Emitter;
  voice: Voice | null;
  level: number;
}
interface Cart {
  route: Array<[number, number]>;
  lens: number[];
  total: number;
  s: number;
  dir: 1 | -1;
  speed: number;
  x: number;
  z: number;
  voice: Voice | null;
  level: number;
}

export interface SoundscapeOptions {
  /** Use this context instead of a new AudioContext (tests: an OfflineAudioContext). */
  ctx?: BaseAudioContext;
  /** Emitters instead of the ones from shared/city.json. */
  emitters?: Emitter[];
}

export class Soundscape {
  private ctx: BaseAudioContext;
  private master: GainNode;
  private reverbIn: GainNode;
  /** Far bus: everything far off goes through the fog here. */
  /** Positioned sounds now playing; their air lowpass and fog gain follow the listener. */
  private spots = new Set<Spot>();
  /** Metres from the listener to the nearest quay edge (0 over the water). */
  private quayDist = 0;
  private noise: AudioBuffer;
  private brown: AudioBuffer;
  private waterPanner: PannerNode;
  private waterGain: GainNode;
  private windGain: GainNode;
  private windRec: GainNode;
  private murmurGain: GainNode;
  private rainRoofGain: GainNode;
  private rainCobbleGain: GainNode;
  private listenerPos = new THREE.Vector3();
  private nextHorn: number;
  private nextGull: number;
  private nextLap = 0;
  private nextCreak: number;
  private nextDog: number;
  private nextWhistle: number;
  private nextCrane: number;
  private nextCooper: number;
  private nextPump: number;
  private nextCarriage: number;
  private nextSlow = 0;
  private lastMove = 0;
  hornCount = 0;
  private steps: Record<Surface, AudioBuffer[]> = { stone: [], wood: [] };
  private lastStep = -1;
  private gullBuf: AudioBuffer | null = null;
  private fx = new Map<string, AudioBuffer[]>();
  private buf = new Map<SampleName, AudioBuffer>();
  private failed: string[] = [];
  private live: Live[] = [];
  private carts: Cart[] = [];
  private vehicles: Array<{ v: VehicleSound; voice: Voice | null }> = [];
  private shipSounds: ShipSound[] = [];
  private shipTickAt = 0;
  /** Pairs of steam ships that greeted each other: no greeting again before this time. */
  private greeted = new Map<string, number>();
  private bedsStarted = new Set<string>();

  // state set from outside
  private clock: number | null = null;
  private weather: Weather | null = null;
  /** No horn or whistle before this (the shared gap, HORN_GAP). */
  private hornOkAt = 0;
  private crowdN = 0;
  private rain = 0;
  // the smithy works and rests
  private smithyOn = true;
  private smithyNext = 20; // at work when you arrive, then rests and works in turn
  /** Log of bells rung (dev checks). */
  readonly rung: string[] = [];

  constructor(
    private readonly lampPositions: THREE.Vector3[],
    private readonly shipPositions: THREE.Vector3[],
    opts: SoundscapeOptions = {},
  ) {
    this.ctx = opts.ctx ?? new AudioContext();
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

    // wind bed, everywhere (made in code), and wind in the rigging (recorded)
    this.windGain = this.ctx.createGain();
    this.windGain.connect(this.master);
    this.loopNoise(this.brown, "lowpass", 180, 0.7, this.windGain, 0.06, 0.05);
    this.windRec = this.ctx.createGain();
    this.windRec.gain.value = 0;
    this.windRec.connect(this.master);

    // crowd murmur: follows how many people are near (setCrowd)
    this.murmurGain = this.ctx.createGain();
    this.murmurGain.gain.value = 0;
    const murmurLp = this.ctx.createBiquadFilter();
    murmurLp.type = "lowpass";
    murmurLp.frequency.value = 2200;
    murmurLp.connect(this.murmurGain).connect(this.master);
    const murmurWet = this.ctx.createGain();
    murmurWet.gain.value = 0.15;
    this.murmurGain.connect(murmurWet).connect(this.reverbIn);

    // rain beds (setRain)
    this.rainRoofGain = this.ctx.createGain();
    this.rainRoofGain.gain.value = 0;
    this.rainRoofGain.connect(this.master);
    this.rainCobbleGain = this.ctx.createGain();
    this.rainCobbleGain.gain.value = 0;
    this.rainCobbleGain.connect(this.master);

    // positioned loops and events; the world's own lamps join the city's
    const list = opts.emitters ?? cityEmitters();
    const lamps: Emitter[] = this.lampPositions
      .filter((p) => !list.some((e) => e.kind === "lamp" && Math.hypot(e.x - p.x, e.z - p.z) < 1))
      .map((p) => ({ kind: "lamp", x: p.x, z: p.z, y: p.y, name: "gas lamp" }));
    this.emitters([...list, ...lamps]);
    this.carts = cartRoutes().map((route, i) => this.makeCart(route, i));

    void this.loadSteps();
    void this.loadGulls();
    void this.loadFx();
    void this.loadSamples().then(() => {
      this.startBed("murmur", murmurLp, 1);
      this.startBed("windMasts", this.windRec, 1);
      this.startBed("waterWall", this.waterPanner, 0.55);
    });

    const now = this.ctx.currentTime;
    this.nextHorn = now + rand(9, 16); // first one early, then 40-90 s
    this.nextGull = now + rand(4, 10);
    this.nextCreak = now + rand(3, 8);
    this.nextDog = now + rand(20, 45);
    this.nextWhistle = now + rand(60, 140);
    this.nextCrane = now + rand(6, 15);
    this.nextCooper = now + rand(5, 12);
    this.nextPump = now + rand(10, 30);
    this.nextCarriage = now + rand(30, 70);
  }

  resume(): void {
    const c = this.ctx;
    if (c instanceof AudioContext && c.state !== "running") void c.resume();
  }

  get state(): AudioContextState {
    return this.ctx.state;
  }

  /** Stop everything and close the audio context. */
  async dispose(): Promise<void> {
    const c = this.ctx;
    if (c instanceof AudioContext && c.state !== "closed") await c.close();
  }

  // ---------------------------------------------------------------- inputs

  /**
   * The game clock. `hour` may carry fractions (7.25 = 7:15); `minute` adds to it.
   * Crossing a full hour rings the carillon and strikes the hours from the
   * cathedral; crossing a half hour plays a short carillon phrase and the
   * watch bells on a ship near you. Jumps backwards or of more than two hours
   * (sleep, a new day) ring nothing.
   */
  setClock(hour: number, minute = 0): void {
    const t = hour + minute / 60;
    const before = this.clock;
    this.clock = t;
    if (before === null) return;
    const dt = t - before;
    if (dt <= 0 || dt > 2) return;
    const halfBefore = Math.floor(before * 2);
    const halfNow = Math.floor(t * 2);
    if (halfNow === halfBefore) return;
    if (halfNow % 2 === 0) this.hourBells(halfNow / 2);
    else this.carillon(true);
    this.watchBells(halfNow % 8 || 8);
  }

  /** The day's weather: fog dulls far sounds and the bells; the foghorn only sounds in fog. */
  setWeather(w: Weather): void {
    if (!WEATHER_FAR[w]) return; // unknown: keep what we had (at first: no foghorn)
    this.weather = w; // the positioned sounds follow on the next tick (tuneSpot)
  }

  /** How many people are near (e.g. crowd.stats.drawn): the murmur follows. */
  setCrowd(n: number): void {
    this.crowdN = Math.max(0, n);
  }

  /** Rain 0-1: on roofs and cobbles; dampens gulls, market and dogs. */
  setRain(a: number): void {
    this.rain = clamp01(a);
    if (this.rain > 0) {
      this.startBed("rainRoofs", this.rainRoofGain, 1);
      this.startBed("rainCobbles", this.rainCobbleGain, 1);
    }
  }

  /**
   * The carts the world shows, every frame (world/traffic.ts info()): a dray
   * gets hooves and wheels, a handcart its wheels, while it rolls. The unseen
   * carts in the fog keep away from them.
   */
  setVehicles(list: readonly VehicleSound[]): void {
    const now = this.ctx.currentTime;
    const px = this.listenerPos.x;
    const pz = this.listenerPos.z;
    while (this.vehicles.length > list.length) this.stopVoice(this.vehicles.pop()!.voice);
    list.forEach((v, i) => {
      let slot = this.vehicles[i];
      if (!slot || slot.v.kind !== v.kind) {
        if (slot) this.stopVoice(slot.voice);
        slot = this.vehicles[i] = { v, voice: null };
      }
      slot.v = v;
      const def = v.kind === "dray" ? CART : HANDCART;
      const d = Math.hypot(v.x - px, v.z - pz);
      const on = d < def.radius;
      if (on && !slot.voice) slot.voice = this.startVoice({ x: v.x, z: v.z, y: 1 }, def);
      if (!slot.voice) return;
      if (!on && d > def.radius + 10) {
        this.stopVoice(slot.voice);
        slot.voice = null;
        return;
      }
      this.moveSpot(slot.voice.spot, v.x, v.z);
      const level = v.state === "go" ? 1 - 0.3 * this.rain : 0;
      slot.voice.gain.gain.setTargetAtTime(level, now, 0.25);
    });
  }

  /** Replace the positioned sound sources (loops and event spots). */
  emitters(list: Emitter[]): void {
    for (const l of this.live) this.stopVoice(l.voice);
    this.live = list.map((e) => ({ e, voice: null, level: 0 }));
  }

  // ---------------------------------------------------------------- time of day

  /** 0 at night, 1 by day; clock unknown counts as day. */
  private get dayness(): number {
    const h = this.clock === null ? 10 : ((this.clock % 24) + 24) % 24;
    return h < 12 ? ramp(h, 5.5, 8) : 1 - ramp(h, 18, 21);
  }

  private get hourNow(): number {
    return this.clock === null ? 10 : ((this.clock % 24) + 24) % 24;
  }

  /** Gas lamps lit (the world's DAYLIGHT table, roughly); unknown clock: lit. */
  private get lampsLit(): number {
    if (this.clock === null) return 1;
    const h = this.hourNow;
    if (h < 5.5 || h >= 18.5) return 1;
    if (h < 7) return 1 - 0.3 * ramp(h, 5.5, 7);
    if (h < 9) return 0.7 * (1 - ramp(h, 7, 9));
    if (h < 15) return 0;
    if (h < 17) return 0.4 * ramp(h, 15, 17);
    return 0.4 + 0.6 * ramp(h, 17, 18.5);
  }

  /** How loud a kind of loop is at this hour and weather. */
  private kindLevel(kind: EmitterKind): number {
    const day = this.dayness;
    const night = 1 - day;
    const h = this.hourNow;
    switch (kind) {
      case "bridge":
      case "pontoon":
        return 1 + 0.4 * night + 0.3 * this.rain;
      case "smithy":
        return this.smithyOn ? ramp(h, 7, 7.5) * (1 - ramp(h, 18.5, 19)) : 0;
      case "tavern":
        return h >= 18 ? ramp(h, 18, 20) : h < 2 ? 1 - ramp(h, 0.5, 2) : 0;
      case "market":
        // the fish market is a morning market
        return ramp(h, 6, 7) * (1 - ramp(h, 13, 15)) * (1 - 0.5 * this.rain);
      case "lamp":
        return this.lampsLit;
      default:
        return 1;
    }
  }

  // ---------------------------------------------------------------- per frame

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

    // water sits on the nearest quay edge; over the water (pier, deck, pontoon) all round you
    const px = this.listenerPos.x;
    const pz = this.listenerPos.z;
    if (overWater(px, pz)) {
      this.waterPanner.positionX.value = px;
      this.waterPanner.positionZ.value = pz;
      this.quayDist = 0;
    } else {
      const q = nearestQuay(px, pz);
      this.quayDist = q.d;
      this.waterPanner.positionX.value = q.x;
      this.waterPanner.positionZ.value = q.z;
    }
    // swimming, the water is right at your ears
    this.waterPanner.positionY.value = Math.min(-1.2, this.listenerPos.y - 0.4);

    const now = ctx.currentTime;
    const slow = now > this.nextSlow;
    if (slow) {
      this.slowTick(now);
      this.nextSlow = now + 0.25;
    }
    this.moveCarts(now, slow);

    if (now > this.nextLap) {
      this.lap();
      this.nextLap = now + rand(0.25, 1.4);
    }
    if (now > this.nextHorn) {
      // the foghorn only in fog (Steve), and never within the horn gap of a ship's whistle
      const chance = this.weather ? WEATHER_FAR[this.weather].horn : 0;
      if (this.weather === "fog" && this.hornFree() && Math.random() < chance) this.foghorn();
      this.nextHorn = now + rand(40, 90);
    }
    if (now > this.nextGull) {
      // gulls by day; rain keeps them down
      if (this.dayness > 0.3 && Math.random() > this.rain * 0.8) this.gulls();
      this.nextGull = now + rand(12, 35);
    }
    if (now > this.nextCreak) {
      this.creak();
      this.nextCreak = now + rand(5, 14);
    }
    const day = this.dayness;
    if (now > this.nextDog) {
      if (Math.random() > this.rain * 0.6) this.dog();
      this.nextDog = now + (day > 0.5 ? rand(35, 90) : rand(15, 45));
    }
    if (now > this.nextWhistle) {
      // a steamer far down the river, unseen; only while the world reports no ships of its own
      if (!this.shipSounds.length && this.hornFree()) this.steamWhistle();
      this.nextWhistle = now + rand(90, 240) * (day > 0.5 ? 1 : 2);
    }
    if (now > this.nextCrane) {
      const c = this.nearest("crane", 90);
      if (c && Math.random() < day) this.craneWork(c);
      this.nextCrane = now + rand(14, 40);
    }
    if (now > this.nextCooper) {
      const c = this.nearest("cooper", 70);
      if (c && Math.random() < day) this.cooperWork(c);
      this.nextCooper = now + rand(5, 14);
    }
    if (now > this.nextPump) {
      const p = this.nearest("pump", 50);
      if (p && Math.random() < 0.3 + 0.7 * day) this.pump(p);
      this.nextPump = now + rand(25, 70);
    }
    if (now > this.nextCarriage) {
      if (Math.random() < day) this.carriageFar();
      this.nextCarriage = now + rand(50, 120);
    }
  }

  /** Four times a second: beds follow the state; loops start and stop by distance. */
  private slowTick(now: number): void {
    const night = 1 - this.dayness;
    const tau = 0.8;
    this.waterGain.gain.setTargetAtTime(0.5 * (1 + 0.4 * night), now, tau);
    this.windGain.gain.setTargetAtTime(1 + 0.5 * night, now, tau);
    // wind in the rigging: by the water, gone a street or two inland
    const byWater = 1 - ramp(this.quayDist, 15, 120);
    this.windRec.gain.setTargetAtTime((0.05 + 0.09 * night + 0.05 * this.rain) * byWater, now, tau);
    for (const sp of this.spots) this.tuneSpot(sp, now, false);
    const crowd = Math.min(1, Math.sqrt(this.crowdN / 20));
    this.murmurGain.gain.setTargetAtTime(0.22 * crowd * (1 - 0.3 * this.rain), now, 1.5);
    this.rainRoofGain.gain.setTargetAtTime(0.4 * this.rain, now, 1.5);
    this.rainCobbleGain.gain.setTargetAtTime(1.1 * this.rain, now, 1.5);

    if (now > this.smithyNext) {
      this.smithyOn = !this.smithyOn;
      this.smithyNext = now + (this.smithyOn ? rand(20, 45) : rand(6, 18));
    }

    const px = this.listenerPos.x;
    const pz = this.listenerPos.z;
    for (const l of this.live) {
      const def = LOOPS[l.e.kind];
      if (!def) continue;
      const d = Math.hypot(l.e.x - px, l.e.z - pz);
      const edge = 1 - ramp(d, def.radius * 0.7, def.radius);
      const level = d < def.radius ? this.kindLevel(l.e.kind) * (l.e.gain ?? 1) * edge : 0;
      if (level > 0.001 && !l.voice) l.voice = this.startVoice(l.e, def);
      if (l.voice) {
        if (level <= 0.001 && d > def.radius + 10) {
          this.stopVoice(l.voice);
          l.voice = null;
        } else if (Math.abs(level - l.level) > 0.002 || l.level === 0) {
          l.voice.gain.gain.setTargetAtTime(level, now, 0.6);
        }
      }
      l.level = level;
    }
  }

  // ---------------------------------------------------------------- loops

  private startVoice(e: { x: number; z: number; y?: number }, def: LoopDef): Voice | null {
    const ctx = this.ctx;
    const layers = def.layers.filter(([n]) => n === "hiss" || this.buf.has(n));
    if (!layers.length) return null;
    const spot = this.spot(e, def.ref, def.rolloff, def.reach ?? 150, def.wet ?? 0, def.lowpass);
    const panner = spot.pan;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(spot.fog);
    const head: AudioNode = gain;
    const srcs: AudioScheduledSourceNode[] = [];
    for (const [name, g] of layers) {
      const src = ctx.createBufferSource();
      src.loop = true;
      const lg = ctx.createGain();
      lg.gain.value = g;
      if (name === "hiss") {
        src.buffer = this.noise;
        const hp = ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = 3800;
        hp.Q.value = 0.4;
        src.connect(hp).connect(lg);
      } else {
        const b = this.buf.get(name)!;
        src.buffer = b;
        src.playbackRate.value = rand(0.97, 1.03);
        src.connect(lg);
      }
      lg.connect(head);
      src.start(ctx.currentTime, Math.random() * (src.buffer!.duration - 0.1));
      srcs.push(src);
    }
    return { srcs, gain, panner, spot };
  }

  private stopVoice(v: Voice | null): void {
    if (!v) return;
    const t = this.ctx.currentTime;
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setTargetAtTime(0, t, 0.3);
    for (const s of v.srcs) s.stop(t + 1.6);
    v.srcs[0].onended = () => this.dropSpot(v.spot);
  }

  /** A non-positional bed loop into `out`. */
  private startBed(name: SampleName, out: AudioNode, gain: number): void {
    const b = this.buf.get(name);
    if (!b || this.bedsStarted.has(name)) return;
    this.bedsStarted.add(name);
    const src = this.ctx.createBufferSource();
    src.buffer = b;
    src.loop = true;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(out);
    src.start(this.ctx.currentTime, Math.random() * b.duration);
  }

  // ---------------------------------------------------------------- carts in the fog

  private makeCart(route: Array<[number, number]>, i: number): Cart {
    const lens: number[] = [];
    let total = 0;
    for (let k = 1; k < route.length; k++) {
      const d = Math.hypot(route[k][0] - route[k - 1][0], route[k][1] - route[k - 1][1]);
      lens.push(d);
      total += d;
    }
    return { route, lens, total, s: rand(0, total), dir: i % 2 ? -1 : 1, speed: rand(1.1, 1.5), x: route[0][0], z: route[0][1], voice: null, level: 0 };
  }

  /**
   * Horses and carts walk their streets, heard but never seen: within 18 m
   * they fall silent (the fog hides them past 20-30 m; a cart you could see
   * but not find would be wrong). Day only, a stray one at night.
   */
  private moveCarts(now: number, slow: boolean): void {
    const dt = Math.min(0.1, Math.max(0, now - this.lastMove));
    this.lastMove = now;
    const px = this.listenerPos.x;
    const pz = this.listenerPos.z;
    for (const c of this.carts) {
      c.s += c.dir * c.speed * dt;
      if (c.s > c.total) [c.s, c.dir] = [c.total, -1];
      if (c.s < 0) [c.s, c.dir] = [0, 1];
      let s = c.s;
      let k = 0;
      while (k < c.lens.length - 1 && s > c.lens[k]) s -= c.lens[k++];
      const t = c.lens[k] ? s / c.lens[k] : 0;
      const [ax, az] = c.route[k];
      const [bx, bz] = c.route[k + 1];
      c.x = ax + (bx - ax) * t;
      c.z = az + (bz - az) * t;
      if (c.voice) {
        this.moveSpot(c.voice.spot, c.x, c.z);
      }
      if (!slow) continue; // gains four times a second
      const d = Math.hypot(c.x - px, c.z - pz);
      const real = this.vehicles.some((s) => Math.hypot(s.v.x - c.x, s.v.z - c.z) < 40);
      const level = d < 120 && !real ? (0.1 + 0.9 * this.dayness) * ramp(d, 18, 30) * (1 - 0.3 * this.rain) : 0;
      if (level > 0.001 && !c.voice) c.voice = this.startVoice({ x: c.x, z: c.z, y: 1 }, CART);
      if (c.voice) {
        if (level <= 0.001 && d > 130) {
          this.stopVoice(c.voice);
          c.voice = null;
        } else c.voice.gain.gain.setTargetAtTime(level, now, 0.5);
      }
      c.level = level;
    }
  }

  // ---------------------------------------------------------------- ships under way

  /**
   * The ships moving on the river, every frame (world/boats.ts moving()). Each
   * steam ship within 120 m gets its engine (and paddle wheels) on its own
   * panner, dulled by distance and fog. Steam ships whistle now and then: once
   * as they come within 150 m, and to greet another steamer near them; tugs
   * toot short, big steamers give a deep long blast. Sailing ships only ring
   * their bell or call an order. All whistles share the horn gap (HORN_GAP)
   * with the foghorn. Web Audio panners have no doppler; nothing here adds one.
   */
  setMovingShips(list: readonly MovingShip[]): void {
    const now = this.ctx.currentTime;
    const px = this.listenerPos.x;
    const pz = this.listenerPos.z;
    const ids = new Set(list.map((s) => s.id));
    this.shipSounds = this.shipSounds.filter((s) => {
      if (ids.has(s.ship.id)) return true;
      this.stopVoice(s.voice);
      return false;
    });
    for (const ship of list) {
      let s = this.shipSounds.find((q) => q.ship.id === ship.id);
      if (!s) {
        s = { ship, voice: null, d: Infinity, level: 0, approached: false, nextCall: now + rand(5, 30) };
        this.shipSounds.push(s);
      }
      s.ship = ship;
      s.d = Math.hypot(ship.x - px, ship.z - pz);
      if (s.voice) {
        this.moveSpot(s.voice.spot, ship.x, ship.z);
      }
    }
    if (now < this.shipTickAt) return;
    this.shipTickAt = now + 0.25;

    for (const s of this.shipSounds) {
      const { ship } = s;
      if (ship.anchored) {
        // a ship at anchor (world/anchorage.ts): no engine, a deep blast every few minutes,
        // heard far across the river (the whistle's own reach and the fog do the rest)
        if (s.d < 600 && now > s.nextCall && this.hornFree()) {
          this.whistle(ship, "pass");
          s.nextCall = now + rand(150, 360);
        }
        continue;
      }
      if (ship.steam) {
        const def = isPaddle(ship.kind) ? PADDLE_LOOP : SCREW_LOOP;
        if (s.d < def.radius && !s.voice) s.voice = this.startVoice({ x: ship.x, z: ship.z, y: 2 }, def);
        if (s.voice && s.d > def.radius + 10) {
          this.stopVoice(s.voice);
          s.voice = null;
        }
        s.level = s.voice ? (0.3 + 0.7 * clamp01(ship.speed / 3)) * (isTug(ship.kind) ? 0.8 : 1) : 0;
        if (s.voice) {
          s.voice.gain.gain.setTargetAtTime(s.level, now, 0.5);
        }
        // a whistle as it comes by
        // (inside the horn gap it waits, and gives up once the ship is close)
        if (!s.approached && s.d < 150) {
          if (this.hornFree()) {
            s.approached = true;
            if (Math.random() < 0.7) this.whistle(ship, "pass");
          } else if (s.d < 60) s.approached = true;
        } else if (s.approached && s.d > 220) s.approached = false;
      } else if (s.d < 70 && now > s.nextCall) {
        // a sailing ship: the bell, or an order called on deck
        if (Math.random() < 0.5) this.shipBellAt(ship, 2);
        else this.shoutAt(ship);
        s.nextCall = now + rand(35, 80);
      }
    }

    // two steamers meeting greet each other: one whistles, the other answers
    const steam = this.shipSounds.filter((s) => s.ship.steam && s.d < 300);
    for (let i = 0; i < steam.length; i++) {
      for (let j = i + 1; j < steam.length; j++) {
        const a = steam[i];
        const b = steam[j];
        if (Math.hypot(a.ship.x - b.ship.x, a.ship.z - b.ship.z) > 90) continue;
        const key = [String(a.ship.id), String(b.ship.id)].sort().join("|");
        if (now < (this.greeted.get(key) ?? 0) || !this.hornFree()) continue;
        this.greeted.set(key, now + rand(240, 420));
        if (Math.random() < 0.6) {
          const dur = this.whistle(a.ship, "greet");
          this.whistle(b.ship, "greet", dur + rand(1.5, 3), true);
        }
      }
    }
  }

  /**
   * A ship asks the lock or a bridge to open (world/boats.ts onSignal): one
   * long, one short blast (a sailing ship calls and rings its bell, long then
   * short), answered by the bridge-keeper's hand bell from the nearest bridge.
   * Signals always sound (the world shows the bridge opening) but still hold
   * back the next horn by the horn gap.
   */
  shipSignal(ship: MovingShip, at: "lock" | "bridge"): void {
    let dur: number;
    if (ship.steam) dur = this.whistle(ship, "signal", 0, true);
    else {
      this.shoutAt(ship);
      this.shipBellAt(ship, 2, 1.2);
      dur = 3;
    }
    this.log(`signal ${at} ${ship.kind}`);
    const keeper = this.nearestTo("bridge", ship.x, ship.z, 250);
    const bell = this.buf.get("handbell");
    if (!keeper || !bell) return;
    const len = rand(2.2, 4.4);
    this.slice(bell, { x: keeper.x, z: keeper.z, y: 3 }, 0, len, 0.7, rand(0.95, 1.05), 300, 8, dur + rand(1.5, 3));
    this.log("bridge-keeper's bell");
  }

  /**
   * A steam whistle from a ship. Tugs: short toots; big steamers: a deep long
   * blast; "signal": one long, one short. Returns how long it lasts (s).
   * `force`: play even inside the horn gap (an answer, a signal).
   */
  private whistle(ship: MovingShip, why: "pass" | "greet" | "signal", delay = 0, force = false): number {
    if (!force && !this.hornFree()) return 0;
    const long = this.buf.get("steamboatWhistle");
    const toots = this.buf.get("tugToots");
    if (!long) return 0;
    const tug = isTug(ship.kind);
    const rate = tug ? rand(1.0, 1.08) : rand(0.7, 0.78);
    const out = 450; // how far a whistle stays bright (reach)
    const at = { x: ship.x, z: ship.z, y: 8 };
    let dur: number;
    if (why === "signal") {
      const l = 2.2 / rate;
      this.slice(long, at, 0, 2.2, 0.8, rate, out, 30, delay);
      this.slice(long, at, 0, 0.6, 0.8, rate, out, 30, delay + l + 0.7);
      dur = l + 0.7 + 0.6 / rate;
    } else if (tug && toots) {
      const n = why === "greet" ? 1 : Math.random() < 0.5 ? 2 : 3;
      let t = delay;
      for (let i = 0; i < n; i++) {
        const [a, b] = TOOT_SPANS[i % TOOT_SPANS.length];
        this.slice(toots, at, a, b, 0.75, rate, out, 25, t);
        t += (b - a) / rate + 0.35;
      }
      dur = t - delay;
    } else {
      const len = why === "greet" ? rand(1.6, 2.4) : rand(3.2, 4.6);
      this.slice(long, at, 0, len, 0.85, rate, out, 40, delay);
      dur = len / rate;
    }
    this.hornCount++;
    this.hornUsed();
    this.log(`whistle ${why} ${ship.kind}`);
    return dur;
  }

  /** A ship's bell rung n times on a moving ship; `hold` lets the first ring sound longer. */
  private shipBellAt(ship: MovingShip, n: number, hold = 0): void {
    const b = this.buf.get("shipBell");
    if (!b) return;
    const out = 300;
    let t = 0;
    for (let i = 0; i < n; i++) {
      const first = i === 0 && hold > 0;
      this.slice(b, { x: ship.x, z: ship.z, y: 4 }, 0, first ? b.duration : 1.6, 0.5, 0.9, out, 6, t);
      t += first ? hold : 0.45;
    }
    this.log(`ship's bell ${ship.kind}`);
  }

  /** An order called on deck. */
  private shoutAt(ship: MovingShip): void {
    const b = this.buf.get("heaveShout");
    if (!b) return;
    this.slice(b, { x: ship.x, z: ship.z, y: 3 }, 0, b.duration, 0.6, rand(0.88, 1.0), 200, 6);
    this.log(`shout ${ship.kind}`);
  }

  private hornFree(): boolean {
    return this.ctx.currentTime >= this.hornOkAt;
  }

  private hornUsed(): void {
    this.hornOkAt = this.ctx.currentTime + rand(HORN_GAP[0], HORN_GAP[1]);
  }

  private nearestTo(kind: EmitterKind, x: number, z: number, within: number): Emitter | null {
    let best: Emitter | null = null;
    let bd = within;
    for (const l of this.live) {
      if (l.e.kind !== kind) continue;
      const d = Math.hypot(l.e.x - x, l.e.z - z);
      if (d < bd) [best, bd] = [l.e, d];
    }
    return best;
  }

  // ---------------------------------------------------------------- bells

  /** The hour: the carillon's voorslag, then the strokes of the big bell. */
  hourBells(hour: number): void {
    const n = ((Math.round(hour) % 12) + 12) % 12 || 12;
    const tune = this.carillon(false);
    this.strike(n, tune + 0.8);
  }

  /** Strike the big bell n times, starting `delay` s from now. */
  strike(n: number, delay = 0): void {
    const b = this.buf.get("hourStroke");
    const cat = this.cathedral();
    if (!b || !cat) return;
    this.log(`hour ${n}`);
    const spot = this.spot(cat, BELL.ref, BELL.rolloff, BELL.reach, 0.9);
    const t0 = this.ctx.currentTime + delay + 0.05;
    for (let i = 0; i < n; i++) {
      const src = this.ctx.createBufferSource();
      src.buffer = b;
      src.playbackRate.value = 0.82; // a big bell, deeper than the village one recorded
      const g = this.ctx.createGain();
      g.gain.value = 1.1;
      src.connect(g).connect(spot.fog);
      src.start(t0 + i * 2.6);
      if (i === n - 1) src.onended = () => this.dropSpot(spot);
    }
  }

  /** The cathedral carillon: the whole tune, or a short phrase. Returns its length (s). */
  carillon(short: boolean): number {
    const b = this.buf.get("carillon");
    const cat = this.cathedral();
    if (!b || !cat) return 0;
    this.log(short ? "carillon short" : "carillon");
    const spot = this.spot(cat, BELL.ref, BELL.rolloff, BELL.reach, 0.9);
    const dur = short ? CARILLON_SHORT : b.duration;
    const src = this.ctx.createBufferSource();
    src.buffer = b;
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime + 0.05;
    g.gain.setValueAtTime(0.9, t);
    if (short) {
      g.gain.setValueAtTime(0.9, t + dur - 1.2);
      g.gain.linearRampToValueAtTime(0, t + dur);
    }
    src.connect(g).connect(spot.fog);
    src.start(t, 0, dur + 0.05);
    src.onended = () => this.dropSpot(spot);
    return dur;
  }

  /** Ship's watch bells, rung in pairs, from a ship near you. */
  watchBells(n: number): void {
    const b = this.buf.get("shipBell");
    const ship = this.nearest("ship", 160);
    if (!b || !ship) return;
    this.log(`watch ${n}`);
    const spot = this.spot({ x: ship.x + rand(-4, 4), z: ship.z + rand(-4, 4), y: 4 }, 6, 1, 300, 0.6);
    let t = this.ctx.currentTime + rand(1, 4);
    for (let i = 0; i < n; i++) {
      const src = this.ctx.createBufferSource();
      src.buffer = b;
      src.playbackRate.value = 0.9;
      const g = this.ctx.createGain();
      g.gain.value = 0.55;
      src.connect(g).connect(spot.fog);
      src.start(t);
      if (i === n - 1) src.onended = () => this.dropSpot(spot);
      t += i % 2 === 0 ? 0.42 : 1.25;
    }
  }

  // ---------------------------------------------------------------- street events

  /** A dog far off, inland. */
  dog(): void {
    const b = this.buf.get("dogFar");
    if (!b) return;
    let x = 0;
    let z = 0;
    for (let i = 0; i < 8; i++) {
      const a = rand(0, Math.PI * 2);
      const d = rand(60, 150);
      x = this.listenerPos.x + Math.cos(a) * d;
      z = Math.abs(this.listenerPos.z + Math.sin(a) * d) + 10;
      if (!overWater(x, z)) break;
    }
    const [a, e] = pick(DOG_SPANS);
    this.slice(b, { x, z, y: 2 }, a, e, 1, rand(0.95, 1.05), 300, 10);
  }

  /** A steam whistle from a boat on the river. */
  steamWhistle(): void {
    const name: SampleName = Math.random() < 0.5 ? "steamWhistleFar" : "steamboatWhistle";
    const b = this.buf.get(name);
    if (!b) return;
    const pos = { x: this.listenerPos.x + rand(-250, 250), z: rand(-250, -120), y: 8 };
    this.slice(b, pos, 0, b.duration, name === "steamboatWhistle" ? 0.7 : 0.9, rand(0.9, 1.0), 450, 60);
    this.hornCount++;
    this.hornUsed();
    this.log("whistle far");
  }

  /** The railway gate at the Werf store opens (M3g, world/railgate.ts): the keeper rings his hand bell. */
  gateBell(x: number, z: number): void {
    const bell = this.buf.get("handbell");
    if (!bell || Math.hypot(x - this.listenerPos.x, z - this.listenerPos.z) > 150) return;
    this.slice(bell, { x, z, y: 3 }, 0, rand(1.8, 2.8), 0.6, rand(0.95, 1.05), 150, 6);
    this.log("railway gate bell");
  }

  /** An iron wheel over a rail joint (M3g, world/railway.ts): a knock and a short ring, made in code. */
  railClack(x: number, z: number): void {
    if (Math.hypot(x - this.listenerPos.x, z - this.listenerPos.z) > 70) return;
    const spot = this.spot({ x, z, y: 0.4 }, 4, 1.2, 70, 0.25);
    const t = this.ctx.currentTime + 0.01;
    this.burst(t, 0.07, "bandpass", rand(1700, 2300), 3, 0.45, spot.fog, 0.001);
    this.burst(t + 0.1, 0.06, "bandpass", rand(1500, 2100), 3, 0.3, spot.fog, 0.001);
    this.thump(t, 65, 0.14, 0.4, spot.fog);
    window.setTimeout(() => this.dropSpot(spot), 600);
  }

  /** A crane at work: ratchet or winch, then the chain. */
  craneWork(c: Emitter): void {
    const r = this.buf.get(Math.random() < 0.5 ? "ratchet" : "winch");
    if (!r) return;
    const dur = rand(2.5, 4.5);
    const start = rand(0, r.duration - dur);
    this.slice(r, c, start, start + dur, 0.7, rand(0.85, 1.0), 150, 6);
    const ch = this.buf.get("chain");
    if (ch && Math.random() < 0.7) this.slice(ch, c, 0, ch.duration, 0.6, rand(0.8, 0.95), 150, 6, dur - 0.2);
  }

  /** A cooper driving hoops on a cask: a run of mallet blows (Kenney wood impacts). */
  cooperWork(c: Emitter): void {
    const wood = this.fx.get("thud_wood");
    const plank = this.fx.get("thud_plank");
    if (!wood?.length || !plank?.length) return;
    const n = Math.floor(rand(5, 10));
    const gap = rand(0.42, 0.52);
    const rate = rand(0.68, 0.78);
    for (let i = 0; i < n; i++) {
      const hoop = i % 3 === 2;
      const b = pick(hoop ? plank : wood);
      this.slice(b, c, 0, b.duration, hoop ? 0.35 : 0.55, hoop ? rate * 1.9 : rate, 150, 5, i * gap + rand(-0.02, 0.02));
    }
  }

  /** A pump handle worked a few strokes. */
  pump(p: Emitter): void {
    const b = this.buf.get("pump");
    if (!b) return;
    const dur = rand(3, 7);
    const start = rand(0, b.duration - dur);
    this.slice(b, p, start, start + dur, 0.6, rand(0.95, 1.05), 150, 4);
  }

  /** A carriage passing somewhere off in the fog. */
  carriageFar(): void {
    const b = this.buf.get(Math.random() < 0.5 ? "carriageFar" : "carriageArch");
    if (!b) return;
    const a = rand(0, Math.PI * 2);
    const d = rand(50, 90);
    const pos = { x: this.listenerPos.x + Math.cos(a) * d, z: Math.abs(this.listenerPos.z + Math.sin(a) * d) + 20, y: 1 };
    this.slice(b, pos, 0, b.duration, 0.8, 1, 250, 12);
  }

  /**
   * Play part of a buffer at a place, with short fades, through a spot:
   * inverse fall-off from `ref` metres, duller towards `reach` metres.
   */
  private slice(
    b: AudioBuffer,
    at: { x: number; z: number; y?: number },
    from: number,
    to: number,
    vol: number,
    rate: number,
    reach: number,
    ref: number,
    delay = 0,
  ): void {
    const ctx = this.ctx;
    const spot = this.spot(at, ref, 1, reach, 0.35);
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = rate;
    const env = ctx.createGain();
    const t = ctx.currentTime + 0.03 + Math.max(0, delay);
    const dur = Math.max(0.05, (to - from) / rate);
    const f = Math.min(0.08, dur / 4);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vol, t + (from > 0 ? f : 0.005));
    env.gain.setValueAtTime(vol, t + dur - f);
    env.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(env).connect(spot.fog);
    src.start(t, from, to - from);
    src.onended = () => this.dropSpot(spot);
  }

  private log(what: string): void {
    this.rung.push(what);
    if (this.rung.length > 40) this.rung.shift();
  }

  private nearest(kind: EmitterKind, within: number): Emitter | null {
    let best: Emitter | null = null;
    let bd = within;
    for (const l of this.live) {
      if (l.e.kind !== kind) continue;
      const d = Math.hypot(l.e.x - this.listenerPos.x, l.e.z - this.listenerPos.z);
      if (d < bd) [best, bd] = [l.e, d];
    }
    return best;
  }

  private cathedral(): Emitter | null {
    return this.live.find((l) => l.e.kind === "cathedral")?.e ?? null;
  }


  // ---------------------------------------------------------------- distance

  /**
   * A place for a sound: fog gain -> air lowpass -> panner -> master, and a
   * reverb send after the panner. Connect the source to `fog`. Tuned now and
   * four times a second after (tuneSpot); drop it when the sound ends.
   */
  private spot(at: { x: number; z: number; y?: number }, ref: number, rolloff: number, reach: number, wet: number, cap = 14000): Spot {
    const ctx = this.ctx;
    const pan = this.panner(ref, rolloff);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 0.5;
    const fog = ctx.createGain();
    const w = ctx.createGain();
    fog.connect(lp).connect(pan).connect(this.master);
    pan.connect(w).connect(this.reverbIn);
    const sp: Spot = { x: at.x, y: at.y ?? 1, z: at.z, reach, cap, wetBase: wet, fog, lp, pan, wet: w };
    pan.positionX.value = sp.x;
    pan.positionY.value = sp.y;
    pan.positionZ.value = sp.z;
    this.tuneSpot(sp, ctx.currentTime, true);
    this.spots.add(sp);
    return sp;
  }

  private moveSpot(sp: Spot, x: number, z: number): void {
    sp.x = x;
    sp.z = z;
    sp.pan.positionX.value = x;
    sp.pan.positionZ.value = z;
  }

  private dropSpot(sp: Spot): void {
    this.spots.delete(sp);
    sp.pan.disconnect();
    sp.wet.disconnect();
  }

  /** Distance from the listener, in 3D (the bells hang 65 m up). */
  private distTo(x: number, y: number, z: number): number {
    const l = this.listenerPos;
    return Math.hypot(x - l.x, y - l.y, z - l.z);
  }

  private tuneSpot(sp: Spot, now: number, first: boolean): void {
    const d = this.distTo(sp.x, sp.y, sp.z);
    const lp = Math.min(sp.cap, this.airLp(d, sp.reach));
    const fog = this.fogLoss(d);
    // far off, more of what you hear is the echo off the fog and the walls
    const wet = sp.wetBase * (0.6 + 1.4 * ramp(d, 20, 400));
    if (first) {
      sp.lp.frequency.value = lp;
      sp.fog.gain.value = fog;
      sp.wet.gain.value = wet;
    } else {
      sp.lp.frequency.setTargetAtTime(lp, now, 0.4);
      sp.fog.gain.setTargetAtTime(fog, now, 0.4);
      sp.wet.gain.setTargetAtTime(wet, now, 0.4);
    }
  }

  private weatherFar(): { lp: number; gain: number; horn: number } {
    return this.weather ? WEATHER_FAR[this.weather] : WEATHER_UNKNOWN;
  }

  /** Air lowpass: 14 kHz within 10 m, down to the weather's cutoff at `reach` m, duller beyond. */
  private airLp(d: number, reach: number): number {
    const far = this.weatherFar().lp;
    let f = 14000 * Math.pow(far / 14000, ramp(d, 10, reach));
    if (d > reach) f *= Math.sqrt(reach / d);
    return Math.max(300, f);
  }

  /** Fog (mist, rain) takes a little more off far sounds: none within 30 m, the full weather loss by 300 m. */
  private fogLoss(d: number): number {
    return 1 - (1 - this.weatherFar().gain) * ramp(d, 30, 300);
  }

  // ---------------------------------------------------------------- dev

  /** What the audio graph holds now (dev checks: log it). */
  graph(): Record<string, unknown> {
    const active = this.live.filter((l) => l.voice).map((l) => ({ kind: l.e.kind, name: l.e.name ?? "", level: +l.level.toFixed(3), layers: l.voice!.srcs.length }));
    const byKind: Record<string, number> = {};
    for (const l of this.live) byKind[l.e.kind] = (byKind[l.e.kind] ?? 0) + 1;
    return {
      state: this.ctx.state,
      samples: { loaded: [...this.buf.keys()], failed: this.failed },
      emitters: byKind,
      active,
      carts: this.carts.map((c) => ({ x: +c.x.toFixed(1), z: +c.z.toFixed(1), level: +c.level.toFixed(3), playing: !!c.voice })),
      vehicles: this.vehicles.map((s) => ({ kind: s.v.kind, x: +s.v.x.toFixed(1), z: +s.v.z.toFixed(1), state: s.v.state, playing: !!s.voice })),
      beds: [...this.bedsStarted],
      gains: {
        water: +this.waterGain.gain.value.toFixed(3),
        wind: +this.windGain.gain.value.toFixed(3),
        windRigging: +this.windRec.gain.value.toFixed(3),
        murmur: +this.murmurGain.gain.value.toFixed(3),
        rainRoofs: +this.rainRoofGain.gain.value.toFixed(3),
        rainCobbles: +this.rainCobbleGain.gain.value.toFixed(3),
        weatherLowpass: this.weatherFar().lp,
        spots: this.spots.size,
      },
      clock: this.clock,
      dayness: +this.dayness.toFixed(2),
      weather: this.weather ?? "unknown",
      hornOkIn: +Math.max(0, this.hornOkAt - this.ctx.currentTime).toFixed(1),
      ships: this.shipSounds.map((s) => ({ id: s.ship.id, kind: s.ship.kind, steam: s.ship.steam, d: Math.round(s.d), loop: !!s.voice, level: +s.level.toFixed(3) })),
      crowd: this.crowdN,
      rain: this.rain,
      rung: [...this.rung],
    };
  }

  get samplesLoaded(): number {
    return this.buf.size;
  }

  // ---------------------------------------------------------------- events (older)

  /** A boot in a puddle: a wet slap and a spray of water (made here: filtered noise). */
  splashStep(hurry: boolean, wet: number): void {
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.01;
    const len = 0.28;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      const k = i / d.length;
      // a sharp slap, then a hiss of drops falling back, patchy
      const env = Math.exp(-k * 14) * 0.9 + Math.exp(-k * 5) * 0.25 * (Math.random() < 0.35 ? 1 : 0.3);
      d[i] = (Math.random() * 2 - 1) * env;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rand(0.85, 1.15) * (hurry ? 1.1 : 1);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = rand(900, 1600);
    bp.Q.value = 0.7;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 3800;
    const g = ctx.createGain();
    g.gain.value = 0.32 * Math.min(1, wet) * (hurry ? 1.3 : 1);
    src.connect(bp).connect(lp).connect(g).connect(this.master);
    src.start(t);
  }

  footstep(surface: Surface, hurry: boolean, puddle = 0): void {
    const ctx = this.ctx;
    if (puddle > 0.3) this.splashStep(hurry, puddle);
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

  /** The foghorn far out on the river. Only in fog: in any other weather (or none yet) it stays silent. */
  foghorn(): void {
    if (this.weather !== "fog") return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.05;
    this.hornCount++;
    this.hornUsed();
    this.log("foghorn");
    // out on the river, 180-260 m off the quays; it carries (low rolloff), a long wet tail
    const spot = this.spot({ x: this.listenerPos.x + rand(-160, 160), z: rand(-260, -180), y: 5 }, 40, 0.6, 900, 1.6);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 520;
    lp.Q.value = 0.6;
    const env = ctx.createGain();
    env.gain.value = 0;
    lp.connect(env).connect(spot.fog);

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
      if (mult === 0.5) o.onended = () => this.dropSpot(spot);
    }
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(FOGHORN_GAIN, t + 0.6);
    env.gain.setValueAtTime(FOGHORN_GAIN, t + hold);
    env.gain.linearRampToValueAtTime(FOGHORN_GAIN * 0.8, t + hold + 0.5);
    env.gain.linearRampToValueAtTime(0, t + hold + 1.1);
  }

  gulls(): void {
    if (!this.gullBuf) return;
    const ctx = this.ctx;
    // over the water near you (they follow the river, not you inland)
    const spot = this.spot({ x: this.listenerPos.x + rand(-40, 40), z: rand(-45, -8), y: rand(8, 18) }, 8, 0.8, 200, 0.9, 3200);

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
    src.connect(env).connect(spot.fog);
    src.start(t, start, dur + 0.1);
    src.onended = () => this.dropSpot(spot);
  }

  /** Rope and timber creak from a ship near you: the recorded pulley, or the made one while it loads. */
  creak(): void {
    const rec = this.buf.get("pulleyCreak");
    const ship = this.nearest("ship", 60);
    if (rec && ship) {
      const dur = rand(1.8, 4);
      const start = rand(0, rec.duration - dur);
      this.slice(rec, { x: ship.x + rand(-6, 6), z: ship.z, y: ship.y ?? 1 }, start, start + dur, 0.45, rand(0.8, 1.0), 120, 5);
      return;
    }
    if (rec || !this.shipPositions.length) return; // no ship near: no creak
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

  // ---------------------------------------------------------------- loading

  private async decode(url: string): Promise<AudioBuffer | null> {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status}`);
      return await this.ctx.decodeAudioData(await res.arrayBuffer());
    } catch {
      this.failed.push(url);
      return null;
    }
  }

  /** The street sounds (audio/samples.ts). A file that fails stays silent. */
  private async loadSamples(): Promise<void> {
    await Promise.all(
      (Object.entries(SAMPLES) as Array<[SampleName, string]>).map(async ([name, url]) => {
        const b = await this.decode(url);
        if (b) this.buf.set(name, b);
      }),
    );
  }

  private async loadSteps(): Promise<void> {
    const files: Record<Surface, string> = { stone: "concrete", wood: "wood" };
    for (const surface of ["stone", "wood"] as const) {
      const loaded = await Promise.all(
        [0, 1, 2, 3, 4].map((n) => this.decode(`/audio/kenney-impact/footstep_${files[surface]}_00${n}.ogg`)),
      );
      this.steps[surface] = loaded.filter((b): b is AudioBuffer => b !== null);
    }
  }

  /** One-shot job sounds. All recorded, CC0 (assets/ATTRIBUTION.md). */
  private async loadFx(): Promise<void> {
    const k = (n: string) => `/audio/kenney-impact/${n}.ogg`;
    const sets: Record<string, string[]> = {
      thud_wood: [0, 1, 2].map((i) => k(`impactWood_heavy_00${i}`)),
      thud_soft: [0, 1, 2].map((i) => k(`impactSoft_heavy_00${i}`)),
      thud_plank: [0, 1, 2].map((i) => k(`impactPlank_medium_00${i}`)),
      splash: ["/audio/bigsoundbank/splash-big-1519.ogg"],
      bell: ["/audio/bigsoundbank/bell-5-oclock-3445.ogg"],
    };
    for (const [name, urls] of Object.entries(sets)) {
      const bufs = await Promise.all(urls.map((u) => this.decode(u)));
      this.fx.set(name, bufs.filter((b): b is AudioBuffer => b !== null));
    }
  }

  /**
   * Play a job sound. "lift" and "coins" reuse the thuds, played soft and
   * high. With a position it sits in the world; without, it is far off.
   */
  play(name: string, at?: THREE.Vector3): void {
    const ctx = this.ctx;
    let key = name;
    let rate = rand(0.9, 1.05);
    let vol = 0.9;
    if (name === "lift") [key, rate, vol] = ["thud_soft", rand(1.3, 1.5), 0.35];
    if (name === "coins") [key, rate, vol] = ["thud_plank", rand(2.6, 3.0), 0.25];
    const set = this.fx.get(key);
    if (!set?.length) return;
    const src = ctx.createBufferSource();
    src.buffer = set[Math.floor(Math.random() * set.length)];
    src.playbackRate.value = name === "bell" ? 1 : rate;
    const g = ctx.createGain();
    g.gain.value = name === "bell" ? 0.5 : vol;
    if (at) {
      const spot = this.spot(at, 2, 1.1, 150, name === "bell" ? 1.2 : 0.3);
      src.connect(g).connect(spot.fog);
      src.onended = () => this.dropSpot(spot);
    } else {
      // far off in the fog: dull it down
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = name === "bell" ? 1800 : 6000;
      src.connect(lp).connect(g).connect(this.master);
      const send = ctx.createGain();
      send.gain.value = name === "bell" ? 1.2 : 0.3;
      g.connect(send).connect(this.reverbIn);
    }
    src.start();
  }

  private async loadGulls(): Promise<void> {
    // no gulls if it fails; better silence than a bad fake
    this.gullBuf = await this.decode("/audio/bigsoundbank/gulls-harbor-2573-mono.ogg");
  }

  get gullsLoaded(): boolean {
    return this.gullBuf !== null;
  }

  get stepSamples(): number {
    return this.steps.stone.length + this.steps.wood.length;
  }

  // ---------------------------------------------------------------- made in code

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

  /** A swim stroke: an arm through the water, then the wash (made in code). */
  swimStroke(): void {
    const t = this.ctx.currentTime + 0.01;
    const out = this.ctx.createGain();
    out.gain.value = 0.7;
    out.connect(this.master);
    this.burst(t, rand(0.35, 0.55), "bandpass", rand(500, 900), 1.2, 0.35, out, 0.08);
    this.burst(t + 0.14, rand(0.3, 0.45), "lowpass", rand(350, 480), 0.7, 0.3, out, 0.05);
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
