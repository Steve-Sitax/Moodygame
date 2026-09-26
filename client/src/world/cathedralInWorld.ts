import * as THREE from "three";
import * as P from "../../../shared/cathedralPlan";
import { buildCathedral } from "./cathedralHall";
import type { LandmarkRoom } from "./landmarkRooms";
import { psx } from "../retro/psx";
import type { World } from "./rijnkaai";
import type { InWorld, InWorldRoom } from "./inworld";
import { addSpill } from "./spill";

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
  // The leaves: the cathedral's oak doors with their iron (the portals' picture, /textures/cathx_door.jpg, a half on each
  // leaf; world/cathedralOutside.ts). Deep in the porch no sun reaches them and they stood black from the square (Steve,
  // 2026-09-26): a little of the day's light of their own (the fill follows the daylight: none at night).
  const doorPic = new THREE.TextureLoader().load("/textures/cathx_door.jpg");
  doorPic.colorSpace = THREE.SRGBColorSpace;
  doorPic.anisotropy = 4;
  const oakFor = (half: number) => {
    const map = doorPic.clone();
    map.repeat.set(0.5, 1);
    map.offset.set(half * 0.5, 0);
    map.needsUpdate = true;
    const m = psx(new THREE.MeshLambertMaterial({ map, color: 0xf0e4d8, emissive: 0x000000, emissiveMap: map }), { affine: 0 });
    m.name = "cath_door_oak"; // (the bump audit: its bump from its own picture, world/bumps.ts)
    return m;
  };
  const edge = psx(new THREE.MeshLambertMaterial({ color: 0x3a2a1e }), { affine: 0 });
  const oaks: THREE.MeshLambertMaterial[] = [];
  const leaves: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const hinge = new THREE.Group();
    hinge.position.set(P.ORIGIN.x + s * D.hw, P.FLOOR_Y, P.ORIGIN.z + D.z - 0.06);
    const w = P.LEAF.w;
    // the leaf reaches from its hinge toward the trumeau (-s along x); from the square the left leaf shows the
    // picture's left half (both faces: the inside mirrors it)
    const oak = oakFor(s < 0 ? 1 : 0);
    oaks.push(oak);
    // faces +x, -x, +y, -y, +z, -z: the picture on the two broad faces, dark oak on the edges
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(w, DH, 0.12), [edge, edge, edge, edge, oak, oak]);
    leaf.position.set(-s * (w / 2), DH / 2, 0);
    hinge.add(leaf);
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

  // the lit nave's light on the square through the open west door after dark (world/spill.ts)
  const doorLight = addSpill({
    kind: "hall",
    label: "the cathedral's west door",
    x: P.ORIGIN.x,
    y: P.FLOOR_Y + DH / 2,
    z: P.ORIGIN.z + D.z - 0.02,
    nx: 0,
    nz: -1,
    hw: D.hw,
    hh: DH / 2,
  });

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
      {
        const k = THREE.MathUtils.smoothstep(leafAngle / P.LEAF.open, 0.05, 0.6) * THREE.MathUtils.clamp((0.45 - day) / 0.25, 0, 1);
        doorLight.level = k;
        doorLight.glow = () => k;
      }
      for (const m of oaks) m.emissive.setRGB(0.32, 0.29, 0.26).multiplyScalar(THREE.MathUtils.clamp(day, 0, 1) * sky);
      // the flames, lights and glass always follow the hour (cheap): no step in them when the hall's life starts
      void live;
      room.update(t, dt);
      room.setDaylight(day, sky);
    },
    local,
    world: (x, z) => P.toWorld(x, z),
  };
}
