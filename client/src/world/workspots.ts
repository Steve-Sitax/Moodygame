// The port's work spots (D4, 2026-10-11; the look survey: "the port is empty ... three or four dense work spots with
// lanes between them"). Four places where a ship's cargo is being worked, each a dense, laid-out group of the goods of
// its trade with the gear of the work round it, and lanes left open between the groups:
//
// - the Anna Maria's berth on the Rijnkaai: Brazil coffee and Java sugar landed from her, sacks on pallets and in a
//   tarpaulined stack, the landing scale, the sack trucks; the gangway's lane and the Hessenatie dockers' way to
//   their door (shared/hauls.ts rk-w) run between the two groups;
// - the Werf: petroleum, Antwerp's new trade of the 1860s and 70s, in blue casks lying in rows between the crane
//   runway and the trees, a pyramid and the cooper's open cask (route wf-2's pile and door stay clear);
// - the Petit Bassin's east end, by the Entrepot: Scandinavian deals and baulks in stacks, wool bales from the River
//   Plate (route en-3's way to the Entrepot runs past it);
// - the north quay by the Hanseatic House (the old Hessenhuis's trade): hides in bales and crates, roped and under a
//   tarpaulin (route bs-1's pile is in front of it).
//
// Each has a tarpaulined stack, a hand barrow, a weighing machine (the landing scale of quaygoods.glb or the public
// weighbridge with its house) and a tally clerk's desk. The goods are the one model of each good (quaygoods.glb; the
// sacks are the one sack model, game/sackModel.ts); the gear is quayfurniture.glb's. quayfurniture.ts lays them with
// its own rules (open ground, off the rails, the lanes, the crane runways, doors and job places), so a piece that does
// not fit is left out and nothing closes a way.
//
// The people: the work spots stand round the dockers' own piles of shared/hauls.ts (rk-w, wf-2, en-3, bs-1), so the
// dockers of game/town.ts carry from and past them. `stands` says where a clerk or a hand would stand at his work
// (the tally desk, the scale, the barrow) for the street life to use; the people models are another update's.

/** A piece of a spot, in the spot's own frame (metres; x along the quay, z inland; rot in degrees). */
export interface SpotPiece {
  /** "qf": quayfurniture.glb's gear; "qg": quaygoods.glb's goods. */
  src: "qf" | "qg";
  model: string;
  x: number;
  z: number;
  rot: number;
  /** For sacks: what is in them (shared/goodsCatalog.ts). */
  goods?: string;
  /** Blocks walking (default: true). */
  solid?: boolean;
}

export interface WorkSpot {
  id: string;
  name: string;
  /** The spot's origin and its turn (radians: its x axis along the quay). */
  x: number;
  z: number;
  yaw: number;
  pieces: SpotPiece[];
  /** Lanes kept open through it (spot frame: x0, z0, x1, z1): no piece is laid there. */
  keep: Array<[number, number, number, number]>;
  /** Where a worker stands at the gear (spot frame), and what he does there. */
  stands: Array<{ x: number; z: number; rot: number; what: string }>;
}

const qg = (model: string, x: number, z: number, rot = 0, goods?: string): SpotPiece => ({ src: "qg", model, x, z, rot, goods });
const qf = (model: string, x: number, z: number, rot = 0, solid = true): SpotPiece => ({ src: "qf", model, x, z, rot, solid });

