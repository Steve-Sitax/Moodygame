using System;
using Godot;
using Scheldemist.Render;

namespace Scheldemist.World;

/// <summary>
/// Thunder and lightning (the browser's world/alive/air.ts createStorm): on a storm day, and now and then in a heavy
/// shower, the sky and the air flash two or three times and the thunder follows after the time the sound takes (343
/// m/s) from a strike 0.8 to 6 km off, a crack when it is near, a long roll when it is far. In the great storm strike
/// on strike, some right over the roofs with the bolt itself seen through the rain, the clouds flickering between, the
/// far storm rolling on out of sight. The flash is the air's colour and the sky's light (Daylight.Flash); the bolt is a
/// crooked ribbon from the cloud to the roofs, made again at each near strike, drawn with the window lights' shader
/// (unlit, added, no fog: it outshines the rain). One draw while it shows; no new shader, no light.
/// </summary>
[GamePart(19)]
public partial class Lightning : Node
{
    public static Lightning? I { get; private set; }
    private const int BoltSeg = 64;

    private float wait = 20, rumble = 8, flicker = 3, flash = -1, near;
    private readonly (float t, float a)[] pattern = new (float, float)[5];
    private int patternN, boltN;
    private float forced = -1;
    private readonly RandomNumberGenerator rng = new();
    private MeshInstance3D bolt = null!;
    private ShaderMaterial boltMat = null!;
    private readonly Vector3[] boltA = new Vector3[BoltSeg], boltB = new Vector3[BoltSeg];
    // the thunders on their way (the sound's time from the strike)
    private readonly (float at, float a, float km)[] coming = new (float, float, float)[8];
    private float t;

    /// <summary>For a check: strikes, rumbles, flickers, seconds to the next strike, flashing now, the last one's km.</summary>
    public (int strikes, int rumbles, int flickers, float next, bool flashing, float lastKm) Info => (strikes, rumbles, flickers, wait, flash >= 0, near);
    private int strikes, rumbles, flickers;

    /// <summary>Dev (air.ts strike): a strike now, `km` off; `toward` its side (radians in x, z), else any.</summary>
    public void Strike(float km = 1.5f, float? toward = null)
    {
        forced = km;
        forcedSide = toward;
    }
    private float? forcedSide;

    public override void _Ready()
    {
        I = this;
        // before the daylight: its flash goes into this frame's air
        ProcessPriority = -10;
        var kind = new Psx.Kind(Unlit: true, Blend: true, Scissor: false, TwoSided: false, DepthWrite: false, Snap: false, Atlas: 0, VertexColor: true, Add: true, Fog: false);
        boltMat = new ShaderMaterial { Shader = Psx.ShaderOf(kind), ResourceName = "lightning_bolt", RenderPriority = 5 };
        boltMat.SetShaderParameter("albedo", new Color(0, 0, 0, 1));
        boltMat.SetShaderParameter("affine", 0.0);
        boltMat.SetShaderParameter("fog_reach", 1.0);
        boltMat.SetShaderParameter("uv_xform", new Vector4(1, 1, 0, 0));
        bolt = new MeshInstance3D { Name = "alive_bolt", Mesh = new ArrayMesh(), CastShadow = GeometryInstance3D.ShadowCastingSetting.Off, Visible = false, Layers = Mirrors.NoMirror, ExtraCullMargin = 2000 };
        Main.I.View.AddChild(bolt);
    }

    private float Rand(float a, float b) => rng.RandfRange(a, b);

