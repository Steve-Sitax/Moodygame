import * as THREE from "three";
import { Organ } from "./organ";
import { singPhrase, type Note } from "./ballad";
import { workSound, type StreetWork } from "./cries";
import { playCue, type CueSpec } from "./eventcues";
import type { Surface } from "../world/rijnkaai";
import { water } from "../world/tide";
import { blockedMetres, cartRoutes, cityEmitters, nearestQuay, overWater, type Emitter, type EmitterKind } from "./emitters";
import { CARILLON_SHORT, DOG_SPANS, PUDDLE_SPANS, SAMPLES, TOOT_SPANS, type SampleName } from "./samples";

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
/**
 * How far sounds carry: fog dulls and softens everything far off. The foghorn only in fog (Steve).
 * `seen`: metres you can see a cart in the street in this weather; the unseen carts keep beyond it.
 */
const WEATHER_FAR: Record<Weather, { lp: number; gain: number; horn: number; seen: number }> = {
  fog: { lp: 1300, gain: 0.6, horn: 1, seen: 30 },
  mist: { lp: 2300, gain: 0.8, horn: 0, seen: 55 },
  clear: { lp: 6000, gain: 1, horn: 0, seen: 90 },
  rain: { lp: 2000, gain: 0.75, horn: 0, seen: 60 },
  storm: { lp: 1600, gain: 0.7, horn: 0, seen: 45 },
};
/** Before the first setWeather: a soft far bus and no foghorn (start silent, not "fog"). */
const WEATHER_UNKNOWN = { lp: 2300, gain: 0.8, horn: 0, seen: 55 };
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
  /** Past `reach` the cutoff falls as (reach / d) to this power (default 0.5; the bells go dull fast). */
  dull?: number;
  /** Audible radius: fades out from 0.6 of it and is silent beyond (Infinity: the bells). */
  max: number;
  /** How much the house blocks in the way muffle it: 1 at street level, less for the tower bells, 0 in the air. */
  occl: number;
  /** The last occlusion and where the listener and the sound were for it (recomputed after 1.5 m of movement). */
  occ?: { gain: number; lp: number; lx: number; lz: number; sx: number; sz: number };
  wetBase: number;
  fog: GainNode;
  lp: BiquadFilterNode;
  pan: PannerNode;
  wet: GainNode;
}
/**
 * Where the bells are hung: loud at the tower's foot (63 m below them). Fixes 2026-09-24 (Steve: "extremely
 * loud over the entire map; faint and dull from far"): they fall off fast past the cathedral square, go
 * dull past 100 m, and the echo does not make up for the distance any more.
 */
/**
 * Fixes 2026-09-24 again (Steve: "loud bells I do not see nearby"): measured -22 dBFS at 78 m in the back
 * streets, the loudest sound in town. Now ref 20 m, rolloff 1.5: 9 dB softer at 80 m, 7 dB at 165 m, and
 * the house blocks between you and the tower take up to 4 dB more (occl 0.4; the bells hang above the roofs).
 */
const BELL = { ref: 20, rolloff: 1.5, reach: 100, dull: 1.5, wet: 0.5, occl: 0.4 };
/** At most this many positioned sounds at once; past it, new far one-shots are skipped (nearest first). */
const SPOT_CAP = 28;
/** At most this many emitter loops, and this many vehicles, play at once: the nearest. */
const LOOP_CAP = 12;
const VEHICLE_CAP = 6;
/** A steam whistle or a liner's blast is not heard past this (metres). */
const WHISTLE_MAX = 380;
/**
 * Fixes 2026-09-24 (Steve: "only at appropriate hours"): the tune and the strokes on the hour from 7:00
 * to 21:00, the short phrase on the half hour from 7:30 to 20:30. The night is quiet.
 */
const BELL_HOURS = { from: 7, to: 21 };
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
  /** How much the house blocks in the way muffle it (default 1). */
  occl?: number;
}
/**
 * Talk follows the people (Steve 2026-09-25: "chatter is heard from too far; cafes chatter with nobody
 * there. One person no chatter, two when they are close, more chatter with more people"): 0 for one
 * person, a little for two, full by about sixteen.
 */
