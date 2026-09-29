import * as THREE from "three";
import { mergePartsTree } from "./staticMerge";
import { psx } from "../retro/psx";
import { makeHuman, whenHumans, type Human, type HumanKind, type Motion } from "../game/humans";
import type { Crowd, Puppet } from "../game/crowd";
import { glowTexture } from "./textures";
import { addLantern, type LanternSource } from "./lanternLights";
import type { Rect } from "./geom";
import { groundRound } from "../game/stationRound";
import type { World } from "./rijnkaai";
import { water } from "./tide";
import { loadSteenModel, type SteenModel } from "./steenModel";
import { addPropObject } from "./propSpots";
import { STEEN_BENCHES } from "../../../shared/sleep";
import { nearestPlayer, runsHere, share } from "../game/share";

// Life round Het Steen (M3i, docs/milestones/M3i-steen.md). In 1873 the Steen was the city's
// Museum of Antiquities (decided 1862, open from 1864), in the old castle gate and prison.
// Steve: "people visiting it would be nice, or other appropriate activities around it."
//
// By day, while the museum is open (10 to 4, the board by the door): an attendant in his coat
// by the door, which stands open; visitors (the crowd's puppets) walk up the lane, stop and
// look at the gatehouse, go in (they vanish in the doorway), come out a while later and stroll
// on; some only look and walk on. Round it: a painter at his easel on the promontory, sketching
// the Steen from the river side; an old man fishing over the railing at the tip; children and
// a couple at the railings watching the ships; two benches. At night: the museum shut, nobody
// at the door, only the lanterns lit: on the Steenpoort, under it, and by the museum door.
//
// Cheap: the figures exist only within 90 m; one mesh each for the easel, the benches, the rod
// and line, the open doorway; one glow sprite. The visitors are crowd puppets (crowd.ts) and are
// dropped when Jef is far.

type P = [number, number];

/** The museum door (Charles V's gate, on the raised courtyard; tools/blender/build_landmarks.py steen5). */
export const STEEN_DOOR = { x: -183.5, z: -23.0 };
/** The courtyard's height (tools/city/design.py TERRACE_H): the door, the attendant and the doorway stand on it. */
const TY = 2.2;
const OPEN: P = [10, 16]; // the board: OPEN 10 - 4
const LANTERN = new THREE.Vector3(-194.42, 6.53, -17.65); // on the Steenpoort's outer face, over the landing
/** Under the Steenpoort: the middle of its passage (tools/blender/build_steen.py, u -16.75..-13, v 8.45..12.95). */
const PASSAGE_LAMP: P = [-191.9, -20.55];
/** The gatehouse's courtyard face (the museum door's plane), the lanterns either side of the door (over its small windows). */
const STEEN_WALL_Z = -23.25;
const DOOR_LAMPS = [-185.6, -181.4];
const WATER_Y = -2.8;

interface Figure {
  kind: HumanKind;
  x: number;
  z: number;
  /** Facing (0 = +z). */
  yaw: number;
  motion: Motion;
  /** Height of the ground it stands on. */
  y: number;
  /** Seat height when sitting. */
  seat?: number;
  hours: P;
  h: Human | null;
  root: THREE.Group;
  routine?: ReturnType<typeof groundRound>;
}

const face = (fx: number, fz: number, tx: number, tz: number) => Math.atan2(tx - fx, tz - fz);

// the painter on the promontory, looking at the north wing's spire tower and the courtyard
const PAINTER: P = [-165.5, -9.5];
const PAINTER_YAW = face(PAINTER[0], PAINTER[1], -178, -30);
// the old man fishing over the promontory's east railing, into the river
const ANGLER: P = [-151.5, -6.5];
const ANGLER_YAW = Math.PI / 2;
// M7 sleep: the two benches' places are shared with the server (shared/sleep.ts), which lets Jef sleep on them
const BENCHES: Array<[number, number, number]> = STEEN_BENCHES;
/** Where someone sits on a bench: a little back from its middle, `side` along it. */
const benchSeat = (b: [number, number, number], side: number): P => [
  b[0] - Math.sin(b[2]) * 0.18 + Math.cos(b[2]) * side,
  b[1] - Math.cos(b[2]) * 0.18 - Math.sin(b[2]) * side,
];

