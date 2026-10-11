using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.Render;

namespace Scheldemist.World;

/// <summary>
/// The water's sheets (the browser's world/rijnkaai.ts): the river's sheet goes where the eye goes, in whole picture
/// tiles of 4 m so the ripples stay put, and lies under the land: it is the river, the canals, the vlieten and the
/// moat, all at the tide's level (Tide.River). The Petit Bassin, its mouth and the lock chamber have sheets of their
/// own at their own levels (Tide.Dock, the chamber's two ends: it slopes while both pairs of gates stand open); the
/// river's sheet is not drawn under them. The waves, the foam and the dark mirror are the psx water material
/// (Render/Psx.cs, Kind.Water). The tide's mud and marks on the walls stand still in the bake: only the water moves.
/// </summary>
[GamePart(35)]
public partial class Waters : Node
{
    private const float Size = 1200, Tile = 4;
    private MeshInstance3D? river;
    private readonly List<MeshInstance3D> dock = new();
    private MeshInstance3D? chamber;
    // D1: the canal's and the vliet's low water (the browser's world/tidemud.ts): a calm sheet over the beds at the
    // river's level while it stands below the walls' toe (the river's own sheet, with its swell, is kept out of the
    // canals then: Psx.cs in_canal), and the pools' sheets at their own level, shown only when the river is lower
    private MeshInstance3D? calm, pools;
    private ShaderMaterial? riverMat;
    private float poolY;
    private bool calmOn;
    private const float CalmTop = -4.75f, TrickleY = -5.05f - 0.22f;
    private static float level = float.NaN;
    /// <summary>Where the river's sheet lies now (it follows the tide at 0.6 m a second at most).</summary>
    public static float Level => float.IsNaN(level) ? Tide.River : level;

    /// <summary>The river sheet's material (the mirror's part sets its picture on it and on the basins').</summary>
    public static readonly List<ShaderMaterial> Materials = new();

    public override void _Ready()
    {
        ProcessPriority = 45;
        rippleTest = Main.I.Flag("ripple-test");
        foreach (var n in BakedWorld.All(Main.I.World))
        {
            if (n is not MeshInstance3D mi || mi.Mesh == null || mi.Mesh.GetSurfaceCount() == 0) continue;
            if (mi.Mesh.SurfaceGetMaterial(0) is not ShaderMaterial m || !m.HasMeta("psx_water")) continue;
            if (!Materials.Contains(m)) Materials.Add(m);
            string nm = mi.Name.ToString();
            if (nm.StartsWith("tide_calm")) { calm = mi; continue; }
            if (nm.StartsWith("tide_pools")) { pools = mi; poolY = mi.GlobalPosition.Y; continue; }
            if (m.GetMeta("psx_water").AsInt32() != 1) continue;
            var box = mi.GetAabb();
            if (Math.Max(box.Size.X, box.Size.Y) > 500)
            {
                // the bake's river sheet is cut to the place it was baked at: ours is whole and goes with the eye
                mi.Visible = false;
                var mat = (ShaderMaterial)m.Duplicate();
                mat.SetShaderParameter("river", 1f);
                mat.SetMeta("psx_water", 1);
                Materials.Add(mat);
                riverMat = mat;
                var plane = new PlaneMesh { Size = new Vector2(Size, Size), SubdivideWidth = 239, SubdivideDepth = 239, Material = mat };
                // (the waves lift it: never culled by its flat box)
                plane.CustomAabb = new Aabb(new Vector3(-Size / 2, -3, -Size / 2), new Vector3(Size, 6, Size));
                river = new MeshInstance3D { Name = "river_sheet", Mesh = plane, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off };
                Main.I.View.AddChild(river);
            }
            else if (mi.GlobalPosition.Z < 40) chamber = mi;
            else dock.Add(mi);
        }
        if (river == null) GD.Print("waters: no river sheet in the bake");
        // (dev: -- --switch-test x,y,z puts the shader switches' tiny test there: Psx's NameCell and TideWet)
        if (Main.I.Arg("switch-test") is { Length: > 0 } at && at.Split(',') is { Length: 3 } p)
            SwitchTest(new Vector3(float.Parse(p[0], System.Globalization.CultureInfo.InvariantCulture), float.Parse(p[1], System.Globalization.CultureInfo.InvariantCulture), float.Parse(p[2], System.Globalization.CultureInfo.InvariantCulture)));
    }

