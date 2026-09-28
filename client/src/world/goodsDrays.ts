import * as THREE from "three";
import { CART_RUNS, type CartRun } from "../../../shared/goods";
import { CART_RUN_PACE as PACE, along, cartAt as whereAt, dayPlan, type CartLeg } from "../../../shared/cartRuns";
import type { NetMover } from "../net/mp/world";
import { makeHuman, type Human } from "../game/humans";
import { LedDray, PushCart, handsOf, hideBakedCart } from "./traffic";
import { goodsRects } from "./quaygoods";
import type { Props } from "./props3d";
import type { Rect } from "./geom";

// M8f goods pass 2 (docs/milestones/M8f.md): the town's carts that move a whole pile of the server's goods (shared/goods.ts
// CART_RUNS: the Hessenatie's dray with the casks, a handcart with the Rijnkaai's sacks). The server moves the goods on
// the world's clock (it takes the pile at `out`, sets it down at `to` at `down` ...); this draws the cart going the
// same round on the same clock, with its man, and the load on it (game/goods.ts hangs the items on `bedOf(cart)`).
//
// Where a cart is follows from the clock alone (a leg of the round and how far along it; a dray's rig on the carter's
// trail, a handcart on the way ahead of its man), so every PC draws it the same; played together the world PC's state
// is the one drawn (net/mp/world.ts), as for every mover.

/** A handcart's man walks this far behind its axle (the grips 2.15 m back, his hands 0.45 m before him: traffic.ts). */
const CART_BEHIND = 2.15 + 0.45;
/** Where a dray's rig stands behind its carter (world/traffic.ts LedDray): the horse, the fore axle, the rear axle. */
const RIG = { horse: 1.0, fore: 3.05, rear: 5.45, bedFront: 2.4, bedBack: 6.17, side: 0.85 };

type Leg = CartLeg;

interface Rig {
  run: CartRun;
  legs: Leg[];
  dray: LedDray | null;
  cart: PushCart | null;
  man: Human | null;
  manGroup: THREE.Group;
  leg: number;
  s: number;
  moving: boolean;
  /** Where the man is (for the map, the checks). */
  at: { x: number; z: number; yaw: number };
}

export interface GoodsDrayNet {
  d: Array<{ id: string; _leg: number; s: number; _moving: boolean }>;
}

export interface GoodsDrays extends NetMover<GoodsDrayNet> {
  /** Each frame: the clock (day, hour with its fraction) and the camera, to hide what is past the fog or out of view. */
  update(dt: number, day: number, hourF: number, cam: THREE.Camera, far: number): void;
  /** The frame goods on this cart hang on (null: not one of these carts). */
  bedOf(cart: string): THREE.Object3D | null;
  /** The run of a cart. */
  runOf(cart: string): CartRun | null;
  /** Dev: where each cart is, its leg and when its legs run. */
  info(): Array<{ id: string; leg: number; s: number; moving: boolean; x: number; z: number; yaw: number; legs: Array<[number, number]> }>;
  /** Dev: every metre of every leg, the points of the rig (a dray: man, horse, bed front, fore axle, rear axle, bed back; a handcart: man, axle). */
  sweep(id: string): Array<Array<[number, number]>>;
}

