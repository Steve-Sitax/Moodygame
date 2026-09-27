import * as THREE from "three";
import * as PP from "../../../shared/prisonPlan";
import { buildChapel, buildGovernor, buildPrisonHall } from "./prisonRooms";
import { createHallInWorld, type HallInWorld } from "./hallInWorld";
import { windowOpenings } from "./realOpenings";
import { makeHuman, type Human, type HumanKind } from "../game/humans";
import type { ShellOpening } from "../../../shared/shellOpening";
import type { World } from "./rijnkaai";
import type { InWorld, Opening } from "./inworld";
import { lambert, tex } from "./rooms";

/** The prison panes' sky sheen by full day (the houses' take the air's own colour: houseInWorld.ts). */
const PANE_DAY = new THREE.Color(0x56646e);

// The prison in the world (M7 prison and squares; made real in M7 prison real, 2026-09-26: docs/milestones/
// M7-prison-real.md). Its rooms (world/prisonRooms.ts) stand inside the Blender shell (tools/blender/build_prison.py)
// at its true size and are walked by the plan (shared/prisonPlan.ts), the halls' way (world/hallInWorld.ts): the
// prison itself through its gate, the chapel through its door in the west court, the governor's house (shut). Every
// window of the shell is an opening of the room behind it (world/realOpenings.ts): the rooms are drawn through them
// from the street, the street through them from inside, and from inside only the windows that part can see.
// The courts are walk areas of their own in the street's scene: the exercise yard beyond wing A's door, the west
// court round the chapel beyond wing B's. The life: the warders by their shifts, the men in the ring at the hours of
// exercise, a man brought to the grille in visiting hours: all the server's (server/src/town/prison.ts).

type P2 = [number, number];

// ================================================================ the prison in the world

/** Where paths() checks the prison inside (local points; only while the gate stands open). */
export const PRISON_POINTS: HallInWorld["points"] = [
  { label: "the prison, inside the gate", x: 0, z: 1.6, reach: 1.2 },
  { label: "the prison, the guard room", x: -5.0, z: 6.4, reach: 1.0 },
  { label: "the prison, the visitors' grille", x: 6.8, z: 3.0, reach: 1.0 },
  { label: "the prison, the watch pavilion", x: 3.2, z: 19, reach: 1.2 },
  { label: "the prison, the cell corridor", x: 16.5, z: 19.5, reach: 1.2 },
  { label: "the prison, at an open cell's door", x: 10.2, z: 20.6, reach: 0.8 },
  { label: "the prison, at the other open cell's door", x: 18.6, z: 18.4, reach: 0.8 },
  { label: "the prison, the yard door", x: 13.0, z: 16.0, reach: 0.8 },
];
/** M7 prison real: wing B, the stairs' feet, the chapel and the west court (local; while the gate stands open). */
PRISON_POINTS.push(
  { label: "the prison, wing B's corridor", x: -16.5, z: 19.5, reach: 1.2 },
  { label: "the prison, wing B's yard door", x: -13.0, z: 16.0, reach: 0.8 },
  { label: "the prison, the foot of wing A's stair", x: 19.2, z: 19.5, reach: 0.8 },
  { label: "the prison, the foot of the link's stair", x: 1.75, z: 13.4, reach: 0.6 },
);
/** The chapel's points (the plan's own frame: shared/prisonPlan.ts CHAPEL_PLAN; x the prison's z, z minus its x). */
export const CHAPEL_POINTS: HallInWorld["points"] = [
  { label: "the prison chapel, inside its side door", x: PP.CHAPEL.side.z, z: 14.9, reach: 1.0 },
  { label: "the prison chapel, before the rail", x: 10.0, z: -PP.CHAPEL.xm, reach: 1.0 },
  { label: "the prison chapel, the aisle by the gable", x: 3.0, z: -PP.CHAPEL.xm, reach: 1.0 },
];
export const COURT_POINTS: HallInWorld["points"] = [
  { label: "the prison's west court, behind the front building", x: -8.0, z: 12.0, reach: 1.0 },
  { label: "the prison's west court, before the chapel's side door", x: -12.8, z: PP.CHAPEL.side.z, reach: 0.6 },
];

