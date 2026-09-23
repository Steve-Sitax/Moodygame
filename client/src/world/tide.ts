// The tide on the Schelde at Antwerp, 1873 (docs/milestones/M6-tides.md).
//
// Research (Coen, "De eeuwige Schelde?", Waterbouwkundig Laboratorium 2008, p. 11 and the table
// on p. 56): at Antwerp the mean high water in 1871-80 stood at +4.80 m NKD and the mean low water
// at +0.31 m, a mean range of 4.31 m (today about 5.2 m). A tide lasts 12 h 25 min on average.
// Springs and neaps today run about +12 % and -15 % of the mean range (same source, p. 11);
// we use +-11.5 % on the 1873 mean: springs about 4.8 m, neaps about 3.8 m.
// The flood is shorter than the ebb at Antwerp; we let the water rise for 5.5 h and fall for 6.9 h.
//
// The game's quay top is y 0 and the still water used to be WATER_Y -2.8, which is the half tide
// here: mean high water -0.65, spring high water -0.40 (0.4 m below the edge stones), mean low
// water -4.95, spring low water -5.20. The Petit Bassin (a closed dock behind its lock) is kept at
// DOCK_Y, a little below mean high water, as the docks were: ships went in and out round high water.
// The canal and the vlieten are open to the river, so they are tidal; at low water their beds of
// mud come near the surface and the boats in them sit on it (nl.wikipedia "Antwerpse vlieten").
//
// Nothing here imports the world: rijnkaai.ts and the boat modules all read the live levels in
// `water` (set once a frame by rijnkaai.ts), or ask levelAt(x, z).

/** Half tide: the old still water level (rijnkaai.ts WATER_Y). */
export const MID_Y = -2.8;
/** Half the mean range, 1871-80 (4.31 m). */
export const HALF = 2.155;
/** Spring and neap: the range swells and shrinks by this share over half a lunar month. */
export const SPRING = 0.115;
/** A tide, in hours (12 h 25 min). */
export const PERIOD = 12 + 25 / 60;
/** Hours from low to high water (the flood); the ebb takes the rest. */
export const RISE = 5.5;
/** Spring to spring, in days (half a synodic month). */
export const SPRING_DAYS = 14.765;
/** High water on the first day (Monday) at this hour; springs peak at SPRING_AT hours (from Monday 0:00). */
const HW0 = 9.6;
const SPRING_AT = 30;

/** The highest and lowest the river ever goes (spring tides), and the mean marks. */
export const HW_MAX = MID_Y + HALF * (1 + SPRING);
export const LW_MIN = MID_Y - HALF * (1 + SPRING);
export const MHW = MID_Y + HALF;
export const MLW = MID_Y - HALF;
/** The Petit Bassin's water: kept a little under mean high water by the lock. */
export const DOCK_Y = -1.0;
/** The mud beds of the canal and the vlieten: bare at low spring tides. */
export const CANAL_BED = -5.05;
/** The mud at the foot of the river walls (world/tidemud.ts): top against the wall, falling away. */
export const TOE_TOP = -4.75;
/** The Anna Maria sits on the bottom at her berth below this water level (her deck stays at -2.0). */
export const BRIG_FLOOR = -4.4;

/** Game clock -> hours since Monday 0:00. */
const hoursOf = (day: number, hour: number) => (Math.max(1, day) - 1) * 24 + hour;

/** Half the range at time t (hours since Monday 0:00): springs and neaps. */
export function amplitudeAt(t: number): number {
  return HALF * (1 + SPRING * Math.cos((2 * Math.PI * (t - SPRING_AT)) / (SPRING_DAYS * 24)));
}

/** Level at t hours since Monday 0:00. */
function levelAtHour(t: number): number {
  const A = amplitudeAt(t);
  const fall = PERIOD - RISE;
  const ph = (((t - HW0) % PERIOD) + PERIOD) % PERIOD; // hours since high water
  if (ph < fall) return MID_Y + A * Math.cos((Math.PI * ph) / fall);
  return MID_Y - A * Math.cos((Math.PI * (ph - fall)) / RISE);
}

/** The river's level (y, metres; quay top 0) on game day `day` (1 = Monday) at `hour` (0-24, fractions). */
export function tideAt(day: number, hour: number): number {
  return levelAtHour(hoursOf(day, hour));
}