    // ---------------------------------------------------------------- the ripple sources (psx.ts `ripples`, the same)

    private sealed class RingSrc { public float X, Z, T0, C, Life, S; }
    private sealed class WakeSrc { public float X, Z, Dx, Dz, V, Beam, S, Seen; }
    private static readonly List<RingSrc> rings = new();
    private static readonly Dictionary<object, WakeSrc> wakes = new();
    private static readonly Dictionary<object, float> emitAt = new();
    private static readonly List<(float d, Vector4 a, Vector4 b)> rippleList = new();
    private static readonly List<(Vector4 a, Vector4 b)> rippleOut = new();
    private static float camX, camZ;
    private static uint rseed = 77;
    private static float Rnd() { rseed = unchecked(rseed * 1664525u + 1013904223u); return rseed / 4294967296f; }
    private static float Now => (float)Movers.MoverClock.T;

    /// <summary>A ring born now at (x, z): an oar dipping, a stroke, a splash; `speed` how fast it spreads, `life` s.</summary>
    public static void Ring(float x, float z, float strength = 1, float speed = 0.45f, float life = 2.6f)
    {
        if (MathF.Abs(x - camX) > 70 || MathF.Abs(z - camZ) > 70) return;
        if (rings.Count >= 64) rings.RemoveAt(0);
        rings.Add(new RingSrc { X = x, Z = z, T0 = Now, C = speed, Life = life, S = strength });
    }

    /// <summary>A boat under way this frame (`key` the boat): its bow at (x, z), heading (dx, dz), speed m/s, beam m.</summary>
    public static void Wake(object key, float x, float z, float dx, float dz, float speed, float beam, float strength = 1)
    {
        float l = MathF.Sqrt(dx * dx + dz * dz);
        if (l < 1e-6f) l = 1;
        if (!wakes.TryGetValue(key, out var w)) wakes[key] = w = new WakeSrc();
        w.X = x; w.Z = z; w.Dx = dx / l; w.Dz = dz / l; w.V = speed; w.Beam = beam; w.S = speed > 0.15f ? strength : 0; w.Seen = Now;
    }

    /// <summary>A swimmer this frame: a ring at every stroke while moving, a small wake.</summary>
    public static void Swim(object key, float x, float z, float dx, float dz, float speed)
    {
        Wake(key, x, z, dx, dz, speed, 0.5f, 0.6f);
        if (emitAt.TryGetValue(key, out float next) && Now < next) return;
        emitAt[key] = Now + (speed > 0.2f ? 0.85f : 2.2f);
        Ring(x, z, speed > 0.2f ? 0.9f : 0.45f, 0.4f, 2.4f);
    }

    /// <summary>A moored hull bobbing this frame (centre, heading, length, beam): now and then a faint ring at its side.</summary>
    public static void Moored(object key, float x, float z, float dx, float dz, float length, float beam)
    {
        if (MathF.Abs(x - camX) > 50 || MathF.Abs(z - camZ) > 50) return;
        if (!emitAt.TryGetValue(key, out float next)) { emitAt[key] = Now + Rnd() * 3; return; }
        if (Now < next) return;
        emitAt[key] = Now + 1.8f + Rnd() * 2.5f;
        float l = MathF.Sqrt(dx * dx + dz * dz);
        if (l < 1e-6f) l = 1;
        float along = (Rnd() - 0.5f) * length * 0.8f, side = (Rnd() < 0.5f ? -1 : 1) * beam * 0.5f;
        Ring(x + dx / l * along - dz / l * side, z + dz / l * along + dx / l * side, 0.35f, 0.3f, 3.2f);
    }

