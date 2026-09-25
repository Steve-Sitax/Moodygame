import type { FirstPerson } from "../player/firstPerson";
import type { World } from "../world/rijnkaai";
import type { CraneLadder, CraneSpot } from "../world/railway";
import type { Action } from "./runs";

// Up a portal crane (M3g; Steve: "make the ladder climbable"). Each crane has an iron ladder up
// the back of its portal, caged over the upper part, to the gallery round the driver's cabin. At
// the foot, E (or walking into the rungs) starts the climb; W up, S down. At the top you step onto
// the gallery (M3g part 4): railed all round, walk it both sides of the cabin to the front and look
// over the jib, go in at the open door (a step up), past the winch to the driver's window, and out
// again; E at the ladder head climbs down. Nothing up there works the crane. While you stand at the
// foot, climb, or are anywhere up there, the crane stands still with its jib at rest
// (world/railway.ts summon / occupy). Not with goods in your arms.

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
      const d = Math.hypot(x - l.head.x, z - l.head.z);
      return { only: d < REACH_HEAD ? [{ key: "KeyE", text: "climb down the ladder", run: () => this.down(l), self: true }] : [] };
    }
    const l = this.nearFoot(x, z);
    if (!l) return {};
    rail.summon(l.crane);
    if (!l.ready) return {};
    return { options: [[Math.hypot(x - l.foot.x, z - l.foot.z), { key: "KeyE", text: "climb the crane's ladder", run: () => this.up(l), at: { x: l.hang.x - Math.sin(l.face) * 0.3, y: 1.4, z: l.hang.z - Math.cos(l.face) * 0.3 } }]] };
  }

  private nearFoot(x: number, z: number): CraneLadder | null {
    if (this.player.y > 0.5 || this.player.swimming || this.player.riding) return null;
    let best: CraneLadder | null = null;
    let bd = REACH_FOOT;
    for (const l of this.ladders()) {
      const d = Math.hypot(x - l.foot.x, z - l.foot.z);
      if (d < bd && this.world.isFree(l.foot.x, l.foot.z, 0.3)) {
        bd = d;
        best = l;
      }
    }
    return best;
  }

  private up(l: CraneLadder): void {
    if (this.player.laden) {
      this.say("Not with goods in your arms.");
      return;
    }
    this.on = l.crane;
    this.world.railway()?.occupy(l.crane);
    this.player.climbLadderStart({ hang: l.hang, foot: l.foot, head: l.head, face: l.face, bottom: 0, top: l.top, done: (at) => this.done(at) });
  }

  private down(l: CraneLadder): void {
    this.player.climbLadderStart({ hang: l.hang, foot: l.foot, head: l.head, face: l.face, bottom: 0, top: l.top, done: (at) => this.done(at) }, true);
  }

  private done(at: "top" | "foot"): void {
    if (at === "foot") {
      this.on = null;
      this.world.railway()?.occupy(null);
    }
  }

  /** Once a frame: walking into the rungs starts the climb too; a teleport off the crane lets it go. */
  update(dt: number): void {
    const p = this.player;
    if (this.on !== null && !p.climbLadder && p.y < 3) {
      this.on = null;
      this.world.railway()?.occupy(null);
    }
    if (this.on !== null || p.climbLadder || p.laden) {
      this.push = 0;
      return;
    }
    const l = this.nearFoot(p.x, p.z);
    const facing = l && Math.abs(Math.atan2(Math.sin(p.yaw - l.face), Math.cos(p.yaw - l.face))) < 0.6;
    if (l && l.ready && facing && (p.pressing("KeyW") || p.pressing("ArrowUp")) && Math.hypot(p.x - l.foot.x, p.z - l.foot.z) < 0.8) {
      this.push += dt;
      if (this.push > 0.3) this.up(l);
    } else this.push = 0;
  }

  /**
   * Places up on the climbable cranes for later jobs: a "crane_cabin" and a "crane_gallery" spot
   * per crane you can climb (world/railway.ts CRANE_SPOTS), where the crane stands now (cranes
   * travel). Not in shared/spots.json: the path check covers ground spots only.
   */
  spots(): CraneSpot[] {
    return this.ladders()
      .filter((l) => this.world.isFree(l.foot.x, l.foot.z, 0.3))
      .flatMap((l) => l.spots);
  }

  /** Dev: state for checks. */
  info(): Record<string, unknown> {
    return { on: this.on, climbing: !!this.player.climbLadder, y: +this.player.y.toFixed(2), ladders: this.ladders().map((l) => ({ crane: l.crane, foot: [+l.foot.x.toFixed(1), +l.foot.z.toFixed(1)], ready: l.ready })) };
  }
}