function figures(): Figure[] {
  const f = (kind: HumanKind, x: number, z: number, yaw: number, motion: Motion, hours: P, seat?: number, y = 0): Figure => ({
    kind, x, z, yaw, motion, hours, seat, y, h: null, root: new THREE.Group(),
  });
  const sailor = benchSeat(BENCHES[1], 0.4);
  return [
    // the attendant, in his coat, beside the open door up on the courtyard
    f("clerk", STEEN_DOOR.x - 2.8, STEEN_DOOR.z + 1.65, 0.15, "behind", [9.5, 16.5], undefined, TY),
    // the painter on his stool
    f("gentleman", PAINTER[0], PAINTER[1], PAINTER_YAW, "sit", [10, 16], 0.45),
    // the old man fishing over the east railing
    f("old_man", ANGLER[0], ANGLER[1], ANGLER_YAW, "sit", [7, 17.5], 0.42),
    // children at the west railing, watching the ships
    f("boy", -213.1, -17.5, -Math.PI / 2, "idle", [11, 17]),
    f("girl", -213.1, -18.6, -Math.PI / 2 + 0.3, "idle", [11, 17]),
    // a couple at the west railing, watching the river
    f("clerk", -213.2, -22.6, -Math.PI / 2, "lean", [9, 18]),
    f("wife_a", -213.1, -21.4, -Math.PI / 2 + 0.2, "idle", [9, 18]),
    // a sailor resting on the second bench
    f("sailor_b", sailor[0], sailor[1], BENCHES[1][2], "sit", [8, 18], 0.47),
  ];
}

/** Where the visitors come from and go to: the quay by the ramp's foot, the Steenplein, both sides of the promontory. */
const ENDS: P[] = [[-196, 12], [-178, 22], [-210, -18], [-157, -12], [-212, 12]];
/** Where they stand on the courtyard and look at the gatehouse. */
const LOOK: P[] = [[-183.3, -20.2], [-181.2, -19.6], [-185.6, -19.8], [-179.2, -20.4]];
const VISITORS: HumanKind[] = ["gentleman", "wife_a", "wife_b", "clerk", "priest", "old_woman", "sailor_b", "maid", "wife_a", "gentleman"];

interface Visitor {
  kind: HumanKind;
  p: Puppet | null;
  state: "coming" | "looking" | "entering" | "stepIn" | "inside" | "stepOut" | "leaving";
  /** Where the scripted steps through the doorway go (the crowd grid keeps walkers off the wall). */
  to: P;
  t: number;
  goesIn: boolean;
  look: P;
  /** M8f sync pass 3: the figure's id among the players' PCs (a new one each time it comes out of a door). */
  id?: string;
}

export interface SteenLife {
  group: THREE.Group;
  /** Walk colliders (the Steenpoort's east tower, the calvary, the easel, the benches): add them to the world. */
  colliders: Rect[];
  /** Once a frame: the game hour with fraction, the camera. */
  update(dt: number, hour: number, cam: THREE.Camera): void;
  /** Points a path must reach (main.ts paths()): the museum door, the Steenpoort from outside. */
  pathPoints(): Array<{ label: string; x: number; z: number; reach: number }>;
  /** Dev: who is where. */
  info(): Record<string, unknown>;
  /** The Steen's model (world/steenModel.ts). */
  model: SteenModel;
}