export const WORK_SPOTS: WorkSpot[] = [
  {
    // behind the quay railway's loop (z 10.3): the coffee west of the gangway's lane, the sugar east of the dockers'
    // way (route rk-w: from its pile at -39, 16 to the Hessenatie's door at -42, 46)
    id: "anna-maria",
    name: "the Anna Maria's berth",
    x: -42,
    z: 13.2,
    yaw: 0,
    keep: [[-3.8, -1.5, 4.6, 12]],
    pieces: [
      // coffee: a stack under the tarpaulin, pallets of sacks in a row, the scale with the tally desk
      qg("tarp_big", -11.5, 5.0, 4),
      qg("sacks_mountain", -11.0, 1.2, -2, "coffee"),
      qg("pallet", -7.6, 0.8, 3, "coffee"),
      qg("pallet", -6.0, 0.8, -4, "coffee"),
      qg("pallet", -7.0, 2.6, 88, "coffee"),
      qg("weigh_scale", -5.0, 4.6, 90, "coffee"),
      qf("tally_desk", -6.8, 6.6, 180),
      qg("sack_truck", -4.6, 1.0, 20, "coffee"),
      qg("sack_truck", -8.8, 4.4, -150),
      qf("hand_barrow", -9.6, 8.2, 6),
      qg("sacks_heap", -14.4, 2.2, 30, "coffee"),
      qf("gangplank", -14.0, 8.6, 90, false),
      qf("hawser_coil", -12.4, 9.8, 0, false),
      // sugar: mats of Java sugar on pallets, the second scale, a tarpaulined stack
      qg("pallet", 6.8, 0.9, 2, "sugar"),
      qg("pallet", 8.4, 0.9, -3, "sugar"),
      qg("pallet", 10.0, 0.9, 4, "sugar"),
      qg("pallet", 7.6, 2.8, 90, "sugar"),
      qg("pallet", 9.4, 2.8, 86, "sugar"),
      qg("tarp_crates", 13.4, 2.6, 92),
      qf("tally_desk", 6.6, 5.4, 160),
      qg("weigh_scale", 9.0, 5.2, 90, "sugar"),
      qg("sack_truck", 11.2, 5.0, -30, "sugar"),
      qf("hand_barrow", 12.8, 7.6, -4),
      qg("pallet", 14.6, 6.4, 10),
    ],
    stands: [
      { x: -6.8, z: 7.3, rot: 180, what: "the tally clerk at his desk" },
      { x: -5.0, z: 3.6, rot: 0, what: "the weigher at the scale" },
      { x: 6.6, z: 6.1, rot: 160, what: "the tally clerk at his desk" },
    ],
  },
  {
    // the Werf's west corner, west of the crane runway's end (x -318) and route wf-1's pile (-300, 12.5): petroleum in
    // blue casks in two rows, the tally clerk at the corner; the docker's way to his door (-311.9, 14) runs behind them
    id: "werf-petroleum",
    name: "the petroleum on the Werf",
    x: -312,
    z: 10.9,
    yaw: 0,
    keep: [[-6, 1.7, 7, 3.4]],
    pieces: [
      qf("tally_desk", -4.4, 0.1, 90),
      ...[-3.0, -2.3, -1.6, -0.9, -0.2, 0.5, 1.2, 1.9, 2.6, 3.3].map((dx, i) => qg("cask_blue", dx, -0.55 + (i % 2) * 0.06, i * 37)),
      ...[-2.65, -1.95, -1.25, -0.55, 0.15, 0.85, 1.55, 2.25, 2.95].map((dx, i) => qg("cask_blue", dx, 0.15 + (i % 2) * 0.05, i * 53)),
      qg("tarp_casks", 4.6, 0.2, 90),
      qg("cask_lying", -3.4, 1.0, 85),
      qf("hand_barrow", 1.0, 1.2, 0),
      qg("barrel_broken", 4.5, 1.3, 40),
    ],
    stands: [
      { x: -5.1, z: 0.1, rot: 90, what: "the tally clerk at his desk" },
      { x: 1.0, z: 2.2, rot: 180, what: "a hand at the barrow" },
    ],
  },
  {
    // the Petit Bassin's east end, by the Entrepot: the deals and baulks west of the cart lane (x 157..160.5), the wool
    // and the public weighbridge east of it, by the Entrepot's quay (route en-3 to the Entrepot runs north of them)
    id: "bassin-timber",
    name: "the deals and the wool by the Entrepot",
    x: 160,
    z: 30,
    yaw: 0,
    keep: [],
    pieces: [
      qg("planks_stack", -7.4, -5.0, 0),
      qg("planks_stack", -7.4, 0.2, 2),
      qg("baulks", -5.0, -3.0, 0),
      qf("timber_baulks", -5.0, 2.6, 0),
      qg("tarp_big_brown", -7.2, 5.4, 0),
      qf("gangplank", -4.6, -6.8, 0, false),
      qg("bales_wall", 4.0, -2.0, 0),
      qg("bales_stack", 7.6, -1.6, 4),
      qg("bale", 9.6, 0.4, 30),
      qg("bales_stack", 4.6, 1.4, 90),
      qf("weighbridge_plate", 6.0, 6.4, 0, false),
      qf("weigh_house", 9.4, 6.4, 90),
      qf("tally_desk", 3.6, 5.0, 90),
      qf("hand_barrow", 7.4, 2.8, 80),
    ],
    stands: [
      { x: 2.9, z: 5.0, rot: 90, what: "the tally clerk at his desk" },
      { x: 9.0, z: 6.4, rot: -90, what: "the weigher in the weigh house" },
    ],
  },
  {
    // the north quay's edge strip before the Hanseatic House (between the water at z 110 and the railway at z 115),
    // west of route bs-1's pile (143, 112.9): hides in bales and crates, gaps left to the edge between the groups
    id: "hanse-hides",
    name: "the hides and crates by the Hanseatic House",
    x: 128,
    z: 112.9,
    yaw: 0,
    keep: [[-9.8, -2, -8.2, 2], [-1.0, -2, 1.0, 2], [8.6, -2, 10.4, 2]],
    pieces: [
      qg("bales_wall", -14.2, 0.2, 0),
      qg("bale", -11.4, 0.4, 10),
      qg("tarp_crates", -5.0, 0.2, 0),
      qg("bale", -2.3, -0.3, -20),
      qg("crates_block", 3.6, 0.3, 0),
      qg("crates_tied", 6.6, 0.3, 0),
      qg("crate_open", -16.6, 0.0, 25),
      qg("weigh_scale", -7.2, 0.2, 0),
      qf("tally_desk", 12.4, 0.2, -90),
      qf("hand_barrow", -19.0, 0.0, 0),
      qg("crate_b", 11.4, -0.6, 12),
    ],
    stands: [
      { x: 11.7, z: 0.2, rot: -90, what: "the tally clerk at his desk" },
      { x: -7.2, z: -0.8, rot: 0, what: "the weigher at the scale" },
    ],
  },
];

