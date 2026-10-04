using System;
using Godot;

namespace Scheldemist.World;

/// <summary>
/// Breath in the cold (the browser's world/alive/air.ts createBreath): on a cold night and early morning (more under a
/// clear sky and in the fog) a little mist out of Jef's mouth every few seconds, low in the view, drifting off with
/// the wind; faster when he runs. And the horses' (the drays', the goods train's, the omnibus's: every copy of a horse
/// body the movers write), blown from their noses every three or four seconds within 25 m; now and then one blows out
/// loud (within 12 m). The breath's mist (AirPoints.AsMist): 90 puffs, one draw.
/// </summary>
[GamePart(43)]
public partial class Breath : Node
{
    public static Breath? I { get; private set; }
    private const int Puffs = 90;
    private AirPoints draw = null!;
    private readonly Vector3[] p = new Vector3[Puffs], v = new Vector3[Puffs];
    private readonly float[] age = new float[Puffs], life = new float[Puffs], size = new float[Puffs];
    private float next = 1, speed;
    private Vector3 lastEye;
    private uint dice = 250;
    // (dev: a --snap view named breath... waits for no breath: one a second)
    private readonly bool quick = Main.I.Arg("views").Contains("breath");
    private float R() => Air.Mulberry(ref dice);
    // the horses: their bodies' copies (found again every 3 s), each one's next breath
    private readonly System.Collections.Generic.List<MultiMeshInstance3D> horses = new();
    private readonly System.Collections.Generic.Dictionary<(ulong, int), float> horseNext = new();
    private float scanWait, t;
    /// <summary>horseGait.ts HORSE_NOSE: the nose in the body's frame.</summary>
    private static readonly Vector3 Nose = new(0, 1.68f, 1.56f);

    /// <summary>For a check: the puffs in the air now, how cold it is.</summary>
    public (int puffs, float cold) Info { get; private set; }
    /// <summary>For a check: horses near enough to show their breath, and where the last one breathed.</summary>
    public (int horses, Vector3 last) HorseInfo { get; private set; }

    public override void _Ready()
    {
        I = this;
        ProcessPriority = 60;
        draw = new AirPoints("alive_breath_live", Puffs, priority: 4).AsMist(1);
        Array.Fill(age, -1);
        Main.I.World.Unported.Remove("alive_breath");
    }

    private void Emit(Vector3 at, Vector3 dir, int n, float spread, float span, float big = 1)
    {
        for (int i = 0; i < Puffs && n > 0; i++)
        {
            if (age[i] >= 0) continue;
            p[i] = at;
            v[i] = dir * (0.35f + R() * 0.25f) + new Vector3((R() - 0.5f) * spread, 0.05f + R() * 0.06f, (R() - 0.5f) * spread);
            age[i] = 0;
            life[i] = span * (0.8f + R() * 0.4f);
            size[i] = big;
            n--;
        }
    }

    /// <summary>A horse body's copies: tr_horse_body (the drays, the omnibus), horse_body (horses.ts); the bake's copy
    /// names lose the underscores (INST12_trhorsebody_mm).</summary>
    private static bool IsHorse(string name) => name.Contains("horse_body") || name.Contains("horsebody");

    /// <summary>For a test picture: the nearest horse body drawn now (its place and facing), or null.</summary>
    public Transform3D? NearestHorse(Vector3 to)
    {
        Transform3D? best = null;
        foreach (var n in BakedWorld.All(Main.I.View))
            if (n is MultiMeshInstance3D mm && mm.Multimesh != null && IsHorse(mm.Name.ToString()) && mm.IsVisibleInTree())
                for (int i = 0; i < mm.Multimesh.InstanceCount; i++)
                {
                    var x = mm.GlobalTransform * mm.Multimesh.GetInstanceTransform(i);
                    if (x.Basis.X.LengthSquared() < 1e-4f || x.Origin.LengthSquared() < 1e-6f) continue;
                    if (best == null || x.Origin.DistanceSquaredTo(to) < best.Value.Origin.DistanceSquaredTo(to)) best = x;
                }
        return best;
    }