export function createSteenLife(scene: THREE.Scene, crowd: Crowd | null, world: Pick<World, "standFree">): SteenLife {
  const group = new THREE.Group();
  group.name = "steenlife";
  scene.add(group);
  // the Steen itself in detail (2026-09-26, world/steenModel.ts, tools/blender/build_steen.py): it hides the old one of landmarks.glb
  const model = loadSteenModel(scene);
  let humansReady = false;
  whenHumans(() => (humansReady = true));

  const wood = psx(new THREE.MeshLambertMaterial({ color: 0x6b4a2e }));
  const dark = psx(new THREE.MeshLambertMaterial({ color: 0x2a2622 }));
  const iron = psx(new THREE.MeshLambertMaterial({ color: 0x33373a }));

  // --- the easel with a sketch of the Steen, the stool, the paint box
  const easel = new THREE.Group();
  {
    const leg = new THREE.BoxGeometry(0.035, 1.75, 0.035);
    for (const [x, z, rx, rz] of [[-0.28, 0, 0.12, 0], [0.28, 0, 0.12, 0], [0, 0.45, -0.25, 0]] as const) {
      const m = new THREE.Mesh(leg, wood);
      m.position.set(x, 0.86, z);
      m.rotation.set(rx, 0, rz + (x < 0 ? -0.12 : x > 0 ? 0.12 : 0));
      easel.add(m);
    }
    const ledge = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.04, 0.08), wood);
    ledge.position.set(0, 0.95, -0.08);
    easel.add(ledge);
    const canvas = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.48), psx(new THREE.MeshLambertMaterial({ map: sketchTexture(), side: THREE.DoubleSide })));
    canvas.position.set(0, 1.22, -0.1);
    canvas.rotation.x = -0.12;
    canvas.rotation.y = Math.PI; // the painted side faces the painter
    easel.add(canvas);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.5, 0.015), wood);
    back.position.set(0, 1.22, -0.085);
    back.rotation.x = -0.12;
    easel.add(back);
    const stool = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.05, 0.3), wood);
    stool.position.set(0, 0.43, -0.95);
    easel.add(stool);
    for (const sx of [-0.14, 0.14]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.43, 0.03), wood);
      l.position.set(sx, 0.21, -0.95);
      l.rotation.x = sx < 0 ? 0.3 : -0.3;
      easel.add(l);
    }
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.1, 0.26), dark);
    box.position.set(0.45, 0.05, -0.7);
    easel.add(box);
    // the easel stands 0.95 m in front of the painter, facing him
    easel.position.set(PAINTER[0] + Math.sin(PAINTER_YAW) * 0.95, 0, PAINTER[1] + Math.cos(PAINTER_YAW) * 0.95);
    easel.rotation.y = PAINTER_YAW;
    group.add(easel);
  }

  // --- the angler's rod and line, his stool and bucket
  const rod = new THREE.Group();
  /** M6 tides: the line's end and the float ride on the water (set in update). */
  let fishLine: THREE.BufferGeometry | null = null;
  let fishFloat: THREE.Mesh | null = null;
  {
    const fx = Math.sin(ANGLER_YAW);
    const fz = Math.cos(ANGLER_YAW);
    const at = (fwd: number, side: number, y: number) => new THREE.Vector3(ANGLER[0] + fx * fwd - fz * side, y, ANGLER[1] + fz * fwd + fx * side);
    const stool = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.4, 0.3), wood);
    stool.position.copy(at(-0.05, 0, 0.2));
    rod.add(stool);
    const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.12, 0.26, 6), wood);
    bucket.position.copy(at(0.1, 0.5, 0.13));
    rod.add(bucket);
    const from = at(0.35, 0.12, 1.0);
    const tip = at(3.9, 0.35, 2.7);
    const len = from.distanceTo(tip);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.02, len, 4).translate(0, len / 2, 0), wood);
    pole.position.copy(from);
    pole.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tip.clone().sub(from).normalize());
    rod.add(pole);
    const lineGeo = new THREE.BufferGeometry().setFromPoints([tip, new THREE.Vector3(tip.x + fx * 0.2, WATER_Y + 0.02, tip.z + fz * 0.2)]);
    rod.add(new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x9a9890, transparent: true, opacity: 0.6 })));
    const float = new THREE.Mesh(new THREE.SphereGeometry(0.03, 4, 3), psx(new THREE.MeshLambertMaterial({ color: 0xb03a28 })));
    float.position.set(tip.x + fx * 0.2, WATER_Y + 0.02, tip.z + fz * 0.2);
    rod.add(float);
    fishLine = lineGeo;
    fishFloat = float;
    group.add(rod);
  }

  // --- two benches on the promontory
  const benchRects: Rect[] = [];
  for (const [x, z, yaw] of BENCHES) {
    const b = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.06, 0.42), wood);
    seat.position.set(0, 0.46, 0);
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.36, 0.05), wood);
    back.position.set(0, 0.78, -0.2);
    back.rotation.x = -0.12;
    b.add(seat, back);
    for (const sx of [-0.72, 0.72]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.46, 0.4), iron);
      l.position.set(sx, 0.23, 0);
      b.add(l);
    }
    b.position.set(x, 0, z);
    b.rotation.y = yaw;
    group.add(b);
    b.name = "steen_bench";
    addPropObject("steen", b);
    const c = Math.abs(Math.cos(yaw));
    const s = Math.abs(Math.sin(yaw));
    const hw = 0.85 * c + 0.25 * s;
    const hd = 0.85 * s + 0.25 * c;
    benchRects.push({ minX: x - hw, maxX: x + hw, minZ: z - hd, maxZ: z + hd, top: 0.5 });
  }

  // --- the open doorway by day (the museum door stands open), a dark shape over the painted door
  const doorway = new THREE.Mesh(
    doorGeometry(2.3, 3.45),
    psx(new THREE.MeshLambertMaterial({ color: 0x0d0b09 })),
  );
  doorway.position.set(STEEN_DOOR.x, TY + 0.02, STEEN_DOOR.z - 0.17);
  // M7 halls: the museum door is a real opening now, the museum inside it in the world (world/hallInWorld.ts,
  // landmarkHalls.ts buildSteen): no dark shape over it any more (the mesh stays, unadded, for doorOpen in info())

  // --- M7 doors: the courtyard (design.py, from z -23.0) stopped 0.25 m short of the lane face (z -23.25),
  // a slit down to the street all along the gatehouse and the prison range (the hall's sill closed it only
  // at the door). A bluestone kerb at the wall's foot fills it, 2 cm proud of the paving so the two never
  // share a plane.
  {
    const x0 = -190.6;
    const x1 = -168.9;
    const z0 = -23.4;
    const z1 = -23.0;
    const kerb = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, TY + 0.02, z1 - z0), psx(new THREE.MeshLambertMaterial({ color: 0x57544e })));
    kerb.position.set((x0 + x1) / 2, (TY + 0.02) / 2, (z0 + z1) / 2);
    kerb.name = "steen_wall_kerb";
    group.add(kerb);
  }

  // --- the lanterns after dusk: the one on the Steenpoort (in the model), and three of our own: one hung in the
  // passage under the gate, two by the museum door. Each lights the world (Steve 2026-09-27: "there is a light but
  // it does not shine"): a lantern source of world/lanternLights.ts, so the nearest get a real light and the rest
  // spill (world/spill.ts); no light of their own is added (docs/rendering.md).
  const glowMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffc47a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffd08a });
  const lanterns: Array<{ glow: THREE.Sprite; flame: THREE.Mesh; src: LanternSource }> = [];
  const lantern = (at: THREE.Vector3, size: [number, number], halo = 1.6) => {
    const glow = new THREE.Sprite(glowMat);
    glow.position.copy(at);
    glow.scale.setScalar(halo);
    group.add(glow);
    const flame = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[0]), flameMat);
    flame.position.copy(at);
    group.add(flame);
    const src = addLantern({ power: 2.2 });
    src.pos.copy(at);
    src.ground = TY;
    lanterns.push({ glow, flame, src });
  };
  // the Steenpoort's: the lit glass a hair larger than the model's dark lantern glass, so it covers it
  lantern(LANTERN, [0.37, 0.47]);
  // an iron lantern of our own: its frame (cap, base, corner bars) round the lit glass at `at`
  const ironLantern = (at: THREE.Vector3) => {
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.2, 4, 1), iron);
    cap.position.set(at.x, at.y + 0.3, at.z);
    cap.rotation.y = Math.PI / 4;
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.06, 0.28), iron);
    base.position.set(at.x, at.y - 0.23, at.z);
    group.add(cap, base);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.44, 0.03), iron);
      bar.position.set(at.x + sx * 0.14, at.y, at.z + sz * 0.14);
      group.add(bar);
    }
    // the glass by day (the lit glass, a hair larger, covers it at night)
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.37, 0.23), dark);
    glass.position.copy(at);
    group.add(glass);
    lantern(at, [0.24, 0.38], 1.1);
  };
  // hung on an iron rod from the crown of the passage's vault (the pointed arch's top at 7.8)
  {
    const at = new THREE.Vector3(PASSAGE_LAMP[0], 5.7, PASSAGE_LAMP[1]);
    ironLantern(at);
    const rod = new THREE.Mesh(new THREE.BoxGeometry(0.03, 7.8 - at.y - 0.38, 0.03), iron);
    rod.position.set(at.x, (7.8 + at.y + 0.38) / 2, at.z);
    group.add(rod);
  }
  // on iron brackets out of the gatehouse's courtyard face, either side of the museum door, over its small windows
  for (const x of DOOR_LAMPS) {
    const at = new THREE.Vector3(x, 5.75, STEEN_WALL_Z + 0.55);
    ironLantern(at);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.6), iron);
    arm.position.set(x, at.y + 0.5, STEEN_WALL_Z + 0.3);
    // the stay from the wall up to the arm, under it
    const stay = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.6), iron);
    stay.position.set(x, at.y + 0.3, STEEN_WALL_Z + 0.225);
    stay.rotation.x = -Math.atan2(0.4, 0.45);
    const hook = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.12, 0.02), iron);
    hook.position.set(x, at.y + 0.44, at.z);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.03), iron);
    plate.position.set(x, at.y + 0.3, STEEN_WALL_Z + 0.015);
    group.add(arm, stay, hook, plate);
  }

  // the still wooden and iron parts (lantern frames, brackets, bench legs, the easel) drawn as one mesh per material
  // under each parent (world/staticMerge.ts): the flames, the float and the sketch keep their own
  mergePartsTree(group, (m) => m.material === wood || m.material === dark || m.material === iron);

  // (the gate's east tower, the calvary, the courtyard's and the ramp's balustrades are walls in the walk map: design.py DECOR)
  const colliders: Rect[] = [
    // the easel and the painter's stool
    {
      minX: Math.min(PAINTER[0], easel.position.x) - 0.45, maxX: Math.max(PAINTER[0], easel.position.x) + 0.45,
      minZ: Math.min(PAINTER[1], easel.position.z) - 0.45, maxZ: Math.max(PAINTER[1], easel.position.z) + 0.45,
    },
    // the angler and his bucket
    { minX: ANGLER[0] - 0.45, maxX: ANGLER[0] + 0.45, minZ: ANGLER[1] - 0.45, maxZ: ANGLER[1] + 0.75 },
    ...benchRects,
  ];

  const figs = figures();
  const visitors: Visitor[] = [];
  let spawnT = 3;
  let t = 0;

  function show(f: Figure, on: boolean): void {
    if (on && !f.h && humansReady) {
      f.h = makeHuman(f.kind);
      if (!f.h) return;
      f.root.add(f.h.root);
      group.add(f.root);
      f.root.position.set(f.x, f.y + (f.seat !== undefined ? f.h.sitDrop(f.seat) : 0), f.z);
      f.root.rotation.y = f.yaw;
      f.h.play(f.motion, 0);
      f.h.update(Math.random() * 3);
    } else if (!on && f.h) {
      f.h.dispose();
      f.h = null;
      f.root.removeFromParent();
    }
  }

  /** The figure goes: in at the door or out of the game (`gone`), or let go for the PC of a player near it. */
  function drop(v: Visitor, gone = true): void {
    if (v.id && share.net) {
      if (gone) share.net.personGone(v.id);
      else share.net.release(v.id);
    }
    v.id = undefined;
    if (v.p && crowd?.alive(v.p)) crowd.removePuppet(v.p);
    v.p = null;
  }
  /** M8f sync pass 3: a new figure of this PC: its id (played together). */
  const netId = (v: Visitor): void => {
    if (share.on && share.net) v.id = share.net.newId("sv", v.kind);
  };
  let adoptWired = false;

  function spawnVisitor(cx: number, cz: number): void {
    if (!crowd) return;
    const ends = ENDS.filter(([x, z]) => crowd.isHidden(x, z) && !share.seenByOthers(x, z) && Math.hypot(x - cx, z - cz) > 8);
    if (!ends.length) return;
    const [x, z] = ends[Math.floor(Math.random() * ends.length)];
    const kind = VISITORS[Math.floor(Math.random() * VISITORS.length)];
    const p = crowd.addPuppet(kind, x, z, 0, 1.0 + Math.random() * 0.25);
    if (!p) return;
    const free = LOOK.filter((l) => !visitors.some((v) => v.look === l));
    const look = (free.length ? free : LOOK)[Math.floor(Math.random() * (free.length || LOOK.length))];
    crowd.puppetGo(p, look[0], look[1]);
    const v: Visitor = { kind, p, state: "coming", t: 0, goesIn: Math.random() < 0.7, look, to: [0, 0] };
    netId(v);
    visitors.push(v);
  }

  /** Move a standing puppet a step towards a point (the walk clip plays); true when there. */
  function stepTo(p: Puppet, to: P, dt: number, speed: number): boolean {
    const dx = to[0] - p.x;
    const dz = to[1] - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.08) return true;
    const k = Math.min(1, (speed * dt) / d);
    p.x += dx * k;
    p.z += dz * k;
    return false;
  }

  function visitorsUpdate(dt: number, open: boolean, near: boolean, cx: number, cz: number): void {
    if (!crowd) return;
    if (share.net && !adoptWired) {
      adoptWired = true;
      // M8f sync pass 3: a visitor another PC ran and let go near this player: this PC walks it off
      share.net.onAdopt("x:sv:", (id, o) => {
        const p = o as Puppet;
        const [x, z] = ENDS[Math.floor(Math.random() * ENDS.length)];
        crowd.puppetGo(p, x, z);
        visitors.push({ kind: id.split(":")[2] as HumanKind, p, state: "leaving", t: 0, goesIn: false, look: [x, z], to: [0, 0], id });
        return true;
      });
    }
    for (const v of visitors) if (v.p && v.id && share.net) share.net.person(v.id, v.p);
    // too far or shut: the ones outside go (dropped at once when Jef is far), the ones inside come out at closing
    for (let i = visitors.length - 1; i >= 0; i--) {
      const v = visitors[i];
      if (v.p && !crowd.alive(v.p)) v.p = null;
      if (!near) {
        // (one still near another player is his PC's to walk on)
        drop(v, !(v.p && share.on && nearestPlayer(v.p.x, v.p.z) < 60));
        visitors.splice(i, 1);
        continue;
      }
      v.t += dt;
      const p = v.p;
      switch (v.state) {
        case "coming":
          if (!p) {
            visitors.splice(i, 1);
          } else if (!crowd.puppetBusy(p) || Math.hypot(p.x - v.look[0], p.z - v.look[1]) < 0.6) {
            crowd.puppetStand(p, Math.random() < 0.3 ? "fold" : "idle", face(p.x, p.z, STEEN_DOOR.x, STEEN_DOOR.z));
            v.state = "looking";
            v.t = -(5 + Math.random() * 6);
          } else if (v.t > 150) { // the way up the ramp is long
            drop(v);
            visitors.splice(i, 1);
          }
          break;
        case "looking":
          if (!p) {
            visitors.splice(i, 1);
          } else if (v.t > 0) {
            if (v.goesIn && open) {
              crowd.puppetGo(p, STEEN_DOOR.x + (Math.random() - 0.5) * 0.6, STEEN_DOOR.z + 0.6, 0.9);
              v.state = "entering";
            } else {
              const [x, z] = ENDS[Math.floor(Math.random() * ENDS.length)];
              crowd.puppetGo(p, x, z);
              v.state = "leaving";
            }
            v.t = 0;
          }
          break;
        case "entering":
          if (!p) {
            visitors.splice(i, 1);
          } else if (Math.hypot(p.x - STEEN_DOOR.x, p.z - STEEN_DOOR.z) < 3.4 || (!crowd.puppetBusy(p) && v.t > 1) || v.t > 25) {
            // the last steps by hand, into the doorway
            v.to = [STEEN_DOOR.x + (Math.random() - 0.5) * 0.5, STEEN_DOOR.z + 0.3];
            crowd.puppetStand(p, "walk", Math.PI);
            v.state = "stepIn";
          }
          break;
        case "stepIn":
          if (!p) {
            v.state = "inside";
            v.t = -(40 + Math.random() * 80);
          } else if (stepTo(p, v.to, dt, 0.8)) {
            drop(v); // in through the open door
            v.state = "inside";
            v.t = -(40 + Math.random() * 80);
          }
          break;
        case "inside":
          if (v.t > 0 || !open) {
            const q = crowd.addPuppet(v.kind, STEEN_DOOR.x, STEEN_DOOR.z + 0.3, 0, 1.1);
            if (!q) break; // try again next frame
            v.p = q;
            netId(v);
            crowd.puppetStand(q, "walk", 0);
            v.to = [STEEN_DOOR.x + (Math.random() - 0.5) * 1.2, STEEN_DOOR.z + 3.0];
            v.state = "stepOut";
            v.t = 0;
          }
          break;
        case "stepOut":
          if (!p) {
            visitors.splice(i, 1);
          } else if (stepTo(p, v.to, dt, 0.9) || v.t > 8) {
            const [x, z] = ENDS[Math.floor(Math.random() * ENDS.length)];
            crowd.puppetGo(p, x, z);
            v.state = "leaving";
            v.t = 0;
          }
          break;
        case "leaving":
          if (!p || (!crowd.puppetBusy(p) && v.t > 1.5) || v.t > 90 || (Math.hypot(p.x - cx, p.z - cz) > 25 && crowd.isHidden(p.x, p.z))) {
            drop(v);
            visitors.splice(i, 1);
          }
          break;
      }
    }
    if (!near || !open) return;
    // (the PC of the player nearest the Steen brings the visitors for all: game/share.ts)
    if (!runsHere("g:st", -185, -12, 75)) return;
    spawnT -= dt;
    const outside = visitors.filter((v) => v.state !== "inside").length;
    if (spawnT <= 0 && outside < 3 && visitors.length < 5) {
      spawnT = 12 + Math.random() * 20;
      spawnVisitor(cx, cz);
    }
  }

  function update(dt: number, hour: number, cam: THREE.Camera): void {
    t += dt;
    model.update();
    const cx = cam.position.x;
    const cz = cam.position.z;
    const d = Math.hypot(cx - -185, cz - -12);
    const near = d < 90;
    const open = hour >= OPEN[0] && hour < OPEN[1];
    const night = hour < 6.8 || hour >= 18.6;
    group.visible = d < 260;
    for (const f of figs) {
      const on = near && hour >= f.hours[0] && hour < f.hours[1];
      show(f, on);
      if (f.h && Math.hypot(f.x - cx, f.z - cz) < 60) {
        f.routine ??= groundRound(world, [f.x, f.z], f.y, f.yaw, f.seat !== undefined, figs.indexOf(f) * 7, f.y ? 1.5 : 2.5);
        const { round: r, free } = f.routine;
        r.update(dt, Math.hypot(cx - r.x, cz - r.z) < .9, free);
        const sitting = r.atHome && f.seat !== undefined;
        f.h.play(r.walking ? "walk" : r.atHome ? f.motion : "behind");
        f.h.setPace(r.speed);
        f.root.position.set(r.x, f.y + (sitting ? f.h.sitDrop(f.seat!) : 0), r.z);
        f.root.rotation.y = r.walking ? r.yaw : r.atHome ? f.yaw : r.yaw;
        f.h.update(dt);
      }
    }
    easel.visible = hour >= 10 && hour < 16;
    if (fishLine && fishFloat && near) {
      const y = water.river + 0.02 + Math.sin(t * 1.3) * 0.02;
      fishFloat.position.y = y;
      const a = fishLine.getAttribute("position") as THREE.BufferAttribute;
      a.setY(1, y);
      a.needsUpdate = true;
    }
    rod.visible = hour >= 7 && hour < 17.5 && (figs[2].routine?.round.atHome ?? true);
    if (fishFloat) fishFloat.visible = rod.visible;
    doorway.visible = open;
    for (const l of lanterns) {
      l.glow.visible = night;
      l.flame.visible = night;
      l.src.on = night ? 1 : 0;
    }
    if (night) glowMat.opacity = 0.85 + 0.15 * Math.sin(t * 7.3) * Math.sin(t * 2.9);
    visitorsUpdate(dt, open, d < 75, cx, cz);
  }

  return {
    group,
    colliders,
    update,
    model,
    pathPoints: () => [
      { label: "the Steen, museum door (up the ramp)", x: STEEN_DOOR.x, z: STEEN_DOOR.z + 1.1, reach: 1.6 },
      { label: "the Steen, the ramp's foot", x: -202.2, z: -1.5, reach: 1.6 },
      { label: "the Steen, the painter", x: PAINTER[0] + 1.2, z: PAINTER[1] - 0.8, reach: 2.0 },
    ],
    info: () => ({
      model: model.info(),
      figures: figs.filter((f) => f.h).map((f) => f.kind),
      routines: figs.map(f => ({ kind: f.kind, x: f.root.position.x, z: f.root.position.z, routes: f.routine?.round.routes.length ?? null, walking: f.routine?.round.walking ?? false })),
      visitors: visitors.map((v) => ({ kind: v.kind, state: v.state, x: v.p ? +v.p.x.toFixed(1) : null, z: v.p ? +v.p.z.toFixed(1) : null, t: +v.t.toFixed(1) })),
      doorOpen: doorway.visible,
      lantern: lanterns[0].glow.visible,
      lanterns: lanterns.map((l) => ({ at: l.src.pos.toArray().map((v) => +v.toFixed(2)), on: l.src.on, level: +l.src.level.toFixed(2) })),
    }),
  };
}

