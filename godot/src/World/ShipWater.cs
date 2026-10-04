using System;
using Godot;

namespace Scheldemist.World;

/// <summary>
/// The moored ships' small life on the water (the browser's world/alive/water.ts):
/// - their riding lights after dark (createShipLights): each ship lying still in the stream shows one white light
///   forward on her forestay, a lantern seen far through the wet air (three fog lengths), a core and its halo. Boats
///   under way add theirs through the hook Moving (masthead white, port red, starboard green; the anchored liner two
///   white): the moving-things part calls Put for each.
/// - the bilge pumps (createBilge): five moored ships pump now and then by the game's clock (a run of 14 to 33
///   strokes in each round of 240 s, not by night), the dirty water spouting from an outlet under the rail on each
///   down stroke and falling into the river; the clank and the gush in runs of six strokes.
/// Four point sets (white, red and green lights, the water), each one draw; nothing allocated after the start.
/// </summary>
[GamePart(42)]
public partial class ShipWater : Node
{
    public static ShipWater? I { get; private set; }

    /// <summary>Ships lying still in the stream (water.ts RIDING): x, z, yaw, length.</summary>
    private static readonly (float x, float z, float yaw, float len)[] Riding =
    {
        (-40, -7.2f, MathF.PI / 2, 26), (-34, -26, MathF.PI / 2, 34), (-150, -62, MathF.PI / 2, 40), (-40, -48, MathF.PI / 2, 34),
        (110, -44, -MathF.PI / 2, 34), (-205, -64, MathF.PI / 2 + 0.3f, 24), (30, -70, 1.2f, 14), (125, 80, 0, 34),
    };

    /// <summary>water.ts PUMPS: the ship's middle, yaw, half beam, the outlet's height over the water, which side.</summary>
    private static readonly (float x, float z, float yaw, float half, float free, int side)[] Pumps =
    {
        (-40, -7.2f, MathF.PI / 2, 4.8f, 2.3f, -1), (-34, -26, MathF.PI / 2, 5.0f, 2.0f, -1), (110, -44, -MathF.PI / 2, 5.0f, 2.0f, 1),
        (125, 80, 0, 5.0f, 2.0f, 1), (-150, -62, MathF.PI / 2, 4.5f, 3.0f, -1),
    };

    private const int MaxLights = 64, PerPump = 40;
    private const float Period = 1.7f, Round = 240;
    public enum Lamp { White, Red, Green }

    /// <summary>The hook for boats under way (the moving-things part): called each night frame; put their lights with Put.</summary>
    public static Action<ShipWater>? Moving;

    private AirPoints white = null!, red = null!, green = null!, water = null!;
    private readonly int[] used = new int[3];
    private float lit;
    private readonly Vector3[] dropP = new Vector3[Pumps.Length * PerPump], dropV = new Vector3[Pumps.Length * PerPump];
    private readonly bool[] dropOn = new bool[Pumps.Length * PerPump];
    private readonly (int strokes, float clock, float soundAt)[] pump = new (int, float, float)[Pumps.Length];
    private readonly RandomNumberGenerator rng = new() { Seed = 1873 };
    private float t;
    private bool settle;

    /// <summary>Dev (water.ts pumpNow): every pump near the eye works now, day or night.</summary>
    public bool PumpNow { get; set; }

    /// <summary>For a check: the lights burning, how lit, the pumps working, the drops in the air.</summary>
    public (int lights, float lit, int pumping, int drops) Info { get; private set; }

    public override void _Ready()
    {
        I = this;
        ProcessPriority = 60;
        // (a test picture: the lights at once, not over the next seconds)
        Daylight.I.Settled += () => settle = true;
        AirPoints Light(string name, Color c)
        {
            var p = new AirPoints(name, MaxLights, add: true, priority: 3);
            p.Param("shape", 3.0f);
            p.Param("col", new Vector3(c.R, c.G, c.B));
            p.Param("fog_mix", 0.0f);
            p.Param("fog_fade", 1.0f);
            p.Param("fog_reach", 3.0f);
            p.Param("min_px", 3.0f);
            p.Param("max_px", 22.0f);
            return p;
        }
        white = Light("alive_ship_lights_white", new Color(1, 0.92f, 0.75f));
        red = Light("alive_ship_lights_red", new Color(1, 0.15f, 0.08f));
        green = Light("alive_ship_lights_green", new Color(0.2f, 1, 0.35f));
        water = new AirPoints("alive_bilge_live", Pumps.Length * PerPump);
        water.Param("shape", 1.0f);
        water.Param("col", new Vector3(0.55f, 0.53f, 0.46f));
        water.Param("fog_mix", 1.0f);
        water.Param("fog_fade", 1.0f);
        water.Param("min_px", 1.0f);
        water.Param("max_px", 8.0f);
        foreach (var n in new[] { "alive_ship_lights", "alive_bilge" })
        {
            if (Main.I.World.FindChild(n, true, false) is Node3D baked) baked.Visible = false;
            Main.I.World.Unported.Remove(n);
        }
    }

    /// <summary>For a test picture: the pump outlet nearest a point, and which way its water goes.</summary>
    public (Vector3 at, Vector3 outward) NearestOutlet(Vector3 to)
    {
        var best = (at: Vector3.Zero, outward: Vector3.Forward);
        float bd = float.MaxValue;
        foreach (var p in Pumps)
        {
            var side = new Vector3(MathF.Cos(p.yaw) * p.side, 0, -MathF.Sin(p.yaw) * p.side);
            var at = new Vector3(p.x, Water.Level(p.x, p.z) + p.free, p.z) + side * (p.half + 0.05f);
            if (at.DistanceSquaredTo(to) < bd) { bd = at.DistanceSquaredTo(to); best = (at, side); }
        }
        return best;
    }

