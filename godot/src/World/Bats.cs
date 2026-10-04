using System;
using System.Collections.Generic;
using System.Text.Json;
using Godot;
using Scheldemist.Render;

namespace Scheldemist.World;

/// <summary>
/// Bats at dusk and before dawn (the browser's world/alive/night.ts createBats): over the water and by the trees, in
/// loops and sudden turns, hunting moths; not in rain, a gale or a cold wind. The town's own haunts (one in a cell of
/// 20 m that has water or trees, by the cell's dice: the same as the browser's), the six nearest to the eye flying by
/// the clock. The bird shape of alive/common.ts birdShape with a bat's colours; the browser beats its wings in the
/// vertex shader, here each bat is its body and its two wings, each wing turned about the body by the beat (three
/// MultiMeshes, the psx matt material made at load: no new kind).
/// </summary>
[GamePart(44)]
public partial class Bats : Node
{
    public static Bats? I { get; private set; }
    private const int N = 6;
    private const float Span = 0.32f;

    private MultiMesh body = null!, left = null!, right = null!;
    private readonly List<Vector2> trees = new();
    private readonly Dictionary<(int, int), Vector3?> haunts = new();
    private readonly List<Vector3> near = new(16);
    private readonly Vector3[] centre = new Vector3[N], pos = new Vector3[N], prev = new Vector3[N];
    private readonly float[] seed = new float[N], yaw = new float[N];
    private int drawn;

    /// <summary>For a check: the bats out now, and where the first is.</summary>
    public (int drawn, Vector3 first) Info => (drawn, drawn > 0 ? pos[0] : Vector3.Zero);

    public override void _Ready()
    {
        I = this;
        ProcessPriority = 60;
        for (int i = 0; i < N; i++) centre[i] = new Vector3(1e5f, 0, 0);
        // the trees bats hunt round (city.json decor trees and trees_wild)
        string file = Paths.Shared("city.json");
        if (System.IO.File.Exists(file))
        {
            using var doc = JsonDocument.Parse(System.IO.File.ReadAllText(file));
            if (doc.RootElement.TryGetProperty("decor", out var decor))
                foreach (var key in new[] { "trees", "trees_wild" })
                    if (decor.TryGetProperty(key, out var list))
                        foreach (var t in list.EnumerateArray()) trees.Add(new Vector2(t[0].GetSingle(), t[1].GetSingle()));
        }
        var kind = new Psx.Kind(Unlit: false, Blend: false, Scissor: false, TwoSided: true, DepthWrite: true, Snap: true, Atlas: 0, VertexColor: true, Add: false, Fog: true);
        var mat = BakedWorld.PsxMaterial(new StandardMaterial3D { AlbedoColor = Colors.White, ResourceName = "alive_bats" }, kind, 0, 1);
        body = Part("alive_bats_body", Shape(0), mat);
        left = Part("alive_bats_wing_l", Shape(-1), mat);
        right = Part("alive_bats_wing_r", Shape(1), mat);
        Main.I.World.Unported.Remove("alive_bats");
    }

    private MultiMesh Part(string name, ArrayMesh mesh, Material mat)
    {
        var mm = new MultiMesh { TransformFormat = MultiMesh.TransformFormatEnum.Transform3D, Mesh = mesh, InstanceCount = N, VisibleInstanceCount = 0 };
        mm.CustomAabb = new Aabb(new Vector3(-3000, -100, -3000), new Vector3(6000, 600, 6000));
        Main.I.View.AddChild(new MultiMeshInstance3D { Name = name, Multimesh = mm, MaterialOverride = mat, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off, Layers = Mirrors.NoMirror });
        return mm;
    }

