import * as THREE from "three";
import { psx } from "../retro/psx";

// The Poesje's rod puppets (M6), made in code: half a man high, a wooden head, a cloth body,
// arms and legs that hang loose from the joints, an iron rod from the top of the head and a
// thinner one to the right hand, going up out of sight to the player on the bridge. De Neus
// has the nose (and the red cap), De Schele squints under his hat; the third is dressed for
// the part the play gives him. They bob and turn to whoever they speak to, and wave; their
// legs swing as they bounce. Nothing loaded: boxes, cones and spheres.

export type PuppetRole = "neus" | "schele" | "third";

const mats = new Map<number, THREE.Material>();
const m = (c: number) => {
  let x = mats.get(c);
  if (!x) mats.set(c, (x = psx(new THREE.MeshLambertMaterial({ color: c }), { affine: 0 })));
  return x;
};

interface Look {
  coat: number;
  trousers: number;
  hat: "cap" | "bowler" | "kepi" | "flat" | "bonnet" | "top";
  hatColor: number;
  nose: number;
  skirt?: boolean;
}

/** What the third puppet wears, by the part the play names. */
export function thirdLook(name: string): Look {
  const n = name.toLowerCase();
  if (/agent|police|constable|officer/.test(n)) return { coat: 0x1c2436, trousers: 0x1a1a22, hat: "kepi", hatColor: 0x1c2436, nose: 1 };
  if (/thief|pickpocket|rogue|robber/.test(n)) return { coat: 0x151515, trousers: 0x2a2420, hat: "flat", hatColor: 0x151515, nose: 1.2 };
  if (/bride|wife|widow|woman|fishwife|maid|girl/.test(n)) return { coat: /bride/.test(n) ? 0xd8d0c0 : 0x3a2a3a, trousers: 0x3a2a3a, hat: "bonnet", hatColor: /bride/.test(n) ? 0xe8e0d0 : 0x2a2a2a, nose: 0.8, skirt: true };
  if (/jef|farm|boy|lad/.test(n)) return { coat: 0x5a4430, trousers: 0x3a3228, hat: "flat", hatColor: 0x4a3a2a, nose: 1 };
  if (/skipper|sailor|captain/.test(n)) return { coat: 0x1a2a3a, trousers: 0x1a2a3a, hat: "cap", hatColor: 0x1a2a3a, nose: 1.1 };
  return { coat: 0x4a4a44, trousers: 0x2a2826, hat: "top", hatColor: 0x121212, nose: 1.1 };
}

const LOOKS: Record<"neus" | "schele", Look> = {
  neus: { coat: 0x7a1c14, trousers: 0xd8c8a0, hat: "cap", hatColor: 0xa01c14, nose: 2.6 },
  schele: { coat: 0x2c4a2a, trousers: 0x3a3228, hat: "bowler", hatColor: 0x1a1612, nose: 1.1 },
};

export class Puppet {
  readonly group = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly armL = new THREE.Group();
  private readonly armR = new THREE.Group();
  private readonly legL = new THREE.Group();
  private readonly legR = new THREE.Group();
  private readonly rodR: THREE.Mesh;
  private t = Math.random() * 10;
  /** Speaking now: bob, wave, face the one spoken to. */
  speaking = false;
  /** A knock with the stick: a short hard swing (and the one hit jumps). */
  private knockT = 0;
  private hitT = 0;
  /** The front is -z (the nose): yaw 0 faces the audience, down the room. */
  private faceYaw = 0;
  private yaw = 0;
  private legSwing = 0;
  private legV = 0;