/**
 * The chapel's gable door (M7 prison real): a real doorway in the shell, shut for good (it opens on a strip a metre
 * wide along the street wall; the prisoners come in by the side door). Its leaves hang in the street's scene; it is
 * an opening of the chapel's room that never opens (the interior check finds it).
 */
function chapelGableDoor(world: World): Opening {
  const Ch = PP.CHAPEL;
  const frame = new THREE.Group();
  frame.position.set(PP.ORIGIN.x, PP.CHAPEL_FLOOR_Y, PP.ORIGIN.z);
  frame.rotation.y = PP.YAW;
  const oak = lambert("prison_chapel_leaf", { map: tex().planks, color: 0xd0b494 }, 0);
  const iron = lambert("prison_chapel_leaf_iron", { color: 0x2c2a28 }, 0);
  const hw = Ch.door.hw;
  const sp = Ch.door.spring;
  const z = Ch.reveal + 0.05;
  for (const s of [-1, 1]) {
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(hw - 0.01, sp, 0.1), oak);
    leaf.position.set(Ch.xm + s * (hw / 2), sp / 2, z);
    frame.add(leaf);
    for (const y of [0.4, sp - 0.4]) {
      const strap = new THREE.Mesh(new THREE.BoxGeometry(hw * 0.8, 0.08, 0.13), iron);
      strap.position.set(Ch.xm + s * (hw / 2), y, z);
      frame.add(strap);
    }
  }
  const head = new THREE.Shape();
  head.moveTo(hw, sp);
  for (let i = 0; i <= 8; i++) head.lineTo(hw * Math.cos((Math.PI * i) / 8), sp + hw * Math.sin((Math.PI * i) / 8));
  head.lineTo(hw, sp);
  const hg = new THREE.ExtrudeGeometry(head, { depth: 0.1, bevelEnabled: false });
  hg.translate(Ch.xm, 0, z - 0.05);
  frame.add(new THREE.Mesh(hg, oak));
  world.scene.add(frame);
  const box = new THREE.Box3();
  for (const [x, zz] of [[Ch.xm - 1.0, Ch.faceZ - 0.4], [Ch.xm + 1.0, Ch.faceZ - 0.4], [Ch.xm - 1.0, Ch.z0 + 0.1], [Ch.xm + 1.0, Ch.z0 + 0.1]]) {
    const [wx, wz] = PP.toWorld(x, zz);
    box.expandByPoint(new THREE.Vector3(wx, 0, wz)).expandByPoint(new THREE.Vector3(wx, PP.CHAPEL_FLOOR_Y + sp + hw + 0.3, wz));
  }
  const [cx, cz] = PP.toWorld(Ch.xm, Ch.faceZ);
  const [ox, oz] = PP.toWorld(Ch.xm, Ch.faceZ - 1);
  return { kind: "door", label: "the chapel, the gable door (shut)", box, centre: new THREE.Vector3(cx, 1.4, cz), out: new THREE.Vector3(ox - cx, 0, oz - cz).normalize(), open: () => false };
}
/** Where paths() checks the yard (local): by the ring, its benches. */
export const YARD_POINTS: HallInWorld["points"] = [
  { label: "the prison yard, by the ring", x: PP.PARTS.ring.x - PP.PARTS.ring.r_out - 1.0, z: PP.PARTS.ring.z, reach: 1.0 },
  { label: "the prison yard, a bench", x: 16.0, z: 1.8, reach: 0.8 },
];

export interface PrisonState {
  visiting: boolean;
  exercise: boolean;
  dayShift: boolean;
  warders: Array<{ role: string; name: string }>;
  inmates: Array<{ id: string; name: string; crime: string; since: number; until: number }>;
  ring: number;
}

export interface PrisonInWorld {
  hall: HallInWorld;
  /** M7 prison real: its three rooms in the world (the prison, the chapel, the governor's house), for the checks. */
  halls(): HallInWorld[];
  readonly indoors: boolean;
  update(t: number, dt: number, day: number, hour: number, daylight: number, sky: number): void;
  pathPoints(): Array<{ label: string; x: number; z: number; reach: number }>;
  /** E: Jef at the grille, by a warder: what he may do there (null: nothing here). */
  action(x: number, z: number): { label: string; run(): void } | null;
  /** Dev: the state from the server, the figures drawn. */
  info(): unknown;
}

