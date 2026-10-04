using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using BitOperations = System.Numerics.BitOperations;
using Godot;

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
    private sealed class BodyBox
    {
        public Node3D Node = null!;
        public Aabb Box, World;
        public Transform3D Inverse;
        public bool Transit, Active;
        public Puppet? Owner;
    }
    private static readonly List<BodyBox> bodies = new();
    private ulong[] bodyBits = Array.Empty<ulong>();
    private int bodyWords;
    /// <summary>Live boxes absent from the static browser dump: piles, carts and posted people.</summary>
    public static void RegisterBody(Node3D node, Aabb box, bool transit = false, Puppet? owner = null) => bodies.Add(new() { Node = node, Box = box, Transit = transit, Owner = owner });
    public void RefreshBodies()
    {
        for (int i = bodies.Count - 1; i >= 0; i--)
        {
            var b = bodies[i];
            if (!GodotObject.IsInstanceValid(b.Node)) { bodies.RemoveAt(i); continue; }
            b.World = b.Node.GlobalTransform * b.Box;
            b.Inverse = b.Node.GlobalTransform.AffineInverse();
            b.Active = b.Node is not CollisionObject3D collision || collision.CollisionLayer != 0;
        }
        bodyWords = (bodies.Count + 63) / 64;
        int count = tileW * ((D + 7) / 8) * bodyWords;
        if (bodyBits.Length != count) bodyBits = new ulong[count];
        else Array.Clear(bodyBits);
        for (int i = 0; i < bodies.Count; i++)
        {
            var b = bodies[i];
            if (!b.Active) continue;
            int x0 = Math.Max(0, (int)Math.Floor((b.World.Position.X - 0.3 - X0) / 8)), x1 = Math.Min(tileW - 1, (int)Math.Floor((b.World.End.X + 0.3 - X0) / 8));
            int z0 = Math.Max(0, (int)Math.Floor((b.World.Position.Z - 0.3 - Z0) / 8)), z1 = Math.Min((D + 7) / 8 - 1, (int)Math.Floor((b.World.End.Z + 0.3 - Z0) / 8));
            for (int z = z0; z <= z1; z++) for (int x = x0; x <= x1; x++) bodyBits[(z * tileW + x) * bodyWords + i / 64] |= 1ul << (i % 64);
        }
    }
    private bool BodyFree(double x, double z, bool ignoreTransit = false, Puppet? owner = null)
    {
        int ix = (int)Math.Floor((x - X0) / 8), iz = (int)Math.Floor((z - Z0) / 8);
        if (ix < 0 || iz < 0 || ix >= tileW || iz >= (D + 7) / 8 || bodyWords == 0) return true;
        int tile = (iz * tileW + ix) * bodyWords;
        double feet = double.NaN;
        for (int word = 0; word < bodyWords; word++)
        {
            ulong bits = bodyBits[tile + word];
            while (bits != 0)
            {
                int i = word * 64 + BitOperations.TrailingZeroCount(bits); bits &= bits - 1;
                var b = bodies[i];
                if ((owner != null && b.Owner == owner) || (ignoreTransit && b.Transit)) continue;
                if (x < b.World.Position.X - 0.3 || x > b.World.End.X + 0.3 || z < b.World.Position.Z - 0.3 || z > b.World.End.Z + 0.3) continue;
                if (double.IsNaN(feet)) feet = BaseAt(x, z);
                if (b.World.End.Y <= feet + 0.36 || b.World.Position.Y >= feet + 1.75) continue;
                var p = b.Inverse * new Godot.Vector3((float)x, (float)feet + 0.8f, (float)z);
                if (p.X >= b.Box.Position.X - 0.3 && p.X <= b.Box.End.X + 0.3 && p.Z >= b.Box.Position.Z - 0.3 && p.Z <= b.Box.End.Z + 0.3) return false;
            }
        }
        return true;
    }
    public bool FreeFor(Puppet owner, double x, double z)
    {
        int ix = (int)Math.Floor((x-X0)*4), iz = (int)Math.Floor((z-Z0)*4);
        return ix>=0 && iz>=0 && ix<W*4 && iz<D*4 && free[iz*W*4+ix]!=0 && BodyFree(x,z,owner:owner);
    }
    public double X0, Z0;
    public int W, D;
    public byte[] BrowserReached = Array.Empty<byte>();
    public string[] BrowserUnreachable = Array.Empty<string>();
    public double BrowserX0, BrowserZ0;
    public int BrowserW, BrowserD;
    private byte[] open = Array.Empty<byte>();
    private byte[] free = Array.Empty<byte>();
    private short[] ground = Array.Empty<short>();
    private float[] low = Array.Empty<float>(), high = Array.Empty<float>();
    private int tileW;
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
        if (j.TryGetProperty("paths", out var paths))
        {
            if (paths.GetProperty("res").GetDouble() != 0.5 || paths.GetProperty("start")[0].GetDouble() != 10 || paths.GetProperty("start")[1].GetDouble() != 12)
                throw new InvalidDataException("baked browser path rule must be 0.5 m from (10,12)");
            m.BrowserX0 = paths.GetProperty("x0").GetDouble(); m.BrowserZ0 = paths.GetProperty("z0").GetDouble();
            m.BrowserW = paths.GetProperty("w").GetInt32(); m.BrowserD = paths.GetProperty("h").GetInt32();
            m.BrowserReached = data.AsSpan(paths.GetProperty("offset").GetInt32(), m.BrowserW * m.BrowserD).ToArray();
            if (paths.TryGetProperty("browserUnreachable", out var bad))
            {
                var labels = new List<string>();
                foreach (var label in bad.EnumerateArray()) labels.Add(label.GetString()!);
                m.BrowserUnreachable = labels.ToArray();
            }
        }
        if (j.TryGetProperty("sellers", out var s))
            foreach (var e in s.EnumerateObject())
                m.Sellers[e.Name] = new[] { e.Value[0].GetDouble(), e.Value[1].GetDouble(), e.Value[2].GetDouble() };
        m.BodyHeights();
        Scheldemist.World.Solid.I?.Footprints(m);
        m.low = m.high = Array.Empty<float>();
        m.RefreshBodies();
        return m;
    }

    private void BodyHeights()
    {
        tileW = (W + 7) / 8;
        low = new float[tileW * ((D + 7) / 8)]; high = new float[low.Length];
        Array.Fill(low, float.PositiveInfinity); Array.Fill(high, float.NegativeInfinity);
        for (int z = 0; z < D * 4; z++) for (int x = 0; x < W * 4; x++)
            if (free[z * W * 4 + x] != 0)
            {
                int tile = z / 32 * tileW + x / 32;
                float feet = (float)BaseAt(X0 + (x + 0.5) / 4, Z0 + (z + 0.5) / 4);
                low[tile] = Math.Min(low[tile], feet); high[tile] = Math.Max(high[tile], feet);
            }
    }
    public bool HasBodyAt(Aabb box)
    {
        int x0 = Math.Max(0, (int)Math.Floor((box.Position.X - 0.4 - X0) / 8)), x1 = Math.Min(tileW - 1, (int)Math.Floor((box.End.X + 0.4 - X0) / 8));
        int z0 = Math.Max(0, (int)Math.Floor((box.Position.Z - 0.4 - Z0) / 8)), z1 = Math.Min((D + 7) / 8 - 1, (int)Math.Floor((box.End.Z + 0.4 - Z0) / 8));
        for (int z = z0; z <= z1; z++) for (int x = x0; x <= x1; x++)
        {
            int i = z * tileW + x;
            if (box.End.Y > low[i] + 0.36f && box.Position.Y < high[i] + 1.75f) return true;
        }
        return false;
    }

    /// <summary>Close only triangles within a walker's body height. Load-time work; walking remains a byte lookup.
    /// Clip before projecting so a high beam or deck underside does not close the space beneath/above it.</summary>
    public void AddTriangles(Vector3[] faces)
    {
        var a = new Vector3[8]; var b = new Vector3[8];
        int Clip(Vector3[] input, int n, Vector3[] output, float y, bool above)
        {
            int count = 0;
            for (int i = 0; i < n; i++)
            {
                var p = input[i]; var q = input[(i + 1) % n];
                bool pin = above ? p.Y >= y : p.Y <= y, qin = above ? q.Y >= y : q.Y <= y;
                if (pin) output[count++] = p;
                if (pin != qin) output[count++] = p.Lerp(q, (y - p.Y) / (q.Y - p.Y));
            }
            return count;
        }
        for (int k = 0; k < faces.Length; k += 3)
        {
            var p = faces[k]; var q = faces[k + 1]; var r = faces[k + 2];
            float minX = Math.Min(p.X, Math.Min(q.X, r.X)), maxX = Math.Max(p.X, Math.Max(q.X, r.X));
            float minZ = Math.Min(p.Z, Math.Min(q.Z, r.Z)), maxZ = Math.Max(p.Z, Math.Max(q.Z, r.Z));
            float minY = Math.Min(p.Y, Math.Min(q.Y, r.Y)), maxY = Math.Max(p.Y, Math.Max(q.Y, r.Y));
            if (!HasBodyAt(new Aabb(new Vector3(minX, minY, minZ), new Vector3(maxX - minX, maxY - minY, maxZ - minZ)))) continue;
            for (int iz = Math.Max(0, (int)((minZ - 0.4 - Z0) * 4)); iz <= Math.Min(D * 4 - 1, (int)((maxZ + 0.4 - Z0) * 4)); iz++)
                for (int ix = Math.Max(0, (int)((minX - 0.4 - X0) * 4)); ix <= Math.Min(W * 4 - 1, (int)((maxX + 0.4 - X0) * 4)); ix++)
                {
                    int cell = iz * W * 4 + ix;
                    if (free[cell] == 0) continue;
                    double x = X0 + (ix + 0.5) / 4, z = Z0 + (iz + 0.5) / 4, feet = BaseAt(x, z);
                    if (maxY <= feet + 0.36 || minY >= feet + 1.75) continue;
                    a[0] = p; a[1] = q; a[2] = r;
                    int n = Clip(a, 3, b, (float)feet + 0.36f, true);
                    n = Clip(b, n, a, (float)feet + 1.75f, false);
                    bool inside = false, near = false;
                    for (int i = 0; i < n; i++)
                    {
                        var u = a[i]; var v = a[(i + 1) % n];
                        if ((u.Z > z) != (v.Z > z) && x < (v.X - u.X) * (z - u.Z) / (v.Z - u.Z) + u.X) inside = !inside;
                        double dx = v.X - u.X, dz = v.Z - u.Z, length = dx * dx + dz * dz;
                        double t = length == 0 ? 0 : Math.Clamp(((x - u.X) * dx + (z - u.Z) * dz) / length, 0, 1);
                        if (Math.Pow(x - u.X - t * dx, 2) + Math.Pow(z - u.Z - t * dz, 2) < 0.4 * 0.4) near = true;
                    }
                    if (inside || near) free[cell] = 0;
                }
        }
    }
    public void CloseOpenCells()
    {
        for (int z = 0; z < D; z++) for (int x = 0; x < W; x++)
            if (open[z * W + x] == 3 && !Free(X0 + x + 0.5, Z0 + z + 0.5)) open[z * W + x] = 0;
    }

    /// <summary>Is the 1 m cell at (x, z) open for the walk grid (crowd.ts NavGrid.open)?</summary>
    public bool Open(double x, double z)
    {
        int ix = (int)Math.Floor(x - X0), iz = (int)Math.Floor(z - Z0);
        return ix >= 0 && iz >= 0 && ix < W && iz < D && open[iz * W + ix] == 3 && BodyFree(x, z);
    }

    /// <summary>Can a walker's body stand here (the browser's World.isFree with a body's radius)?</summary>
    public bool Free(double x, double z)
    {
        int ix = (int)Math.Floor((x - X0) * 4), iz = (int)Math.Floor((z - Z0) * 4);
        return ix >= 0 && iz >= 0 && ix < W * 4 && iz < D * 4 && free[iz * W * 4 + ix] != 0 && BodyFree(x, z);
    }

    /// <summary>The browser path rule ignores vehicles passing on their rounds.</summary>
    public bool PathFree(double x, double z)
    {
        int ix = (int)Math.Floor((x - X0) * 4), iz = (int)Math.Floor((z - Z0) * 4);
        return ix >= 0 && iz >= 0 && ix < W * 4 && iz < D * 4 && free[iz * W * 4 + ix] != 0 && BodyFree(x, z, true);
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
