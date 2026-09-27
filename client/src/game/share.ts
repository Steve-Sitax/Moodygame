// M8f sync pass 3: what the town's own things need so that every player sees the same (docs/milestones/M8f.md).
//
// Alone this is a plain stand-in: this PC runs everything, the clock is its own, there are no other players. Played
// together, net/mp/together.ts fills it in: the server's clock, every player's place, and `net` (net/mp/extras.ts),
// which says which PC runs each animal and each of the town's other walkers and carries their states.
//
// No three.js here, no imports from the game: the animals, the birds, the markets and the Steen read it.

/** A person the town's other walkers are drawn as (crowd.ts Puppet; kept loose here). */
export type SharedPuppet = object;

/** What an animal shows the others (the PC that runs it sends it: net/mp/extras.ts). */
export interface SharedAnimal {
  x: number;
  z: number;
  yaw: number;
  motion: "idle" | "walk" | "run" | "sit" | "lie" | "sniff" | "peck" | "graze";
  /** A jump of place: no in-between. */
  snap?: boolean;
}

export interface ShareNet {
  /**
   * May this PC run it now? Its PC (the server's word) is this one, or nobody runs it and this player is the nearest
   * to (x, z) of all players within `reach`: then this PC asks for it. False: another PC runs it (or none should).
   */
  run(id: string, x: number, z: number, reach: number): boolean;
  /** This PC lets it go: still about (`gone` false: the next PC near runs it on) or gone for good. */
  release(id: string, gone?: boolean): void;
  /** Who runs it (0: nobody, -1: gone). */
  owner(id: string): number;
  /** An animal this PC runs, now (sent when due). `dogOf`: a townsperson's dog, under his number. */
  putAnimal(id: string, s: SharedAnimal, dogOf?: string): void;
  /** An animal another PC runs, as drawn now (about 200 ms behind); null before its first state. */
  animal(id: string): SharedAnimal | null;
  /** The animals other PCs have sent lately (ids), for the ones not made here yet. */
  animalsHeard(): Iterable<string>;
  /** One of the town's other walkers this PC runs (its id says its kind: `x:<group>:<kind>:<n>`): sent when due. */
  person(id: string, p: SharedPuppet): void;
  /** It went (in at a door, off the map): nobody runs it now. */
  personGone(id: string): void;
  /** A walker another PC ran comes to this PC (its PC left, or walked off): the group behind the prefix takes it on. */
  onAdopt(prefix: string, take: (id: string, p: SharedPuppet) => boolean): void;
  /** A fresh id for a walker of this PC. */
  newId(group: string, kind: string): string;
}

export const share = {
  /** Played together, and the server has said who this player is. */
  on: false,
  /** This player's id (0 alone). */
  me: 0,
  /** The clock every PC shares (ms): the server's when together, this PC's own alone. */
  now: (): number => Date.now(),
  /** Every player's place, this one's first. */
  players: (): Array<{ x: number; z: number }> => [],
  /** Does another player see this point now (net/mp/together.ts)? */
  seenByOthers: (_x: number, _z: number): boolean => false,
  net: null as ShareNet | null,
};

/** Alone, or this PC runs it (see ShareNet.run). */
export function runsHere(id: string, x: number, z: number, reach = 80): boolean {
  return !share.on || !share.net ? true : share.net.run(id, x, z, reach);
}

/** The nearest player to (x, z), metres (this one alone). */
export function nearestPlayer(x: number, z: number, self?: { x: number; z: number }): number {
  let d = Infinity;
  const list = share.players();
  if (!list.length && self) return Math.hypot(x - self.x, z - self.z);
  for (const p of list) d = Math.min(d, Math.hypot(x - p.x, z - p.z));
  return d;
}

// ------------------------------------------------------------------ the same dice on every PC

/** A 32-bit hash of a string and numbers. */
export function hash32(key: string, ...n: number[]): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193);
  for (const v of n) {
    h = Math.imul(h ^ (v | 0), 0x01000193);
    h = Math.imul(h ^ ((v * 4096) | 0), 0x85ebca6b);
  }
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}

/** 0..1 from a key and numbers: the same on every PC. */
export function dice(key: string, ...n: number[]): number {
  return hash32(key, ...n) / 4294967296;
}

/** A row of dice from a seed (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seconds on the shared clock. */
export const sharedSeconds = (): number => share.now() / 1000;
