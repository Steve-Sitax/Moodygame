using System;
using System.Collections.Generic;
using Godot;

namespace Scheldemist.World.Ruien;

/// <summary>
/// Vault coverage shared by underground lighting and world-space exclusion of the town water sheets.
/// It follows the clear interior plus masonry thickness, independent of camera height and tide.
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
        // The zone describes the clear interior. Its wall, vault haunch and relief are covered too.
        float c = Mathf.SmoothStep(-z.Wall-0.35f, -z.Wall+0.15f, inside);
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
                Rect2 zr = z.Kind == "room" ? z.Rect.Grow(z.Wall+1) : Bounds(z.Path).Grow(z.S.Width / 2 + z.Wall+1);
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

}