const chatter = (n: number): number => (n <= 1 ? 0 : Math.min(1, Math.sqrt((n - 1) / 15)));
/** A song wants a room: none below four people, full by ten. */
const singing = (n: number): number => ramp(n, 3, 10);
/** Two people this close (metres) can be talking to each other. */
const TALK_M = 3;
/** Crowd cues of an event that need people (a crowd's voices); a shout or a cry needs one. */
const GROUP_CUES = new Set(["cheer", "laughter", "applause", "hymn", "murmur"]);
const VOICE_CUES = new Set(["shout", "cry"]);
const LOOPS: Partial<Record<EmitterKind, LoopDef>> = {
  // Steve 2026-09-25 ("water sound is still everywhere; it needs to fade fast further from the
  // water"): the water under a bridge or a pontoon is heard on it and beside it, not a street away
  bridge: { layers: [["waterBridge", 0.7]], radius: 7, ref: 2, rolloff: 2, wet: 0.3 },
  pontoon: { layers: [["waterPontoon", 1.1]], radius: 8, ref: 2, rolloff: 2, wet: 0.2 },
  smithy: { layers: [["anvil", 0.6]], radius: 80, ref: 4, rolloff: 1.1, wet: 0.35 },
  ship: { layers: [["shipCreak", 0.3]], radius: 30, ref: 3, rolloff: 1.4, wet: 0.2 },
  // Steve 2026-09-25: a tavern's talk through its door is heard in front of it, not a street away (was 45 m)
  tavern: { layers: [["tavernCrowd", 0.5], ["tavernSong", 0.55]], radius: 20, ref: 3, rolloff: 1.4, lowpass: 750, wet: 0.15 },
  market: { layers: [["market", 0.6]], radius: 50, ref: 6, rolloff: 1.1, wet: 0.2 },
  lamp: { layers: [["hiss", 0.012]], radius: 12, ref: 0.6, rolloff: 2.2, occl: 0 },
};
/** A horse and cart: hooves on the setts and iron-shod wheels, on one panner; gone by 60 m. */
const CART: LoopDef = { layers: [["hooves", 0.9], ["wheels", 0.55]], radius: 60, ref: 4, rolloff: 1.2, wet: 0.25 };
/** A handcart: just the wheels, smaller; gone by 40 m. */
const HANDCART: LoopDef = { layers: [["wheels", 0.4]], radius: 40, ref: 2.5, rolloff: 1.2, wet: 0.2 };

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
const PADDLE_LOOP: LoopDef = { layers: [["paddleWheels", 0.8], ["shipEngine", 0.3]], radius: 120, ref: 6, rolloff: 1, lowpass: 6000, wet: 0.3 };
const SCREW_LOOP: LoopDef = { layers: [["shipEngine", 0.6], ["waterBridge", 0.35]], radius: 120, ref: 6, rolloff: 1, lowpass: 6000, wet: 0.3 };
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
  /** Each layer's own gain (a tavern's song follows its people apart from the talk). */
  layers: Array<{ name: SampleName | "hiss"; base: number; g: GainNode }>;
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
  /** M6: the street's own master (master points at the room bus only inside `indoors`). */
  private street: GainNode;
  private streetLp: BiquadFilterNode;
  private room: GainNode;
  private roomKind: string | null = null;
  /** M6 landmark interiors: a long hall's echo (the cathedral, the town hall, the vaults), and the organ. */
  private hallVerb: ConvolverNode;
  private hallSend: GainNode;
  private hallBufs = new Map<string, AudioBuffer>();
  private organSynth: Organ | null = null;
  private roomBeds: AudioScheduledSourceNode[] = [];
  /** The room's talk and song beds: their gains follow how many people are in the room (setRoomPeople). */
  private roomBedGains: Array<{ name: SampleName; base: number; g: GainNode }> = [];
  /** People in the room Jef is in (null: nobody counted them, e.g. a hall with no people list). */
  private roomPeople: number | null = null;
  /** People in each building whose life the game runs now (a tavern by its house id): its door's talk follows. */
  private placePeople = new Map<string, number>();
  /** Everyone walking about, as setCrowdAround last had them (the market and event voices count them). */
  private people: ReadonlyArray<{ x: number; z: number }> = [];
  /** Event murmurs: their people gain follows who stands near them. */
  private crowdSpots = new Set<{ spot: Spot; g: GainNode }>();
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
  /** The last node before the speakers: silent on test copies (see the constructor). */
  readonly speaker: GainNode;
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
  private lastSplash = -1;
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
    // M6 interiors: the street goes through a lowpass (the walls, when you are inside); the room
    // you stand in has its own bus with a short, close reverb (setInterior, indoors)
    this.streetLp = this.ctx.createBiquadFilter();
    this.streetLp.type = "lowpass";
    this.streetLp.frequency.value = 20000;
    // Steve 2026-09-25 ("something in the background makes sounds; I closed my browser and the
    // sounds stayed"): test copies (tools/teststack.mjs, any port but his game's 5173) play to no
    // speaker. Everything before this node still runs, so a check can measure it; a check that
    // must be heard sets `__scheldemist.sound.speaker.gain.value = 1`.
    this.speaker = this.ctx.createGain();
    this.speaker.gain.value = typeof location !== "undefined" && location.port && location.port !== "5173" ? 0 : 1;
    comp.connect(this.speaker).connect(this.ctx.destination);
    this.master.connect(this.streetLp).connect(comp);
    this.street = this.master;
    this.room = this.ctx.createGain();
    this.room.connect(comp);
    const roomVerb = this.ctx.createConvolver();
    roomVerb.buffer = this.impulse(0.7, 5);
    const roomSend = this.ctx.createGain();
    roomSend.gain.value = 0.22;
    this.room.connect(roomSend).connect(roomVerb).connect(comp);
    this.hallVerb = this.ctx.createConvolver();
    this.hallSend = this.ctx.createGain();
    this.hallSend.gain.value = 0;
    this.room.connect(this.hallSend).connect(this.hallVerb).connect(comp);

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

  /**
   * M6 interiors (game/interiors.ts): inside a tavern or the Poesje's cellar the street is
   * heard through the walls (low and dull), and the room has its own sound, close and clear:
   * the tavern's crowd and song (the same CC0 loops the street hears muffled at the door),
   * the cellar's audience murmuring. null: back out in the street.
   */
  setInterior(kind: string | null): void {
    if (kind === this.roomKind) return;
    this.roomKind = kind;
    const t = this.ctx.currentTime;
    for (const b of this.roomBeds) b.stop(t + 0.3);
    this.roomBeds = [];
    this.roomBedGains = [];
    // a new room starts quiet: its talk comes up as its people are counted (not the last room's)
    this.roomPeople = null;
    // M6 landmarks: a hall of its own size (seconds of echo, how much of it); the cathedral lets the bells through
    const HALLS: Record<string, [number, number, number, number, number]> = {
      // echo s, decay, send, street lowpass Hz, street gain
      church: [4.8, 2.2, 0.62, 900, 0.5],
      hall: [1.9, 3, 0.34, 480, 0.35],
      vault: [1.6, 3, 0.36, 380, 0.3],
      museum: [2.2, 2.8, 0.4, 420, 0.32],
      store: [1.7, 3, 0.3, 460, 0.35],
    };
    const hall = kind ? HALLS[kind] : undefined;
    if (hall) {
      let b = this.hallBufs.get(kind!);
      if (!b) this.hallBufs.set(kind!, (b = this.impulse(hall[0], hall[1])));
      this.hallVerb.buffer = b;
    }
    this.hallSend.gain.setTargetAtTime(hall ? hall[2] : 0, t, 0.2);
    if (kind !== "church") this.organ(false);
    this.streetLp.frequency.setTargetAtTime(hall ? hall[3] : kind ? 420 : 20000, t, 0.12);
    this.street.gain.setTargetAtTime(hall ? hall[4] : kind ? 0.4 : 0.9, t, 0.12);
    const beds: Array<[SampleName, number]> =
      kind === "tavern" ? [["tavernCrowd", 0.55], ["tavernSong", 0.32]] : kind === "cellar" ? [["murmur", 0.3]] : kind === "church" ? [["murmur", 0.05]] : kind === "hall" ? [["murmur", 0.08]] : [];
    for (const [name, gain] of beds) {
      const b = this.buf.get(name);
      if (!b) continue;
      const src = this.ctx.createBufferSource();
      src.buffer = b;
      src.loop = true;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain * this.roomLevel(name), t + 0.6);
      src.connect(g).connect(this.room);
      src.start(t, Math.random() * b.duration);
      this.roomBeds.push(src);
      this.roomBedGains.push({ name, base: gain, g });
    }
  }

  /** How loud a room bed is for the people in the room now: talk from two, a song from four and in the evening. */
  private roomLevel(name: SampleName): number {
    const n = this.roomPeople ?? 0;
    return name === "tavernSong" ? singing(n) * this.songHours() : chatter(n);
  }

  /** Taverns sing from six in the evening to two at night. */
  private songHours(): number {
    const h = this.hourNow;
    return h >= 18 ? ramp(h, 18, 20) : h < 2 ? 1 - ramp(h, 0.5, 2) : 0;
  }

  /** How many people are in the room Jef is in (main.ts, from interiors and landmarks); null: none counted. */
  setRoomPeople(n: number | null): void {
    this.roomPeople = n === null ? null : Math.max(0, n);
  }

  /**
   * How many people are in the building whose life runs now (a tavern's house id; null: none runs):
   * the talk at its door follows. Only one runs at a time, so the others count as empty.
   */
  setPlacePeople(id: string | null, n: number): void {
    if (id === null) {
      this.placePeople.clear();
      return;
    }
    if (this.placePeople.size > 1 || (this.placePeople.size === 1 && !this.placePeople.has(id))) this.placePeople.clear();
    this.placePeople.set(id, Math.max(0, n));
  }

  /** M6 landmarks: the organ in the cathedral (a chord bed made in code), on or off. */
  organ(on: boolean, level = 1): void {
    if (!on && !this.organSynth) return;
    this.organSynth ??= new Organ(this.ctx, [this.room, this.hallSend]);
    this.organSynth.set(on, level);
  }

  /** M6 landmarks: the small bell at the altar (the elevation). */
  altarBell(): void {
    this.organSynth ??= new Organ(this.ctx, [this.room, this.hallSend]);
    this.organSynth.bell([this.room, this.hallSend]);
  }

  /** Dev: is the organ playing? */
  get organOn(): boolean {
    return this.organSynth?.on ?? false;
  }

  /** Run `fn` with its one-shot sounds (steps, voices) in the room, not out in the street. */
  indoors(fn: () => void): void {
    const m = this.master;
    this.master = this.room;
    try {
      fn();
    } finally {
      this.master = m;
    }
  }

  /** Dev: the room sound now. */
  get interior(): string | null {
    return this.roomKind;
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
    const at = (halfNow / 2) % 24;
    if (at >= BELL_HOURS.from && at <= BELL_HOURS.to) {
      if (halfNow % 2 === 0) this.hourBells(halfNow / 2);
      else this.carillon(true);
    }
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

  /**
   * The people walking about (crowd.positions()): the murmur follows how many near you are talking,
   * that is, stand within TALK_M of someone else. Each counts in full within 5 m and not at all past
   * 18 m. One person alone makes no murmur (Steve 2026-09-25; before, everyone within 30 m counted).
   * The list is kept for the market and the events' voices (read in the same frame).
   */
  setCrowdAround(people: ReadonlyArray<{ x: number; z: number }>): void {
    this.people = people;
    this.crowdN = this.talkers(this.listenerPos.x, this.listenerPos.z, 5, 18);
  }

  /** People near (x, z) with someone to talk to: full within `near` m, none past `far` m. */
  private talkers(x: number, z: number, near: number, far: number): number {
    const box = far + TALK_M;
    const close: Array<{ x: number; z: number }> = [];
    for (const p of this.people) {
      const dx = p.x - x;
      const dz = p.z - z;
      if (dx <= box && dx >= -box && dz <= box && dz >= -box) close.push(p);
    }
    let n = 0;
    for (let i = 0; i < close.length; i++) {
      const a = close[i];
      const d = Math.hypot(a.x - x, a.z - z);
      if (d >= far) continue;
      let partner = false;
      for (let j = 0; j < close.length && !partner; j++) {
        if (j !== i && Math.abs(close[j].x - a.x) < TALK_M && Math.abs(close[j].z - a.z) < TALK_M && Math.hypot(close[j].x - a.x, close[j].z - a.z) < TALK_M) partner = true;
      }
      if (partner) n += 1 - ramp(d, near, far);
    }
    return n;
  }

  /** People within `r` m of (x, z), each in full. */
  private peopleNear(x: number, z: number, r: number): number {
    let n = 0;
    for (const p of this.people) {
      const dx = p.x - x;
      const dz = p.z - z;
      if (dx * dx + dz * dz < r * r) n++;
    }
    return n;
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
    // only the nearest few rolling ones get a voice (VEHICLE_CAP)
    const near: number[] = [];
    for (const v of list) {
      const d = Math.hypot(v.x - px, v.z - pz);
      if (v.state === "go" && d < (v.kind === "dray" ? CART : HANDCART).radius) near.push(d);
    }
    near.sort((a, b) => a - b);
    const within = near.length > VEHICLE_CAP ? near[VEHICLE_CAP - 1] : Infinity;
    list.forEach((v, i) => {
      let slot = this.vehicles[i];
      if (!slot || slot.v.kind !== v.kind) {
        if (slot) this.stopVoice(slot.voice);
        slot = this.vehicles[i] = { v, voice: null };
      }
      slot.v = v;
      const def = v.kind === "dray" ? CART : HANDCART;
      const d = Math.hypot(v.x - px, v.z - pz);
      const capped = d > within;
      const on = d < def.radius && !capped;
      if (on && !slot.voice) slot.voice = this.startVoice({ x: v.x, z: v.z, y: 1 }, def);
      if (!slot.voice) return;
      if ((!on && d > def.radius + 10) || capped) {
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
        // the talk follows the people inside (setPlacePeople), at any hour it is open; the song keeps its hours
        return 1;
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
    // M6 tides: the lapping is down at the water, wherever the tide has it (world/tide.ts)
    this.waterPanner.positionY.value = Math.min(water.river + 0.2, this.listenerPos.y - 0.4);

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
    // the water bed: its panner falls off from the quay edge; past 40 m it fades out (silent by 110 m),
    // and a row of houses between you and the edge muffles it (you hear the water you can see)
    const wx = this.waterPanner.positionX.value;
    const wz = this.waterPanner.positionZ.value;
    const wOcc = this.quayDist > 0 ? this.occlusion(wx, wz, 1).gain : 1;
    // Steve 2026-09-25: "110 is far. 5 metres at best": full at the edge, gone 6 m from it
    const wFar = 1 - ramp(this.quayDist, 1, 6);
    this.waterGain.gain.setTargetAtTime(0.5 * (1 + 0.4 * night) * wOcc * wFar, now, tau);
    // Steve 2026-09-24 ("water sounds are always very loud"): the loudest steady sound in town was
    // this low wind rumble (about -30 dB, above everything near him), and low noise reads as
    // rushing water. Now about 10 dB down in the streets, a little more by open water.
    const byWater = 1 - ramp(this.quayDist, 15, 120);
    this.windGain.gain.setTargetAtTime((0.3 + 0.15 * night) * (0.65 + 0.35 * byWater), now, tau);
    // wind in the rigging: by the ships (the canals have no masts), gone a street or two inland
    let dShip = Infinity;
    for (const sp of this.shipPositions) dShip = Math.min(dShip, Math.hypot(sp.x - this.listenerPos.x, sp.z - this.listenerPos.z));
    const byShips = 1 - ramp(dShip, 25, 100);
    this.windRec.gain.setTargetAtTime((0.04 + 0.06 * night + 0.04 * this.rain) * byShips, now, tau);
    for (const sp of this.spots) this.tuneSpot(sp, now, false);
    this.murmurGain.gain.setTargetAtTime(0.22 * chatter(this.crowdN) * (1 - 0.3 * this.rain), now, 1.5);
    // the room's talk and song follow the people in it
    for (const b of this.roomBedGains) b.g.gain.setTargetAtTime(b.base * this.roomLevel(b.name), now, 1.2);
    // an event's murmur follows the people standing near it
    for (const c of this.crowdSpots) c.g.gain.setTargetAtTime(chatter(this.peopleNear(c.spot.x, c.spot.z, 15)), now, 1.2);
    this.rainRoofGain.gain.setTargetAtTime(0.4 * this.rain, now, 1.5);
    this.rainCobbleGain.gain.setTargetAtTime(1.1 * this.rain, now, 1.5);

    if (now > this.smithyNext) {
      this.smithyOn = !this.smithyOn;
      this.smithyNext = now + (this.smithyOn ? rand(20, 45) : rand(6, 18));
    }

    const px = this.listenerPos.x;
    const pz = this.listenerPos.z;
    // the loops within their radius, nearest first: only LOOP_CAP of them sound at once
    const cands: Array<{ l: Live; def: LoopDef; d: number; level: number }> = [];
    for (const l of this.live) {
      const def = LOOPS[l.e.kind];
      if (!def) continue;
      const d = Math.hypot(l.e.x - px, l.e.z - pz);
      const edge = 1 - ramp(d, def.radius * 0.7, def.radius);
      let level = d < def.radius ? this.kindLevel(l.e.kind) * (l.e.gain ?? 1) * edge : 0;
      // talk needs people: a tavern's by who is inside (unknown: nobody), the market's by who stands there
      if (level > 0 && l.e.kind === "tavern") level *= chatter(l.e.id ? (this.placePeople.get(l.e.id) ?? 0) : 0);
      else if (level > 0 && l.e.kind === "market") level *= chatter(this.peopleNear(l.e.x, l.e.z, 25));
      if (level > 0.001 || l.voice) cands.push({ l, def, d, level });
      else l.level = 0;
    }
    cands.sort((a, b) => a.d - b.d);
    let playing = 0;
    for (const { l, def, d, level: want } of cands) {
      const room = want > 0.001 && playing < LOOP_CAP;
      if (room) playing++;
      const level = room ? want : 0;
      if (room && !l.voice) l.voice = this.startVoice(l.e, def);
      if (l.voice) {
        if (level <= 0.001 && (d > def.radius + 10 || want > 0.001)) {
          // out of reach, or pushed out by nearer loops
          this.stopVoice(l.voice);
          l.voice = null;
        } else if (Math.abs(level - l.level) > 0.002 || l.level === 0) {
          l.voice.gain.gain.setTargetAtTime(level, now, 0.6);
        }
        // a tavern sings only with a room full enough, in the evening
        if (l.voice && l.e.kind === "tavern") {
          const song = singing(l.e.id ? (this.placePeople.get(l.e.id) ?? 0) : 0) * this.songHours();
          for (const ly of l.voice.layers) if (ly.name === "tavernSong") ly.g.gain.setTargetAtTime(ly.base * song, now, 0.8);
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
    const spot = this.spot(e, def.ref, def.rolloff, def.reach ?? 150, def.wet ?? 0, def.lowpass, this.street, def.radius, def.occl ?? 1);
    const panner = spot.pan;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(spot.fog);
    const head: AudioNode = gain;
    const srcs: AudioScheduledSourceNode[] = [];
    const lgs: Voice["layers"] = [];
    for (const [name, g] of layers) {
      const src = ctx.createBufferSource();
      src.loop = true;
      const lg = ctx.createGain();
      lg.gain.value = g;
      lgs.push({ name, base: g, g: lg });
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
    return { srcs, layers: lgs, gain, panner, spot };
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
   * Horses and carts walk their streets, heard but never seen: nearer than you can
   * see in this weather (WEATHER_FAR seen: 30 m in fog, 90 m on a clear day) they
   * fall silent (a cart you could see but not find would be wrong). Day only, a stray
   * one at night.
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
      // only beyond what you can see in this weather (fixes 2026-09-24: on a clear day they rolled 37 m
      // off in an empty street); on a clear day that is past the cart's own radius, so they are silent
      const seen = this.weatherFar().seen;
      const level = d < CART.radius && !real ? (0.1 + 0.9 * this.dayness) * ramp(d, seen, seen + 12) * (1 - 0.3 * this.rain) : 0;
      if (level > 0.001 && !c.voice) c.voice = this.startVoice({ x: c.x, z: c.z, y: 1 }, CART);
      if (c.voice) {
        if (level <= 0.001 && (d > CART.radius + 10 || d < seen)) {
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
        if (s.d < WHISTLE_MAX && now > s.nextCall && this.hornFree()) {
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
    this.slice(bell, { x: keeper.x, z: keeper.z, y: 3 }, 0, len, 0.7, rand(0.95, 1.05), 300, 4, dur + rand(1.5, 3), 150);
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
    // fixes 2026-09-24 (Steve: loud things far off): ref 25-40 m made a blast 480 m off, behind the old
    // town, as loud as the wind; now ref 7-10 m, silent past WHISTLE_MAX, muffled half by the houses
    let dur: number;
    if (why === "signal") {
      const l = 2.2 / rate;
      this.slice(long, at, 0, 2.2, 0.8, rate, out, 9, delay, WHISTLE_MAX, 0.5);
      this.slice(long, at, 0, 0.6, 0.8, rate, out, 9, delay + l + 0.7, WHISTLE_MAX, 0.5);
      dur = l + 0.7 + 0.6 / rate;
    } else if (tug && toots) {
      const n = why === "greet" ? 1 : Math.random() < 0.5 ? 2 : 3;
      let t = delay;
      for (let i = 0; i < n; i++) {
        const [a, b] = TOOT_SPANS[i % TOOT_SPANS.length];
        this.slice(toots, at, a, b, 0.75, rate, out, 7, t, WHISTLE_MAX, 0.5);
        t += (b - a) / rate + 0.35;
      }
      dur = t - delay;
    } else {
      const len = why === "greet" ? rand(1.6, 2.4) : rand(3.2, 4.6);
      this.slice(long, at, 0, len, 0.85, rate, out, 10, delay, WHISTLE_MAX, 0.5);
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
      this.slice(b, { x: ship.x, z: ship.z, y: 4 }, 0, first ? b.duration : 1.6, 0.5, 0.9, out, 4, t, 150);
      t += first ? hold : 0.45;
    }
    this.log(`ship's bell ${ship.kind}`);
  }

  /** An order called on deck. */
  private shoutAt(ship: MovingShip): void {
    const b = this.buf.get("heaveShout");
    if (!b) return;
    this.slice(b, { x: ship.x, z: ship.z, y: 3 }, 0, b.duration, 0.6, rand(0.88, 1.0), 200, 3, 0, 80);
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
    const spot = this.bellSpot(cat);
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
    const spot = this.bellSpot(cat);
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
    const spot = this.spot({ x: ship.x + rand(-4, 4), z: ship.z + rand(-4, 4), y: 4 }, 4, 1, 300, 0.6, 14000, this.master, 180);
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

  // ---------------------------------------------------------------- M4: speech and the events' sounds

  /**
   * A voice without words (M4 bubbles): noise and a glottal sawtooth through two
   * vowel formants, 4-6 syllables a second, a pause now and then. Men 110 Hz,
   * women 210, children 280, the old a tenth lower. Through the fog and the air
   * like every placed sound (spot: ref 2, rolloff 1.2, reach 40).
   */
  speech(at: { x: number; z: number }, voice: { sex: "m" | "f"; age: number }, seconds: number): void {
    const ctx = this.ctx;
    const dur = Math.max(0.5, Math.min(6, seconds));
    const t0 = ctx.currentTime + 0.02;
    if (this.distTo(at.x, 1.6, at.z) > 35) return;
    const spot = this.spot({ x: at.x, z: at.z, y: 1.6 }, 2, 1.2, 40, 0.25, 14000, this.master, 35);
    const out = ctx.createGain();
    out.gain.value = 0.16;
    out.connect(spot.fog);
    const child = voice.age < 13;
    const f0 = (child ? 280 : voice.sex === "f" ? 210 : 110) * (voice.age >= 60 ? 0.9 : 1) * rand(0.93, 1.07);
    const scale = child ? 1.3 : voice.sex === "f" ? 1.15 : 1;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(f0, t0);
    const breath = ctx.createBufferSource();
    breath.buffer = this.noise;
    breath.loop = true;
    const bGain = ctx.createGain();
    bGain.gain.value = 0.3;
    const mix = ctx.createGain();
    mix.gain.value = 0.8;
    osc.connect(mix);
    breath.connect(bGain).connect(mix);
    const f1 = ctx.createBiquadFilter();
    f1.type = "bandpass";
    f1.Q.value = 6;
    const f2 = ctx.createBiquadFilter();
    f2.type = "bandpass";
    f2.Q.value = 9;
    const env = ctx.createGain();
    env.gain.value = 0;
    mix.connect(f1).connect(env);
    mix.connect(f2).connect(env);
    env.connect(out);
    const VOWELS: Array<[number, number]> = [[730, 1090], [270, 2290], [530, 1840], [570, 840], [300, 870], [660, 1720], [440, 1020]];
    let t = t0;
    let n = 0;
    let nextPause = 3 + Math.floor(rand(0, 4));
    while (t < t0 + dur) {
      const len = 1 / rand(4, 6);
      const v = pick(VOWELS);
      f1.frequency.setTargetAtTime(v[0] * scale, t, 0.02);
      f2.frequency.setTargetAtTime(v[1] * scale, t, 0.02);
      osc.frequency.setTargetAtTime(f0 * rand(0.88, 1.18), t, 0.05);
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(1, t + 0.03);
      env.gain.linearRampToValueAtTime(0.6, t + len * 0.6);
      env.gain.linearRampToValueAtTime(0, t + len * 0.92);
      t += len;
      if (++n >= nextPause) {
        t += rand(0.12, 0.3);
        n = 0;
        nextPause = 3 + Math.floor(rand(0, 4));
      }
    }
    osc.start(t0);
    breath.start(t0);
    osc.stop(t + 0.1);
    breath.stop(t + 0.1);
    osc.onended = () => this.dropSpot(spot);
  }

  /**
   * M6 ballads: a line of a ballad, sung (audio/ballad.ts): the tune's notes, a beat each, from a
   * voice made in code at a point, louder than talk and carrying further (reach 55 m).
   * Indoors (a tavern) run it through indoors(). Returns the seconds it lasts.
   */
  /**
   * M6 lively (audio/cries.ts): the sound of a street trade at a point for some seconds: the knife
   * grinder's stone, the mussel seller's rattle, the milk cans, a brush scrubbing the step.
   */
  streetWork(kind: StreetWork, at: { x: number; z: number }, seconds: number): void {
    const max = kind === "rattle" ? 50 : 40;
    if (this.distTo(at.x, 1, at.z) > max) return;
    const spot = this.spot({ x: at.x, z: at.z, y: 1.0 }, 2, 1.3, kind === "rattle" ? 45 : 30, 0.25, 14000, this.master, max);
    const out = this.ctx.createGain();
    out.gain.value = kind === "scrub" ? 0.12 : 0.22;
    out.connect(spot.fog);
    workSound(this.ctx, out, this.noise, kind, seconds, () => this.dropSpot(spot));
  }

  sing(at: { x: number; z: number }, voice: { sex: "m" | "f"; age: number }, notes: Note[], beat: number): number {
    const ctx = this.ctx;
    const spot = this.spot({ x: at.x, z: at.z, y: 1.6 }, 3, 1.1, 55, 0.3, 14000, this.master, 60);
    const out = ctx.createGain();
    out.gain.value = 0.2;
    out.connect(spot.fog);
    const child = voice.age < 13;
    const f0 = (child ? 262 : voice.sex === "f" ? 220 : 131) * (voice.age >= 60 ? 0.94 : 1);
    const t0 = ctx.currentTime + 0.03;
    const end = singPhrase(ctx, out, this.noise, { f0, formant: child ? 1.3 : voice.sex === "f" ? 1.15 : 1, notes, beat, t0 }, () => this.dropSpot(spot));
    this.log("ballad line");
    return end - t0;
  }

  /**
   * An event's sound at a place for some seconds (M4 events.ts): bells (the
   * cathedral's carillon and three strokes), music (the tavern song, a loop),
   * murmur (walla), or a handbell rung ahead of a procession. Returns a handle to
   * move it (a procession) or stop it early. Nothing new recorded: all CC0 samples
   * already in the game.
   */
  eventSound(kind: "bells" | "music" | "murmur" | "handbell" | "alarm", at: { x: number; z: number }, seconds: number): { move(x: number, z: number): void; stop(): void } {
    const ctx = this.ctx;
    const secs = Math.max(4, Math.min(180, seconds));
    // M6 town life: the fire alarm, the same big bell struck fast and hard at one pitch, no rounds
    const alarm = kind === "alarm";
    if (kind === "bells" || alarm) {
      // a festive peal from the tower: the big bell struck quickly at six pitches in rounds,
      // a sound the hourly carillon never makes (the recorded stroke, played at different rates)
      const b = this.buf.get("hourStroke");
      const cat = this.cathedral();
      if (!b || !cat) return { move: () => {}, stop: () => {} };
      this.log("event peal");
      const spot = this.bellSpot(cat);
      // every stroke through one gain, so stop() can fade the peal out and silence the strokes still to come
      const out = ctx.createGain();
      out.connect(spot.fog);
      const srcs: AudioBufferSourceNode[] = [];
      const rates = alarm ? [1.18, 1.18, 1.18, 1.18, 1.18, 1.18] : [1.5, 1.34, 1.2, 1.12, 1.0, 0.9];
      const t0 = ctx.currentTime + 0.05;
      const n = Math.floor(Math.min(secs, 40) / 0.34);
      let last: AudioBufferSourceNode | null = null;
      for (let i = 0; i < n; i++) {
        const round = Math.floor(i / rates.length);
        // every other round the order changes a little, as ringers do
        const k = round % 2 ? [1, 0, 3, 2, 5, 4][i % 6] : i % 6;
        const src = ctx.createBufferSource();
        src.buffer = b;
        src.playbackRate.value = rates[k];
        const g = ctx.createGain();
        g.gain.value = 0.55;
        src.connect(g).connect(out);
        src.start(t0 + i * 0.34 + (alarm ? 0 : round * 0.4), 0, 2.2); // a breath between rounds (not in an alarm)
        srcs.push(src);
        last = src;
      }
      if (last) last.onended = () => this.dropSpot(spot);
      let stopped = false;
      return {
        move: () => {},
        stop: () => {
          if (stopped) return;
          stopped = true;
          const now = ctx.currentTime;
          out.gain.cancelScheduledValues(now);
          out.gain.setValueAtTime(out.gain.value, now);
          out.gain.linearRampToValueAtTime(0, now + 1);
          for (const q of srcs) {
            try {
              q.stop(now + 1.05); // the last one's onended drops the spot
            } catch {
              // already over
            }
          }
        },
      };
    }
    if (kind === "handbell") {
      const bell = this.buf.get("handbell");
      const spot = this.spot({ x: at.x, z: at.z, y: 1.8 }, 3, 1.2, 120, 0.5, 14000, this.master, 90);
      let on = true;
      let n = 0;
      const ring = () => {
        if (!on || !bell || n++ * 2.6 > secs) return void this.dropSpot(spot);
        const src = ctx.createBufferSource();
        src.buffer = bell;
        src.playbackRate.value = rand(0.95, 1.05);
        const g = ctx.createGain();
        g.gain.value = 0.55;
        src.connect(g).connect(spot.fog);
        src.start(ctx.currentTime + 0.02, 0, 2.4);
        src.onended = () => ring();
      };
      ring();
      return { move: (x, z) => this.moveSpot(spot, x, z), stop: () => (on = false) };
    }
    const b = this.buf.get(kind === "music" ? "tavernSong" : "murmur");
    if (!b) return { move: () => {}, stop: () => {} };
    // a murmur is talk: heard near the gathering (35 m, was 90), and only as loud as the people there make it
    const murmur = kind === "murmur";
    const spot = murmur ? this.spot({ x: at.x, z: at.z, y: 1.5 }, 3, 1.4, 30, 0.3, 14000, this.master, 35) : this.spot({ x: at.x, z: at.z, y: 1.5 }, 3, 1.2, 70, 0.3, 14000, this.master, 90);
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.loop = true;
    const g = ctx.createGain();
    const level = kind === "music" ? 0.5 : 0.7;
    const t = ctx.currentTime + 0.02;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 2);
    g.gain.setValueAtTime(level, t + secs - 2);
    g.gain.linearRampToValueAtTime(0, t + secs);
    let crowd: { spot: Spot; g: GainNode } | null = null;
    if (murmur) {
      const pg = ctx.createGain();
      pg.gain.value = chatter(this.peopleNear(at.x, at.z, 15));
      g.connect(pg).connect(spot.fog);
      this.crowdSpots.add((crowd = { spot, g: pg }));
    } else g.connect(spot.fog);
    src.connect(g);
    src.start(t);
    src.stop(t + secs + 0.05);
    src.onended = () => {
      if (crowd) this.crowdSpots.delete(crowd);
      this.dropSpot(spot);
    };
    this.log(`event ${kind}`);
    return {
      move: (x, z) => this.moveSpot(spot, x, z),
      stop: () => {
        const now = ctx.currentTime;
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(g.gain.value, now);
        g.gain.linearRampToValueAtTime(0, now + 1);
        src.stop(now + 1.05);
      },
    };
  }

  /**
   * The sound of an event's stage as the director composed it (Steve, 2026-09-24: "let AI create
   * sounds at events"): each cue fires at the place, then again every `every_s` seconds (a little
   * uneven, as life is) until the stage ends or `stop()`. The cues themselves are made in
   * audio/eventcues.ts: voices, a fiddle, a drum, glass, wood, fire in code; the bells, hooves
   * and the dog from the CC0 recordings already in the game. Returns a handle to move or stop it.
   */
  eventCues(cues: CueSpec[], at: { x: number; z: number }, seconds: number): { move(x: number, z: number): void; stop(): void } {
    const ctx = this.ctx;
    const secs = Math.max(4, Math.min(180, seconds));
    const spot = this.spot({ x: at.x, z: at.z, y: 1.5 }, 3, 1.15, 75, 0.3, 14000, this.master, 100);
    const out = ctx.createGain();
    out.gain.value = 0.9;
    out.connect(spot.fog);
    let on = true;
    const timers: number[] = [];
    const endAt = performance.now() + secs * 1000;
    for (const c of cues.slice(0, 4)) {
      const fire = () => {
        if (!on) return;
        // Jef far off: this hit is skipped (nobody hears it), the next one still comes
        const d = this.distTo(spot.x, spot.y, spot.z);
        // a crowd's voices need a crowd there and are heard near it; a shout or a cry needs someone (Steve 2026-09-25)
        const group = GROUP_CUES.has(c.source);
        const one = VOICE_CUES.has(c.source);
        const people = group || one ? this.peopleNear(spot.x, spot.z, 15) : 0;
        const level = group ? chatter(people) : one ? (people >= 1 ? 1 : 0) : 1;
        const far = d > (group ? 35 : one ? 60 : spot.max) || level <= 0;
        let len = 0;
        if (!far) {
          const hit = ctx.createGain();
          hit.gain.value = level;
          hit.connect(out);
          len = playCue(ctx, hit, this.noise, this.buf, c, ctx.currentTime + 0.03);
          this.log(`cue ${c.source}`);
        }
        if (c.every_s <= 0) return;
        const wait = Math.max(c.every_s * rand(0.75, 1.3), len + 0.6);
        if (performance.now() + wait * 1000 < endAt) timers.push(window.setTimeout(fire, wait * 1000));
      };
      timers.push(window.setTimeout(fire, rand(0.2, 2.5) * 1000));
    }
    const stop = () => {
      if (!on) return;
      on = false;
      for (const t of timers) clearTimeout(t);
      // the last hits ring out before the spot goes
      window.setTimeout(() => this.dropSpot(spot), 12_000);
    };
    timers.push(window.setTimeout(stop, secs * 1000));
    return { move: (x, z) => this.moveSpot(spot, x, z), stop };
  }

  // ---------------------------------------------------------------- street events

  /** A dog far off, inland. */
  dog(): void {
    const b = this.buf.get("dogFar");
    if (!b) return;
    // fixes 2026-09-24: the old z = |z + ...| + 10 folded a far point back next to you (a bark 27 m
    // off, the loudest sound in the street); now a point on land 50-100 m off, or no bark
    const at = this.farOnLand(50, 100);
    if (!at) return;
    const [a, e] = pick(DOG_SPANS);
    this.slice(b, { ...at, y: 2 }, a, e, 1, rand(0.95, 1.05), 300, 3, 0, 110);
  }

  /** A point on land (inside the map, not over the water) some metres from the listener, or null. */
  private farOnLand(near: number, far: number): { x: number; z: number } | null {
    for (let i = 0; i < 10; i++) {
      const a = rand(0, Math.PI * 2);
      const d = rand(near, far);
      const x = this.listenerPos.x + Math.cos(a) * d;
      const z = this.listenerPos.z + Math.sin(a) * d;
      if (z > 2 && z < 300 && x > -340 && x < 200 && !overWater(x, z)) return { x, z };
    }
    return null;
  }

  /** A steam whistle from a boat on the river. */
  steamWhistle(): void {
    const name: SampleName = Math.random() < 0.5 ? "steamWhistleFar" : "steamboatWhistle";
    const b = this.buf.get(name);
    if (!b) return;
    const pos = { x: this.listenerPos.x + rand(-250, 250), z: rand(-250, -120), y: 8 };
    // (ref 60 m made this unseen whistle louder than a crane beside you; inland past WHISTLE_MAX: nothing)
    this.slice(b, pos, 0, b.duration, name === "steamboatWhistle" ? 0.7 : 0.9, rand(0.9, 1.0), 450, 10, 0, WHISTLE_MAX, 0.5);
    this.hornCount++;
    this.hornUsed();
    this.log("whistle far");
  }

  /** The railway gate at the Werf store opens (M3g, world/railgate.ts): the keeper rings his hand bell. */
  gateBell(x: number, z: number): void {
    const bell = this.buf.get("handbell");
    if (!bell || Math.hypot(x - this.listenerPos.x, z - this.listenerPos.z) > 110) return;
    this.slice(bell, { x, z, y: 3 }, 0, rand(1.8, 2.8), 0.6, rand(0.95, 1.05), 150, 3, 0, 110);
    this.log("railway gate bell");
  }

  /** An iron wheel over a rail joint (M3g, world/railway.ts): a knock and a short ring, made in code. */
  railClack(x: number, z: number): void {
    if (Math.hypot(x - this.listenerPos.x, z - this.listenerPos.z) > 70) return;
    const spot = this.spot({ x, z, y: 0.4 }, 4, 1.2, 70, 0.25, 14000, this.master, 70);
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
    this.slice(r, c, start, start + dur, 0.7, rand(0.85, 1.0), 150, 4, 0, 130);
    const ch = this.buf.get("chain");
    if (ch && Math.random() < 0.7) this.slice(ch, c, 0, ch.duration, 0.6, rand(0.8, 0.95), 150, 4, dur - 0.2, 130);
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
      this.slice(b, c, 0, b.duration, hoop ? 0.35 : 0.55, hoop ? rate * 1.9 : rate, 150, 3, i * gap + rand(-0.02, 0.02), 80);
    }
  }

  /** A pump handle worked a few strokes. */
  pump(p: Emitter): void {
    const b = this.buf.get("pump");
    if (!b) return;
    const dur = rand(3, 7);
    const start = rand(0, b.duration - dur);
    this.slice(b, p, start, start + dur, 0.6, rand(0.95, 1.05), 150, 3, 0, 60);
  }

  /** A carriage passing somewhere off in the fog. */
  carriageFar(): void {
    const b = this.buf.get(Math.random() < 0.5 ? "carriageFar" : "carriageArch");
    if (!b) return;
    // beyond what you can see in this weather, and soft (it was ref 12 m: at 70 m as loud as a crane at 6 m)
    const seen = this.weatherFar().seen;
    const at = this.farOnLand(Math.max(55, seen + 10), Math.max(95, seen + 30));
    if (!at) return;
    this.slice(b, { ...at, y: 1 }, 0, b.duration, 0.8, 1, 250, 4, 0, 140);
  }

  /**
   * Play part of a buffer at a place, with short fades, through a spot:
   * inverse fall-off from `ref` metres, duller towards `reach` metres, silent past
   * `max` metres (not started at all there). With SPOT_CAP sounds playing, only a
   * near one (within 25 m) still starts.
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
    max = 150,
    occl = 1,
  ): void {
    const ctx = this.ctx;
    const d = this.distTo(at.x, at.y ?? 1, at.z);
    if (d > max || (this.spots.size >= SPOT_CAP && d > 25)) return;
    const spot = this.spot(at, ref, 1, reach, 0.35, 14000, this.master, max, occl);
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
  private spot(
    at: { x: number; z: number; y?: number },
    ref: number,
    rolloff: number,
    reach: number,
    wet: number,
    cap = 14000,
    out: AudioNode = this.master,
    max = 150,
    occl = 1,
  ): Spot {
    const ctx = this.ctx;
    const pan = this.panner(ref, rolloff);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 0.5;
    const fog = ctx.createGain();
    const w = ctx.createGain();
    fog.connect(lp).connect(pan).connect(out);
    pan.connect(w).connect(this.reverbIn);
    const sp: Spot = { x: at.x, y: at.y ?? 1, z: at.z, reach, cap, max, occl, wetBase: wet, fog, lp, pan, wet: w };
    pan.positionX.value = sp.x;
    pan.positionY.value = sp.y;
    pan.positionZ.value = sp.z;
    this.tuneSpot(sp, ctx.currentTime, true);
    this.spots.add(sp);
    return sp;
  }

  /** The cathedral tower's bells: their own fall-off and dullness (BELL). */
  private bellSpot(cat: Emitter): Spot {
    const sp = this.spot(cat, BELL.ref, BELL.rolloff, BELL.reach, BELL.wet, 14000, this.master, Infinity, BELL.occl);
    sp.dull = BELL.dull;
    this.tuneSpot(sp, this.ctx.currentTime, true);
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

  /**
   * What the house blocks between the listener and (x, z) do to a sound: its gain and a factor on its
   * lowpass. `occl` 1 (street level): 12 m of houses halve it (-6 dB), at most -10 dB; 0: nothing.
   */
  private occlusion(x: number, z: number, occl: number): { gain: number; lp: number } {
    if (occl <= 0 || this.indoorsNow) return { gain: 1, lp: 1 };
    const m = blockedMetres(this.listenerPos.x, this.listenerPos.z, x, z);
    if (m <= 0) return { gain: 1, lp: 1 };
    const g = Math.max(0.32, 1 / (1 + m / 12));
    return { gain: 1 - occl * (1 - g), lp: 1 - 0.6 * occl * ramp(m, 0, 30) };
  }

  /** Inside a room the street is already muffled (setInterior); no second muffling there. */
  private get indoorsNow(): boolean {
    return this.roomKind !== null;
  }

  private tuneSpot(sp: Spot, now: number, first: boolean): void {
    const d = this.distTo(sp.x, sp.y, sp.z);
    const l = this.listenerPos;
    let occ = sp.occ;
    if (!occ || Math.abs(occ.lx - l.x) + Math.abs(occ.lz - l.z) > 1.5 || Math.abs(occ.sx - sp.x) + Math.abs(occ.sz - sp.z) > 1.5) {
      occ = sp.occ = { ...this.occlusion(sp.x, sp.z, sp.occl), lx: l.x, lz: l.z, sx: sp.x, sz: sp.z };
    }
    const lp = Math.max(200, Math.min(sp.cap, this.airLp(d, sp.reach, sp.dull)) * occ.lp);
    // the audible radius: fades out from 0.6 of it, silent beyond; and what stands in the way
    const edge = Number.isFinite(sp.max) ? 1 - ramp(d, sp.max * 0.6, sp.max) : 1;
    const fog = this.fogLoss(d) * edge * occ.gain;
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

  private weatherFar(): { lp: number; gain: number; horn: number; seen: number } {
    return this.weather ? WEATHER_FAR[this.weather] : WEATHER_UNKNOWN;
  }

  /** Air lowpass: 14 kHz within 10 m, down to the weather's cutoff at `reach` m, duller beyond. */
  private airLp(d: number, reach: number, dull = 0.5): number {
    const far = this.weatherFar().lp;
    let f = 14000 * Math.pow(far / 14000, ramp(d, 10, reach));
    if (d > reach) f *= Math.pow(reach / d, dull);
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
      roomPeople: this.roomPeople,
      roomBeds: this.roomBedGains.map((b) => ({ name: b.name, gain: +b.g.gain.value.toFixed(3) })),
      placePeople: Object.fromEntries(this.placePeople),
      rain: this.rain,
      rung: [...this.rung],
    };
  }

  get samplesLoaded(): number {
    return this.buf.size;
  }

  // ---------------------------------------------------------------- events (older)

  /**
   * A boot in a puddle: one step cut from two recordings (PUDDLE_SPANS). Fixes 2026-09-24 (Steve: "walking
   * in water sounds like a hihat, find a soppy puddle sound"): the filtered noise below only plays while
   * the recordings load. The rumble under the recordings is cut, and the top kept soft.
   */
  splashStep(hurry: boolean, wet: number): void {
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.01;
    const have = PUDDLE_SPANS.map((s, i) => [s, i] as const).filter(([s]) => this.buf.has(s[0]));
    if (have.length > 0) {
      let k = Math.floor(Math.random() * have.length);
      if (have[k][1] === this.lastSplash && have.length > 1) k = (k + 1) % have.length;
      const [[name, start, dur, level], i] = have[k];
      this.lastSplash = i;
      const src = ctx.createBufferSource();
      src.buffer = this.buf.get(name)!;
      src.playbackRate.value = rand(0.9, 1.04) * (hurry ? 1.06 : 1);
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 110;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = name === "puddleSteps" ? 3600 : 5000;
      lp.Q.value = 0.5;
      const g = ctx.createGain();
      const peak = 0.7 * level * Math.min(1, 0.4 + wet * 0.6) * (hurry ? 1.25 : 1) * rand(0.85, 1);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + 0.006);
      g.gain.setValueAtTime(peak, t + dur * 0.6);
      g.gain.linearRampToValueAtTime(0, t + dur);
      src.connect(hp).connect(lp).connect(g).connect(this.master);
      src.start(t, start, dur + 0.02);
      return;
    }
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
      // in a puddle the water takes the hard click off the stone
      const soft = puddle > 0.3 ? 1 - 0.55 * Math.min(1, puddle) : 1;
      g.gain.value = (surface === "wood" ? 0.8 : 0.65) * vol * rand(0.8, 1.0) * soft;
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
    // fixes 2026-09-24: ref 40 m, rolloff 0.6 made it one of the loudest things in the old town; now it is
    // clearly far off inland, and the house rows muffle it half
    const spot = this.spot({ x: this.listenerPos.x + rand(-160, 160), z: rand(-260, -180), y: 5 }, 15, 0.8, 900, 1.6, 14000, this.master, Infinity, 0.5);
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
    // they keep over the water: a street or two inland they are gone, not heard over the roofs
    if (this.quayDist > 130) return;
    const ctx = this.ctx;
    // over the water near you (they follow the river, not you inland)
    const spot = this.spot({ x: this.listenerPos.x + rand(-40, 40), z: rand(-45, -8), y: rand(8, 18) }, 6, 1, 200, 0.9, 3200, this.master, 160, 0);

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
      this.slice(rec, { x: ship.x + rand(-6, 6), z: ship.z, y: ship.y ?? 1 }, start, start + dur, 0.45, rand(0.8, 1.0), 120, 4, 0, 70);
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
      const spot = this.spot(at, 2, 1.1, 150, name === "bell" ? 1.2 : 0.3, 14000, this.master, name === "bell" ? 120 : 60);
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