    /// <summary>
    /// common.ts birdShape(0.32, bat colours, long 0.6): the body (side 0) or one wing (-1 left, 1 right), flat faces.
    /// </summary>
    private static ArrayMesh Shape(int side)
    {
        float k = Span / 1.32f, lg = 0.6f;
        Color C(float r, float g, float b) => new Color(r, g, b).SrgbToLinear();
        Color bodyC = C(0.12f, 0.09f, 0.08f), wingC = C(0.1f, 0.08f, 0.07f), tipC = C(0.08f, 0.06f, 0.05f), beakC = C(0.1f, 0.08f, 0.07f);
        var st = new SurfaceTool();
        st.Begin(Mesh.PrimitiveType.Triangles);
        void Tri(Vector3 a, Vector3 b, Vector3 c, Color col)
        {
            var n = (b - a).Cross(c - a).Normalized();
            foreach (var p in new[] { a, b, c })
            {
                st.SetColor(col);
                st.SetNormal(n);
                st.AddVertex(p * k);
            }
        }
        if (side == 0)
        {
            Vector3 nose = new(0, 0.02f, 0.28f * lg), tail = new(0, 0, -0.24f * lg), top = new(0, 0.08f, 0.02f), bot = new(0, -0.07f, 0.03f), l = new(-0.085f, 0, 0.03f), r = new(0.085f, 0, 0.03f);
            Tri(nose, r, top, bodyC); Tri(nose, top, l, bodyC); Tri(nose, bot, r, bodyC); Tri(nose, l, bot, bodyC);
            Tri(tail, top, r, bodyC); Tri(tail, l, top, bodyC); Tri(tail, r, bot, bodyC); Tri(tail, bot, l, bodyC);
            Tri(new(0, 0.03f, 0.34f * lg), new(-0.02f, 0.015f, 0.27f * lg), new(0.02f, 0.015f, 0.27f * lg), beakC);
            Tri(new(-0.08f, 0.01f, -0.36f * lg), new(0.08f, 0.01f, -0.36f * lg), new(0, 0.01f, -0.18f * lg), wingC);
        }
        else
        {
            float s = side;
            Vector3 rf = new(s * 0.07f, 0.012f, 0.09f), rb = new(s * 0.07f, 0.012f, -0.08f), mf = new(s * 0.36f, 0.02f, 0.07f), mb = new(s * 0.36f, 0.02f, -0.11f), tp = new(s * 0.66f, 0, -0.1f);
            Tri(rf, mf, mb, wingC); Tri(rf, mb, rb, wingC); Tri(mf, tp, mb, tipC);
        }
        return st.Commit();
    }

    /// <summary>common.ts hours: 0 outside a..b (round midnight when a &gt; b), rising to 1 over `e` hours in from each end.</summary>
    private static float Hours(float h, float a, float b, float e)
    {
        bool inside = a <= b ? h >= a && h <= b : h >= a || h <= b;
        if (!inside) return 0;
        float da = (h - a + 24) % 24, db = (b - h + 24) % 24;
        return Math.Clamp(Math.Min(da, db) / e, 0, 1);
    }

    /// <summary>game/share.ts hash32: the same dice on every PC.</summary>
    private static uint Hash32(string key, params double[] n)
    {
        uint h = 0x811c9dc5;
        foreach (char c in key) h = unchecked((h ^ c) * 0x01000193u);
        foreach (double v in n)
        {
            h = unchecked((h ^ (uint)(int)v) * 0x01000193u);
            h = unchecked((h ^ (uint)(int)(v * 4096)) * 0x85ebca6bu);
        }
        h = unchecked((h ^ (h >> 15)) * 0x2c1b3c6du);
        h = unchecked((h ^ (h >> 12)) * 0x297a2d39u);
        return h ^ (h >> 15);
    }

    /// <summary>A cell's haunt (night.ts hauntOf): over water or by trees, 3.5 to 7.5 m up; or none.</summary>
    private Vector3? HauntOf(int ci, int cj)
    {
        if (haunts.TryGetValue((ci, cj), out var got)) return got;
        Vector3? found = null;
        uint s = Hash32("bathaunt", ci, cj);
        float R() => Air.Mulberry(ref s);
        if (R() < 0.5f)
            for (int k = 0; k < 20 && found == null; k++)
            {
                float x = (ci + R()) * 20, z = (cj + R()) * 20, hy = R();
                int fl = Ways.Flags(x, z);
                if (fl == Ways.Wall || (fl & Ways.Outside) != 0) continue;
                bool water = (fl & Ways.Water) != 0;
                bool tree = false;
                foreach (var t in trees) if (Math.Abs(t.X - x) < 12 && Math.Abs(t.Y - z) < 12) { tree = true; break; }
                if (!water && !tree) continue;
                var hit = Main.I.View.FindWorld3D().DirectSpaceState.IntersectRay(PhysicsRayQueryParameters3D.Create(new Vector3(x, 60, z), new Vector3(x, -20, z), Solid.Layer));
                float y = hit.Count > 0 ? hit["position"].AsVector3().Y : water ? Water.Level(x, z) : 0;
                found = new Vector3(x, y + 3.5f + hy * 4, z);
            }
        haunts[(ci, cj)] = found;
        return found;
    }

