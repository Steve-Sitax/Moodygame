using System;
using Godot;
using Scheldemist.People;
using Scheldemist.World;

namespace Scheldemist.Native.World;

/// <summary>
/// The sexton's lantern at St James's churchyard gate (Codex review, 2026-10-27: one motivated, restrained light at night):
/// the game's one lantern model (Carried.Lantern, its horn glowing after dark with every lantern) on the gate pier's bracket,
/// and its light on the gate, the path and the nearest graves in one of the fixed spill slots (Lights.AddMoving: no Godot
/// light, the light count unchanged), lit as the gas lamps are.
/// </summary>
public partial class NativeChurchyardLantern : Node3D
{
    private const float Power = 0.55f;
    private static readonly Vector3 Flame = new(0, -0.08f, 0);
    private Action<Vector3, float>? light;
    private float level = -1;

    public static NativeChurchyardLantern Hang(Node3D parent, Vector3 at)
    {
        var lantern = new NativeChurchyardLantern { Name = "sexton_lantern", Position = at };
        lantern.AddChild(Carried.Lantern());
        parent.AddChild(lantern);
        return lantern;
    }

    public override void _Process(double delta)
    {
        if (light == null)
        {
            if (Lights.I is not { } lights) return;
            light = lights.AddMoving("churchyard lantern", Scheldemist.Render.Psx.Hex(0xffa048), Power);
        }
        float now = Daylight.I?.LampsLit ?? 0;
        if (MathF.Abs(now - level) < 0.01f) return;
        level = now;
        light(GlobalPosition + Flame, now);
    }
}
