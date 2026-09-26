import * as THREE from "three";
import { addSpill, type SpillSource } from "./spill";
import * as HP from "../../../shared/hallPlan";
import type { HallPlan } from "../../../shared/hallPlan";
import type { LandmarkId } from "../../../shared/landmarks";
import type { LandmarkRoom } from "./landmarkRooms";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { boxGeo, lambert, tex } from "./rooms";
import { glass } from "./landmarkKit";
import type { World } from "./rijnkaai";
import type { InWorld, InWorldRoom, Opening } from "./inworld";

// The landmark halls in the world (M7 halls, docs/milestones/M7-halls-inworld.md): the town hall, the
// Vleeshuis, the Oostershuis and the Steen, the cathedral's way (world/cathedralInWorld.ts). The hall
// (world/landmarkHalls.ts) is built from its plan (shared/*Plan.ts) at the shell's own place; each street
// door of the shell is a real opening (tools/blender/build_landmarks.py hangs no leaves there) with oak
// leaves hung here in the street's scene, standing open into the hall by day and shut at closing time.
// Jef and the townspeople walk in by the plan (World.addWalkArea, with storeys by the feet); the renderer
// draws the hall through its doors and the street through them from inside (world/inworld.ts).

export interface HallAir {
  color: number;
  near: number;
  far: number;
}

/** A hall in the world, as game/landmarks.ts drives it (the cathedral's in-world object has the same shape). */
export interface HallInWorld {
  id: LandmarkId;
  plan: HallPlan;
  room: LandmarkRoom;
  /** The server's word per door: open or shut (landmarkOpen). */
  doorOpen: boolean;
  /** 0 on the street .. 1 in the hall (Jef's feet, world). */
  insideness(x: number, z: number): number;
  /** Near enough that the hall's life should run (m from a door)? */
  near(x: number, z: number, m?: number): number | null;
  /** Each frame: the leaves, the hall's lights, the glass by the day and the weather. */
  update(t: number, dt: number, day: number, sky: number): void;
  /** World point <-> the hall's frame. */
  local(x: number, z: number): [number, number];
  world(x: number, z: number): [number, number];
  /** The storey Jef's feet are on (-1 on a stair), and the floor under them (local), for his feet (world). */
  level(x: number, z: number, feet: number): number;
  floor(x: number, z: number, feet: number): number;
  /** Its places on the ground floor for the path check (local). */
  points: Array<{ label: string; x: number; z: number; reach: number }>;
}

/** Oak leaves, iron straps: one leaf of width w and height h, hinged at x 0, reaching toward -side. */
function leaf(side: number, w: number, h: number, oak: THREE.Material, iron: THREE.Material): THREE.Group {
  const hinge = new THREE.Group();
  const m = new THREE.Mesh(boxGeo(w, h, 0.1, 1.2), oak);
  m.position.set(-side * (w / 2), h / 2, 0);
  hinge.add(m);
  for (const y of [h * 0.18, h * 0.5, h * 0.82]) {
    for (const f of [-1, 1]) {
      const strap = new THREE.Mesh(new THREE.BoxGeometry(w * 0.72, 0.1, 0.03), iron);
      strap.position.set(-side * w * 0.36, y, f * 0.065);
      hinge.add(strap);
    }
  }
  return hinge;
}

/**
 * A window of the shell that glows to the street at night when the hall is lit (room.nightGlow): a pane of
 * warm light laid just over the Blender window (local: its middle across on the face, the face's plane, the
 * way out of it, bottom and top over the ground floor, width).
 */
export interface GlowPane {
  along: "x" | "z";
  a: number;
  face: number;
  out: 1 | -1;
  y0: number;
  y1: number;
  w: number;
}

