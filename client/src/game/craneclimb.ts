import type { ClimbLadder, FirstPerson } from "../player/firstPerson";
import type { World } from "../world/rijnkaai";
import type { CraneLadder, CraneSpot } from "../world/railway";
import type { Action } from "./runs";

// Up a portal crane (M3g; Steve: "make the ladder climbable"). Each crane has an iron ladder up
// the back of its portal, caged over the upper part, to the gallery round the driver's cabin. At
// the foot, E (or walking into the rungs) starts the climb; W up, S down. At the top you step onto
// the gallery (M3g part 4): railed all round, walk it both sides of the cabin to the front and look
// over the jib, go in at the open door (a step up), past the winch to the driver's window, and out
// again; E at the ladder head climbs down. Nothing up there works the crane. Not with goods in your arms.
// 2026-09-30 (Steve: "i must be able to climb while crane works, it does not get disturbed"): the crane works on.
// The ladder is on the portal (it rolls along the runway, he with it); the gallery turns with the jib, so at the top
// he steps off when its back is at the ladder head, else holds on there; up on it he rides its turns and travel.
//
// M8b: played together, another PC (the world PC) may drive the cranes; it does not know you are at
// the ladder, so there the crane cannot wait for you and the climb is refused with a word (M8c will
// ask the world PC to hold the crane for you).

const REACH_FOOT = 1.4;
const REACH_HEAD = 1.3;

export class CraneClimb {
  /** The crane you are on (ladder or deck), or null. */
  private on: number | null = null;
  private push = 0;

  constructor(
    private readonly player: FirstPerson,
    private readonly world: World,
    private readonly say: (text: string) => void,
  ) {}

  private ladders(): CraneLadder[] {
    return this.world.railway()?.ladders() ?? [];
  }

  /** In the shape of Jobs.extraActions (game/jobs.ts). */
  keys(x: number, z: number): { only?: Action[]; options?: Array<[number, Action]> } {
    const p = this.player;
    if (p.climbLadder) return { only: [] };
    const rail = this.world.railway();
    if (!rail) return {};
    if (this.on !== null) {
      const l = this.ladders()[this.on];
      if (!l) return {};
      // down again where the ladder head is now under the gallery (it turns with the jib)
      const d = Math.hypot(x - l.head.x, z - l.head.z);
      return { only: d < REACH_HEAD && this.headOnDeck(l) ? [{ key: "KeyE", text: "climb down the ladder", run: () => this.down(l), self: true }] : [] };
    }
    const f = this.nearFoot(x, z);
    if (!f) return {};
    const { l, stand } = f;
    const at = { x: l.hang.x - Math.sin(l.face) * 0.3, y: 1.4, z: l.hang.z - Math.cos(l.face) * 0.3 };
    const d = Math.hypot(x - stand.x, z - stand.z);
    if (rail.netRemote) return { options: [[d, { key: "KeyE", text: "climb the crane's ladder", run: () => this.say("The crane is at work. The driver waves you off the ladder."), at }]] };
    // 2026-09-30 (Steve: "i must be able to climb while crane works, it does not get disturbed"): it works on
    return { options: [[d, { key: "KeyE", text: "climb the crane's ladder", run: () => this.up(l, stand), at }]] };
  }

  /**
   * The ladder whose foot he stands at, and where he stands for it: at the foot, or (a dock crane whose ladder comes
   * down over the quay's edge) the nearest free ground toward the portal's middle.
   */
  private nearFoot(x: number, z: number): { l: CraneLadder; stand: { x: number; z: number } } | null {
    if (this.player.y > 0.5 || this.player.swimming || this.player.riding) return null;
    let best: { l: CraneLadder; stand: { x: number; z: number } } | null = null;
    let bd = REACH_FOOT;
    for (const l of this.ladders()) {
      const stand = this.standOf(l);
      if (!stand) continue;
      const d = Math.hypot(x - stand.x, z - stand.z);
      if (d < bd) {
        bd = d;
        best = { l, stand };
      }
    }
    return best;
  }

  private standOf(l: CraneLadder): { x: number; z: number } | null {
    const dx = l.head.x - l.foot.x;
    const dz = l.head.z - l.foot.z;
    const n = Math.hypot(dx, dz) || 1;
    for (let s = 0; s <= 2.5; s += 0.25) {
      const x = l.foot.x + (dx / n) * s;
      const z = l.foot.z + (dz / n) * s;
      if (this.world.groundAt(x, z, 0.3, 0.5) > -0.6 && this.world.isFree(x, z, 0.3)) return { x, z };
    }
    return null;
  }

  /** Is the gallery under the ladder head now (the jib turned so its back is at the ladder)? */
  private headOnDeck(l: CraneLadder): boolean {
    return this.world.standFree(l.head.x, l.head.z, 0.2, l.top);
  }

  private up(l: CraneLadder, stand: { x: number; z: number }): void {
    if (this.player.laden) {
      this.say("Not with goods in your arms.");
      return;
    }
    this.on = l.crane;
    this.world.railway()?.occupy(l.crane);
    this.climbing = { hang: { ...l.hang }, foot: { ...stand }, head: { ...l.head }, face: l.face, bottom: 0, top: l.top, done: (at) => this.done(at), canStepOff: () => this.headOnDeck(this.ladders()[l.crane] ?? l) };
    this.player.climbLadderStart(this.climbing);
    this.waitSaid = false;
  }