/** A spot's frame to the world. */
export function spotToWorld(s: WorkSpot, lx: number, lz: number): [number, number] {
  const c = Math.cos(s.yaw);
  const n = Math.sin(s.yaw);
  return [s.x + lx * c + lz * n, s.z - lx * n + lz * c];
}

export interface SpotKit {
  /** Lay a piece at (x, z) turned yaw (radians) if it fits; true when it did. */
  lay(p: SpotPiece, x: number, z: number, yaw: number): boolean;
  /** Keep these boxes (world) clear while the spots are laid; release them after. */
  reserve(rects: Array<{ minX: number; maxX: number; minZ: number; maxZ: number }>): void;
  release(): void;
}

/** The tries round a piece's place, nearest first (up to 1.25 m off, a quarter metre apart). */
const TRIES: Array<[number, number]> = (() => {
  const out: Array<[number, number]> = [];
  for (let i = -5; i <= 5; i++) for (let j = -5; j <= 5; j++) if (Math.hypot(i, j) <= 5.01) out.push([i * 0.25, j * 0.25]);
  return out.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]));
})();

export interface SpotsLaid {
  /** Pieces laid and left out, per spot. */
  bySpot: Record<string, { laid: number; left: string[] }>;
  /** Where the workers stand, in the world (for the street life). */
  stands: Array<{ spot: string; x: number; z: number; yaw: number; what: string }>;
  /** Dev: why the pieces left out did not fit, each try. */
  why?: string[];
}

/** Lay every spot's pieces (a piece that does not fit is tried round its place, nearest first, then left out). */
export function layWorkSpots(kit: SpotKit): SpotsLaid {
  const out: SpotsLaid = { bySpot: {}, stands: [] };
  for (const s of WORK_SPOTS) {
    const rec = (out.bySpot[s.id] = { laid: 0, left: [] as string[] });
    kit.reserve(
      s.keep.map(([x0, z0, x1, z1]) => {
        const [ax, az] = spotToWorld(s, x0, z0);
        const [bx, bz] = spotToWorld(s, x1, z1);
        return { minX: Math.min(ax, bx), maxX: Math.max(ax, bx), minZ: Math.min(az, bz), maxZ: Math.max(az, bz) };
      }),
    );
    for (const p of s.pieces) {
      let ok = false;
      for (const [dx, dz] of TRIES) {
        const [x, z] = spotToWorld(s, p.x + dx, p.z + dz);
        if (kit.lay(p, x, z, s.yaw + (p.rot * Math.PI) / 180)) {
          ok = true;
          break;
        }
      }
      if (ok) rec.laid++;
      else rec.left.push(p.model);
    }
    kit.release();
    for (const st of s.stands) {
      const [x, z] = spotToWorld(s, st.x, st.z);
      out.stands.push({ spot: s.id, x, z, yaw: s.yaw + (st.rot * Math.PI) / 180, what: st.what });
    }
  }
  return out;
}