export function createHallInWorld(world: World, inWorld: InWorld, plan: HallPlan, room: LandmarkRoom, air: HallAir, points: HallInWorld["points"], glow: GlowPane[] = [], scatter = 0.3): HallInWorld {
  const AIR = { color: new THREE.Color(air.color), near: air.near, far: air.far };
  const open = new Map<string, number>(plan.doors.map((d) => [d.id, d.open]));
  let doorOpen = true;
  let dayNow = 1;
  const isOpen = (id: string) => (open.get(id) ?? 0) > 0.08;
  const local = (x: number, z: number) => HP.toLocal(plan, x, z);
  const toW = (x: number, z: number) => HP.toWorld(plan, x, z);

  // ---- walking: the porches, the doorways and the halls by the plan (the feet pick the storey)
  const lf = (feet?: number) => (feet === undefined ? 0 : feet - plan.floorY);
  world.addWalkArea({
    box: HP.worldBox(plan),
    has: (x, z) => HP.answers(plan, ...local(x, z)),
    walkable: (x, z, feet) => HP.walkable(plan, ...local(x, z), lf(feet), isOpen),
    floor: (x, z, feet) => plan.floorY + HP.floorAt(plan, ...local(x, z), lf(feet)),
    hits: (x, z, r, feet) => HP.hits(plan, ...local(x, z), r, lf(feet), true),
  });

  // ---- the leaves of each street door, in the street's frame (seen from both sides)
  const frame = new THREE.Group();
  frame.position.set(plan.origin.x, plan.floorY, plan.origin.z);
  frame.rotation.y = plan.yaw;
  world.scene.add(frame);
  frame.updateMatrixWorld(true);
  const oak = lambert(`${plan.id}_leaf`, { map: tex().planks, color: 0xd0b494 }, 0);
  const iron = lambert(`${plan.id}_leaf_iron`, { color: 0x2c2a28 }, 0);
  const leaves = plan.doors.map((d) => {
    const n = d.leaves;
    const w = (2 * d.hw) / n;
    const hs: THREE.Group[] = [];
    for (const s of n === 2 ? [-1, 1] : [1]) {
      const h = leaf(s, w, d.h, oak, iron);
      h.position.set(d.x + s * d.hw, d.y, d.z + d.dir * 0.06);
      frame.add(h);
      hs.push(h);
    }
    // an arched head over the leaves: a fixed board filling it (seen from both sides)
    if (d.archTop?.length) {
      const sh = new THREE.Shape();
      sh.moveTo(d.hw, d.h);
      for (const [x, y] of d.archTop) sh.lineTo(x, y);
      sh.lineTo(-d.hw, d.h);
      sh.lineTo(d.hw, d.h);
      const g = new THREE.ExtrudeGeometry(sh, { depth: 0.08, bevelEnabled: false });
      g.translate(0, 0, -0.04);
      const uv = g.getAttribute("uv") as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 1.2, uv.getY(i) / 1.2);
      const board = new THREE.Mesh(g, oak);
      board.position.set(d.x, d.y, d.z + d.dir * 0.06);
      frame.add(board);
    }
    return { d, hs, w };
  });
  // ---- lit windows to the street at night (the Vleeshuis's theatre at play): warm panes over the shell's windows
  let glowMesh: THREE.Mesh | null = null;
  if (glow.length) {
    const geos = glow.map((g) => {
      const q = new THREE.PlaneGeometry(g.w, g.y1 - g.y0);
      // facing out of the building: a pane on a face across z looks along z, one across x along x
      if (g.along === "x") q.rotateY(g.out > 0 ? 0 : Math.PI);
      else q.rotateY(g.out > 0 ? Math.PI / 2 : -Math.PI / 2);
      const [x, z] = g.along === "x" ? [g.a, g.face + g.out * 0.1] : [g.face + g.out * 0.1, g.a];
      q.translate(x, (g.y0 + g.y1) / 2, z);
      return q;
    });
    const merged = mergeGeometries(geos, false)!;
    for (const q of geos) q.dispose();
    const mat = new THREE.MeshBasicMaterial({ map: glass("grisaille", 57), color: 0xffb060, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    glowMesh = new THREE.Mesh(merged, mat);
    glowMesh.visible = false;
    glowMesh.name = `${plan.id}_lit_windows`;
    frame.add(glowMesh);
  }
  // ---- the lit hall's light on the street (world/spill.ts): its lit windows at night, its open doors after dark
  const paneSpills: SpillSource[] = glow.map((g) => {
    const [ax, az] = g.along === "x" ? [g.a, g.face + g.out * 0.12] : [g.face + g.out * 0.12, g.a];
    const [bx, bz] = g.along === "x" ? [g.a, g.face + g.out * 1.12] : [g.face + g.out * 1.12, g.a];
    const [mx, mz] = toW(ax, az);
    const [nx, nz] = toW(bx, bz);
    return addSpill({ kind: "hall", label: `${plan.id} lit window`, x: mx, y: plan.floorY + (g.y0 + g.y1) / 2, z: mz, nx: nx - mx, nz: nz - mz, hw: g.w / 2, hh: (g.y1 - g.y0) / 2, bars: 23 });
  });
  const doorSpills = plan.doors.map((d) => {
    const [mx, mz] = toW(d.x, d.z - d.dir * 0.02);
    const [nx, nz] = toW(d.x, d.z - d.dir * 1.02);
    return { d, s: addSpill({ kind: "hall", label: `${plan.id} door`, x: mx, y: plan.floorY + d.y + d.h / 2, z: mz, nx: nx - mx, nz: nz - mz, hw: d.hw, hh: d.h / 2 }) };
  });
  const setLeaves = () => {
    for (const { d, hs } of leaves) {
      const a = open.get(d.id) ?? 0;
      // into the hall: a leaf hinged at -x turns one way, at +x the other; a door opening to -z mirrors it
      if (hs.length === 2) {
        hs[0].rotation.y = -a * d.dir;
        hs[1].rotation.y = a * d.dir;
      } else hs[0].rotation.y = a * d.dir;
    }
  };
  setLeaves();

  // ---- the openings: from outside the porch, the doorway and the leaves; from inside the doorway
  const wbox = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => {
    const b = new THREE.Box3();
    for (const x of [x0, x1])
      for (const z of [z0, z1]) {
        const [wx, wz] = toW(x, z);
        b.expandByPoint(new THREE.Vector3(wx, plan.floorY + y0, wz));
        b.expandByPoint(new THREE.Vector3(wx, plan.floorY + y1, wz));
      }
    return b;
  };
  const openings: Opening[] = leaves.map(({ d, w }) => {
    const reach = Math.max(w, Math.abs(d.inner - d.z)) + 0.3;
    const zOut = d.z - d.dir * 2.9;
    const zIn = d.z + d.dir * reach;
    const zDoorOut = d.z - d.dir * 0.25;
    const [cx, cz] = toW(d.x, d.z);
    const [ox, oz] = toW(d.x, d.z - d.dir);
    return {
      kind: "door",
      label: d.id,
      box: wbox(d.x - d.hw - 1.0, d.x + d.hw + 1.0, -0.5, Math.max(d.h, 2.2) + 0.4, Math.min(zOut, zIn), Math.max(zOut, zIn)),
      inBox: wbox(d.x - d.hw - 0.2, d.x + d.hw + 0.2, -0.2, d.h + 0.25, Math.min(zDoorOut, zIn), Math.max(zDoorOut, zIn)),
      centre: new THREE.Vector3(cx, plan.floorY + d.h / 2, cz),
      out: new THREE.Vector3(ox - cx, 0, oz - cz).normalize(),
      open: () => isOpen(d.id),
    };
  });
  const iw: InWorldRoom = {
    id: plan.id,
    scene: room.scene,
    openings,
    insideness: (eye) => HP.insideness(plan, ...local(eye.x, eye.z)),
    reach: 95,
    air(k, street) {
      const fog = room.scene.fog as THREE.Fog;
      // from the street the hall shows through the street's own air, turning into its own over the threshold
      fog.color.copy(street.color).lerp(AIR.color, k);
      fog.near = THREE.MathUtils.lerp(street.near, AIR.near, k);
      fog.far = THREE.MathUtils.lerp(street.far, AIR.far, k);
      // the eye coming in from the bright street: the hall looks darker from outside by day
      room.setAmbient?.(1 - 0.4 * (1 - k) * dayNow);
    },
    lamps: () => room.lamps,
    scatter,
  };
  inWorld.add(iw);

  return {
    id: plan.id,
    plan,
    room,
    get doorOpen() {
      return doorOpen;
    },
    set doorOpen(v: boolean) {
      doorOpen = v;
    },
    insideness: (x, z) => HP.insideness(plan, ...local(x, z)),
    near(x, z, m = 150) {
      let best: number | null = null;
      for (const d of plan.doors) {
        const [wx, wz] = toW(d.x, d.z);
        const dist = Math.hypot(x - wx, z - wz);
        if (dist < m && (best === null || dist < best)) best = dist;
      }
      if (best === null && HP.insideness(plan, ...local(x, z)) > 0) best = 0;
      return best;
    },
    update(t, dt, day, sky) {
      const target = doorOpen ? 1 : 0;
      let moved = false;
      for (const d of plan.doors) {
        const a = open.get(d.id) ?? 0;
        const want = target * d.open;
        if (a !== want) {
          open.set(d.id, a + THREE.MathUtils.clamp(want - a, -dt * 0.55, dt * 0.55));
          moved = true;
        }
      }
      if (moved) setLeaves();
      dayNow = day;
      room.update(t, dt);
      room.setDaylight(day, sky);
      const dusk = THREE.MathUtils.clamp((0.45 - day) / 0.25, 0, 1);
      if (glowMesh) {
        const k = (room.nightGlow?.() ?? 0) * dusk;
        (glowMesh.material as THREE.MeshBasicMaterial).opacity = k * (0.85 + 0.1 * Math.sin(t * 3.1) * Math.sin(t * 1.7));
        glowMesh.visible = k > 0.01;
      }
      {
        const k = (room.nightGlow?.() ?? 0) * dusk;
        for (const s of paneSpills) {
          s.level = k;
          s.glow = () => k;
        }
        // an open door shows the lit hall (its lamps burn while it is open)
        for (const { d, s } of doorSpills) {
          const a = THREE.MathUtils.smoothstep((open.get(d.id) ?? 0) / Math.max(d.open, 0.01), 0.05, 0.6);
          s.level = a * dusk;
          s.glow = () => a * dusk;
        }
      }
    },
    local,
    world: toW,
    level: (x, z, feet) => HP.levelAt(plan, ...local(x, z), feet - plan.floorY),
    floor: (x, z, feet) => HP.floorAt(plan, ...local(x, z), feet - plan.floorY),
    points,
  };
}