  constructor(
    readonly role: PuppetRole,
    look: Look,
    /** Home spot in the room frame, feet height. */
    readonly home: { x: number; z: number; y: number },
  ) {
    const S = 0.78; // about 60 cm with the hat
    const g = this.body;
    // the body: a coat (a skirt for a woman) from the hips to the shoulders
    const coat = new THREE.Mesh(new THREE.CylinderGeometry(0.075 * S, look.skirt ? 0.16 * S : 0.1 * S, 0.3 * S, 7), m(look.coat));
    coat.position.y = 0.37 * S;
    g.add(coat);
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.05 * S, 0.075 * S, 0.04 * S, 7), m(0xd8d0bc));
    collar.position.y = 0.53 * S;
    g.add(collar);
    // the head: a wooden ball, painted cheeks, the nose, the eyes, the hat
    this.head.position.y = 0.6 * S;
    const face = new THREE.Mesh(new THREE.IcosahedronGeometry(0.075 * S, 1), m(0xd0a080));
    face.scale.set(1, 1.12, 0.95);
    this.head.add(face);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.022 * S * Math.min(1.6, look.nose), 0.06 * S * look.nose, 6), m(look.nose > 2 ? 0xc0402a : 0xc88a6a));
    nose.rotation.x = -Math.PI / 2 - (look.nose > 2 ? 0.35 : 0);
    nose.position.set(0, -0.005 * S, -0.075 * S - 0.03 * S * look.nose);
    this.head.add(nose);
    const squint = role === "schele";
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.014 * S, 5, 4), m(0xf0ece0));
      eye.position.set(s * 0.028 * S, 0.02 * S, -0.066 * S);
      this.head.add(eye);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.008 * S, 4, 3), m(0x111111));
      // De Schele: both pupils toward the nose
      pupil.position.set(s * 0.028 * S + (squint ? -s * 0.008 * S : 0), 0.02 * S, -0.078 * S);
      this.head.add(pupil);
      const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.016 * S, 4, 3), m(0xc0605a));
      cheek.position.set(s * 0.045 * S, -0.018 * S, -0.055 * S);
      this.head.add(cheek);
    }
    const hat = this.hat(look, S);
    hat.position.y = 0.06 * S;
    this.head.add(hat);
    g.add(this.head);
    // arms from the shoulders, loose; legs from the hips, dangling
    const limb = (grp: THREE.Group, len: number, r: number, c: number, hand?: number) => {
      const upper = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.9, len, 5), m(c));
      upper.position.y = -len / 2;
      grp.add(upper);
      if (hand !== undefined) {
        const h = new THREE.Mesh(new THREE.SphereGeometry(r * 1.4, 5, 4), m(hand));
        h.position.y = -len;
        grp.add(h);
      }
    };
    this.armL.position.set(-0.09 * S, 0.5 * S, 0);
    this.armR.position.set(0.09 * S, 0.5 * S, 0);
    limb(this.armL, 0.2 * S, 0.02 * S, look.coat, 0xd0a080);
    limb(this.armR, 0.2 * S, 0.02 * S, look.coat, 0xd0a080);
    this.armL.rotation.z = -0.25;
    this.armR.rotation.z = 0.25;
    if (role === "neus") {
      // his stick
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.008 * S, 0.01 * S, 0.3 * S, 4), m(0x6a4a2a));
      stick.position.set(0, -0.2 * S, -0.1 * S);
      stick.rotation.x = Math.PI / 2 - 0.4;
      this.armR.add(stick);
    }
    g.add(this.armL, this.armR);
    this.legL.position.set(-0.04 * S, 0.22 * S, 0);
    this.legR.position.set(0.04 * S, 0.22 * S, 0);
    if (!look.skirt) {
      limb(this.legL, 0.22 * S, 0.024 * S, look.trousers, 0x1a1410);
      limb(this.legR, 0.22 * S, 0.024 * S, look.trousers, 0x1a1410);
    } else {
      limb(this.legL, 0.1 * S, 0.02 * S, 0x1a1410);
      limb(this.legR, 0.1 * S, 0.02 * S, 0x1a1410);
    }
    g.add(this.legL, this.legR);
    this.group.add(g);
    // the rods: one out of the top of the head, one to the right hand
    const rodM = m(0x2a2622);
    const rodHead = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 1.4, 4), rodM);
    rodHead.position.y = 0.6 * S + 0.7;
    g.add(rodHead);
    this.rodR = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 1.3, 4), rodM);
    this.group.add(this.rodR);
    this.group.position.set(home.x, home.y, home.z);
    this.group.rotation.y = this.yaw;
  }

  private hat(look: Look, S: number): THREE.Object3D {
    const h = new THREE.Group();
    const c = m(look.hatColor);
    if (look.hat === "cap") {
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.075 * S, 0.14 * S, 7), c);
      cap.position.set(0, 0.05 * S, 0.02 * S);
      cap.rotation.x = 0.5;
      h.add(cap);
    } else if (look.hat === "bowler") {
      const crown = new THREE.Mesh(new THREE.SphereGeometry(0.07 * S, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), c);
      h.add(crown);
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.1 * S, 0.1 * S, 0.008 * S, 8), c);
      h.add(brim);
    } else if (look.hat === "kepi") {
      const k = new THREE.Mesh(new THREE.CylinderGeometry(0.06 * S, 0.075 * S, 0.07 * S, 7), c);
      k.position.y = 0.03 * S;
      k.rotation.x = -0.2;
      h.add(k);
      const peak = new THREE.Mesh(new THREE.BoxGeometry(0.1 * S, 0.006 * S, 0.05 * S), m(0x0a0a0a));
      peak.position.set(0, 0.0, -0.07 * S);
      h.add(peak);
    } else if (look.hat === "bonnet") {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.085 * S, 7, 5, 0, Math.PI * 2, 0, Math.PI * 0.62), c);
      b.position.set(0, -0.02 * S, 0.01 * S);
      h.add(b);
    } else if (look.hat === "top") {
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.06 * S, 0.06 * S, 0.14 * S, 8), c);
      crown.position.y = 0.07 * S;
      h.add(crown);
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.1 * S, 0.1 * S, 0.008 * S, 8), c);
      h.add(brim);
    } else {
      const flat = new THREE.Mesh(new THREE.CylinderGeometry(0.08 * S, 0.08 * S, 0.03 * S, 8), c);
      flat.position.set(0, 0.005 * S, -0.01 * S);
      flat.rotation.x = -0.15;
      h.add(flat);
    }
    return h;
  }

  /** Turn toward a point of the room frame (the one spoken to), or back to the audience. */
  faceTo(x: number | null, z = 0): void {
    if (x === null) {
      this.faceYaw = 0;
      return;
    }
    // three parts toward the other puppet, one part still open to the audience
    const len = Math.hypot(x - this.home.x, z - this.home.z) || 1;
    const dx = ((x - this.home.x) / len) * 0.75;
    const dz = ((z - this.home.z) / len) * 0.75 - 0.25;
    this.faceYaw = Math.atan2(-dx, -dz);
  }

  knock(): void {
    this.knockT = 0.5;
  }
  hit(): void {
    this.hitT = 0.45;
  }

  update(dt: number): void {
    this.t += dt;
    const t = this.t;
    let d = this.faceYaw - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * Math.min(1, dt * 5);
    this.group.rotation.y = this.yaw;
    // bob: the player jigs the rod; hard when speaking, a breath otherwise
    const talk = this.speaking ? 1 : 0;
    const bob = talk ? Math.abs(Math.sin(t * 9)) * 0.05 : Math.sin(t * 1.6) * 0.008;
    this.hitT = Math.max(0, this.hitT - dt);
    const jump = this.hitT > 0 ? Math.sin((this.hitT / 0.45) * Math.PI) * 0.14 : 0;
    const prevY = this.group.position.y;
    this.group.position.y = this.home.y + bob + jump;
    // legs swing from how the body moves (a loose pendulum)
    const vy = (this.group.position.y - prevY) / Math.max(dt, 1e-3);
    this.legV += (-this.legSwing * 40 - this.legV * 3 - vy * 6) * dt;
    this.legSwing += this.legV * dt;
    this.legL.rotation.x = this.legSwing;
    this.legR.rotation.x = -this.legSwing * 0.8;
    this.body.rotation.z = talk ? Math.sin(t * 4.5) * 0.08 : Math.sin(t * 0.9) * 0.03;
    this.head.rotation.x = talk ? Math.sin(t * 7) * 0.12 : 0;
    // the right arm waves while speaking; a knock is a hard swing down
    this.knockT = Math.max(0, this.knockT - dt);
    const knock = this.knockT > 0 ? Math.sin((1 - this.knockT / 0.5) * Math.PI) : 0;
    this.armR.rotation.x = -(talk ? 0.9 + Math.sin(t * 6) * 0.5 : 0.1) - knock * 1.6;
    this.armR.rotation.z = 0.25 + (talk ? Math.sin(t * 3) * 0.2 : 0);
    this.armL.rotation.x = talk ? -0.3 - Math.sin(t * 5 + 1) * 0.3 : Math.sin(t * 1.1) * 0.05;
    // the hand rod follows the right hand up out of sight
    const hand = new THREE.Vector3(0, -0.2 * 0.78, 0).applyEuler(this.armR.rotation).add(this.armR.position);
    hand.applyEuler(this.body.rotation);
    this.rodR.position.set(hand.x, hand.y + 0.65, hand.z);
  }
}

export function makePuppet(role: PuppetRole, home: { x: number; z: number; y: number }, thirdName = ""): Puppet {
  return new Puppet(role, role === "third" ? thirdLook(thirdName) : LOOKS[role], home);
}