  private down(l: CraneLadder): void {
    const stand = this.standOf(l) ?? l.foot;
    this.climbing = { hang: { ...l.hang }, foot: { ...stand }, head: { ...l.head }, face: l.face, bottom: 0, top: l.top, done: (at) => this.done(at), canStepOff: () => this.headOnDeck(this.ladders()[l.crane] ?? l) };
    this.player.climbLadderStart(this.climbing, true);
  }

  private done(at: "top" | "foot"): void {
    if (at === "foot") {
      this.on = null;
      this.climbing = null;
      this.world.railway()?.occupy(null);
    } else {
      this.climbing = null;
      this.frame = null;
    }
  }

  /** The ladder he is on, moved with the crane each frame (a crane travels along its runway). */
  private climbing: ClimbLadder | null = null;
  /** The jib's frame last frame, while he is up on the gallery: he rides its turns and its travel. */
  private frame: { x: number; z: number; rot: number } | null = null;
  private waitSaid = false;

  /**
   * Once a frame, after the world has moved the cranes and before Jef takes his step (main.ts): up on the gallery he is
   * carried as the jib turns and the crane rolls, so he is where he stood on it before his own step is checked.
   */
  ride(): void {
    const p = this.player;
    const l = this.on !== null && !p.climbLadder && p.y > 3 ? this.ladders()[this.on] : null;
    if (!l) {
      this.frame = null;
      return;
    }
    const f = l.frame;
    if (this.frame) {
      const dr = f.rot - this.frame.rot;
      if (Math.abs(dr) > 1e-6 || f.x !== this.frame.x || f.z !== this.frame.z) {
        const dx = p.x - this.frame.x;
        const dz = p.z - this.frame.z;
        const c = Math.cos(dr);
        const s = Math.sin(dr);
        p.carryTo(f.x + dx * c + dz * s, f.z - dx * s + dz * c, dr);
      }
    }
    this.frame = { x: f.x, z: f.z, rot: f.rot };
  }

  /** Once a frame: walking into the rungs starts the climb too; the ladder moves with the portal; a teleport lets it go. */
  update(dt: number): void {
    const p = this.player;
    if (this.on !== null && !p.climbLadder && p.y < 3) {
      this.on = null;
      this.climbing = null;
      this.frame = null;
      this.world.railway()?.occupy(null);
    }
    if (this.on !== null) {
      const l = this.ladders()[this.on];
      if (!l) return;
      if (p.climbLadder && this.climbing && p.climbLadder === this.climbing) {
        // on the rungs: the ladder is on the portal, which rolls along the runway; the foot keeps its offset
        const ox = this.climbing.foot.x - this.climbing.hang.x;
        const oz = this.climbing.foot.z - this.climbing.hang.z;
        this.climbing.hang.x = l.hang.x;
        this.climbing.hang.z = l.hang.z;
        this.climbing.head.x = l.head.x;
        this.climbing.head.z = l.head.z;
        this.climbing.foot.x = l.hang.x + ox;
        this.climbing.foot.z = l.hang.z + oz;
        if (p.y >= l.top - 1.05 && !this.headOnDeck(l) && !this.waitSaid) {
          this.waitSaid = true;
          this.say("The cabin is swung away. You hold on at the top of the ladder till the gallery comes round.");
        }
        this.frame = null;
      }
      this.push = 0;
      return;
    }
    if (p.climbLadder || p.laden) {
      this.push = 0;
      return;
    }
    const f = this.world.railway()?.netRemote ? null : this.nearFoot(p.x, p.z);
    const facing = f && Math.abs(Math.atan2(Math.sin(p.yaw - f.l.face), Math.cos(p.yaw - f.l.face))) < 0.6;
    if (f && facing && (p.pressing("KeyW") || p.pressing("ArrowUp")) && Math.hypot(p.x - f.stand.x, p.z - f.stand.z) < 0.8) {
      this.push += dt;
      if (this.push > 0.3) this.up(f.l, f.stand);
    } else this.push = 0;
  }

  /**
   * Places up on the climbable cranes for later jobs: a "crane_cabin" and a "crane_gallery" spot
   * per crane you can climb (world/railway.ts CRANE_SPOTS), where the crane stands now (cranes
   * travel). Not in shared/spots.json: the path check covers ground spots only.
   */
  spots(): CraneSpot[] {
    return this.ladders()
      .filter((l) => this.standOf(l) !== null)
      .flatMap((l) => l.spots);
  }

  /** Dev: state for checks. */
  info(): Record<string, unknown> {
    return { on: this.on, climbing: !!this.player.climbLadder, y: +this.player.y.toFixed(2), ladders: this.ladders().map((l) => ({ crane: l.crane, foot: [+l.foot.x.toFixed(1), +l.foot.z.toFixed(1)], ready: l.ready })) };
  }
}