/** Rising (+) or falling (-), metres per game hour. */
export function tideRate(day: number, hour: number): number {
  const t = hoursOf(day, hour);
  return (levelAtHour(t + 0.05) - levelAtHour(t - 0.05)) / 0.1;
}

export interface TideInfo {
  y: number;
  rising: boolean;
  /** Metres above (+) or below (-) half tide. */
  fromMid: number;
  /** Today's range, metres (springs about 4.8, neaps about 3.8). */
  range: number;
  /** Game time of the next high and low water: day and hour. */
  nextHigh: { day: number; hour: number; y: number };
  nextLow: { day: number; hour: number; y: number };
}

/** The tide now and what comes next (for the dev readout). */
export function tideInfo(day: number, hour: number): TideInfo {
  const t = hoursOf(day, hour);
  const y = levelAtHour(t);
  const fall = PERIOD - RISE;
  const ph = (((t - HW0) % PERIOD) + PERIOD) % PERIOD;
  const toHigh = PERIOD - ph;
  const toLow = ph < fall ? fall - ph : fall + PERIOD - ph;
  const at = (h: number) => {
    const tt = t + h;
    return { day: Math.floor(tt / 24) + 1, hour: tt % 24, y: levelAtHour(tt) };
  };
  return { y, rising: ph >= fall, fromMid: y - MID_Y, range: 2 * amplitudeAt(t), nextHigh: at(toHigh), nextLow: at(toLow) };
}

/** Where the water stands now (set every frame by rijnkaai.ts). */
export const water = {
  /** The Schelde, the canal and the vlieten. */
  river: MID_Y,
  /** The Petit Bassin. */
  dock: DOCK_Y,
  /** The lock chamber between its two pairs of gates (world/lock.ts levels it): its mean... */
  chamber: DOCK_Y,
  /** ...and its two ends, at the river gates (z 7) and the dock gates (z 42): with both pairs open the water slopes between them. */
  chamberA: DOCK_Y,
  chamberB: DOCK_Y,
};

/** The lock chamber between the gates (lock.ts: channel x 104..116, gates at z 7 and 42). */
export const CHAMBER = { minX: 100, maxX: 120, minZ: 7, maxZ: 42 };
/** The Petit Bassin with its quays (grown a little: cranes and boats at its walls count too). */
export const DOCK = { minX: 62, maxX: 178, minZ: 42, maxZ: 118 };
/** The canal and the vliet (tools/city/design.py water): tidal, with mud beds. */
const CANALS = [
  { minX: -83, maxX: -69, minZ: 1, maxZ: 206 },
  { minX: -151, maxX: -141, minZ: 1, maxZ: 73 },
];

/** 0 river (tidal), 1 dock, 2 lock chamber. */
export function regionAt(x: number, z: number): 0 | 1 | 2 {
  if (x > DOCK.minX && x < DOCK.maxX && z > DOCK.minZ && z < DOCK.maxZ) return 1;
  if (x > CHAMBER.minX && x < CHAMBER.maxX && z > CHAMBER.minZ && z < CHAMBER.maxZ) return 2;
  return 0;
}

/** The still water level at (x, z) now (no waves). */
export function levelAt(x: number, z: number): number {
  const r = regionAt(x, z);
  if (r === 2) return water.chamberA + ((water.chamberB - water.chamberA) * (z - CHAMBER.minZ)) / (CHAMBER.maxZ - CHAMBER.minZ);
  return r === 0 ? water.river : water.dock;
}

/** The level of a region now. */
export function levelOf(region: 0 | 1 | 2): number {
  return region === 0 ? water.river : region === 1 ? water.dock : water.chamber;
}

/** The river bed where boats may take the ground: the canal and vliet mud, or -Infinity (deep enough). */
export function bedAt(x: number, z: number): number {
  for (const c of CANALS) if (x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ) return CANAL_BED;
  return -Infinity;
}

/** How deep a boat of this kind sits (m below its waterline), for taking the ground. */
export function draftOf(kind: string): number {
  switch (kind) {
    case "rowboat":
    case "punt":
      return 0.25;
    case "lighter":
    case "hengst":
    case "sloop":
      return 0.55;
    case "lighter_loaded":
    case "rhine_barge":
      return 0.85;
    default:
      return 1.5;
  }
}

/** Dev: hold the river at high or low water (null: follow the clock). */
export const tideDev = { hold: null as null | "high" | "low" };

/** Water deeper than this over a floor (steps, a landing): you swim; shallower: you wade and stand. */
export const WADE = 1.2;
