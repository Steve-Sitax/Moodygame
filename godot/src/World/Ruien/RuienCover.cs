using System;
using System.Collections.Generic;
using Godot;

namespace Scheldemist.World.Ruien;

/// <summary>
/// Vault coverage shared by underground lighting and world-space exclusion of the town water sheets.
/// It follows the clear interior plus masonry thickness, independent of camera height and tide.
/// Red: a vault overhead (open above the street, so the shafts' tops and the street keep the sky). Green: a closed way
/// in from the street (an entrance's stair and landing behind its door, RuienEntrance), covered up to the height in blue
/// (-8 m at 0 to +8 m at 1: every height for a stair in a bank, the masonry's top for one that runs on under a street).
/// </summary>
public sealed class RuienCover
{
    private const float Px = 0.5f;
    public Vector4 Box { get; private set; }
    private float[] map = Array.Empty<float>();
    private float[] closed = Array.Empty<float>();
    private float[] ceiling = Array.Empty<float>();
    public const float CeilingSpan = 8;
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

    public void Build(RuienData data, IReadOnlyList<RuienEntrance.Spec>? entrances = null)
    {
        entrances ??= Array.Empty<RuienEntrance.Spec>();
        if (data.Areas.Count == 0 && entrances.Count == 0) return;
        Aabb? merged = null;
        foreach (var a in data.Areas) merged = merged is { } m ? m.Merge(a.Box) : a.Box;
        foreach (var e in entrances)
            foreach (var (frame, lo, hi, _) in RuienEntrance.Footprint(e))
                foreach (var c in new[] { new Vector3(lo.X, 0, lo.Y), new Vector3(hi.X, 0, lo.Y), new Vector3(lo.X, 0, hi.Y), new Vector3(hi.X, 0, hi.Y) })
                {
                    var p = frame * c;
                    merged = merged is { } m ? m.Expand(p) : new Aabb(p, Vector3.Zero);
                }
        var box = merged!.Value.Grow(4);
        w = (int)MathF.Ceiling(box.Size.X / Px);
        h = (int)MathF.Ceiling(box.Size.Z / Px);
        Box = new Vector4(box.Position.X, box.Position.Z, w * Px, h * Px);
        map = new float[w * h];
        closed = new float[w * h];
        ceiling = new float[w * h];
        Array.Fill(ceiling, -CeilingSpan);
        var deepest = new float[w * h];
        Array.Fill(deepest, float.NegativeInfinity);
        var bytes = new byte[w * h * 3];
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
        // The entrances: their footprints (in their frames' x and z), soft over a quarter metre at the edge. Under them
        // red too: below the street the stair is under cover like a vault (rain, the water sheets).
        foreach (var e in entrances)
            foreach (var (frame, lo, hi, top) in RuienEntrance.Footprint(e))
            {
                var inv = frame.AffineInverse();
                var r = new Rect2(); bool first = true;
                foreach (var c in new[] { new Vector3(lo.X, 0, lo.Y), new Vector3(hi.X, 0, lo.Y), new Vector3(lo.X, 0, hi.Y), new Vector3(hi.X, 0, hi.Y) })
                {
                    var p = frame * c; var q = new Vector2(p.X, p.Z);
                    r = first ? new Rect2(q, Vector2.Zero) : r.Expand(q); first = false;
                }
                r = r.Grow(1);
                int i0 = Math.Max(0, (int)((r.Position.X - Box.X) / Px)), i1 = Math.Min(w - 1, (int)((r.End.X - Box.X) / Px) + 1);
                int j0 = Math.Max(0, (int)((r.Position.Y - Box.Y) / Px)), j1 = Math.Min(h - 1, (int)((r.End.Y - Box.Y) / Px) + 1);
                for (int j = j0; j <= j1; j++)
                    for (int i = i0; i <= i1; i++)
                    {
                        var p = inv * new Vector3(Box.X + (i + 0.5f) * Px, frame.Origin.Y, Box.Y + (j + 0.5f) * Px);
                        float inside = Math.Min(Math.Min(p.X - lo.X, hi.X - p.X), Math.Min(p.Z - lo.Y, hi.Y - p.Z));
                        float c = Mathf.SmoothStep(-0.25f, 0.25f, inside);
                        if (c > closed[j * w + i]) closed[j * w + i] = c;
                        if (c > map[j * w + i]) map[j * w + i] = c;
                        // (the height of the piece this cell is deepest in, or nearest to: no fall-off at the edges)
                        if (inside > deepest[j * w + i]) { deepest[j * w + i] = inside; ceiling[j * w + i] = Math.Min(top, CeilingSpan); }
                    }
            }
        for (int k = 0; k < map.Length; k++)
        {
            bytes[3 * k] = (byte)Math.Clamp(MathF.Round(map[k] * 255), 0, 255);
            bytes[3 * k + 1] = (byte)Math.Clamp(MathF.Round(closed[k] * 255), 0, 255);
            bytes[3 * k + 2] = (byte)Math.Clamp(MathF.Round((ceiling[k] + CeilingSpan) / (2 * CeilingSpan) * 255), 0, 255);
        }
        // (x across the picture, z down it: the shaders' uv is (x - x0, z - z0) / size)
        var im = Image.CreateFromData(w, h, false, Image.Format.Rgb8, bytes);
        Texture = ImageTexture.CreateFromImage(im);
    }

    private static Rect2 Bounds(Vector2[] pts)
    {
        var r = new Rect2(pts[0], Vector2.Zero);
        foreach (var p in pts) r = r.Expand(p);
        return r;
    }

    /// <summary>The cover at a point of the plan (0 outside every area), as the shaders read it.</summary>
    public float At(float x, float z) => Sample(map, x, z);
    /// <summary>A closed way in (an entrance) at a point: covered below its height there (as ruien_covered).</summary>
    public float Closed(float x, float y, float z)
    {
        float top = Sample(ceiling, x, z);
        return Sample(closed, x, z) * (1 - Mathf.SmoothStep(top - .05f, top + .25f, y));
    }

    private float Sample(float[] map, float x, float z)
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
