import * as THREE from "three";
import { psx } from "../retro/psx";
import { addLantern, type LanternSource } from "../world/lanternLights";
import type { World } from "../world/rijnkaai";
import { activityAt } from "../../../server/src/town/schedule";
import { atPost, POST_HOURS } from "../../../shared/night";
import type { People } from "./people";
import type { Town } from "./town";
import type { Target } from "./facing";
import { landmarkDoorKeepOut } from "../world/doorKeep";

// M7 night (Steve 2026-09-25: "Sooi is not standing there but went home. We can still get paid by
// completing a quest and going to a quest sign/box at their door."). Every employer of the day board
// has a small box on a post by his door, with a painted sign and a lamp he leaves burning at night.
// When he is away (home asleep, his hours: shared/night.ts POST_HOURS, or his schedule), Jef finishes
// his job there: he drops the proof (the tally, the receipt, the watch token) in the box and takes the
// pay from it at once; the server settles as always (game.ts finishJob with box). A parcel to deliver
// waits in the box too. By day, the employer is there and it goes as before. The client only shows it.

export interface QuestBox {
  employer: string;
  /** "Sooi", "Widow Peeters", a townsman's name. */
  name: string;
  x: number;
  z: number;
  yaw: number;
  /** Where the box stands, in words ("by the Hessenatie door"). */
  label: string;
  group: THREE.Group;
  lamp: LanternSource;
  flame: THREE.Mesh;
  halo: THREE.Sprite;
}

/** Reach to use a box (metres). */
export const REACH_BOX = 2.2;
/** The board's employers of the Rijnkaai (people.ts); the town's come from the town data. */
const RIJNKAAI_EMPLOYERS = ["sooi", "peeters", "tuur"];

const mats = new Map<string, THREE.Material>();
const mat = (key: string, make: () => THREE.Material) => {
  let m = mats.get(key);
  if (!m) mats.set(key, (m = make()));
  return m;
};

function signTexture(name: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#3a2a1c";
  g.fillRect(0, 0, 128, 64);
  g.strokeStyle = "#20160e";
  g.lineWidth = 4;
  g.strokeRect(2, 2, 124, 60);
  g.fillStyle = "#e8dcbc";
  g.textAlign = "center";
  g.font = "bold 20px Georgia, serif";
  g.fillText(name.toUpperCase().slice(0, 12), 64, 27);
  g.font = "italic 12px Georgia, serif";
  g.fillText("work done: proof here", 64, 48);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}

let haloTex: THREE.CanvasTexture | null = null;
function halo(): THREE.CanvasTexture {
  if (haloTex) return haloTex;
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.3, "rgba(255,255,255,0.45)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 32, 32);
  haloTex = new THREE.CanvasTexture(c);
  haloTex.colorSpace = THREE.SRGBColorSpace;
  return haloTex;
}

export class QuestBoxes {
  readonly list: QuestBox[] = [];
  private built = false;
  /** Set by main: the clock (day of the week, hour with its fraction). */
  clock: () => { day: number; hour: number } = () => ({ day: 1, hour: 12 });

  constructor(
    private readonly world: World,
    private readonly people: People,
    private readonly town: Town,
  ) {}

  /** After the town loaded: a box by every day employer's post. */
  build(): void {
    if (this.built) return;
    const d = this.town.data;
    if (!d) return;
    this.built = true;
    const ids = [...RIJNKAAI_EMPLOYERS, ...d.employers.map((e) => e.id).filter((id) => !this.isNightGiver(id))];
    for (const id of ids) {
      const n = this.people.get(id);
      if (!n) continue;
      const spot = this.place(n.def.x, n.def.z);
      if (!spot) continue;
      const r = d.residents.find((x) => x.id === id);
      const name = n.def.name;
      const label = r ? `by ${name.split(" ")[0]}'s post` : `by ${name}'s door`;
      this.list.push(this.make(id, name, spot.x, spot.z, spot.yaw, label));
    }
  }

  private isNightGiver(id: string): boolean {
    const r = this.town.data?.residents.find((x) => x.id === id);
    const s = r?.sched?.day?.[0];
    return !!s && s[0] >= 20;
  }

