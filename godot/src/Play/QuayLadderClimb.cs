using System;
using Godot;
using Scheldemist.Player;
using Scheldemist.World;

namespace Scheldemist.Play;

/// <summary>
/// The quay ladders on foot (issue 85: they were only a swimmer's way out). E at the hoops climbs down into the water,
/// or onto the mud at a low spring tide, when there is room at the foot (a boat moored at the ladder has its own way
/// down, Rowing.ClimbInto); E at the foot, standing on the mud, climbs up. Not with goods in hand.
/// </summary>
[GamePart(922)]
public partial class QuayLadderClimb : Node
{
    public override void _Ready() => Interact.I.AddProvider(Keys);

    private static Offers? Keys(float x, float z)
    {
        var j = Jef.I;
        if (j == null || !j.Grounded || j.Swimming || j.Climbing || j.Riding || j.Fly || j.Laden || j.Frozen) return null;
        Exit? best = null;
        bool down = false;
        float bd = 1.3f;
        foreach (var e in QuayExits.Exits)
        {
            if (!e.Ladder) continue;
            if (Math.Abs(j.Y - e.Ty) < 0.3f)
            {
                // on the quay behind the ladder's head
                float d = new Vector2(x - e.Wx, z - e.Wz).Length();
                if (d >= bd || (x - e.Wx) * e.Nx + (z - e.Wz) * e.Nz > 0.25f || j.LadderFoot(e) == null) continue;
                (best, bd, down) = (e, d, true);
            }
            else if (j.Y < e.Ty - 1.0f)
            {
                // on the mud at its foot, in front of the rungs
                float d = new Vector2(x - e.Gx, z - e.Gz).Length();
                if (d >= Math.Min(bd, 1.0f)) continue;
                (best, bd, down) = (e, d, false);
            }
        }
        if (best == null) return null;
        var e1 = best;
        if (down)
            return new Offers { Options = new() { (bd, Act.At(Key.E, "climb down the ladder", new Vector3(e1.Wx, e1.Ty + 0.8f, e1.Wz), () => Jef.I.ClimbDown(e1))) } };
        return new Offers { Options = new() { (bd, Act.At(Key.E, "climb up the ladder", new Vector3(e1.Wx, j.Y + 1.4f, e1.Wz), () => Jef.I.ClimbUp(e1))) } };
    }
}