export function createGoodsDrays(scene: THREE.Scene, props: Props, colliders: { add(r: Rect): void }): GoodsDrays {
  const group = new THREE.Group();
  group.name = "goods_drays";
  scene.add(group);
  const rigs: Rig[] = CART_RUNS.map((run) => {
    const dray = run.vehicle === "dray" ? new LedDray(group, props, null) : null;
    const cart = run.vehicle === "handcart" ? new PushCart(group, props, { load: false }) : null;
    if (dray) dray.root.name = `goods_dray ${run.id}`;
    if (cart) cart.root.name = `goods_cart ${run.id}`;
    for (const r of dray?.rects ?? cart?.rects ?? []) {
      goodsRects.add(r);
      colliders.add(r);
    }
    const manGroup = new THREE.Group();
    manGroup.name = `goods_carter ${run.id}`;
    group.add(manGroup);
    const legs = dayPlan(run);
    return { run, legs, dray, cart, man: null, manGroup, leg: legs.length - 1, s: legs[legs.length - 1].cum.at(-1)!, moving: false, at: { x: 0, z: 0, yaw: 0 } };
  });
  const P = { x: 0, z: 0, yaw: 0 };
  const frustum = new THREE.Frustum();
  const PV = new THREE.Matrix4();
  const camPos = new THREE.Vector3();
  const sphere = new THREE.Sphere();

  /** The cart of r at its leg and s, its man with it. */
  const place = (r: Rig, dt: number) => {
    const L = r.legs[Math.max(0, Math.min(r.legs.length - 1, r.leg))];
    const back = (d: number, out: { x: number; z: number; yaw: number }) => along(L, r.s - d, out);
    if (r.dray) {
      back(0, P);
      r.dray.pose(dt, r.moving ? PACE : 0, back);
    } else if (r.cart) {
      // the handcart before him: its axle on the way, the man CART_BEHIND back on it
      back(CART_BEHIND, P);
    }
    r.at = { x: P.x, z: P.z, yaw: P.yaw };
    r.manGroup.position.set(P.x, 0, P.z);
    r.manGroup.rotation.y = P.yaw;
    if (!r.man) {
      r.man = makeHuman(r.cart ? "carter" : "docker_b");
      if (r.man) {
        if (r.cart) hideBakedCart(r.man.root);
        r.manGroup.add(r.man.root);
      }
    }
    if (r.cart) {
      const hands = handsOf(r.man, r.manGroup, P.x, P.z, P.yaw);
      const A = { x: 0, z: 0, yaw: 0 };
      back(0, A);
      // (the cart points from his hands to where its axle is on the way: it goes where he pushes it; put there each
      // frame, so a jump of the clock or a late PC finds it where the round has it, standing or pushed)
      const yaw = Math.atan2(A.x - hands.x, A.z - hands.z);
      const now = r.cart.axle;
      if (Math.hypot(now.x - A.x, now.z - A.z) > 0.4) r.cart.place(hands.x, hands.z, yaw);
      r.cart.push(dt, hands.x, hands.z, hands.y, yaw, r.moving ? 1 : 0);
    }
    if (r.man) {
      r.man.play(r.moving ? "walk" : "idle");
      if (r.moving) r.man.setPace(PACE);
      if (r.manGroup.visible) r.man.update(dt);
    }
  };

  let remote = false;
  const api: GoodsDrays = {
    get netRemote() {
      return remote;
    },
    set netRemote(v: boolean) {
      remote = v;
    },
    netState(): GoodsDrayNet {
      return { d: rigs.map((r) => ({ id: r.run.id, _leg: r.leg, s: +r.s.toFixed(3), _moving: r.moving })) };
    },
    netApply(s: GoodsDrayNet, dt: number): void {
      for (const d of s.d ?? []) {
        const r = rigs.find((q) => q.run.id === d.id);
        if (!r || !(d._leg >= 0 && d._leg < r.legs.length)) continue;
        r.leg = d._leg;
        r.s = d.s;
        r.moving = d._moving;
        place(r, dt);
      }
    },
    netLerp(a: GoodsDrayNet, b: GoodsDrayNet, u: number): GoodsDrayNet {
      // (a new leg: its own start, never eased from the last one's end)
      return {
        d: b.d.map((q) => {
          const p = a.d.find((x) => x.id === q.id);
          return p && p._leg === q._leg ? { ...q, s: p.s + (q.s - p.s) * u } : q;
        }),
      };
    },
    update(dt, day, hourF, cam, far) {
      cam.getWorldPosition(camPos);
      PV.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      frustum.setFromProjectionMatrix(PV);
      for (const r of rigs) {
        if (!remote) {
          const w = whereAt(r.legs, hourF * 60, day % 7 === 0);
          r.leg = w.leg;
          r.s = w.s;
          r.moving = w.moving;
          place(r, dt);
        }
        // (past the fog: not drawn; its colliders stay)
        // (the rig's own meshes the renderer culls; the man's skinned ones it does not)
        const near = Math.hypot(camPos.x - r.at.x, camPos.z - r.at.z) < far + 12;
        sphere.center.set(r.at.x, 0.9, r.at.z);
        sphere.radius = 1.1;
        if (r.dray) r.dray.visible = near;
        if (r.cart) r.cart.visible = near;
        r.manGroup.visible = near && frustum.intersectsSphere(sphere);
      }
    },
    bedOf(cart) {
      const r = rigs.find((q) => q.run.cart === cart);
      return r?.dray?.bedFrame ?? r?.cart?.pivot ?? null;
    },
    runOf(cart) {
      return CART_RUNS.find((r) => r.cart === cart) ?? null;
    },
    info() {
      return rigs.map((r) => ({
        id: r.run.id,
        leg: r.leg,
        s: +r.s.toFixed(2),
        moving: r.moving,
        x: +r.at.x.toFixed(2),
        z: +r.at.z.toFixed(2),
        yaw: +r.at.yaw.toFixed(3),
        legs: r.legs.map((l) => [+l.t0.toFixed(1), +l.t1.toFixed(1)] as [number, number]),
      }));
    },
    sweep(id) {
      const r = rigs.find((q) => q.run.id === id);
      if (!r) return [];
      const out: Array<Array<[number, number]>> = [];
      const O = { x: 0, z: 0, yaw: 0 };
      for (const L of r.legs) {
        const len = L.cum[L.cum.length - 1];
        for (let s = 0; s <= len + 0.01; s += 0.5) {
          const pts: Array<[number, number]> = [];
          const ds = r.dray ? [0, RIG.horse, RIG.bedFront, RIG.fore, RIG.rear, RIG.bedBack] : [CART_BEHIND, 0];
          for (const d of ds) {
            along(L, s - d, O);
            // (a dray's rig stands to the carter's right: world/traffic.ts LedDray)
            const side = r.dray && d ? RIG.side : 0;
            pts.push([+(O.x - Math.cos(O.yaw) * side).toFixed(2), +(O.z + Math.sin(O.yaw) * side).toFixed(2)]);
          }
          out.push(pts);
        }
      }
      return out;
    },
  };
  return api;
}