  /**
   * Free ground near the post, on land: best with a wall at its back (against the house front by his
   * door), the sign facing away from the wall into the street; else facing the post.
   */
  private place(px: number, pz: number): { x: number; z: number; yaw: number } | null {
    const w = this.world;
    let open: { x: number; z: number; yaw: number } | null = null;
    // (M7 doors: never before a landmark's doorway or on its steps; further out if the post is there)
    const doors = landmarkDoorKeepOut();
    const onDoor = (x: number, z: number) => doors.some((q) => x > q.minX - 0.3 && x < q.maxX + 0.3 && z > q.minZ - 0.3 && z < q.maxZ + 0.3);
    for (const r of [1.3, 1.7, 2.2, 2.8, 1.0, 3.6, 4.6, 6.0]) {
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2 + 0.3;
        const x = px + Math.cos(ang) * r;
        const z = pz + Math.sin(ang) * r;
        if (!w.isFree(x, z, 0.45) || w.isWater(x, z) || onDoor(x, z)) continue;
        // a wall within a metre behind it: the box stands against it, the sign to the street
        let bx = 0;
        let bz = 0;
        for (let k = 0; k < 8; k++) {
          const q = (k / 8) * Math.PI * 2;
          if (!w.isFree(x + Math.sin(q) * 0.9, z + Math.cos(q) * 0.9, 0.1) && !w.isWater(x + Math.sin(q) * 0.9, z + Math.cos(q) * 0.9)) {
            bx += Math.sin(q);
            bz += Math.cos(q);
          }
        }
        if (Math.hypot(bx, bz) > 0.5) return { x, z, yaw: Math.atan2(-bx, -bz) };
        open ??= { x, z, yaw: Math.atan2(px - x, pz - z) };
      }
    }
    return open;
  }

  private make(employer: string, name: string, x: number, z: number, yaw: number, label: string): QuestBox {
    const wood = mat("wood", () => psx(new THREE.MeshLambertMaterial({ color: 0x4a3524 })));
    const dark = mat("dark", () => psx(new THREE.MeshLambertMaterial({ color: 0x2a1d12 })));
    const iron = mat("iron", () => psx(new THREE.MeshLambertMaterial({ color: 0x1c1c1c })));
    const g = new THREE.Group();
    g.position.set(x, this.world.groundAt(x, z, 0, 0.5), z);
    g.rotation.y = yaw;
    // the post
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.05, 0.1), wood);
    post.position.y = 0.52;
    g.add(post);
    // the box: a small chest with a slot and a sloped lid
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.3, 0.3), wood);
    box.position.y = 1.2;
    g.add(box);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.04, 0.34), dark);
    lid.position.set(0, 1.37, 0);
    lid.rotation.x = -0.12;
    g.add(lid);
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.012), iron);
    slot.position.set(0, 1.28, 0.152);
    g.add(slot);
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.02), iron);
    lock.position.set(0, 1.12, 0.155);
    g.add(lock);
    // the sign under the box, painted with his name
    const signMat = new THREE.MeshLambertMaterial({ map: signTexture(name) });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.25), psx(signMat));
    sign.position.set(0, 0.86, 0.075);
    g.add(sign);
    // a small lamp on an arm, lit when he is away after dark
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.26), iron);
    arm.position.set(0.18, 1.52, 0.1);
    g.add(arm);
    const flame = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.12, 4), new THREE.MeshBasicMaterial({ color: 0x3a3228, fog: false }));
    flame.position.set(0.18, 1.44, 0.22);
    g.add(flame);
    const hs = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo(), color: 0xffb060, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0, fog: false }));
    hs.scale.set(0.8, 0.8, 1);
    hs.position.copy(flame.position);
    g.add(hs);
    this.world.scene.add(g);
    const lamp = addLantern({ power: 0.8 });
    g.updateMatrixWorld(true);
    flame.getWorldPosition(lamp.pos);
    lamp.ground = g.position.y;
    return { employer, name, x, z, yaw, label, group: g, lamp, flame, halo: hs };
  }

  get(employer: string): QuestBox | undefined {
    return this.list.find((b) => b.employer === employer);
  }

  has(employer: string): boolean {
    return this.list.some((b) => b.employer === employer);
  }

  /** Is this employer away from his post now (home asleep)? */
  away(employer: string): boolean {
    const { day, hour } = this.clock();
    if (employer in POST_HOURS) return !atPost(employer, hour);
    const r = this.town.data?.residents.find((x) => x.id === employer);
    if (!r?.sched) return false;
    return activityAt(r.sched, day, hour).act !== "work";
  }

  /** The box within reach of (x, z), for this employer (or any). */
  near(x: number, z: number, employer?: string): QuestBox | null {
    let best: QuestBox | null = null;
    let bd = REACH_BOX;
    for (const b of this.list) {
      if (employer && b.employer !== employer) continue;
      const d = Math.hypot(b.x - x, b.z - z);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }

  /** Where Jef looks to use it (the box itself). */
  target(b: QuestBox): Target {
    return { x: b.x, y: 1.2, z: b.z };
  }

  /** Per frame (cheap): the lamps burn after dark while their man is away. */
  update(t: number): void {
    const h = this.clock().hour;
    const dark = h >= 18.5 || h < 6.5;
    for (const b of this.list) {
      const lit = dark && this.away(b.employer) ? 1 : 0;
      b.lamp.on = lit;
      (b.flame.material as THREE.MeshBasicMaterial).color.setHex(lit ? 0xffc070 : 0x3a3228);
      b.halo.material.opacity = lit * (0.4 + Math.sin(t * 6 + b.x) * 0.04);
    }
  }

  /** Points a path must reach (main.ts paths()). */
  pathPoints(): Array<{ label: string; x: number; z: number; reach: number }> {
    return this.list.map((b) => ({ label: `quest box of ${b.name}`, x: b.x, z: b.z, reach: 1.9 }));
  }

  /** Dev (the kit): where the boxes stand, and whose man is away now. */
  info(): Array<{ employer: string; name: string; x: number; z: number; away: boolean }> {
    return this.list.map((b) => ({ employer: b.employer, name: b.name, x: +b.x.toFixed(1), z: +b.z.toFixed(1), away: this.away(b.employer) }));
  }
}
