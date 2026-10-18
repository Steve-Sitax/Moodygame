using System;
using System.Collections.Generic;
using Godot;
using Scheldemist.Render;

namespace Scheldemist.World.Ruien;

/// <summary>
/// Where a vault is overhead (docs/ruien-native.md): the cover map the Ruien's shaders read (no sky, no sun, no street
/// lamp under it), the eye's "underground" for the light and the air, and the river's lid: the river's sheet follows the
/// eye at the tide's level and would cut through every gallery and hall below it, so an invisible lid over each zone's
/// floor plan at the river's level marks those pixels (the boats' cap, Psx.Cap: the water is not drawn where it is
/// marked). All from the areas' zones.
/// </summary>
public sealed class RuienCover
{
    private const float Px = 0.5f;
    public Vector4 Box { get; private set; }
    private float[] map = Array.Empty<float>();
    private int w, h;
    public ImageTexture? Texture { get; private set; }

    public static float ZoneCover(RuienData.Zone z, Vector2 p)
    {
        float inside = z.Inside(p, out float along);
        float c = Mathf.SmoothStep(-0.35f, 0.35f, inside);
        if (z.Kind == "line")
        {
            if (z.FadeStart > 0) c *= Mathf.SmoothStep(-0.2f, z.FadeStart, along);
            if (z.FadeEnd > 0) c *= Mathf.SmoothStep(-0.2f, z.FadeEnd, z.Length - along);
        }
        return c;
    }

    public void Build(RuienData data)
    {
        if (data.Areas.Count == 0) return;
        var box = data.Areas[0].Box;
        foreach (var a in data.Areas) box = box.Merge(a.Box);
        box = box.Grow(4);
        w = (int)MathF.Ceiling(box.Size.X / Px);
        h = (int)MathF.Ceiling(box.Size.Z / Px);
        Box = new Vector4(box.Position.X, box.Position.Z, w * Px, h * Px);
        map = new float[w * h];
        var bytes = new byte[w * h];
        foreach (var a in data.Areas)
            foreach (var z in a.Zones)
            {
                // (only the cells near the zone)
                Rect2 zr = z.Kind == "room" ? z.Rect.Grow(1) : Bounds(z.Path).Grow(z.S.Width / 2 + 1);
                int i0 = Math.Max(0, (int)((zr.Position.X - Box.X) / Px)), i1 = Math.Min(w - 1, (int)((zr.End.X - Box.X) / Px) + 1);
                int j0 = Math.Max(0, (int)((zr.Position.Y - Box.Y) / Px)), j1 = Math.Min(h - 1, (int)((zr.End.Y - Box.Y) / Px) + 1);
                for (int j = j0; j <= j1; j++)
                    for (int i = i0; i <= i1; i++)
                    {
                        var p = new Vector2(Box.X + (i + 0.5f) * Px, Box.Y + (j + 0.5f) * Px);
                        float c = ZoneCover(z, p);
                        if (c > map[j * w + i]) map[j * w + i] = c;
                    }
            }
        for (int k = 0; k < map.Length; k++) bytes[k] = (byte)Math.Clamp(MathF.Round(map[k] * 255), 0, 255);
        // (x across the picture, z down it: the shaders' uv is (x - x0, z - z0) / size)
        var im = Image.CreateFromData(w, h, false, Image.Format.R8, bytes);
        Texture = ImageTexture.CreateFromImage(im);
    }

    private static Rect2 Bounds(Vector2[] pts)
    {
        var r = new Rect2(pts[0], Vector2.Zero);
        foreach (var p in pts) r = r.Expand(p);
        return r;
    }

    /// <summary>The cover at a point of the plan (0 outside every area), as the shaders read it.</summary>
    public float At(float x, float z)
    {
        if (map.Length == 0) return 0;
        float fx = (x - Box.X) / Px - 0.5f, fz = (z - Box.Y) / Px - 0.5f;
        int i = (int)MathF.Floor(fx), j = (int)MathF.Floor(fz);
        if (i < 0 || j < 0 || i + 1 >= w || j + 1 >= h) return 0;
        float tx = fx - i, tz = fz - j;
        float a = map[j * w + i] + (map[j * w + i + 1] - map[j * w + i]) * tx;
        float b = map[(j + 1) * w + i] + (map[(j + 1) * w + i + 1] - map[(j + 1) * w + i]) * tx;
        return a + (b - a) * tz;
    }

    /// <summary>The river's lid over the zones' floor plans (drawn at the river's level by the part), one mesh.</summary>
    public static MeshInstance3D Lid(RuienData data)
    {
        var st = new SurfaceTool();
        st.Begin(Mesh.PrimitiveType.Triangles);
        void Quad(Vector2 a, Vector2 b, Vector2 c, Vector2 d)
        {
            foreach (var p in new[] { a, b, c, a, c, d }) st.AddVertex(new Vector3(p.X, 0, p.Y));
        }
        foreach (var area in data.Areas)
            foreach (var z in area.Zones)
            {
                if (z.Kind == "room")
                {
                    var r = z.Rect;
                    Quad(r.Position, new Vector2(r.End.X, r.Position.Y), r.End, new Vector2(r.Position.X, r.End.Y));
                    continue;
                }
                float half = z.S.Width / 2 + 0.05f;
                for (int i = 0; i + 1 < z.Path.Length; i++)
                {
                    var t0 = (z.Path[Math.Min(i + 1, z.Path.Length - 1)] - z.Path[Math.Max(i - 1, 0)]).Normalized();
                    var t1 = (z.Path[Math.Min(i + 2, z.Path.Length - 1)] - z.Path[i]).Normalized();
                    var n0 = new Vector2(t0.Y, -t0.X) * half;
                    var n1 = new Vector2(t1.Y, -t1.X) * half;
                    Quad(z.Path[i] - n0, z.Path[i] + n0, z.Path[i + 1] + n1, z.Path[i + 1] - n1);
                }
            }
        var mesh = st.Commit();
        mesh.SurfaceSetMaterial(0, Psx.Cap());
        return new MeshInstance3D { Name = "ruien_river_lid", Mesh = mesh, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off, Layers = Mirrors.NoMirror };
    }
}