/** The doorway: the four-centred head of the museum door, facing the lane (+z). */
function doorGeometry(w: number, h: number): THREE.BufferGeometry {
  const pts: P[] = [[0, 0], [1, 0], [1, 0.76], [0.9, 0.9], [0.7, 0.98], [0.5, 1], [0.3, 0.98], [0.1, 0.9], [0, 0.76]];
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2((x - 0.5) * w, y * h)));
  return new THREE.ShapeGeometry(shape);
}

/** The painter's canvas: a pale ground, the Steen's towers and roofs sketched in grey and brown. */
function sketchTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 48;
  const g = c.getContext("2d")!;
  g.fillStyle = "#d8d0bc";
  g.fillRect(0, 0, 64, 48);
  g.fillStyle = "#9aa4aa";
  g.fillRect(0, 0, 64, 18); // sky
  g.fillStyle = "#6f6a60";
  g.fillRect(10, 22, 40, 18); // the walls
  g.fillRect(8, 16, 9, 24); // the corner tower
  g.fillStyle = "#4a4f55";
  g.beginPath();
  g.moveTo(6, 16);
  g.lineTo(12.5, 4);
  g.lineTo(19, 16);
  g.fill(); // its roof
  g.beginPath();
  g.moveTo(18, 22);
  g.lineTo(34, 12);
  g.lineTo(50, 22);
  g.fill();
  g.fillStyle = "#7c8a90";
  g.fillRect(0, 40, 64, 8); // the river
  const t = new THREE.CanvasTexture(c);
  t.name = "sketch"; // (the bump audit: a painted picture stays flat, world/bumps.ts)
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}
