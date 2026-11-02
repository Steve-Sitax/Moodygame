using System;
using System.Collections.Generic;
using Godot;
using Scheldemist.World;

namespace Scheldemist.Movers;

/// <summary>
/// A set of moving ropes of one kind (the hawsers between a tug and her tow, the tows' lashings, the lock's tow
/// lines, an opening bridge's lifting chains): real tubes of the rope's own thickness (Rope.cs), each from a to b,
/// hanging `sag` metres at its middle. Given anew every frame by Clear, Add and Commit; the mesh is made again only
/// when a rope has moved, into the same arrays; a set whose ropes are all more than 150 m from the camera is hidden
/// and left as it is (a moving rope's arrays still cost a few hundred managed bytes each time they are handed over).
/// </summary>
public partial class RopeLines : MeshInstance3D
{
    private readonly ArrayMesh mesh = new();
    private readonly Rope.Tube tube = new();
    private readonly Rope.Kind kind;
    private readonly List<(Vector3 A, Vector3 B, float Sag)> ropes = new(), drawn = new();
    private readonly Vector3[] path = new Vector3[Steps + 1];
    private float drawnWet = -1;
    private const int Steps = 10;
    public int Rebuilds { get; private set; }

    public RopeLines(string name, Rope.Kind kind)
    {
        Name = name;
        Mesh = mesh;
        this.kind = kind;
        CastShadow = ShadowCastingSetting.Off;
        // the ropes go where their boats go: no fixed box for the culler
        ExtraCullMargin = 2000;
    }

    public void Clear() => ropes.Clear();

    /// <summary>A rope from a to b; sag: how far its middle hangs below the straight line (0: taut).</summary>
    public void Add(Vector3 a, Vector3 b, float sag = 0) => ropes.Add((a, b, sag));

    /// <summary>Draw what was added since Clear (nothing is made again when no rope moved a few millimetres).</summary>
    public void Commit()
    {
        long b0 = GC.GetAllocatedBytesForCurrentThread();
        Draw();
        Bytes += GC.GetAllocatedBytesForCurrentThread() - b0;
        Commits++;
    }

    /// <summary>For checks: the managed bytes allocated in every rope set's commits, and the commits.</summary>
    public static long Bytes { get; private set; }
    public static long Commits { get; private set; }

    /// <summary>Beyond this every rope of the set is far under a pixel thick: the set is hidden and not made again (a moving rope's arrays cost a few hundred bytes each time).</summary>
    private const float Far = 150;

    private void Draw()
    {
        if (Main.I?.Cam is { } cam && GodotObject.IsInstanceValid(cam))
        {
            var eye = cam.GlobalPosition;
            bool near = false;
            foreach (var (a, b, _) in ropes)
                if (eye.DistanceSquaredTo(a) < Far * Far || eye.DistanceSquaredTo(b) < Far * Far || eye.DistanceSquaredTo((a + b) / 2) < Far * Far) { near = true; break; }
            if (!near && ropes.Count > 0)
            {
                Visible = false;
                drawn.Clear(); // (made again when it comes near)
                return;
            }
            Visible = true;
        }
        float wet = Rope.RainWet;
        bool same = ropes.Count == drawn.Count && MathF.Abs(wet - drawnWet) < 0.05f;
        for (int i = 0; same && i < ropes.Count; i++)
            same = ropes[i].A.DistanceSquaredTo(drawn[i].A) < 1e-5f && ropes[i].B.DistanceSquaredTo(drawn[i].B) < 1e-5f && MathF.Abs(ropes[i].Sag - drawn[i].Sag) < 0.003f;
        if (same) return;
        drawn.Clear();
        drawn.AddRange(ropes);
        drawnWet = wet;
        Rebuilds++;
        tube.Begin();
        float d = Rope.Diameter(kind), water = kind is Rope.Kind.Hawser or Rope.Kind.Mooring ? Tide.River : float.NaN;
        int sides = Rope.Sides(kind);
        var tint = Rope.Tint(kind);
        foreach (var (a, b, sag) in ropes)
        {
            int n = sag > 0.005f ? Steps : 1;
            for (int k = 0; k <= n; k++)
            {
                float f = (float)k / n;
                path[k] = a.Lerp(b, f) + Vector3.Down * (sag * 4 * f * (1 - f));
            }
            tube.Add(path.AsSpan(0, n + 1), d, sides, tint, water, wet);
        }
        tube.Commit(mesh, Rope.Material);
    }
}