    /// <summary>Every frame: the river's ships under way leave wakes; the nearest sources go to the shader.</summary>
    private static void SendRipples(float cx, float cz)
    {
        camX = cx;
        camZ = cz;
        if (Movers.River.I is { } river)
            foreach (var m in river.Movers)
                if (m.V > 0.01) Wake(m, (float)m.X, (float)m.Z, (float)m.Hx, (float)m.Hz, (float)m.V, (float)(m.Beam > 0 ? m.Beam : 4));
        float t = Now;
        rings.RemoveAll(r => t - r.T0 > r.Life || t < r.T0);
        foreach (var k in wakes.Where(p => t - p.Value.Seen > 0.5f || t < p.Value.Seen).Select(p => p.Key).ToList()) wakes.Remove(k);
        foreach (var k in emitAt.Where(p => p.Value > t + 10).Select(p => p.Key).ToList()) emitAt.Remove(k);
        rippleList.Clear();
        foreach (var r in rings)
        {
            float d = MathF.Sqrt((r.X - cx) * (r.X - cx) + (r.Z - cz) * (r.Z - cz)) - r.C * (t - r.T0);
            if (d < 60) rippleList.Add((d, new Vector4(r.X, r.Z, r.T0, 0), new Vector4(0, r.C, r.Life, r.S)));
        }
        foreach (var w in wakes.Values)
        {
            if (w.S <= 0) continue;
            float d = MathF.Sqrt((w.X - cx) * (w.X - cx) + (w.Z - cz) * (w.Z - cz)) - 15;
            if (d < 120) rippleList.Add((d - 40, new Vector4(w.X, w.Z, w.Dx, w.Dz), new Vector4(1, w.V, w.Beam, w.S)));
        }
        rippleList.Sort((p, q) => p.d.CompareTo(q.d));
        rippleOut.Clear();
        foreach (var e in rippleList) rippleOut.Add((e.a, e.b));
        Psx.SetRipples(rippleOut);
    }

    // (dev: -- --ripple-test: the browser's look test, .scratch's before-wake.js: a boat at 3 m/s along z -22, a swimmer, a ring a second)
    private bool rippleTest;
    private float lastRing;
    private void RippleTest()
    {
        float t = Now;
        Wake("testboat", -34 + (t * 3) % 30, -45, 1, 0, 3, 4);
        Swim("testswim", -17 + MathF.Sin(t * 0.2f) * 1.5f, -30, MathF.Cos(t * 0.2f), 0, 0.7f);
        if (t - lastRing > 0.9f) { lastRing = t; Ring(-24, -33, 1); }
    }

    /// <summary>Dev: how many ripple sources there are.</summary>
    public static string RippleInfo() => $"rings {rings.Count}, wakes {wakes.Count}, sent {Math.Min(rippleList.Count, Psx.MaxRipples)}";

