using System;
using Godot;

namespace Scheldemist.World;

/// <summary>
/// The eye under the water (2026-10-11, Steve: "we need to be able to dive"): whatever camera looks (Jef's, the free
/// one), once it is under the surface of the river, a dock or the moat, the air is the river's murk, close and dark
/// and darker deeper down (Daylight.Under), and the town's sounds come dull through the water (Soundscape.Underwater).
/// It runs after Jef has moved the camera, and puts the light right in the same frame the eye goes through the
/// surface, so no frame shows the wrong air.
/// </summary>
[GamePart(21)]
public partial class Underwater : Node
{
    public static Underwater I { get; private set; } = null!;
    /// <summary>The eye is under the water now, and how deep (m).</summary>
    public bool Under { get; private set; }
    public float Depth { get; private set; }
    private float sound;

    public override void _Ready()
    {
        I = this;
        ProcessPriority = 30; // after Jef (10) and the rides that carry him
        // the hulls' shapes for the swimmer, once all parts are in (the boats come after this part)
        Callable.From(() => Scheldemist.Movers.Boats.I?.MeasureHulls()).CallDeferred();
    }

    public override void _Process(double delta)
    {
        var cam = Main.I.Cam;
        if (cam == null || Daylight.I == null) return;
        var p = cam.GlobalPosition;
        bool under = false;
        float depth = 0;
        if (Water.In(p.X, p.Z))
        {
            float level = Water.Level(p.X, p.Z);
            under = p.Y < level - 0.01f;
            depth = level - p.Y;
        }
        bool turned = under != Under;
        Under = under;
        Depth = under ? depth : 0;
        Daylight.I.Under = under ? 1 : 0;
        Daylight.I.UnderDepth = Depth;
        if (turned) Daylight.I.Restep();
        // the ears clear a moment after the head comes up, and close at once going under
        float dt = (float)delta;
        sound = under ? 1 : Math.Max(0, sound - dt * 5);
        Scheldemist.Audio.Soundscape.I?.Underwater(sound, Depth);
    }
}
