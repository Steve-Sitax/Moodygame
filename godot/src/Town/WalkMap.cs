using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using BitOperations = System.Numerics.BitOperations;
using Godot;

namespace Scheldemist.Town;

/// <summary>
/// Native scene support, static footprints and current bodies for crowd navigation. The native town supplies
/// quarter-metre clearance/heights and one-metre crowd cells; the legacy loader can still read old walk dumps.
/// Long-range routes use static support links. Local walking also avoids the main thread's sampled live bodies.
/// </summary>
public sealed class WalkMap
{
    private sealed class BodyBox
    {
        public Node3D Node = null!;
        public Aabb Box, World;
        public Transform3D Inverse;
        public bool Transit, Active, Moves;
        public Puppet? Owner;
    }
    private static readonly List<BodyBox> bodies = new();
    private readonly object bodyGate = new();
    private readonly record struct BodySample(Aabb Box, Aabb World, Transform3D Inverse, bool Transit, bool Active, Puppet? Owner);
    private BodySample[] bodySamples = Array.Empty<BodySample>();
    private ulong[] bodyBits = Array.Empty<ulong>();
    private int bodyWords;
    public ulong BodySnapshot { get; private set; }
    public ulong TopologyRevision { get; private set; }
    private bool[] routeBodyTiles = Array.Empty<bool>();
    private byte[] routeLinks = Array.Empty<byte>();
    public static bool CachedRouteLinks = Array.IndexOf(OS.GetCmdlineUserArgs(), "--route-original") < 0;
    public bool HasCachedRouteLinks => routeLinks.Length != 0;
    /// <summary>Live boxes absent from the static browser dump: piles, carts and posted people.</summary>
    public static void RegisterBody(Node3D node, Aabb box, bool transit = false, Puppet? owner = null, bool moves = false) => bodies.Add(new() { Node = node, Box = box, Transit = transit, Owner = owner, Moves = moves });
    /// <summary>A registered body's box changes (a barrow worked from between its handles).</summary>
    public static void ResizeBody(Node3D node, Aabb box) { foreach (var b in bodies) if (b.Node == node) b.Box = box; }
    public IEnumerable<(Node3D Node,Aabb World,Puppet? Owner)> TransitBodies()
    {foreach(var b in bodies)if(b.Transit&&b.Active&&GodotObject.IsInstanceValid(b.Node))yield return(b.Node,b.World,b.Owner);}
    /// <summary>TransitBodies into a list the caller keeps: the same bodies in the same order, no iterator a frame.</summary>
    public void TransitBodies(List<(Node3D Node,Aabb World,Puppet? Owner)> into)
    {into.Clear();foreach(var b in bodies)if(b.Transit&&b.Active&&GodotObject.IsInstanceValid(b.Node))into.Add((b.Node,b.World,b.Owner));}
    /// <summary>For checks: the live bodies registered, and of them the ones that are not vehicles, carried or moving.</summary>
    public static int BodyCount => bodies.Count;
    public static int StillBodyCount { get { int n = 0; foreach (var b in bodies) if (!b.Transit && !b.Moves && b.Owner == null) n++; return n; } }
    public void RefreshBodies()
    {
        bool changed = bodies.Count != bodySamples.Length;
        for (int i = bodies.Count - 1; i >= 0; i--)
        {
            var b = bodies[i];
            if (!GodotObject.IsInstanceValid(b.Node)) { bodies.RemoveAt(i); changed = true; continue; }
            // one read of the node's transform (each read is a call into Godot)
            var global = b.Node.GlobalTransform;
            var world = global * b.Box; var inverse = global.AffineInverse();
            bool active = b.Node is not CollisionObject3D collision || collision.CollisionLayer != 0;
            if (world != b.World || inverse != b.Inverse || active != b.Active) changed = true;
            b.World = world; b.Inverse = inverse; b.Active = active;
        }
        // Nodes are sampled on the main thread. Background route requests read only
        // these copied values, with the bitset and its stride updated together.
        lock (bodyGate)
        {
        BodySnapshot++;
        // nothing moved, came or went: the samples and tiles already hold exactly these values (#135)
        if (!changed && bodySamples.Length == bodies.Count && routeBodyTiles.Length != 0) return;
        if (bodySamples.Length != bodies.Count) bodySamples = new BodySample[bodies.Count];
        for (int i = 0; i < bodies.Count; i++) {
            var source = bodies[i];
            bodySamples[i] = new(source.Box, source.World, source.Inverse, source.Transit, source.Active, source.Owner);
        }
        bodyWords = (bodySamples.Length + 63) / 64;
        int count = tileW * ((D + 7) / 8) * bodyWords;
        if (bodyBits.Length != count) bodyBits = new ulong[count];
        else Array.Clear(bodyBits);
        int tiles = tileW * ((D + 7) / 8);
        if (routeBodyTiles.Length != tiles) routeBodyTiles = new bool[tiles];
        else Array.Clear(routeBodyTiles);
        for (int i = 0; i < bodySamples.Length; i++)
        {
            var b = bodySamples[i];
            if (!b.Active) continue;
            int x0 = Math.Max(0, (int)Math.Floor((b.World.Position.X - 0.3 - X0) / 8)), x1 = Math.Min(tileW - 1, (int)Math.Floor((b.World.End.X + 0.3 - X0) / 8));
            int z0 = Math.Max(0, (int)Math.Floor((b.World.Position.Z - 0.3 - Z0) / 8)), z1 = Math.Min((D + 7) / 8 - 1, (int)Math.Floor((b.World.End.Z + 0.3 - Z0) / 8));
            for (int z = z0; z <= z1; z++) for (int x = x0; x <= x1; x++) {
                bodyBits[(z * tileW + x) * bodyWords + i / 64] |= 1ul << (i % 64);
                if (!b.Transit) routeBodyTiles[z * tileW + x] = true;
            }
        }
        }
    }
    private bool BodyFree(double x, double z, bool ignoreTransit = false, Puppet? owner = null,double margin=.3)
    {
        lock (bodyGate) return BodyFreeLocked(x, z, ignoreTransit, owner,margin);
    }
    private bool BodyFreeLocked(double x, double z, bool ignoreTransit, Puppet? owner,double margin)
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
                var b = bodySamples[i];
                if ((owner != null && b.Owner == owner) || (ignoreTransit && b.Transit)) continue;
                if (x < b.World.Position.X - margin || x > b.World.End.X + margin || z < b.World.Position.Z - margin || z > b.World.End.Z + margin) continue;
                if (double.IsNaN(feet)) feet = BaseAt(x, z);
                if (b.World.End.Y <= feet + 0.36 || b.World.Position.Y >= feet + 1.75) continue;
                var p = b.Inverse * new Godot.Vector3((float)x, (float)feet + 0.8f, (float)z);
                if (p.X >= b.Box.Position.X - margin && p.X <= b.Box.End.X + margin && p.Z >= b.Box.Position.Z - margin && p.Z <= b.Box.End.Z + margin) return false;
            }
        }
        return true;
    }
    /// <summary>The live bodies whose boxes (with a body's margin) take this point, by name, for reports. Main thread only.</summary>
    public string BlockedBy(Puppet owner, double x, double z)
    {
        var names = new List<string>();
        foreach (var b in bodies)
        {
            if (!b.Active || !GodotObject.IsInstanceValid(b.Node) || b.Owner == owner) continue;
            var w = b.World;
            if (x >= w.Position.X - .3 && x <= w.End.X + .3 && z >= w.Position.Z - .3 && z <= w.End.Z + .3) names.Add(b.Node.GetPath().ToString().Replace("/root/NativeTownGame/@SubViewport@2/", "") + (b.Transit ? " (moving)" : ""));
        }
        return string.Join(" | ", names);
    }
    /// <summary>
    /// The world box of a live body that stays put (a goods crate, a posted figure, a parked cart, a stall) whose margin takes
    /// this point. False when none does, or when a moving body (a dray, the omnibus) takes it too: that one is waited for, not walked
    /// round. Main thread only, and only for a step that was already refused, so it scans the list without a lookup.
    /// </summary>
    public bool StandingBodyAt(Puppet owner, double x, double z, out Aabb world)
    {
        world = default;
        bool found = false;
        double feet = double.NaN;
        foreach (var b in bodies)
        {
            if (!b.Active || b.Owner == owner || !GodotObject.IsInstanceValid(b.Node)) continue;
            var w = b.World;
            if (x < w.Position.X - .3 || x > w.End.X + .3 || z < w.Position.Z - .3 || z > w.End.Z + .3) continue;
            if (double.IsNaN(feet)) feet = BaseAt(x, z);
            if (w.End.Y <= feet + 0.36 || w.Position.Y >= feet + 1.75) continue;
            if (b.Transit || b.Moves || b.Owner is { State: "walk" }) return false;
            world = found ? world.Merge(w) : w;
            found = true;
        }
        return found;
    }

    public bool FreeFor(Puppet owner, double x, double z)
    {
        int ix = (int)Math.Floor((x-X0)*4), iz = (int)Math.Floor((z-Z0)*4);
        return ix>=0 && iz>=0 && ix<W*4 && iz<D*4 && free[iz*W*4+ix]!=0 && BodyFree(x,z,owner:owner);
    }
    /// <summary>A thin part at its actual point, against live boxes only; static ground already carries body-radius clearance.</summary>
    public bool BodyClearanceFor(Puppet owner,double x,double z)=>BodyFree(x,z,owner:owner,margin:.025);
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
    private bool nativeHeights;
    public bool IsNative => nativeHeights;
    private short[] nativeQuarterHeights = Array.Empty<short>();
    private int tileW;
    /// <summary>Where the stalls' and shops' keepers stand (game/stalls.ts sellerSpots, as the bake's town had them): x, z, yaw.</summary>
    public Dictionary<string, double[]> Sellers = new();

    /// <summary>A scene-derived map, built once from native support triangles and current solid footprints.
    /// Quarter-metre heights keep narrow stairs separate from their half-metre display-height samples.</summary>
    public static WalkMap FromNativeData(Rect2 bounds, byte[] freeCells, short[] baseHeights, short[] quarterHeights)
    {
        var map = new WalkMap { X0 = Math.Floor(bounds.Position.X), Z0 = Math.Floor(bounds.Position.Y), nativeHeights = true };
        map.W = (int)Math.Ceiling(bounds.End.X - map.X0); map.D = (int)Math.Ceiling(bounds.End.Y - map.Z0);
        if (freeCells.Length != map.W * map.D * 16 || baseHeights.Length != map.W * map.D * 4 || quarterHeights.Length != freeCells.Length)
            throw new ArgumentException("Native navigation arrays do not match the supplied bounds");
        map.free = freeCells; map.ground = baseHeights; map.nativeQuarterHeights = quarterHeights;
        map.open = new byte[map.W * map.D];
        map.BodyHeights();
        map.RebuildNativeOpenCells();
        map.RefreshBodies();
        return map;
    }

    /// <summary>Discard temporary footprint height ranges after the native map has finished construction.</summary>
    public void FinishNative() { RebuildNativeOpenCells(); low = high = Array.Empty<float>(); PrepareRouteLinks(); RefreshBodies(); }

    /// <summary>Set native support connectivity after static footprint rasterization.</summary>
    public void RestrictNativeTo(byte[] reached)
    {
        TopologyRevision++;
        routeLinks = Array.Empty<byte>();
        if (!nativeHeights || reached.Length != free.Length) throw new ArgumentException("Native reachability size differs from map");
        for (int i = 0; i < free.Length; i++) if (reached[i] == 0) free[i] = 0;
    }

    public bool NativeCellFree(int x, int z) => x >= 0 && z >= 0 && x < W * 4 && z < D * 4 && free[z * W * 4 + x] != 0;

    /// <summary>The static free cells (quarter-metre) around a point as text, one row per z, for the stuck check's report:
    /// '.' free, '#' not free, 'm' marks (x, z) pairs given. Rows run from the lower z; the first column is the lower x.</summary>
    public string[] DumpCells(double cx, double cz, double radius, params (char mark, double x, double z)[] marks)
    {
        var rows = new List<string>();
        for (double z = cz - radius; z <= cz + radius; z += .25)
        {
            var row = new System.Text.StringBuilder();
            for (double x = cx - radius; x <= cx + radius; x += .25)
            {
                char c = NativeCellFree((int)Math.Floor((x - X0) * 4), (int)Math.Floor((z - Z0) * 4)) ? '.' : '#';
                foreach (var m in marks) if (Math.Abs(m.x - x) < .125 && Math.Abs(m.z - z) < .125) c = m.mark;
                row.Append(c);
            }
            rows.Add($"{z:0.00} {row}");
        }
        return rows.ToArray();
    }

    private void RebuildNativeOpenCells()
    {
        // Cell centres carry routes; a one-metre square need not fit inside a narrow stair. Clearance was
        // already rasterized for a walker's radius, and links are checked against the quarter-metre heights.
        for (int z = 0; z < D; z++) for (int x = 0; x < W; x++)
            open[z * W + x] = free[(z * 4 + 2) * W * 4 + x * 4 + 2] != 0 ? (byte)3 : (byte)0;
    }

    private double NativeHeight(double x, double z)
    {
        int ix = (int)Math.Floor((x - X0) * 4), iz = (int)Math.Floor((z - Z0) * 4);
        return ix >= 0 && iz >= 0 && ix < W * 4 && iz < D * 4 ? nativeQuarterHeights[iz * W * 4 + ix] / 100.0 : 0;
    }

    /// <summary>Native route links must follow continuous ground instead of crossing a ledge into a lower cell.
    /// Legacy maps retain their existing route rule.</summary>
    public bool CanStep(double ax, double az, double bx, double bz)
        => StepSupported(ax, az, bx, bz, true);

    // Cache the exact directed one-metre links shared by local routes. Unlike the long-range map,
    // these retain CanStep's direction and samples, including its endpoint-height rule.
    private void PrepareRouteLinks()
    {
        if (!nativeHeights) return;
        var links = new byte[W * D];
        for (int z = 0; z < D; z++) for (int x = 0; x < W; x++) {
            if (open[z * W + x] != 3) continue;
            int bit = 0;
            for (int dz = -1; dz <= 1; dz++) for (int dx = -1; dx <= 1; dx++) {
                if (dx == 0 && dz == 0) continue;
                if (StepSupported(X0 + x + .5, Z0 + z + .5, X0 + x + dx + .5, Z0 + z + dz + .5, false)) links[z * W + x] |= (byte)(1 << bit);
                bit++;
            }
        }
        routeLinks = links;
    }

    /// <summary>The same CanStep answer for a grid edge; static support is shared, live obstacles are current.</summary>
    public bool GridStep(double ax, double az, double bx, double bz)
    {
        if (!CachedRouteLinks || routeLinks.Length == 0) return CanStep(ax, az, bx, bz);
        int x = (int)Math.Floor(ax - X0), z = (int)Math.Floor(az - Z0);
        int dx = (int)(bx - ax), dz = (int)(bz - az);
        int direction = (dz + 1) * 3 + dx + 1;
        if (x < 0 || z < 0 || x >= W || z >= D || ax != X0 + x + .5 || az != Z0 + z + .5
            || bx - ax != dx || bz - az != dz || Math.Abs(dx) > 1 || Math.Abs(dz) > 1 || direction == 4)
            return CanStep(ax, az, bx, bz);
        if (direction > 4) direction--;
        if ((routeLinks[z * W + x] & (1 << direction)) == 0) return false;
        lock (bodyGate) {
            if (!RouteBodiesNearLocked(ax, az, bx, bz)) return true;
            int count = dx != 0 && dz != 0 ? 12 : 8;
            for (int i = 1; i <= count; i++)
                if (!BodyFreeLocked(ax + (bx - ax) * i / count, az + (bz - az) * i / count, true, null, .3)) return false;
            return true;
        }
    }

    private bool RouteBodiesNearLocked(double ax, double az, double bx, double bz)
    {
        int x0 = Math.Max(0, (int)Math.Floor((Math.Min(ax, bx) - X0) / 8)), x1 = Math.Min(tileW - 1, (int)Math.Floor((Math.Max(ax, bx) - X0) / 8));
        int z0 = Math.Max(0, (int)Math.Floor((Math.Min(az, bz) - Z0) / 8)), z1 = Math.Min((D + 7) / 8 - 1, (int)Math.Floor((Math.Max(az, bz) - Z0) / 8));
        for (int z = z0; z <= z1; z++) for (int x = x0; x <= x1; x++) if (routeBodyTiles[z * tileW + x]) return true;
        return false;
    }

    /// <summary>Long-range plans follow static authored support and height. Crowd handles temporary people and movers.</summary>
    public bool SupportsStep(double ax, double az, double bx, double bz)
        => StepSupported(ax, az, bx, bz, false);

    private bool StepSupported(double ax, double az, double bx, double bz, bool liveBodies)
    {
        if (!nativeHeights) return true;
        if (liveBodies && CachedRouteLinks) {
            // One body snapshot/lock for the whole leg, rather than one lock per eighth-metre sample.
            lock (bodyGate) {
                bool near = RouteBodiesNearLocked(ax, az, bx, bz);
                return StaticAndBodiesStep(ax, az, bx, bz, near);
            }
        }
        int count = Math.Max(1, (int)Math.Ceiling(Math.Sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az)) * 8));
        double previous = NativeHeight(ax, az);
        for (int i = 1; i <= count; i++)
        {
            double x = ax + (bx - ax) * i / count, z = az + (bz - az) * i / count;
            if (liveBodies ? !PathFree(x, z) : !NativeCellFree((int)Math.Floor((x - X0) * 4), (int)Math.Floor((z - Z0) * 4))) return false;
            double height = NativeHeight(x, z);
            if (Math.Abs(height - previous) > 0.36) return false;
            previous = height;
        }
        return true;
    }

    private bool StaticAndBodiesStep(double ax, double az, double bx, double bz, bool bodiesNear)
    {
        int count = Math.Max(1, (int)Math.Ceiling(Math.Sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az)) * 8));
        double previous = NativeHeight(ax, az);
        for (int i = 1; i <= count; i++) {
            double x = ax + (bx - ax) * i / count, z = az + (bz - az) * i / count;
            if (!NativeCellFree((int)Math.Floor((x - X0) * 4), (int)Math.Floor((z - Z0) * 4))
                || bodiesNear && !BodyFreeLocked(x, z, true, null, .3)) return false;
            double height = NativeHeight(x, z);
            if (Math.Abs(height - previous) > .36) return false;
            previous = height;
        }
        return true;
    }

    /// <summary>Build the same cheap crowd lookup from the current native physics world, including edited props.</summary>
    public static WalkMap FromNative(Rect2 bounds, PhysicsDirectSpaceState3D space, uint layer)
    {
        var map = new WalkMap { X0 = Math.Floor(bounds.Position.X), Z0 = Math.Floor(bounds.Position.Y) };
        map.W = (int)Math.Ceiling(bounds.End.X - map.X0); map.D = (int)Math.Ceiling(bounds.End.Y - map.Z0);
        map.open = new byte[map.W * map.D]; map.free = new byte[map.W * map.D * 16]; map.ground = new short[map.W * map.D * 4];
        var ray = new PhysicsRayQueryParameters3D { CollisionMask = layer };
        var capsule = new CapsuleShape3D { Radius = 0.25f, Height = 1.4f };
        var body = new PhysicsShapeQueryParameters3D { Shape = capsule, CollisionMask = layer, Margin = 0.015f };
        for (int z = 0; z < map.D * 4; z++) for (int x = 0; x < map.W * 4; x++)
        {
            float wx = (float)map.X0 + (x + 0.5f) / 4, wz = (float)map.Z0 + (z + 0.5f) / 4;
            // This district is the ground-level quay. Deep steps and roofs are separate navigation regions.
            ray.From = new Vector3(wx, 0.35f, wz); ray.To = new Vector3(wx, -0.6f, wz);
            var hit = space.IntersectRay(ray);
            if (hit.Count == 0 || hit["normal"].AsVector3().Y < 0.65f) continue;
            float y = hit["position"].AsVector3().Y;
            body.Transform = new Transform3D(Basis.Identity, new Vector3(wx, y + 1.06f, wz));
            if (space.IntersectShape(body, 1).Count != 0) continue;
            map.free[z * map.W * 4 + x] = 1;
            map.ground[z / 2 * map.W * 2 + x / 2] = (short)Math.Clamp(Math.Round(y * 100), short.MinValue, short.MaxValue);
        }
        for (int z = 0; z < map.D; z++) for (int x = 0; x < map.W; x++)
        {
            bool clear = true;
            for (int dz = 0; dz < 4 && clear; dz++) for (int dx = 0; dx < 4; dx++)
                if (map.free[(z * 4 + dz) * map.W * 4 + x * 4 + dx] == 0) { clear = false; break; }
            map.open[z * map.W + x] = clear ? (byte)3 : (byte)0;
        }
        map.BodyHeights(); map.low = map.high = Array.Empty<float>(); map.RefreshBodies(); capsule.Dispose();
        return map;
    }

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
                float feet = (float)(nativeHeights ? NativeHeight(X0 + (x + 0.5) / 4, Z0 + (z + 0.5) / 4) : BaseAt(X0 + (x + 0.5) / 4, Z0 + (z + 0.5) / 4));
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
        TopologyRevision++;
        routeLinks = Array.Empty<byte>();
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
                    double x = X0 + (ix + 0.5) / 4, z = Z0 + (iz + 0.5) / 4, feet = nativeHeights ? NativeHeight(x, z) : BaseAt(x, z);
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
        TopologyRevision++;
        routeLinks = Array.Empty<byte>();
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
        if (nativeHeights) return NativeHeight(x, z);
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