    /// <summary>
    /// The shader switches' test (D3; the browser's psx.ts psxSwitchTest, the same things): four name plates on one
    /// MultiMesh showing the cells 3, 2, 1, 0 of a 2 x 2 atlas (yellow, blue, green, red, each with its white mark top
    /// left), and a stone pillar from the bed up past the high water with the tide's wet band (tide_wet 0.6).
    /// </summary>
    private void SwitchTest(Vector3 at)
    {
        var im = Image.CreateEmpty(64, 64, false, Image.Format.Rgba8);
        var cols = new[] { new Color(0.8f, 0.1f, 0.1f), new Color(0.1f, 0.7f, 0.1f), new Color(0.1f, 0.2f, 0.9f), new Color(0.9f, 0.8f, 0.1f) };
        for (int cell = 0; cell < 4; cell++)
        {
            int x0 = cell % 2 * 32, y0 = cell / 2 * 32;
            im.FillRect(new Rect2I(x0, y0, 32, 32), cols[cell]);
            im.FillRect(new Rect2I(x0 + 3, y0 + 3, 9, 9), Colors.White);
        }
        im.GenerateMipmaps();
        var kind = new Psx.Kind(false, false, false, true, true, true, 0, false, false, true, NameCell: 2);
        var plate = new ShaderMaterial { Shader = Psx.ShaderOf(kind) };
        plate.SetShaderParameter("tex", ImageTexture.CreateFromImage(im));
        var mm = new MultiMesh { TransformFormat = MultiMesh.TransformFormatEnum.Transform3D, UseCustomData = true, InstanceCount = 4, Mesh = new QuadMesh { Size = new Vector2(1.2f, 1.2f), Material = plate } };
        for (int i = 0; i < 4; i++)
        {
            mm.SetInstanceTransform(i, new Transform3D(Basis.Identity, new Vector3(-2.1f + 1.4f * i, 0, 0)));
            mm.SetInstanceCustomData(i, new Color((3 - i) % 2, (3 - i) / 2, 0, 0));
        }
        Main.I.View.AddChild(new MultiMeshInstance3D { Name = "switch_test_names", Multimesh = mm, Position = at });
        var stone = new ShaderMaterial { Shader = Psx.ShaderOf(new Psx.Kind(false, false, false, false, true, true, 0, false, false, true, TideWet: true)) };
        stone.SetShaderParameter("albedo", new Color(0.55f, 0.52f, 0.48f));
        stone.SetShaderParameter("tide_wet", 0.6f);
        Main.I.View.AddChild(new MeshInstance3D { Name = "switch_test_tide", Mesh = new BoxMesh { Size = new Vector3(1, 6, 1), Material = stone }, Position = new Vector3(at.X + 4, -3, at.Z) });
        GD.Print($"switch test at {at}: tide wet {Psx.TideWetAt(Movers.MoverClock.Hours)}");
    }

    public override void _Process(double delta)
    {
        var cam = Main.I.View.GetCamera3D();
        if (cam == null) return;
        // the water goes to the tide's level at 0.6 m a second at most (a jump of the clock: in a few seconds)
        float d = Tide.River - level;
        level = float.IsNaN(level) ? Tide.River : level + Mathf.Clamp(d, -0.6f * (float)delta, 0.6f * (float)delta);
        if (river != null)
        {
            var p = cam.GlobalPosition;
            river.GlobalPosition = new Vector3(MathF.Round(p.X / Tile) * Tile, level, MathF.Round(p.Z / Tile) * Tile);
        }
        // the tide's wet band on the walls and the mud (Psx.TideWetGlsl): the last high water by the game clock
        Psx.TideWetNow(Movers.MoverClock.Hours);
        // the boats' wakes, the oars', swimmers' and moored hulls' rings (D3)
        if (rippleTest) RippleTest();
        SendRipples(cam.GlobalPosition.X, cam.GlobalPosition.Z);
        // the beds' low water (D1): the calm sheet at the river's level, the pools when the river is under them
        bool on = Level < CalmTop;
        if (on != calmOn)
        {
            calmOn = on;
            riverMat?.SetShaderParameter("river", on ? 2f : 1f);
        }
        if (calm != null)
        {
            calm.Visible = on;
            calm.GlobalPosition = new Vector3(calm.GlobalPosition.X, MathF.Max(Level, TrickleY), calm.GlobalPosition.Z);
        }
        if (pools != null) pools.Visible = on && Level < poolY - 0.004f;
        foreach (var s in dock) s.GlobalPosition = new Vector3(s.GlobalPosition.X, Tide.Dock, s.GlobalPosition.Z);
        if (chamber != null)
        {
            // level, or sloping from the river gates (z 7) to the dock gates (z 42)
            chamber.GlobalPosition = new Vector3(chamber.GlobalPosition.X, (Tide.ChamberA + Tide.ChamberB) / 2, chamber.GlobalPosition.Z);
            chamber.Rotation = new Vector3(-MathF.PI / 2 - MathF.Atan((Tide.ChamberB - Tide.ChamberA) / 35), 0, 0);
        }
    }
}
