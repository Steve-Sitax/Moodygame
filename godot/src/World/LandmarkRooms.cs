using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using Godot;

namespace Scheldemist.World;

/// <summary>
/// The landmarks of rooms lit room by room by the clock (the browser's world/landmarkWindows.ts roomLevel), and the
/// Steen's lanterns after dusk (world/steenlife.ts).
///
/// The town hall, the Oostershuis, the Vleeshuis and the Steen keep their window light as a mesh of the glass's copy
/// (landmark_window_light); the bake keeps its colours as they were at bake time. Here each of those meshes is made
/// again at the start: its glass in whole windows, each window its room (about 2.8 m of front on a storey of one
/// face), its strength and the colours at full light (all as landmarkWindows.ts counts them). Twice a second the rooms
/// are looked at: clerks going home through the evening, a meeting or two lighting a room and its neighbours until
/// 0:00 or 1:00 (not on Sunday), the porter's lodge, a watchman's lamp going round, the first clerks before seven;
/// a tower's or an attic's window dark but for the watchman now and then. A window's colours are written only when
/// its room's lamp changes, and its light on the street (Lights.HallWindow) follows. The churches stay as they are.
///
/// The Steen's lanterns: the bake's flames (hidden by day) shown from 18:36 to 6:48, each with a small halo among the
/// gas lamps' (Lights.FixedHalos) and a place in the lanterns' fixed light pool (People.LanternPool): no light more.
/// </summary>
[GamePart(29)]
public partial class LandmarkRooms : Node
{
    public static LandmarkRooms? I { get; private set; }

    /// <summary>landmarkWindows.ts NIGHTS: shares of a building's rooms.</summary>
    private sealed record Rooms(float Evening, int Meetings, float Watch, float Porter, float Dawn, float Roof);

    private static readonly (Regex test, Rooms? rooms)[] Nights =
    {
        (new Regex("stadhuis"), new Rooms(0.3f, 2, 0.06f, 0.08f, 0.18f, 19)),
        (new Regex("hanzehuis|oostershuis"), new Rooms(0.2f, 1, 0.05f, 0.06f, 0.12f, 15)),
        (new Regex("vleeshuis"), new Rooms(0.12f, 0, 0.05f, 0.05f, 0.08f, 17)),
        (new Regex("steen"), new Rooms(0.1f, 0, 0.07f, 0.06f, 0.05f, 16)),
        (new Regex("."), null),
    };
    private static readonly Regex Glass = new("^(sh_glass|vh_glass|steen_glass|landmark_glass|cath_glass)(_lit)?$");

    private sealed class Win
    {
        public readonly List<int> Tris = new();
        public float K, Lvl;
        public int Room, Storey, Cell;
        public bool High;
        public string Facade = "";
        public Vector3 Mid;
        public Action<float>? Spill;
    }

    private sealed class Built
    {
        public string Building = "";
        public Rooms R = null!;
        public readonly List<Win> Windows = new();
        public float[] Full = Array.Empty<float>();
        public ArrayMesh Mesh = null!;
        public byte[] Bytes = Array.Empty<byte>();
        public int Stride, Offset;
        public bool Bytes8;
        public float Gain = 1;
        public int MeetDay = int.MinValue;
        public readonly HashSet<int> Meet = new();
        public float MeetEnd = 12;
    }

    private readonly List<Built> built = new();
    private float clockT;
    private int lastMin = -1;
    private bool hooked;

    // the Steen's lanterns
    private readonly List<(Node3D flame, int halo, People.LanternPool.Source? src)> lanterns = new();
    private float t;

    /// <summary>For a check: per building, its windows and how many are lit now; the Steen's lanterns and how many burn.</summary>
    public IEnumerable<(string building, int windows, int lit)> Info => built.Select(b => (b.Building, b.Windows.Count, b.Windows.Count(w => w.Lvl > 0)));
    public (int lanterns, int lit) LanternInfo => (lanterns.Count, lanterns.Count(l => l.flame.Visible));

    private static double Hash(double a, double b, double c)
    {
        double s = Math.Sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
        return s - Math.Floor(s);
    }

