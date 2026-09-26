import * as THREE from "three";
import * as P from "../../../shared/cathedralPlan";
import { buildCathedral } from "./cathedralHall";
import type { LandmarkRoom } from "./landmarkRooms";
import { boxGeo, lambert, tex } from "./rooms";
import type { World } from "./rijnkaai";
import type { InWorld, InWorldRoom } from "./inworld";

// The cathedral in the world (M7): its hall (world/cathedralHall.ts buildCathedral, from the plan
// in shared/cathedralPlan.ts) stands inside the Blender shell at the shell's own place; the west
// door is a real opening (build_landmarks.py hangs no leaves there) with two oak leaves hung here
// in the street's scene, standing open into the nave by day and shut at night. Jef and the
// townspeople walk in from the Handschoenmarkt by the plan (World.addWalkArea); the renderer draws
// the hall through the door and the square through it from inside (world/inworld.ts).

/** The hall's own air inside: warm, a little hazy with incense, far (the pale stone carries the daylight). */
const AIR = { color: new THREE.Color(0x2a2620), near: 22, far: 120 };

export interface CathedralInWorld {
  room: LandmarkRoom;
  /** The server's word: the west door stands open (the church's hours, a wedding). */
  doorOpen: boolean;
  /** 0 on the square .. 1 in the nave (Jef's feet, world). */
  insideness(x: number, z: number): number;
  /** Near enough that the hall's life should run (m from the west door)? */
  near(x: number, z: number, m?: number): boolean;
  /** Each frame: the leaves, the hall's flames and lights, the glass by the day and the weather. */
  update(t: number, dt: number, day: number, sky: number, live?: boolean): void;
  /** World point <-> the hall's frame. */
  local(x: number, z: number): [number, number];
  world(x: number, z: number): [number, number];
}

export function createCathedralInWorld(world: World, inWorld: InWorld): CathedralInWorld {
  const room = buildCathedral({ origin: P.ORIGIN, yaw: 0 });
  let doorOpen = true;
  let leafAngle = P.LEAF.open;
  let dayNow = 1;
  const local = (x: number, z: number): [number, number] => P.toLocal(x, z);

  // ---- walking: the porch, the doorway and the halls by the plan
  world.addWalkArea({
    box: P.WORLD_BOX,
    has: (x, z) => P.inArea(x - P.ORIGIN.x, z - P.ORIGIN.z),
    walkable: (x, z) => P.hasFloor(x - P.ORIGIN.x, z - P.ORIGIN.z, doorOpen),
    floor: (x, z) => P.FLOOR_Y + P.floorAt(x - P.ORIGIN.x, z - P.ORIGIN.z),
    hits: (x, z, r) => P.hitsSolid(x - P.ORIGIN.x, z - P.ORIGIN.z, r, true),
  });

  // ---- the two leaves of the west door, hinged at the jambs (drawn with the street: seen from both sides)
  const D = P.SHELL.door;
  const DH = D.top - P.FLOOR_Y;
  // old oak, lighter than the tint suggests: the planks texture is dark and a leaf stands a step from the eye as you pass
  const oak = lambert("cathedral_leaf", { map: tex().planks, color: 0xe0c8a8 }, 0);
  const iron = lambert("cathedral_leaf_iron", { color: 0x2c2a28 }, 0);
  const leaves: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const hinge = new THREE.Group();
    hinge.position.set(P.ORIGIN.x + s * D.hw, P.FLOOR_Y, P.ORIGIN.z + D.z - 0.06);
    const w = P.LEAF.w;
    // the leaf reaches from its hinge toward the trumeau (-s along x)
    const leaf = new THREE.Mesh(boxGeo(w, DH, 0.12, 1.2), oak);
    leaf.position.set(-s * (w / 2), DH / 2, 0);
    hinge.add(leaf);
    // planks' battens and the iron straps with their hinges, on both faces
    for (const y of [DH * 0.18, DH * 0.5, DH * 0.82]) {
      for (const f of [-1, 1]) {
        const strap = new THREE.Mesh(new THREE.BoxGeometry(w * 0.72, 0.12, 0.03), iron);
        strap.position.set(-s * w * 0.36, y, f * 0.075);
        hinge.add(strap);
      }
    }
    world.scene.add(hinge);
    leaves.push(hinge);
  }
  const setLeaves = () => {
    // into the nave (+z): the left leaf (hinge at -x) turns negative, the right one positive
    leaves[0].rotation.y = -leafAngle;
    leaves[1].rotation.y = leafAngle;
  };
  setLeaves();

  // ---- the opening: the porch and the doorway with the leaves standing in it
  const box = new THREE.Box3(new THREE.Vector3(P.ORIGIN.x - 5.9, -0.2, P.ORIGIN.z - 1.6), new THREE.Vector3(P.ORIGIN.x + 5.9, 12.5, P.ORIGIN.z + D.z + P.LEAF.w + 0.4));
  const iw: InWorldRoom = {
    id: "cathedral",
    scene: room.scene,
    openings: [
      {
        kind: "door",
        label: "the west door of the cathedral",
        box,
        // from inside: the doorway, the tympanum's back over it and the two leaves standing in the nave
        inBox: new THREE.Box3(new THREE.Vector3(P.ORIGIN.x - D.hw - 0.2, 0, P.ORIGIN.z + D.z - 0.2), new THREE.Vector3(P.ORIGIN.x + D.hw + 0.2, D.top + 0.3, P.ORIGIN.z + D.z + P.LEAF.w + 0.2)),
        centre: new THREE.Vector3(P.ORIGIN.x, 3, P.ORIGIN.z + D.z),
        out: new THREE.Vector3(0, 0, -1),
        open: () => leafAngle > 0.08,
      },
    ],
    insideness: (eye) => P.insideness(eye.x - P.ORIGIN.x, eye.z - P.ORIGIN.z),
    reach: 95,
    air(k, street) {
      const fog = room.scene.fog as THREE.Fog;
      // from the square the hall shows through the street's own air (so far off it fades exactly as the
      // shell round it does), turning into the hall's still, dark air over the threshold
      fog.color.copy(street.color).lerp(AIR.color, k);
      fog.near = THREE.MathUtils.lerp(street.near, AIR.near, k);
      fog.far = THREE.MathUtils.lerp(street.far, AIR.far, k);
      // the eye coming in from the bright square: the hall looks darker from outside by day
      room.setAmbient?.(1 - 0.4 * (1 - k) * dayNow);
    },
    lamps: () => room.lamps,
    scatter: 0.3,
  };
  inWorld.add(iw);

  return {
    room,
    get doorOpen() {
      return doorOpen;
    },
    set doorOpen(v: boolean) {
      doorOpen = v;
    },
    insideness: (x, z) => P.insideness(x - P.ORIGIN.x, z - P.ORIGIN.z),
    near: (x, z, m = 200) => Math.hypot(x - P.ORIGIN.x, z - (P.ORIGIN.z + D.z)) < m || P.insideness(x - P.ORIGIN.x, z - P.ORIGIN.z) > 0,
    update(t, dt, day, sky, live = true) {
      const target = doorOpen ? P.LEAF.open : 0;
      const step = dt * 0.55;
      if (leafAngle !== target) {
        leafAngle += THREE.MathUtils.clamp(target - leafAngle, -step, step);
        setLeaves();
      }
      dayNow = day;
      // the flames, lights and glass always follow the hour (cheap): no step in them when the hall's life starts
      void live;
      room.update(t, dt);
      room.setDaylight(day, sky);
    },
    local,
    world: (x, z) => P.toWorld(x, z),
  };
}
