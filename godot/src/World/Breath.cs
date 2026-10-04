using System;
using Godot;

namespace Scheldemist.World;

/// <summary>
/// Breath in the cold (the browser's world/alive/air.ts createBreath): on a cold night and early morning (more under a
/// clear sky and in the fog) a little mist out of Jef's mouth every few seconds, low in the view, drifting off with
/// the wind; faster when he runs. The breath's mist (AirPoints.AsMist): 90 puffs, one draw.
/// Not here yet: the horses' breath from their noses (the browser's horse bodies; the movers part has the horses).
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

    /// <summary>For a check: the puffs in the air now, how cold it is.</summary>
    public (int puffs, float cold) Info { get; private set; }

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

    public override void _Process(double delta)
    {
        var day = Daylight.I;
        if (day == null) return;
        float dt = (float)Math.Min(delta, 0.1);
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
