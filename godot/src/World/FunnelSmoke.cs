using System;
using System.Collections.Generic;
using System.Text.Json;
using Godot;
using Scheldemist.Models;
using Scheldemist.Movers;
using Scheldemist.Render;

namespace Scheldemist.World;

/// <summary>
/// The boats' smoke (the browser's world/boats.ts funnel smoke): off every steamer's funnel a long, full plume that
/// rises fast and then lies over and drifts with the wind; off a barge's stove a thin wisp. The places are the boat
/// model's own extras ("smoke": the funnel tops, "stove": the stove pipes), on the live hulls of Boats, so the plume
/// rides with the boat. Fourteen puffs an emitter, each 12 s; written on the CPU (boats.ts updateSmoke), one draw.
/// </summary>
[GamePart(51)]
public partial class FunnelSmoke : Node
{
    private const int Puffs = 14;
    private const float Life = 12;
    private sealed record Emitter(Func<Transform3D> World, Func<bool> Visible, Vector3 Local, float Strength, float Phase);
    private readonly List<Emitter> emitters = new();
    private readonly Dictionary<string, (Vector3[] funnels, Vector3[] stoves)> points = new();
    private readonly HashSet<Boats.Float> registered = new();
    private int floatCount = -1;
    private AirPoints? draw;
    private uint seed = 7;
    // (boats.ts: the funnel smoke's own wind)
    private static readonly Vector3 Wind = new(0.75f, 0, 0.3f);

    /// <summary>For a check: the emitters, the funnels among them.</summary>
    public (int emitters, int funnels) Info
    {
        get { int f = 0; foreach (var e in emitters) if (e.Strength >= 0.5f) f++; return (emitters.Count, f); }
    }

    private (Vector3[] funnels, Vector3[] stoves) Points(string kind)
    {
        if (points.TryGetValue(kind, out var p)) return p;
        var root = ModelLibrary.Get("boats")?.Roots.GetValueOrDefault(kind);
        var funnels = new List<Vector3>();
        var stoves = new List<Vector3>();
        if (root != null && root.HasMeta("extras"))
        {
            var ex = root.GetMeta("extras").AsGodotDictionary();
            // (the model's frame: x, z up, -y; as the lamps)
            if (ex.TryGetValue("smoke", out var raw))
            {
                using var json = JsonDocument.Parse(raw.AsString());
                var a = json.RootElement;
                for (int i = 0; i + 2 < a.GetArrayLength(); i += 3) funnels.Add(new Vector3(a[i].GetSingle(), a[i + 2].GetSingle(), -a[i + 1].GetSingle()));
            }
            if (ex.TryGetValue("stove", out var rs))
            {
                using var json = JsonDocument.Parse(rs.AsString());
                foreach (var q in json.RootElement.EnumerateArray()) stoves.Add(new Vector3(q[0].GetSingle(), q[2].GetSingle(), -q[1].GetSingle()));
            }
        }
        points[kind] = p = (funnels.ToArray(), stoves.ToArray());
        return p;
    }

    private void Add(string kind, Func<Transform3D> world, Func<bool> visible)
    {
        var (funnels, stoves) = Points(kind);
        // (a boat not shown yet, or put away, smokes nowhere: the moored rows are always shown)
        foreach (var f in funnels) emitters.Add(new Emitter(world, visible, f, 0.55f, Air.Mulberry(ref seed)));
        foreach (var s in stoves) emitters.Add(new Emitter(world, visible, s, 0.2f, Air.Mulberry(ref seed)));
    }

    public override void _Ready()
    {
        ProcessPriority = 60;
        if (Boats.I == null) { SetProcess(false); return; }
        foreach (var hull in Boats.I.MooredFrames()) Add(hull.Kind, hull.World, () => true);
        Register();
        // (room for the boats that come later: a fixed count, nothing made in a frame)
        draw = new AirPoints("funnel_smoke_live", Math.Max(256, emitters.Count * Puffs + 40 * Puffs));
        draw.Param("shape", 2.0f);
        draw.Param("col", V(Psx.Hex(0x4a4744)));
        draw.Param("glow_k", 1.0f);
        draw.Param("fog_reach", 1.0f);
        draw.Param("fog_fade", 0.0f);
        Main.I.World.Unported.Remove("funnel_smoke");
        var first = emitters.Find(e => e.Strength >= 0.5f);
        if (Main.I.Flag("funnel-debug"))
            foreach (var e in emitters) if (e.Strength >= 0.5f) GD.Print($"funnel {(e.World() * e.Local).Round()} hull {e.World().Origin.Round()} local {e.Local}");
        GD.Print($"funnel smoke: {Info.funnels} funnels and {Info.emitters - Info.funnels} stoves on the boats" + (first != null ? $", a funnel at {(first.World() * first.Local).Round()}" : ""));
    }

    private static Vector3 V(Color c) => new(c.R, c.G, c.B);

    private void Register()
    {
        if (floatCount == Boats.I!.Floats.Count) return;
        floatCount = Boats.I.Floats.Count;
        foreach (var f in Boats.I.Floats)
            if (registered.Add(f)) Add(f.Kind, () => f.Inner.GlobalTransform, () => IsInstanceValid(f.Outer) && f.Outer.IsVisibleInTree());
    }

    public override void _Process(double delta)
    {
        if (draw == null) return;
        Register();
        float t = Time.GetTicksMsec() / 1000f;
        var eye = Main.I.Cam.GlobalPosition;
        float far = (Daylight.I?.FogFar ?? 200) + 40;
        int n = Math.Min(emitters.Count, draw.Count / Puffs);
        for (int e = 0; e < n; e++)
        {
            var em = emitters[e];
            Vector3 at = Vector3.Zero;
            bool show = em.Visible();
            if (show)
            {
                var xf = em.World();
                show = new Vector2(xf.Origin.X - eye.X, xf.Origin.Z - eye.Z).LengthSquared() < far * far;
                at = xf * em.Local;
            }
            for (int k = 0; k < Puffs; k++)
            {
                int i = e * Puffs + k;
                if (!show) { draw.Hide(i); continue; }
                float f = ((t / Life + (float)k / Puffs + em.Phase) % 1 + 1) % 1;
                float age = f * Life;
                float wob = MathF.Sin(age * 1.7f + k * 2.1f + em.Phase * 9) * 0.25f * (1 + age * 0.15f);
                // (a funnel's plume rises fast, then lies over and drifts; a stove's is thinner)
                bool funnel = em.Strength >= 0.5f;
                float rise = funnel ? 1.6f * (1 - MathF.Exp(-age * 0.45f)) / 0.45f : age * 0.9f - age * age * 0.03f;
                float drift = funnel ? 1.25f : 1;
                var p = new Vector3(at.X + Wind.X * age * drift + wob, at.Y + rise, at.Z + Wind.Z * age * drift - wob);
                float size = funnel ? 1.3f + age * 1.05f : 1.0f + age * 0.75f;
                float alpha = Math.Min(1, em.Strength * (funnel ? 1.5f : 1)) * MathF.Pow(1 - f, funnel ? 1.1f : 1.4f) * Math.Min(1, age * 2.5f);
                draw.Set(i, p, size, alpha, (e * 13 + k) * 0.37f);
            }
        }
        draw.Commit();
    }
}
