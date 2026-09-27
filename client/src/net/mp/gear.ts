// M8b multiplayer: another player's boat, velocipede or handcart, drawn with him (docs/milestones/M8b.md).
// His own PC rows, rides or pushes it; the others only see it go with him: a boat of the same kind under him on
// the water, a velocipede whose wheels turn with the ground he covers, a handcart before his hands.

import { GEAR } from "../../../../shared/mpProtocol";
import { SMALL_KINDS } from "../../../../shared/smallBoats";
import type { World } from "../../world/rijnkaai";
import { levelAt } from "../../world/tide";
import { PushCart } from "../../world/traffic";
import { loadProps } from "../../world/props3d";
import { loadVelocipede } from "../../game/velocipedes";
import type { GearModel } from "./together";

/** Front and rear wheel radii of the velocipede (game/velocipedes.ts draws the same machine). */
const WHEEL = { front: 0.46, rear: 0.36 };
/** The cart's axle this far before the man pushing it. */
const CART_AHEAD = 0.95;

export async function gearModel(world: World, kind: number, sub: number): Promise<GearModel | null> {
  if (kind === GEAR.rowboat) {
    const boats = world.boats();
    const name = SMALL_KINDS[sub] ?? "rowboat";
    if (!boats) return null;
    const obj = boats.place(name as never, 0, 0, 0, world.scene);
    boats.stowed(obj, false); // (his oars are out)
    return {
      place(x, _y, z, heading, _dt, shown) {
        obj.visible = shown;
        obj.position.set(x, levelAt(x, z), z);
        obj.rotation.set(0, heading, 0);
      },
      dispose() {
        obj.removeFromParent();
      },
    };
  }
  if (kind === GEAR.velo) {
    const proto = await loadVelocipede();
    if (!proto) return null;
    const obj = proto.clone(true);
    obj.rotation.order = "YXZ";
    const front = obj.getObjectByName("velocipede_front");
    const rear = obj.getObjectByName("velocipede_rear");
    world.scene.add(obj);
    let lx = NaN;
    let lz = NaN;
    let dist = 0;
    return {
      place(x, y, z, heading, _dt, shown) {
        obj.visible = shown;
        if (!Number.isNaN(lx)) dist += Math.hypot(x - lx, z - lz);
        lx = x;
        lz = z;
        obj.position.set(x, y, z);
        obj.rotation.y = heading;
        if (front) front.rotation.x = dist / WHEEL.front;
        if (rear) rear.rotation.x = dist / WHEEL.rear;
      },
      dispose() {
        obj.removeFromParent();
      },
    };
  }
  if (kind === GEAR.handcart) {
    const props = await loadProps();
    const cart = new PushCart(world.scene, props, { load: false });
    return {
      // (M8f goods pass 2: his load on it, game/goods.ts, when `sub` names the cart it lies on)
      pivot: cart.pivot,
      place(x, _y, z, heading, _dt, shown) {
        cart.visible = shown;
        cart.place(x + Math.sin(heading) * CART_AHEAD, z + Math.cos(heading) * CART_AHEAD, heading);
      },
      dispose() {
        cart.dispose();
      },
    };
  }
  return null;
}
