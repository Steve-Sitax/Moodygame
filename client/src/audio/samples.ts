// Recorded street sounds. All CC0 (public domain); source pages, licences and
// SHA-256 of each original are in assets/ATTRIBUTION.md. Each file is mono OGG,
// trimmed and normalised; "-loop" files have a crossfaded seam and loop cleanly.

const B = "/audio/bigsoundbank/";
const F = "/audio/freesound/";

export const SAMPLES = {
  // the cathedral
  hourStroke: B + "bell-hour-stroke-0994.ogg",
  carillon: F + "carillon-brussels-274987.ogg",
  // quays and ships
  shipBell: F + "ship-bell-353233.ogg",
  shipCreak: F + "ship-creak-483355-loop.ogg",
  pulleyCreak: F + "pulley-creak-438350.ogg",
  waterWall: F + "water-wall-851906-loop.ogg",
  waterPontoon: B + "water-pontoon-1444-loop.ogg",
  waterBridge: F + "water-boardwalk-758858-loop.ogg",
  ratchet: B + "ratchet-large-0795.ogg",
  winch: B + "winch-manual-0901.ogg",
  chain: F + "chain-pulley-386174.ogg",
  steamWhistleFar: F + "steam-whistle-far-9923.ogg",
  steamboatWhistle: F + "steamboat-whistle-840325.ogg",
  windMasts: B + "wind-masts-2443-loop.ogg",
  // ships passing on the Scheldt
  shipEngine: F + "ship-engine-587171-loop.ogg",
  paddleWheels: F + "paddle-steamer-481793-loop.ogg",
  tugToots: F + "steamboat-toots-840326.ogg",
  heaveShout: F + "heave-shout-47891.ogg",
  handbell: B + "handbell-2113.ogg",
  // streets
  hooves: F + "horse-walk-437103-loop.ogg",
  wheels: F + "cart-wheels-437077-loop.ogg",
  carriageFar: F + "horse-carriage-far-479797.ogg",
  carriageArch: F + "horse-arches-bruges-53488.ogg",
  anvil: B + "anvil-3589-loop.ogg",
  pump: F + "pump-815126.ogg",
  dogFar: F + "dog-far-440865.ogg",
  // people
  murmur: B + "walla-0684-loop.ogg",
  market: F + "market-venice-266691-loop.ogg",
  tavernCrowd: F + "tavern-crowd-438379-loop.ogg",
  tavernSong: F + "tavern-song-410739-loop.ogg",
  // rain
  rainRoofs: F + "rain-roofs-669487-loop.ogg",
  rainCobbles: B + "rain-puddle-1290-loop.ogg",
} as const;

export type SampleName = keyof typeof SAMPLES;

/** Spans (s) of the dog recording with one to three clean barks each. */
export const DOG_SPANS: Array<[number, number]> = [
  [0, 2.8],
  [4.9, 7.4],
  [8.5, 10.4],
  [11.3, 13.7],
  [15.5, 17.9],
];

/** Carillon: the whole tune (voorslag before the hour) and a short phrase (half hour). */
export const CARILLON_SHORT = 10.5;

/** Spans (s) of the tug recording: one toot each. */
export const TOOT_SPANS: Array<[number, number]> = [
  [0, 0.42],
  [0.46, 1.08],
];
