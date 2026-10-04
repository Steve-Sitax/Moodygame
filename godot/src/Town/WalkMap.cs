using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;

namespace Scheldemist.Town;

/// <summary>
/// Where a townsperson can walk and how high the ground is: the browser world's own answers, dumped by the bake
/// (tools/godot/export-scene.mjs writes town_walk.bin and town_walk.json beside the town; `--walk-only` for these
/// alone). The world's walk rules (world/rijnkaai.ts, world/city.ts) are not ported; the townspeople keep the game's
/// walk grid (docs/godot-port.md). Three layers over the walk map's area:
///   open: 1 m cells, as game/crowd.ts NavGrid.build opens them (half a metre off walls and water, a body's width
///         off the solids that stood there at bake time)
///   free: 0.25 m cells, World.isFree for a walker's body (0.25 m; 0.15 m on the town wall's narrow stairs)
///   base: 0.5 m cells, World.baseAt (the height of the walkable ground) in centimetres
/// What moves in the browser (a cart put down, a crane travelling) is as it stood at the bake.
/// </summary>
public sealed class WalkMap
{
    public double X0, Z0;
    public int W, D;
    private byte[] open = Array.Empty<byte>();
    private byte[] free = Array.Empty<byte>();
    private short[] ground = Array.Empty<short>();
    /// <summary>Where the stalls' and shops' keepers stand (game/stalls.ts sellerSpots, as the bake's town had them): x, z, yaw.</summary>
    public Dictionary<string, double[]> Sellers = new();

    public static WalkMap? Load(string jsonPath)
    {
        string bin = Path.ChangeExtension(jsonPath, ".bin");
        if (!File.Exists(jsonPath) || !File.Exists(bin)) return null;
        using var doc = JsonDocument.Parse(File.ReadAllText(jsonPath));
        var j = doc.RootElement;
        var m = new WalkMap { X0 = j.GetProperty("x0").GetDouble(), Z0 = j.GetProperty("z0").GetDouble(), W = j.GetProperty("w").GetInt32(), D = j.GetProperty("d").GetInt32() };
        var data = File.ReadAllBytes(bin);
        int no = m.W * m.D, nf = no * 16, nb = no * 4;
        if (data.Length < no + nf + nb * 2) return null;
        m.open = data.AsSpan(0, no).ToArray();
        m.free = data.AsSpan(no, nf).ToArray();
        m.ground = new short[nb];
        Buffer.BlockCopy(data, no + nf, m.ground, 0, nb * 2);
        if (j.TryGetProperty("sellers", out var s))
            foreach (var e in s.EnumerateObject())
                m.Sellers[e.Name] = new[] { e.Value[0].GetDouble(), e.Value[1].GetDouble(), e.Value[2].GetDouble() };
        return m;
    }

    /// <summary>Is the 1 m cell at (x, z) open for the walk grid (crowd.ts NavGrid.open)?</summary>
    public bool Open(double x, double z)
    {
        int ix = (int)Math.Floor(x - X0), iz = (int)Math.Floor(z - Z0);
        return ix >= 0 && iz >= 0 && ix < W && iz < D && open[iz * W + ix] == 3;
    }

    /// <summary>Can a walker's body stand here (the browser's World.isFree with a body's radius)?</summary>
    public bool Free(double x, double z)
    {
        int ix = (int)Math.Floor((x - X0) * 4), iz = (int)Math.Floor((z - Z0) * 4);
        return ix >= 0 && iz >= 0 && ix < W * 4 && iz < D * 4 && free[iz * W * 4 + ix] != 0;
    }

    /// <summary>A permanent prop absent from the bake: close its exact footprint for bodies and grid cells.
    /// The arrays remain the same cheap lookup used by every step; no per-person scan of props.</summary>
    public void AddBox(double x, double z, double minX, double maxX, double minZ, double maxZ, double yaw)
    {
        double c = Math.Cos(yaw), s = Math.Sin(yaw), radius = Math.Max(Math.Abs(minX), Math.Abs(maxX)) + Math.Max(Math.Abs(minZ), Math.Abs(maxZ)) + 1;
        bool In(double wx, double wz, double pad)
        {
            double dx = wx - x, dz = wz - z, lx = dx * c - dz * s, lz = dx * s + dz * c;
            return lx >= minX - pad && lx <= maxX + pad && lz >= minZ - pad && lz <= maxZ + pad;
        }
        for (int iz = Math.Max(0, (int)Math.Floor((z - radius - Z0) * 4)); iz <= Math.Min(D * 4 - 1, (int)Math.Ceiling((z + radius - Z0) * 4)); iz++)
            for (int ix = Math.Max(0, (int)Math.Floor((x - radius - X0) * 4)); ix <= Math.Min(W * 4 - 1, (int)Math.Ceiling((x + radius - X0) * 4)); ix++)
                if (In(X0 + (ix + 0.5) / 4, Z0 + (iz + 0.5) / 4, 0.25)) free[iz * W * 4 + ix] = 0;
        for (int iz = Math.Max(0, (int)Math.Floor(z - radius - Z0)); iz <= Math.Min(D - 1, (int)Math.Ceiling(z + radius - Z0)); iz++)
            for (int ix = Math.Max(0, (int)Math.Floor(x - radius - X0)); ix <= Math.Min(W - 1, (int)Math.Ceiling(x + radius - X0)); ix++)
                if (In(X0 + ix + 0.5, Z0 + iz + 0.5, 0.55)) open[iz * W + ix] = 0;
    }

    /// <summary>The height of the walkable ground (the browser's World.baseAt): quay 0, the Steen's ramp, the wall's walk, stairs.</summary>
    public double BaseAt(double x, double z)
    {
        int w = W * 2, d = D * 2;
        int ix = (int)Math.Floor((x - X0) * 2), iz = (int)Math.Floor((z - Z0) * 2);
        if (ix < 0 || iz < 0 || ix >= w || iz >= d) return 0;
        double here = ground[iz * w + ix] / 100.0;
        // a slope (a ramp, a gangway) is smooth between the samples; a step or a ledge stays a step
        double fx = (x - X0) * 2 - 0.5, fz = (z - Z0) * 2 - 0.5;
        int x0 = (int)Math.Floor(fx), z0 = (int)Math.Floor(fz);
        if (x0 < 0 || z0 < 0 || x0 + 1 >= w || z0 + 1 >= d) return here;
        double a = ground[z0 * w + x0] / 100.0, b = ground[z0 * w + x0 + 1] / 100.0, c = ground[(z0 + 1) * w + x0] / 100.0, e = ground[(z0 + 1) * w + x0 + 1] / 100.0;
        if (Math.Max(Math.Max(a, b), Math.Max(c, e)) - Math.Min(Math.Min(a, b), Math.Min(c, e)) > 0.3) return here;
        double tx = fx - x0, tz = fz - z0;
        return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + e * tx) * tz;
    }
}