    public override void _Ready()
    {
        I = this;
        ProcessPriority = 45; // after the daylight and the lights
        var town = Main.I.World.GetNodeOrNull<Node3D>("town");
        if (town == null) return;
        var all = BakedWorld.All(town).OfType<MeshInstance3D>().ToList();
        foreach (var mi in all)
        {
            if (mi.Mesh is not ArrayMesh am || am.GetSurfaceCount() != 1 || am.SurfaceGetMaterial(0) is not ShaderMaterial m || m.ResourceName != "landmark_window_light") continue;
            Node top = mi;
            while (top.GetParent() is Node p && p != town) top = p;
            var rooms = Nights.First(n => n.test.IsMatch($"{top.Name} {mi.Name}")).rooms;
            if (rooms == null) continue;
            try { Build(mi, am, m, rooms, top.Name, all.Where(o => o != mi && IsUnder(o, top))); }
            catch (Exception e) { GD.PrintErr($"landmark rooms: {mi.Name}: {e.Message}"); }
        }
        FindLanterns(town);
        GD.Print($"landmark rooms: {string.Join(", ", built.Select(b => $"{b.Building} {b.Windows.Count} windows"))}; steen lanterns {lanterns.Count}");
    }

    private static bool IsUnder(Node n, Node top)
    {
        for (var q = n.GetParent(); q != null; q = q.GetParent()) if (q == top) return true;
        return false;
    }

