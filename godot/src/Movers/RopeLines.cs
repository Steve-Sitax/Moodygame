using System.Collections.Generic;
using Godot;

namespace Scheldemist.Movers;

/// <summary>
/// A set of straight ropes drawn as lines (hawsers between a tug and its tow, lashings, a bridge's chains, a
/// crane's fall): the browser's LineSegments with ropeMaterial. Points are given two by two, in the world.
/// </summary>
public partial class RopeLines : MeshInstance3D
{
    private readonly ImmediateMesh im = new();
    private readonly List<Vector3> pts = new();
    private Material? mat;
    private bool had;

    public RopeLines(string name, Material? material)
    {
        Name = name;
        Mesh = im;
        mat = material;
        CastShadow = ShadowCastingSetting.Off;
        // the ropes go where their boats go: no fixed box for the culler
        ExtraCullMargin = 2000;
    }

    public void Clear() => pts.Clear();

    public void Add(Vector3 a, Vector3 b)
    {
        pts.Add(a);
        pts.Add(b);
    }

    /// <summary>Draw what was added since Clear.</summary>
    public void Commit()
    {
        if (pts.Count == 0 && !had) return;
        im.ClearSurfaces();
        had = pts.Count > 0;
        if (!had) return;
        im.SurfaceBegin(Mesh.PrimitiveType.Lines, mat);
        foreach (var p in pts) im.SurfaceAddVertex(p);
        im.SurfaceEnd();
    }
}