    public override void _Process(double delta)
    {
        var day = Daylight.I;
        if (day == null) return;
        var eye = Main.I.Cam.GlobalPosition;
        float hour = day.Hour;
        // dusk and before dawn; not in rain, a gale or a cold wind
        float when = Math.Max(Hours(hour, 17.4f, 19.9f, 0.4f), Hours(hour, 4.9f, 6.4f, 0.4f));
        bool ok = when > 0 && day.Rain < 0.15f && day.Weather != "storm" && Air.Base.Length() < 1.3f;
        int n = ok ? (int)MathF.Round(N * when * (day.Weather == "fog" ? 0.5f : 1)) : 0;
        near.Clear();
        if (n > 0)
        {
            for (int i = (int)MathF.Floor((eye.X - 30) / 20); i <= (int)MathF.Floor((eye.X + 30) / 20); i++)
                for (int j = (int)MathF.Floor((eye.Z - 30) / 20); j <= (int)MathF.Floor((eye.Z + 30) / 20); j++)
                    if (HauntOf(i, j) is { } h && new Vector2(h.X - eye.X, h.Z - eye.Z).Length() < 30 && Math.Abs(h.Y - eye.Y) < 12) near.Add(h);
            near.Sort((a, b) => new Vector2(a.X - eye.X, a.Z - eye.Z).Length().CompareTo(new Vector2(b.X - eye.X, b.Z - eye.Z).Length()));
        }
        // (the shared clock's seconds: a player's bats fly as another's in the same place)
        double tt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0 % 1e5;
        float t = (float)tt;
        int d = 0;
        for (int i = 0; i < N; i++)
        {
            if (i >= n || i >= near.Count)
            {
                centre[i] = new Vector3(1e5f, 0, 0);
                continue;
            }
            var h = near[i];
            if (centre[i] != h)
            {
                centre[i] = h;
                seed[i] = (h.X * 0.37f + h.Z * 0.71f) % 100;
                pos[i] = new Vector3(float.NaN, 0, 0);
            }
            prev[i] = pos[i];
            float s = seed[i];
            // a beat of loops and sudden turns (a bat hunting moths): several sines, one fast
            pos[i] = new Vector3(
                h.X + MathF.Sin(t * 0.9f + s) * 5 + MathF.Sin(t * 2.7f + s * 3) * 1.6f + MathF.Sin(t * 7.3f + s * 5) * 0.35f,
                h.Y + MathF.Sin(t * 1.3f + s * 2) * 1.2f + MathF.Sin(t * 5.1f + s) * 0.3f,
                h.Z + MathF.Cos(t * 0.7f + s * 1.7f) * 5 + MathF.Cos(t * 3.1f + s * 2.3f) * 1.4f + MathF.Cos(t * 6.7f + s * 4) * 0.35f);
            if (float.IsNaN(prev[i].X)) prev[i] = pos[i];
            var vel = pos[i] - prev[i];
            if (vel.LengthSquared() > 1e-8f) yaw[i] = MathF.Atan2(vel.X, vel.Z);
            if (new Vector2(pos[i].X - eye.X, pos[i].Z - eye.Z).Length() > day.FogFar * 1.1f) continue;
            float pitch = -MathF.Atan2(vel.Y, new Vector2(vel.X, vel.Z).Length() + 1e-5f) * 0.5f;
            float roll = MathF.Sin(t * 4 + s) * 0.5f, flap = MathF.Sin(t * 48 + s * 9) * 1.1f;
            var basis = Basis.FromEuler(new Vector3(pitch, yaw[i], roll), EulerOrder.Yxz);
            body.SetInstanceTransform(d, new Transform3D(basis, pos[i]));
            // the wings beat about the body (the tip a little more than the root: here the whole wing, by 1.2)
            right.SetInstanceTransform(d, new Transform3D(basis * new Basis(Vector3.Back, flap * 1.2f), pos[i]));
            left.SetInstanceTransform(d, new Transform3D(basis * new Basis(Vector3.Back, -flap * 1.2f), pos[i]));
            d++;
        }
        if (d != drawn)
        {
            body.VisibleInstanceCount = left.VisibleInstanceCount = right.VisibleInstanceCount = d;
            drawn = d;
        }
    }
}