    /// <summary>A light on a boat under way (for the Moving hook): where and which.</summary>
    public void Put(Vector3 at, Lamp lamp)
    {
        var set = lamp == Lamp.Red ? red : lamp == Lamp.Green ? green : white;
        int k = (int)lamp;
        if (used[k] >= MaxLights) return;
        set.Set(used[k]++, at, 0.9f, 1, at.X, lit * (0.9f + 0.1f * MathF.Sin(t * 7 + at.X)));
    }

    public override void _Process(double delta)
    {
        var day = Daylight.I;
        if (day == null) return;
        float dt = (float)delta;
        t += dt;
        float night = NightLife.NightAt(day);
        var eye = Main.I.View.GetCamera3D()?.GlobalPosition ?? Vector3.Zero;

        // --- the riding lights: lit in the dark, or a foggy dusk
        lit += ((night > 0.55f || (day.Weather == "fog" && night > 0.25f) ? 1 : 0) - lit) * (settle ? 1 : Math.Min(1, dt));
        settle = false;
        int before = used[0] + used[1] + used[2];
        used[0] = used[1] = used[2] = 0;
        if (lit > 0.01f)
        {
            foreach (var (x, z, yaw, len) in Riding)
            {
                float fx = x + MathF.Sin(yaw) * len * 0.4f, fz = z + MathF.Cos(yaw) * len * 0.4f;
                Put(new Vector3(fx, Water.Level(fx, fz) + (len > 20 ? 6.5f : 3.5f), fz), Lamp.White);
            }
            Moving?.Invoke(this);
        }
        // (the ones not put this frame go dark)
        HideFrom(white, used[0]);
        HideFrom(red, used[1]);
        HideFrom(green, used[2]);
        if (before + used[0] + used[1] + used[2] > 0)
        {
            white.Commit();
            red.Commit();
            green.Commit();
        }

        // --- the bilge pumps, by the game's clock
        int working = 0;
        double now0 = (Game.GameState.I.Day * 1440 + day.Hour * 60) * Game.ClockRate.RealSPerGameMin;
        for (int i = 0; i < Pumps.Length; i++)
        {
            var p = Pumps[i];
            bool near = new Vector2(p.x - eye.X, p.z - eye.Z).Length() < 90;
            double now = now0 + i * 37;
            int k = (int)Math.Floor(now / Round);
            int strokes = 14 + (int)Math.Floor(Dice(i, k, 1) * 20);
            double start = Dice(i, k, 2) * (Round - strokes * Period);
            float at = (float)(now - k * Round - start);
            if (PumpNow && near) at = (float)(now % (strokes * Period));
            else if (!near || night >= 0.9f || at < 0 || at >= strokes * Period)
            {
                pump[i].strokes = 0;
                continue;
            }
            if (pump[i].strokes <= 0) pump[i].soundAt = at;
            pump[i].strokes = strokes;
            pump[i].clock = at;
            working++;
            float phase = at % Period / Period;
            var side = new Vector2(MathF.Cos(p.yaw) * p.side, -MathF.Sin(p.yaw) * p.side);
            var outlet = new Vector3(p.x + side.X * (p.half + 0.05f), Water.Level(p.x, p.z) + p.free, p.z + side.Y * (p.half + 0.05f));
            // water comes on the down stroke (the second half of each stroke)
            if (phase > 0.4f && phase < 0.8f)
                for (int n = 0; n < 3; n++)
                {
                    int j = i * PerPump + rng.RandiRange(0, PerPump - 1);
                    if (dropOn[j]) continue;
                    dropOn[j] = true;
                    dropP[j] = outlet + new Vector3((rng.Randf() - 0.5f) * 0.06f, 0, (rng.Randf() - 0.5f) * 0.06f);
                    float sp = 1.2f + rng.Randf() * 0.6f;
                    dropV[j] = new Vector3(side.X * sp, 0.1f + rng.Randf() * 0.2f, side.Y * sp);
                }
            if (at >= pump[i].soundAt)
            {
                // the sound in runs of six strokes (the clank carries ~40 m, the gush less)
                pump[i].soundAt = at + Period * 6;
                Audio.Soundscape.I?.Placed(outlet, new Audio.PlacedOpts(2, 25, 45), Audio.AliveSounds.Bilge(6, Period), "bilge pump");
            }
        }
        int drops = 0;
        for (int j = 0; j < dropOn.Length; j++)
        {
            if (!dropOn[j])
            {
                water.Hide(j);
                continue;
            }
            dropV[j].Y -= 9.8f * dt;
            dropP[j] += dropV[j] * dt;
            if (dropP[j].Y < Water.Level(dropP[j].X, dropP[j].Z))
            {
                dropOn[j] = false;
                water.Hide(j);
                continue;
            }
            drops++;
            water.Set(j, dropP[j], 0.11f, 0.75f);
        }
        water.Commit();
        Info = (used[0] + used[1] + used[2], lit, working, drops);
    }

    private static void HideFrom(AirPoints set, int from)
    {
        for (int i = from; i < set.Count; i++) set.Hide(i);
    }

    /// <summary>water.ts dice: a pump's round's numbers from the clock, the same for every player.</summary>
    private static double Dice(int i, int k, int salt)
    {
        unchecked
        {
            int h = (i + 1) * (int)0x9e3779b1 ^ k * (int)0x85ebca6b ^ salt * (int)0xc2b2ae35;
            h = (h ^ (int)((uint)h >> 15)) * 0x2c1b3c6d;
            h = (h ^ (int)((uint)h >> 12)) * 0x297a2d39;
            return (uint)(h ^ (int)((uint)h >> 15)) / 4294967296.0;
        }
    }
}