    /// <summary>A new bolt `d` metres off that way from the eye: down from the cloud in crooked steps, with two branches.</summary>
    private void MakeBolt(Vector3 eye, float a, float d)
    {
        int i = 0;
        void Seg(Vector3 p, Vector3 q)
        {
            if (i >= BoltSeg) return;
            boltA[i] = p;
            boltB[i] = q;
            i++;
        }
        float top = d * 0.9f + 60;
        var p = new Vector3(eye.X + MathF.Cos(a) * d + Rand(-20, 20), top, eye.Z + MathF.Sin(a) * d + Rand(-20, 20));
        var trunk = new System.Collections.Generic.List<Vector3>(BoltSeg);
        while (p.Y > 0 && i < BoltSeg - 16)
        {
            float st = top / 30;
            var n = new Vector3(p.X + Rand(-0.7f, 0.7f) * st, p.Y - Rand(0.6f, 1.3f) * st, p.Z + Rand(-0.7f, 0.7f) * st);
            Seg(p, new Vector3(n.X, Math.Max(0, n.Y), n.Z));
            trunk.Add(n);
            p = n;
        }
        for (int b = 0; b < 2 && trunk.Count > 6; b++)
        {
            var c = trunk[(int)(Rand(0.15f, 0.6f) * trunk.Count)];
            float dx = Rand(-1, 1), dz = Rand(-1, 1);
            for (int k = 0; k < 7; k++)
            {
                float st = top / 34;
                var n = new Vector3(c.X + (dx + Rand(-0.6f, 0.6f)) * st, c.Y - Rand(0.4f, 1) * st, c.Z + (dz + Rand(-0.6f, 0.6f)) * st);
                Seg(c, n);
                c = n;
            }
        }
        boltN = i;
        // each step a ribbon across the line of sight, about a pixel and a half wide at its distance (a line in the browser)
        var verts = new Vector3[boltN * 6];
        var cols = new Color[boltN * 6];
        for (int s = 0; s < boltN; s++)
        {
            Vector3 A = boltA[s], B = boltB[s], mid = (A + B) / 2;
            var side = (B - A).Cross(mid - eye).Normalized() * (mid.DistanceTo(eye) * 0.0015f + 0.15f);
            verts[s * 6] = A - side; verts[s * 6 + 1] = A + side; verts[s * 6 + 2] = B + side;
            verts[s * 6 + 3] = A - side; verts[s * 6 + 4] = B + side; verts[s * 6 + 5] = B - side;
            for (int k = 0; k < 6; k++) cols[s * 6 + k] = Colors.White;
        }
        var arr = new Godot.Collections.Array();
        arr.Resize((int)Mesh.ArrayType.Max);
        arr[(int)Mesh.ArrayType.Vertex] = verts;
        arr[(int)Mesh.ArrayType.Color] = cols;
        var m = (ArrayMesh)bolt.Mesh;
        m.ClearSurfaces();
        if (boltN > 0)
        {
            m.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arr);
            m.SurfaceSetMaterial(0, boltMat);
        }
    }

    private float Level()
    {
        if (flash < 0) return 0;
        float v = 0;
        for (int i = 0; i < patternN; i++)
        {
            float d = flash - pattern[i].t;
            if (d >= 0 && d < 0.25f) v = Math.Max(v, pattern[i].a * MathF.Exp(-d * 14));
        }
        return v;
    }

    /// <summary>Thunder `km` off from the side `a` (placed in the air that way, far enough that it comes from there).</summary>
    private static void ThunderFrom(Vector3 eye, float a, float km, float gain)
    {
        float r = Math.Clamp(km * 250, 60, 300);
        Audio.Soundscape.I?.Placed(new Vector3(eye.X + MathF.Cos(a) * r, Math.Min(200, r * 0.7f), eye.Z + MathF.Sin(a) * r),
            new Audio.PlacedOpts(400, 5000, 1e9, Occl: 0, Wet: 0.7, Gain: gain, Must: true), Audio.AliveSounds.Thunder(km), "thunder");
    }

    public override void _Process(double delta)
    {
        var day = Daylight.I;
        var cam = Main.I.View.GetCamera3D();
        if (day == null || cam == null) return;
        float dt = (float)delta;
        t += dt;
        var eye = cam.GlobalPosition;
        bool storm = day.Weather == "storm";
        bool heavy = day.Weather == "rain" && day.Rain > 0.8f;
        // (the great storm: strike on strike, some right over the roofs, and the far storm rolls on between)
        float fury = storm ? day.Storm : 0;
        wait -= dt;
        // (a wait set before the storm grew is cut short as it grows: no minute of silence at its height)
        if (storm) wait = Math.Min(wait, 1.5f + 20 * (1 - fury));
        if (forced >= 0 || ((storm || heavy) && wait <= 0))
        {
            wait = storm ? Rand(15, 55) * (1 - 0.9f * fury) : Rand(150, 400);
            float km = forced >= 0 ? forced : fury > 0.4f && rng.Randf() < 0.45f * fury ? Rand(0.2f, 1.1f) : Rand(0.8f, 6) * (1 - 0.5f * fury);
            forced = -1;
            flash = 0;
            // flickers over half a second, weaker far away; a near one strikes again and again down the same channel
            float k = Math.Max(0.25f, 1 - km / 7) * (km < 1.2f ? 1.6f : 1);
            pattern[0] = (0, k);
            pattern[1] = (Rand(0.08f, 0.14f), k * Rand(0.3f, 0.6f));
            pattern[2] = (Rand(0.2f, 0.35f), k * Rand(0.5f, 0.9f));
            patternN = 3;
            if (km < 1.2f)
            {
                pattern[3] = (Rand(0.4f, 0.5f), k * Rand(0.6f, 1));
                pattern[4] = (Rand(0.55f, 0.7f), k * Rand(0.3f, 0.7f));
                patternN = 5;
            }
            near = km;
            strikes++;
            float a = forcedSide ?? rng.Randf() * MathF.Tau;
            forcedSide = null;
            // the bolt itself when it is near enough to see through the rain
            if (km < 2.2f) MakeBolt(eye, a, Math.Clamp(km * 220, 90, 380));
            else boltN = 0;
            for (int i = 0; i < coming.Length; i++)
                if (coming[i].at <= 0) { coming[i] = (t + km * 1000 / 343, a, km); break; }
        }
        for (int i = 0; i < coming.Length; i++)
            if (coming[i].at > 0 && t >= coming[i].at)
            {
                ThunderFrom(eye, coming[i].a, coming[i].km, 2.2f);
                coming[i].at = 0;
            }
        // the lightning inside the clouds: a dim flicker of the sky every second or few, no bolt, no near sound
        flicker -= dt;
        if (storm && fury > 0.3f && flicker <= 0)
        {
            flicker = Rand(1, 4) / fury;
            flickers++;
            if (flash < 0)
            {
                flash = 0;
                near = 9;
                boltN = 0;
                float k = Rand(0.12f, 0.3f);
                pattern[0] = (0, k);
                pattern[1] = (Rand(0.06f, 0.15f), k * Rand(0.4f, 0.9f));
                patternN = 2;
            }
        }
        // the far storm: thunder rolling on out of sight, no flash to speak of
        rumble -= dt;
        if (storm && fury > 0.25f && rumble <= 0)
        {
            rumble = Rand(5, 14) / fury;
            rumbles++;
            ThunderFrom(eye, rng.Randf() * MathF.Tau, Rand(5, 11), 1.2f);
        }
        float v = 0;
        if (flash >= 0)
        {
            flash += dt;
            v = Level();
            if (flash > 0.8f) flash = -1;
        }
        // the air and the sky light up (the daylight takes it into this frame's air)
        day.Flash = v;
        day.FlashSky = near < 1.2f ? 6 : 3;
        bool show = flash >= 0 && boltN > 0 && v > 0;
        if (bolt.Visible != show) bolt.Visible = show;
        if (show) UniformUpdates.Material(boltMat, "albedo", new Color(0.93f, 0.95f, 1f, 1) * Math.Min(1, v * 1.4f));
    }
}