/**
 * The prison in the world: its hall (open in visiting hours; a warder shows Jef out at the end), the yard as a walk
 * area of its own beyond wing A's door, the warders at their posts by their shifts, the men walking the ring at the
 * hours of exercise, a man brought to the grille when Jef asks for a visit. All hours and people from the server.
 */
export function prisonInWorld(
  world: World,
  inWorld: InWorld,
  hooks: {
    roomSound(k: string | null): void;
    say(t: string): void;
    jef(): { x: number; z: number; place(x: number, z: number, yaw: number): void };
    talk(id: string, name: string): void;
  },
): PrisonInWorld {
  // ---- the rooms, each window an opening; from inside only what that part can see (the plan's zones)
  const built = buildPrisonHall();
  const room = built.room;
  let eyeAt = new THREE.Vector3(NaN, 0, 0);
  let eyeZone: PP.Zone | null = null;
  const zoneOfEye = (eye: THREE.Vector3) => {
    if (!eye.equals(eyeAt)) {
      eyeAt = eye.clone();
      const [lx, lz] = PP.toLocal(eye.x, eye.z);
      eyeZone = PP.zoneAt(lx, eye.y, lz);
    }
    return eyeZone;
  };
  const seen = (o: ShellOpening) => {
    const zid = PP.zoneOf(o)?.id;
    if (!zid) return undefined;
    return (eye: THREE.Vector3) => {
      const z = zoneOfEye(eye);
      return !z || PP.sees(z.id, zid);
    };
  };
  const hall = createHallInWorld(world, inWorld, PP.PLAN, room, { color: 0x22241f, near: 14, far: 70 }, PRISON_POINTS, [], 0.3, windowOpenings(built.windows, PP.toWorld, seen));
  // (from inside, the street through the windows within 14 m: the pavilion's high windows show its clear sky colour)
  const iwPrison = inWorld.all.find((r) => r.id === PP.PLAN.id);
  if (iwPrison) iwPrison.insideReach = 14;
  const chapel = buildChapel();
  const chapelHall = createHallInWorld(world, inWorld, PP.CHAPEL_PLAN, chapel.room, { color: 0x2a2622, near: 12, far: 50 }, CHAPEL_POINTS, [], 0.3, [
    ...windowOpenings(chapel.windows, PP.toWorld),
    chapelGableDoor(world),
  ]);
  const governor = buildGovernor();
  const govHall = createHallInWorld(world, inWorld, PP.GOV_PLAN, governor.room, { color: 0x241e18, near: 8, far: 30 }, [], [], 0.3, windowOpenings(governor.windows, PP.toWorld));
  govHall.doorOpen = false;
  // ---- the courts: walk areas of their own (the walk map has the whole compound as wall)
  const L = (x: number, z: number) => PP.toLocal(x, z);
  const inR = (rs: typeof PP.YARD, x: number, z: number, m = 0) => rs.some((q) => x > q.minX - m && x < q.maxX + m && z > q.minZ - m && z < q.maxZ + m);
  const yardHas = (x: number, z: number) => inR(PP.YARD, ...L(x, z));
  const courtHas = (x: number, z: number) => inR(PP.COURT_W, ...L(x, z));
  const ringers: Array<{ h: Human | null; a: number; kind: HumanKind }> = [];
  const worldBox = (rs: typeof PP.YARD) => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const q of rs)
      for (const [x, z] of [[q.minX, q.minZ], [q.maxX, q.minZ], [q.maxX, q.maxZ], [q.minX, q.maxZ]] as P2[]) {
        const [wx, wz] = PP.toWorld(x, z);
        minX = Math.min(minX, wx);
        maxX = Math.max(maxX, wx);
        minZ = Math.min(minZ, wz);
        maxZ = Math.max(maxZ, wz);
      }
    return { minX, maxX, minZ, maxZ };
  };
  let doorOpen = true;
  world.addWalkArea({
    box: worldBox(PP.YARD),
    has: yardHas,
    walkable: (x, z) => doorOpen && yardHas(x, z),
    floor: () => 0,
    // (World asks every area near a point for its solids: only within the court itself, not in the buildings round it)
    hits: (x, z, r) => inR(PP.YARD, ...L(x, z)) && inR(PP.YARD_SOLIDS, ...L(x, z), r),
  });
  world.addWalkArea({
    box: worldBox(PP.COURT_W),
    has: courtHas,
    walkable: (x, z) => doorOpen && courtHas(x, z),
    floor: () => 0,
    hits: (x, z, r) => inR(PP.COURT_W, ...L(x, z)) && inR(PP.COURT_W_SOLIDS, ...L(x, z), r),
  });

  // ---- the people: warders and men, drawn by the state from the server
  let state: PrisonState | null = null;
  let lastFetch = -1e9;
  const fetchState = () => {
    void fetch("/api/prison", { signal: AbortSignal.timeout(6000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((s: PrisonState | null) => {
        if (s) state = s;
      })
      .catch(() => {});
  };
  type Fig = { h: Human | null; kind: HumanKind; x: number; z: number; yaw: number; y: number; motion: "idle" | "sit" | "walk" | "behind"; inHall: THREE.Group | null; on: () => boolean; seat: number };
  const figs: Fig[] = [];
  const fig = (kind: HumanKind, x: number, z: number, yaw: number, motion: Fig["motion"], inHall: boolean | THREE.Group, on: () => boolean, seat = 0.45, y = 0) =>
    figs.push({ h: null, kind, x, z, yaw, y, motion, inHall: inHall === true ? room.group : inHall === false ? null : inHall, on, seat });
  let hourNow = 12;
  const has = (role: string) => !!state?.warders.some((w) => w.role === role);
  const M_ = PP.PLAN.marks;
  fig("police", M_.guardTable.x, M_.guardTable.z, M_.guardTable.yaw, "sit", true, () => has("guard"));
  fig("police", M_.chief.x, M_.chief.z, M_.chief.yaw, "behind", true, () => has("chief"));
  fig("police", M_.gangway.x, M_.gangway.z, M_.gangway.yaw, "sit", true, () => !!state?.visiting && has("visits"), 0.5);
  fig("police", 16.5, 19.5, -Math.PI / 2, "idle", true, () => has("chief") && !!state?.dayShift);
  fig("police", PP.GATE_WARDER.x, PP.GATE_WARDER.z, Math.PI, "behind", false, () => has("gate") || has("gate_night"));
  fig("police", PP.PARTS.ring.x, PP.PARTS.ring.z, 0, "behind", false, () => !!state?.exercise && has("yard"));
  // a man at his oakum in the open cell, on the edge of his bed; another in wing B's open cell
  fig("docker_c", 18.0, 16.1, Math.PI / 2, "sit", true, () => true, 0.55);
  fig("old_man", -15.2, 22.4, -Math.PI / 2, "sit", true, () => true, 0.55);
  // M7 prison real: the clerk in the registry and the director in his room by day, a warder in wing B and one on its
  // gallery, the governor at his desk in the evening (seen through his window)
  fig("police", M_.corridorB.x, M_.corridorB.z, M_.corridorB.yaw, "idle", true, () => !!state?.dayShift && has("chief"));
  fig("police", M_.galleryB.x, M_.galleryB.z, M_.galleryB.yaw, "idle", true, () => !!state?.dayShift, 0.45, M_.galleryB.y ?? 0);
  fig("old_man", M_.clerk.x, M_.clerk.z, M_.clerk.yaw, "sit", true, () => hourNow >= 8 && hourNow < 18, 0.45, M_.clerk.y ?? 0);
  fig("old_man", M_.director.x, M_.director.z, M_.director.yaw, "sit", true, () => hourNow >= 9 && hourNow < 16, 0.45, M_.director.y ?? 0);
  fig("old_man", -24.0, 6.9, Math.PI, "sit", governor.room.group, () => hourNow >= 18 && hourNow < 22, 0.45, 0);
  // the man brought to the grille (a visit)
  let visitor: { id: string; name: string } | null = null;
  fig("docker_a", M_.prisoner.x, M_.prisoner.z, M_.prisoner.yaw, "idle", true, () => !!visitor);
  const KINDS: HumanKind[] = ["docker_a", "docker_b", "docker_c", "old_man", "beggar", "sailor_b", "docker_c", "old_man", "docker_b", "docker_a"];
  for (let i = 0; i < 10; i++) ringers.push({ h: null, a: (i / 10) * Math.PI * 2, kind: KINDS[i] });

  const toW = (x: number, z: number) => PP.toWorld(x, z);
  let inside = false;
  const RING_R = (PP.PARTS.ring.r_in + PP.PARTS.ring.r_out) / 2;
  return {
    hall,
    get indoors() {
      return inside;
    },
    update(t, dt, dayN, hour, daylight, sky) {
      hourNow = hour;
      if (t - lastFetch > (state ? 10 : 2)) {
        lastFetch = t;
        fetchState();
      }
      const want = state ? state.visiting : false;
      const jef = hooks.jef();
      const k = hall.insideness(jef.x, jef.z);
      const [jx, jz] = L(jef.x, jef.z);
      const inYard = inR(PP.YARD, jx, jz) || inR(PP.COURT_W, jx, jz) || chapelHall.insideness(jef.x, jef.z) > 0.2;
      if (doorOpen && !want && (k > 0.2 || inYard)) {
        const [sx, sz] = toW(PP.PLAN.marks.door.x, PP.PLAN.marks.door.z);
        jef.place(sx, sz, PP.YAW); // (facing away from the gate, down the wall street)
        hooks.say("\"Visiting hours are over.\" A warder walks you back down the passage, and the gate shuts behind you.");
        visitor = null;
      }
      doorOpen = want;
      hall.doorOpen = want;
      chapelHall.doorOpen = want;
      hall.update(t, dt, daylight, sky);
      chapelHall.update(t, dt, daylight, sky);
      govHall.update(t, dt, daylight, sky);
      // the lights by the prison's routine: each part's glow and lamps at night; the glass a little of the sky from outside
      const dusk = THREE.MathUtils.clamp((0.45 - daylight) / 0.25, 0, 1);
      const lit = PP.prisonLights(dayN, hour);
      built.night(lit, dusk);
      chapel.night(lit, dusk);
      governor.night(lit, dusk);
      // the chapel's leaded glass: dark with a grey sheen from outside by day, glowing with the daylight from inside
      const kc = chapelHall.insideness(jef.x, jef.z);
      chapel.glass.color.setScalar(Math.max(THREE.MathUtils.lerp(0.35 + 0.25 * daylight, 0.35 + 0.85 * daylight, kc), 0.35 + 0.6 * lit.chapel * dusk));
      const kIn = Math.max(k, chapelHall.insideness(jef.x, jef.z));
      for (const g of [built.glass, governor.glass]) {
        // a little of the grey sky on the glass from outside by day, nearly clear from inside (as the houses' panes)
        // (2026-09-27: fading with the square of the daylight, no switch at dusk: see houseInWorld.ts, the panes)
        g.opacity = 0.12 + 0.28 * daylight * daylight * (1 - kIn);
        g.color.setHex(0x3a3834).lerp(PANE_DAY, daylight);
      }
      const now = inside ? kIn > 0.35 : kIn > 0.55;
      if (now !== inside) {
        inside = now;
        hooks.roomSound(inside ? "vault" : null);
      }
      // the figures: in the hall's scene (its frame) or the street's (world)
      for (const f of figs) {
        const on = f.on();
        if (!on) {
          if (f.h) f.h.root.visible = false;
          continue;
        }
        if (!f.h) {
          f.h = makeHuman(f.kind);
          if (!f.h) continue;
          if (f.inHall) f.inHall.add(f.h.root);
          else world.scene.add(f.h.root);
          f.h.play(f.motion, 0);
        }
        const h = f.h;
        h.root.visible = true;
        if (f.inHall) {
          h.root.position.set(f.x, f.y + (f.motion === "sit" ? h.sitDrop(f.seat) : 0), f.z);
          h.root.rotation.y = f.yaw;
        } else {
          const [wx, wz] = toW(f.x, f.z);
          h.root.position.set(wx, 0, wz);
          h.root.rotation.y = f.yaw + PP.YAW;
        }
        h.update(Math.min(dt, 0.1));
      }
      // the men in the ring: walking round, clockwise, a few paces apart, at the hours of exercise
      const n = state?.exercise ? state.ring : 0;
      ringers.forEach((q, i) => {
        if (i >= n) {
          if (q.h) q.h.root.visible = false;
          return;
        }
        if (!q.h) {
          q.h = makeHuman(q.kind);
          if (!q.h) return;
          world.scene.add(q.h.root);
          q.h.play("walk", 0);
          q.h.setPace(0.8);
        }
        q.a -= (0.8 / RING_R) * dt;
        const lx = PP.PARTS.ring.x + Math.cos(q.a) * RING_R;
        const lz = PP.PARTS.ring.z + Math.sin(q.a) * RING_R;
        const [wx, wz] = toW(lx, lz);
        q.h.root.visible = true;
        q.h.root.position.set(wx, 0.05, wz);
        // facing along the ring (clockwise in the frame)
        const tx = Math.sin(q.a);
        const tz = -Math.cos(q.a);
        q.h.root.rotation.y = Math.atan2(tx, tz) + PP.YAW;
        q.h.update(Math.min(dt, 0.1));
      });
    },
    pathPoints() {
      if (!hall.doorOpen) return [];
      const out = [...PRISON_POINTS, ...YARD_POINTS, ...COURT_POINTS].map((p) => {
        const [x, z] = toW(p.x, p.z);
        return { label: p.label, x, z, reach: p.reach };
      });
      // (the chapel's points are in its plan's own frame)
      for (const p of CHAPEL_POINTS) {
        const [x, z] = chapelHall.world(p.x, p.z);
        out.push({ label: p.label, x, z, reach: p.reach });
      }
      return out;
    },
    action(x, z) {
      const [lx, lz] = L(x, z);
      // at the grille in the visitors' room
      if (hall.doorOpen && lx > PP.IN.passWall && lx < PP.IN.front.x1 && lz > PP.IN.grille1 - 1.2 && lz < PP.IN.grille1 + 0.2) {
        return {
          label: "ask to see a prisoner",
          run() {
            void fetch("/api/prison/visit", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(8000) })
              .then((r) => r.json())
              .then((v: { ok: boolean; id?: string; name?: string; text: string }) => {
                hooks.say(v.text);
                if (v.ok && v.id && v.name) {
                  visitor = { id: v.id, name: v.name };
                  hooks.talk(v.id, v.name);
                }
              })
              .catch(() => hooks.say("The warder does not hear you."));
          },
        };
      }
      // by a warder: the gate warder on the street, the yard warder, the chief at his desk
      const near = (px: number, pz: number, r: number) => Math.hypot(lx - px, lz - pz) < r;
      const ask = (role: string) => ({
        label: "speak to the warder",
        run() {
          void fetch("/api/prison/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role }), signal: AbortSignal.timeout(8000) })
            .then((r) => r.json())
            .then((v: { text: string }) => hooks.say(v.text))
            .catch(() => {});
        },
      });
      if (near(PP.GATE_WARDER.x, PP.GATE_WARDER.z, 2.0) || near(0, -1.8, 1.6)) return ask(state?.dayShift ? "gate" : "gate_night");
      if (state?.exercise && near(PP.PARTS.ring.x, PP.PARTS.ring.z, PP.PARTS.ring.r_out + 1.5)) return ask("yard");
      if (hall.doorOpen && near(PP.PLAN.marks.chief.x, PP.PLAN.marks.chief.z, 2.4)) return ask("chief");
      if (hall.doorOpen && near(PP.PLAN.marks.gangway.x, PP.PLAN.marks.gangway.z, 2.2)) return ask("visits");
      return null;
    },
    info() {
      return { state, doorOpen, inside, visitor, figs: figs.map((f) => ({ kind: f.kind, on: f.on(), drawn: !!f.h?.root.visible })), ring: ringers.filter((q) => q.h?.root.visible).length, windows: { prison: built.windows.length, chapel: chapel.windows.length, governor: governor.windows.length } };
    },
    halls: () => [hall, chapelHall, govHall],
  };
}