    private void Horses(Vector3 eye, float dt, float cold)
    {
        scanWait -= dt;
        if (scanWait <= 0)
        {
            scanWait = 3;
            horses.Clear();
            foreach (var n in BakedWorld.All(Main.I.View))
                if (n is MultiMeshInstance3D mm && mm.Multimesh != null && IsHorse(mm.Name.ToString())) horses.Add(mm);
        }
        int seen = 0;
        var last = HorseInfo.last;
        foreach (var mm in horses)
        {
            if (!GodotObject.IsInstanceValid(mm) || !mm.IsVisibleInTree()) continue;
            var m = mm.Multimesh;
            var gx = mm.GlobalTransform;
            for (int i = 0; i < m.InstanceCount; i++)
            {
                var x = gx * m.GetInstanceTransform(i);
                // (hidden, or not placed yet: at the origin)
                if (x.Basis.X.LengthSquared() < 1e-4f || x.Origin.LengthSquared() < 1e-6f) continue;
                if (new Vector2(x.Origin.X - eye.X, x.Origin.Z - eye.Z).Length() > 25) continue;
                seen++;
                var key = (mm.GetInstanceId(), i);
                if (!horseNext.TryGetValue(key, out float t0)) horseNext[key] = t0 = t + R() * 3;
                if (t < t0) continue;
                horseNext[key] = t + 2.6f + R() * 1.6f;
                var nose = x * Nose;
                var fwd = (x.Basis * new Vector3(0, -0.3f, 1)).Normalized();
                Emit(nose, fwd, 7, 0.14f, 1.8f * cold, 2.2f);
                last = nose;
                if (R() < 0.12f && new Vector2(nose.X - eye.X, nose.Z - eye.Z).Length() < 12)
                    Audio.Soundscape.I?.Placed(nose, new Audio.PlacedOpts(1.5, 8, 12), Audio.AliveSounds.Snort(), "horse breath");
            }
        }
        HorseInfo = (seen, last);
    }

    public override void _Process(double delta)
    {
        var day = Daylight.I;
        if (day == null) return;
        float dt = (float)Math.Min(delta, 0.1);
        t += dt;
        var cam = Main.I.Cam;
        var eye = cam.GlobalPosition;
        float moved = eye.DistanceTo(lastEye);
        if (dt > 0 && moved < 5) speed += (moved / dt - speed) * Math.Min(1, dt * 3);
        lastEye = eye;
        var fog = day.FogColor;
        float k = 0.5f * (1 - day.Night);
        draw.Param("col", new Vector3(fog.R + (0.8f - fog.R) * k, fog.G + (0.82f - fog.G) * k, fog.B + (0.85f - fog.B) * k));
        float cold = Air.Cold(day.Hour, day.Weather);
        if (cold > 0.3f)
        {
            next -= dt;
            if (next <= 0)
            {
                next = quick ? 1 : (speed > 2.5f ? 1.6f : 3.4f) * (0.85f + R() * 0.3f);
                // out through the mouth, a little below the eye and ahead: low in the view, drifting out of it
                var fwd = -cam.GlobalBasis.Z;
                fwd.Y = Math.Min(fwd.Y, 0.1f);
                fwd = fwd.Normalized();
                var at = eye + fwd * 0.42f;
                at.Y -= 0.26f;
                Emit(at, fwd, 3, 0.06f, 1.1f * cold);
            }
            Horses(eye, dt, cold);
        }
        int live = 0;
        for (int i = 0; i < Puffs; i++)
        {
            if (age[i] >= 0)
            {
                age[i] += dt / life[i];
                var w = Air.WindAt(p[i].X, p[i].Z);
                v[i] *= Math.Max(0, 1 - dt * 2.2f);
                p[i] += new Vector3((v[i].X + w.X * 0.25f) * dt, (v[i].Y + 0.08f) * dt, (v[i].Z + w.Y * 0.25f) * dt);
                if (age[i] >= 1) age[i] = -1;
                else live++;
            }
            draw.Mist(i, p[i], age[i], size[i]);
        }
        draw.Commit();
        Info = (live, cold);
    }
}