    private void Build(MeshInstance3D mi, ArrayMesh am, ShaderMaterial mat, Rooms rooms, string building, IEnumerable<MeshInstance3D> rest)
    {
        var arr = am.SurfaceGetArrays(0);
        var pos = arr[(int)Mesh.ArrayType.Vertex].AsVector3Array();
        var uvIn = arr[(int)Mesh.ArrayType.TexUV].AsVector2Array();
        var idxIn = arr[(int)Mesh.ArrayType.Index].VariantType == Variant.Type.Nil ? null : arr[(int)Mesh.ArrayType.Index].AsInt32Array();
        int nv = idxIn?.Length ?? pos.Length;
        // the glass's triangles, three corners each (made again without an index: each window its own corners)
        var P = new Vector3[nv];
        var UV = new Vector2[nv];
        for (int i = 0; i < nv; i++)
        {
            int v = idxIn?[i] ?? i;
            P[i] = pos[v];
            UV[i] = uvIn.Length > v ? uvIn[v] : Vector2.Zero;
        }
        var xf = mi.GlobalTransform;
        // the building's middle: a window faces away from it (the glass's own normal is not in the light mesh)
        var mid = (xf * am.GetAabb()).GetCenter();

        // the windows: triangles that share a corner are one (landmarkWindows.ts build)
        var ids = new Dictionary<(int, int, int), int>();
        var parent = new List<int>();
        int Find(int i) { while (parent[i] != i) i = parent[i] = parent[parent[i]]; return i; }
        int Node(Vector3 p)
        {
            var k = ((int)Math.Round(p.X * 50), (int)Math.Round(p.Y * 50), (int)Math.Round(p.Z * 50));
            if (!ids.TryGetValue(k, out int n)) { n = parent.Count; parent.Add(n); ids[k] = n; }
            return n;
        }
        var tn = P.Select(Node).ToArray();
        for (int t3 = 0; t3 < nv; t3 += 3)
        {
            int a = Find(tn[t3]);
            foreach (var q in new[] { tn[t3 + 1], tn[t3 + 2] })
            {
                int b = Find(q);
                if (a != b) parent[b] = a;
            }
        }
        var panes = new Dictionary<int, (Aabb box, Vector3 n, float area, List<int> tris)>();
        for (int t3 = 0; t3 < nv; t3 += 3)
        {
            Vector3 A = xf * P[t3], B = xf * P[t3 + 1], C = xf * P[t3 + 2];
            var N = (B - A).Cross(C - A);
            float area = N.Length() / 2;
            int r = Find(tn[t3]);
            if (!panes.TryGetValue(r, out var w)) w = (new Aabb(A, Vector3.Zero), Vector3.Zero, 0, new List<int>());
            var box = w.box.Expand(A).Expand(B).Expand(C);
            w.tris.Add(t3);
            panes[r] = (box, w.n + N / 2, w.area + area, w.tris);
        }
        // the panes' outward side: away from the building's middle
        var list = panes.Values.Select(w =>
        {
            var n = w.n;
            var c = w.box.GetCenter();
            if (new Vector2(n.X, n.Z).Dot(new Vector2(c.X - mid.X, c.Z - mid.Z)) < 0) n = -n;
            return (w.box, n, w.area, w.tris);
        }).ToList();
        // whole windows: panes in one face's plane whose outlines meet within 0.3 m
        var pn = list.Select(w =>
        {
            var n = new Vector3(w.n.X, 0, w.n.Z);
            if (n.LengthSquared() > 1e-6f) n = n.Normalized();
            var c = w.box.GetCenter();
            var sz = w.box.Size;
            float along = c.X * -n.Z + c.Z * n.X, half = MathF.Abs(sz.X * n.Z) / 2 + MathF.Abs(sz.Z * n.X) / 2;
            return (n, d: c.X * n.X + c.Z * n.Z, s0: along - half, s1: along + half, y0: w.box.Position.Y, y1: w.box.End.Y);
        }).ToList();
        var up = Enumerable.Range(0, list.Count).ToArray();
        int Top(int i) { while (up[i] != i) i = up[i] = up[up[i]]; return i; }
        for (int i = 0; i < list.Count; i++)
            for (int j = i + 1; j < list.Count; j++)
            {
                var a = pn[i];
                var b = pn[j];
                if (a.n.Dot(b.n) < 0.9f || MathF.Abs(a.d - b.d) > 0.4f) continue;
                if (a.s0 > b.s1 + 0.3f || b.s0 > a.s1 + 0.3f || a.y0 > b.y1 + 0.3f || b.y0 > a.y1 + 0.3f) continue;
                int ra = Top(i), rb = Top(j);
                if (ra != rb) up[rb] = ra;
            }
        var whole = new Dictionary<int, (Aabb box, Vector3 n, float area, List<int> tris)>();
        for (int i = 0; i < list.Count; i++)
        {
            int r = Top(i);
            var w = list[i];
            whole[r] = whole.TryGetValue(r, out var m) ? (m.box.Merge(w.box), m.n + w.n, m.area + w.area, m.tris.Concat(w.tris).ToList()) : (w.box, w.n, w.area, w.tris);
        }
        // the storeys from the lowest glass of the whole building (the shells' own glass too)
        float minY = whole.Values.Min(w => w.box.Position.Y);
        foreach (var o in rest)
            if (o.Mesh != null && o.Mesh.GetSurfaceCount() > 0 && Enumerable.Range(0, o.Mesh.GetSurfaceCount()).Any(s => o.Mesh.SurfaceGetMaterial(s) is Material sm && Glass.IsMatch(sm.ResourceName)))
                minY = Math.Min(minY, (o.GlobalTransform * o.GetAabb()).Position.Y);

        var bl = new Built { Building = building, R = rooms, Full = new float[nv * 3] };
        foreach (var w in whole.Values)
        {
            var c = w.box.GetCenter();
            var n = new Vector3(w.n.X, 0, w.n.Z);
            if (n.LengthSquared() > 1e-6f) n = n.Normalized();
            int storey = (int)Math.Floor((c.Y - minY + 0.5f) / 3.8f);
            string facade = $"{Math.Round(Math.Atan2(n.X, n.Z) / (Math.PI / 8))}:{Math.Round((c.X * n.X + c.Z * n.Z) / 1.5)}";
            int cell = (int)Math.Floor((c.X * -n.Z + c.Z * n.X) / 2.8);
            int room = (int)Math.Floor(Hash(cell, storey, facade.Length * 13 + Math.Round(c.X * n.X + c.Z * n.Z)) * 1e6);
            double h = Hash(Math.Round(c.X * 2), Math.Round(c.Y * 2), Math.Round(c.Z * 2));
            var win = new Win { K = 0.6f + 0.4f * (float)h, Room = room, Storey = storey, Cell = cell, Facade = facade, High = c.Y > rooms.Roof, Lvl = -1, Mid = c };
            win.Tris.AddRange(w.tris);
            bl.Windows.Add(win);
            float warm = 0.92f + 0.16f * (float)Hash(w.box.Position.X, w.box.Position.Z, 7);
            float hgt = Math.Max(0.5f, w.box.Size.Y);
            foreach (int t3 in w.tris)
                for (int j = 0; j < 3; j++)
                {
                    // the lamps stand low in the room: the foot of a window brighter than its head
                    float f = Math.Clamp(((xf * P[t3 + j]).Y - w.box.Position.Y) / hgt, 0, 1);
                    float kk = win.K * (1.15f - 0.55f * f);
                    bl.Full[(t3 + j) * 3] = kk * warm;
                    bl.Full[(t3 + j) * 3 + 1] = kk;
                    bl.Full[(t3 + j) * 3 + 2] = kk * (2 - warm);
                }
        }

        // the mesh again, all dark: one surface, the same material (its own copy: its strength is kept in proportion)
        var cols = new Color[nv];
        var outArr = new Godot.Collections.Array();
        outArr.Resize((int)Mesh.ArrayType.Max);
        outArr[(int)Mesh.ArrayType.Vertex] = P;
        outArr[(int)Mesh.ArrayType.TexUV] = UV;
        outArr[(int)Mesh.ArrayType.Color] = cols;
        var mesh = new ArrayMesh();
        mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, outArr);
        var own = (ShaderMaterial)mat.Duplicate();
        own.ResourceName = mat.ResourceName;
        mesh.SurfaceSetMaterial(0, own);
        mi.Mesh = mesh;
        bl.Mesh = mesh;
        // where the colours lie in the mesh's attribute buffer (8-bit colours stop at 1: then kept at half, the
        // material's strength doubled: a meeting's chandelier is brighter than full)
        var format = (RenderingServer.ArrayFormat)mesh.SurfaceGetFormat(0);
        bl.Stride = (int)RenderingServer.MeshSurfaceGetFormatAttributeStride(format, nv);
        bl.Offset = (int)RenderingServer.MeshSurfaceGetFormatOffset(format, nv, (int)Mesh.ArrayType.Color);
        int uvOff = (int)RenderingServer.MeshSurfaceGetFormatOffset(format, nv, (int)Mesh.ArrayType.TexUV);
        int colSize = uvOff > bl.Offset ? uvOff - bl.Offset : bl.Stride - bl.Offset;
        bl.Bytes8 = colSize == 4;
        bl.Gain = bl.Bytes8 ? 2 : 1;
        bl.Bytes = RenderingServer.MeshGetSurface(mesh.GetRid(), 0)["attribute_data"].AsByteArray();
        pendingGain.Add((own, bl.Gain));
        built.Add(bl);
    }

    private readonly List<(ShaderMaterial m, float gain)> pendingGain = new();

    /// <summary>The Steen's lanterns: the bake's hidden flames under steenlife (steenlife.ts lantern()).</summary>
    private void FindLanterns(Node3D town)
    {
        var life = town.GetNodeOrNull<Node3D>("steenlife");
        if (life == null) return;
        foreach (var c in life.GetChildren())
        {
            if (c is not MeshInstance3D flame || flame.Visible || !flame.HasMeta("extras")) continue;
            var box = flame.Mesh?.GetAabb().Size ?? Vector3.Zero;
            // (the Steenpoort's glass 0.37 wide, the iron lanterns' 0.24: their halos 0.6 and 0.7 across)
            float size = box.X > 0.3f ? 0.6f : 0.7f;
            Lights.FixedHalos.Add((flame.GlobalPosition, size));
            lanterns.Add((flame, Lights.FixedHalos.Count - 1, null));
        }
    }

    /// <summary>A room's lamp now (landmarkWindows.ts roomLevel): n hours from noon, `eve` the evening's day.</summary>
    private static float RoomLevel(Built b, Win w, double n, int eve)
    {
        var R = b.R;
        int r = w.Room;
        if (w.High) return Hash(r, Math.Floor(n * 60 / 40), eve) < 0.04 ? 0.35f : 0;
        if (w.Storey == 0 && Hash(r, 1, 5) < R.Porter) return 0.5f;
        if (b.Meet.Contains(r) && n < b.MeetEnd) return 1.2f;
        if (Hash(r, eve, 1) < R.Evening && n < 7 + 4.5 * Hash(r, eve, 2)) return w.K;
        if (Hash(r, 3, 3) < R.Watch)
        {
            double slot = Math.Floor(n * 60 / 25 + Hash(r, 4, 4) * 7);
            if (Hash(r, slot, eve) < 0.4) return 0.42f;
        }
        if (n > 17.5 + 1.2 * Hash(r, eve, 6) && n < 19.5 && Hash(r, eve, 4) < R.Dawn) return w.K * 0.9f;
        return 0;
    }

    /// <summary>Tonight's meetings: a room off the ground floor and its neighbours along the storey (not on Sunday).</summary>
    private static void ChooseMeetings(Built b, int eve)
    {
        b.MeetDay = eve;
        b.Meet.Clear();
        b.MeetEnd = Hash(eve, b.Windows.Count, 8) < 0.5 ? 12 : 13;
        if (eve % 7 == 0 || b.R.Meetings == 0) return;
        var upper = b.Windows.Where(w => w.Storey > 0 && !w.High).ToList();
        var pool = upper.Count > 0 ? upper : b.Windows;
        foreach (var s in pool.OrderBy(a => Hash(a.Room, eve, 9)).Take(b.R.Meetings))
            foreach (var w in b.Windows)
                if (!w.High && w.Facade == s.Facade && w.Storey == s.Storey && Math.Abs(w.Cell - s.Cell) <= 2) b.Meet.Add(w.Room);
    }

    private void Hook()
    {
        hooked = true;
        if (Lights.I == null) return;
        foreach (var (m, gain) in pendingGain) Lights.I.LandmarkGain[m] = gain;
        // (the spill sits at the window's middle, landmarkWindows.ts addSpill; the light mesh is 3 cm out of the glass)
        // (every window: the bake chose its street windows at its own hour, and one left out kept that hour's light)
        int spills = 0;
        foreach (var b in built)
            foreach (var w in b.Windows)
                if ((w.Spill = Lights.I.HallWindow(w.Mid, 0.6f)) != null) spills++;
        GD.Print($"landmark rooms: {spills} windows light the street");
        if (People.LanternPool.I is { } pool)
            for (int i = 0; i < lanterns.Count; i++)
            {
                var src = pool.Add();
                src.Pos = lanterns[i].flame.GlobalPosition;
                src.Power = 2.2f;
                lanterns[i] = (lanterns[i].flame, lanterns[i].halo, src);
            }
    }

    public override void _Process(double delta)
    {
        var day = Daylight.I;
        if (day == null) return;
        if (!hooked) Hook();
        float dt = (float)delta;
        t += dt;
        float hour = day.Hour;

        // the Steen's lanterns (steenlife.ts: night from 18:36 to 6:48)
        bool night = hour < 6.8f || hour >= 18.6f;
        float flick = 0.85f + 0.15f * MathF.Sin(t * 7.3f) * MathF.Sin(t * 2.9f);
        foreach (var (flame, halo, src) in lanterns)
        {
            if (flame.Visible != night) flame.Visible = night;
            if (src != null) src.On = night;
            Lights.I?.SetFixedHalo(halo, night ? flick : 0);
        }

        // the rooms by the clock: looked at twice a second, a mesh's colours written only when a lamp changes
        clockT -= dt;
        int min = (int)MathF.Floor(hour * 60);
        if (clockT > 0 && min == lastMin) return;
        clockT = 0.5f;
        lastMin = min;
        double n = (hour - 12 + 24) % 24;
        int dayNum = Scheldemist.Game.GameState.I.Day;
        int eve = hour < 12 ? dayNum - 1 : dayNum;
        foreach (var b in built)
        {
            if (b.MeetDay != eve) ChooseMeetings(b, eve);
            bool changed = false;
            foreach (var w in b.Windows)
            {
                float lvl = RoomLevel(b, w, n, eve);
                if (lvl == w.Lvl) continue;
                w.Lvl = lvl;
                changed = true;
                float k = lvl / Math.Max(0.01f, w.K) / b.Gain;
                w.Spill?.Invoke(lvl / Math.Max(0.01f, w.K));
                foreach (int t3 in w.Tris)
                    for (int q = t3; q < t3 + 3; q++)
                        WriteColour(b, q, b.Full[q * 3] * k, b.Full[q * 3 + 1] * k, b.Full[q * 3 + 2] * k);
            }
            if (changed) RenderingServer.MeshSurfaceUpdateAttributeRegion(b.Mesh.GetRid(), 0, 0, b.Bytes);
        }
    }

    private static void WriteColour(Built b, int v, float r, float g, float bl)
    {
        int o = v * b.Stride + b.Offset;
        if (b.Bytes8)
        {
            b.Bytes[o] = (byte)Math.Clamp((int)MathF.Round(r * 255), 0, 255);
            b.Bytes[o + 1] = (byte)Math.Clamp((int)MathF.Round(g * 255), 0, 255);
            b.Bytes[o + 2] = (byte)Math.Clamp((int)MathF.Round(bl * 255), 0, 255);
            b.Bytes[o + 3] = 255;
        }
        else
        {
            BitConverter.TryWriteBytes(b.Bytes.AsSpan(o), r);
            BitConverter.TryWriteBytes(b.Bytes.AsSpan(o + 4), g);
            BitConverter.TryWriteBytes(b.Bytes.AsSpan(o + 8), bl);
            BitConverter.TryWriteBytes(b.Bytes.AsSpan(o + 12), 1f);
        }
    }
}
