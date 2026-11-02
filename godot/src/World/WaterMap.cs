using System;
using System.Collections.Generic;
using Godot;
using Scheldemist.Render;

namespace Scheldemist.World;

/// <summary>
/// #269: where the river's sheet may be drawn, seen from above. The sheet (Waters.cs, river_sheet) is one 1200 m plane at
/// the tide's level that goes with the eye; the land used to hide it only by being higher, so a cellar, a light well, a
/// Ruien gallery or a stair below high water showed the river through its floor. This map is the town's water outlines
/// (shared/city.json `water`, the rings Water.In reads: the river, the Werf, the canal, the vliet, the Petit Bassin with
/// its mouth and the lock, the moat) grown by <see cref="Margin"/> under the quay walls, so the sheet still meets every
/// wall's foot at any tide. The water shader (Psx.WaterMapLines, the river's sheet alone: `river` > 0.5) discards
/// inside the map's box where the map is under one half; outside the box (the far river, the land beyond the moat) it is
/// drawn as before. Built once at load, a half-metre grid, like the Ruien cover (RuienCover.cs).
/// </summary>
public static class WaterMap
{
    /// <summary>Metres per pixel.</summary>
    public const float Px = 0.5f;
    /// <summary>How far past an outline the sheet still goes: under the quay wall, never as far as a cellar's wall.</summary>
    public const float Margin = 1.5f;
    public static Vector4 Box { get; private set; }
    public static ImageTexture? Texture { get; private set; }
    private static byte[] map = Array.Empty<byte>();
    private static int w, h;

    /// <summary>Builds the map from Water.Outlines and gives it to the shaders (psx_water_map, psx_water_box).</summary>
    public static void Build()
    {
        var rings = Water.Outlines;
        if (rings.Count == 0) { GD.PrintErr("water map: no water outlines; the river's sheet is drawn everywhere"); return; }
        ulong t0 = Time.GetTicksUsec();
        float minX = float.MaxValue, minZ = float.MaxValue, maxX = float.MinValue, maxZ = float.MinValue;
        foreach (var r in rings)
            for (int i = 0; i < r.Length; i += 2)
            {
                minX = Math.Min(minX, r[i]); maxX = Math.Max(maxX, r[i]);
                minZ = Math.Min(minZ, r[i + 1]); maxZ = Math.Max(maxZ, r[i + 1]);
            }
        // (the box is the outlines' own: past it, the far river and the land beyond the moat, the sheet is drawn as before)
        float x0 = MathF.Floor(minX), z0 = MathF.Floor(minZ);
        w = (int)MathF.Ceiling((maxX - x0) / Px);
        h = (int)MathF.Ceiling((maxZ - z0) / Px);
        Box = new Vector4(x0, z0, w * Px, h * Px);
        // inside the outlines, by rows: the same even-odd rule over all the rings as Water.In, at each pixel's centre
        var dist = new float[w * h];
        var cross = new List<float>(64);
        for (int j = 0; j < h; j++)
        {
            float z = z0 + (j + 0.5f) * Px;
            cross.Clear();
            foreach (var r in rings)
                for (int i = 0, k = r.Length - 2; i < r.Length; k = i, i += 2)
                {
                    float xi = r[i], zi = r[i + 1], xk = r[k], zk = r[k + 1];
                    if (zi > z != zk > z) cross.Add((xk - xi) * (z - zi) / (zk - zi) + xi);
                }
            cross.Sort();
            int c = 0;
            for (int i = 0; i < w; i++)
            {
                float x = x0 + (i + 0.5f) * Px;
                while (c < cross.Count && cross[c] <= x) c++;
                // (inside: an odd number of crossings still to the right)
                dist[j * w + i] = (cross.Count - c) % 2 == 1 ? 0 : float.MaxValue;
            }
        }
        // the distance from the water, in metres (a two-pass chamfer: within a few per cent of the true distance)
        const float D = Px, Dd = Px * 1.41421356f;
        for (int j = 0; j < h; j++)
            for (int i = 0; i < w; i++)
            {
                int o = j * w + i;
                float v = dist[o];
                if (i > 0) v = Math.Min(v, dist[o - 1] + D);
                if (j > 0)
                {
                    v = Math.Min(v, dist[o - w] + D);
                    if (i > 0) v = Math.Min(v, dist[o - w - 1] + Dd);
                    if (i < w - 1) v = Math.Min(v, dist[o - w + 1] + Dd);
                }
                dist[o] = v;
            }
        for (int j = h - 1; j >= 0; j--)
            for (int i = w - 1; i >= 0; i--)
            {
                int o = j * w + i;
                float v = dist[o];
                if (i < w - 1) v = Math.Min(v, dist[o + 1] + D);
                if (j < h - 1)
                {
                    v = Math.Min(v, dist[o + w] + D);
                    if (i < w - 1) v = Math.Min(v, dist[o + w + 1] + Dd);
                    if (i > 0) v = Math.Min(v, dist[o + w - 1] + Dd);
                }
                dist[o] = v;
            }
        // one half at the margin's line, a pixel's ramp across it: the filtered picture finds the line between pixels
        map = new byte[w * h];
        int water = 0;
        for (int o = 0; o < map.Length; o++)
        {
            float v = Math.Clamp(0.5f + (Margin - dist[o]) / Px, 0, 1);
            map[o] = (byte)MathF.Round(v * 255);
            if (map[o] >= 128) water++;
        }
        // (x across the picture, z down it: the shaders' uv is (x - x0, z - z0) / size)
        Texture = ImageTexture.CreateFromImage(Image.CreateFromData(w, h, false, Image.Format.R8, map));
        Psx.SetWaterMap(Texture, Box);
        GD.Print($"water map: {w} x {h} at {Px} m from ({x0}, {z0}), {water * Px * Px:0} m2 of water with its {Margin} m margin, {rings.Count} outlines, {(Time.GetTicksUsec() - t0) / 1000.0:0.0} ms");
    }

    /// <summary>Is the river's sheet drawn at (x, z)? (As the shader reads the map, without its filtering.)</summary>
    public static bool Drawn(float x, float z)
    {
        if (map.Length == 0) return true;
        int i = (int)MathF.Floor((x - Box.X) / Px), j = (int)MathF.Floor((z - Box.Y) / Px);
        if (x < Box.X || z < Box.Y || x > Box.X + Box.Z || z > Box.Y + Box.W) return true;
        i = Math.Clamp(i, 0, w - 1);
        j = Math.Clamp(j, 0, h - 1);
        return map[j * w + i] >= 128;
    }
}
