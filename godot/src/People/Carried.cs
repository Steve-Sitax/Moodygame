using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.Models;
using Scheldemist.Render;
using Scheldemist.World;

namespace Scheldemist.People;

/// <summary>
/// What people carry and push (the browser's game/crowd.ts setLoad, game/sackModel.ts hangSack, game/fishBox.ts,
/// game/kegModel.ts, world/traffic.ts PushCart): the sack across the arms or on the docker's shoulder and the
/// porter's sack truck, the box of fish, the keg, a crate, the carter's handcart on its own wheels, the lantern.
/// One model per thing: the sack and the fish box are the very meshes the bake drew on the piles (the browser makes
/// them in code, with their stencils; the goods part will bring that code), the keg, the crate and the handcart
/// come from clutter.glb and props.glb.
/// </summary>
public static class Carried
{
    /// <summary>The keg: 0.52 high (game/kegModel.ts KEG).</summary>
    private const float KegH = 0.52f;

    private static Mesh? sack, boxBoards, boxFish, keg, crate;
    private static Vector3 sackSize = new(0.88f, 0.3f, 0.5f);
    private static bool looked;

    private static void Look()
    {
        if (looked) return;
        looked = true;
        foreach (var n in BakedWorld.All(Main.I.World))
        {
            if (n is not MeshInstance3D { Mesh: not null } mi) continue;
            string name = mi.Name.ToString().TrimEnd('0', '1', '2', '3', '4', '5', '6', '7', '8', '9');
            if (sack == null && name == "sack")
            {
                var b = mi.Mesh.GetAabb();
                if (b.Size.X is > 0.8f and < 0.95f)
                {
                    sack = mi.Mesh;
                    sackSize = b.Size;
                }
            }
            else if (boxBoards == null && name == "fish box boards") boxBoards = mi.Mesh;
            else if (boxFish == null && name == "fish box fish") boxFish = mi.Mesh;
            if (sack != null && boxBoards != null && boxFish != null) break;
        }
        // (props.ts and clutter.ts: psx on a Lambert with the file's picture, no warp on the small things)
        var props = ModelLibrary.Get("props", new ModelLibrary.Look(TwoSided: true));
        sack ??= MeshOf(props, "sack");
        crate = MeshOf(props, "crate_seat");
        keg = MeshOf(ModelLibrary.Get("clutter", new ModelLibrary.Look(TwoSided: true, Affine: 0, VertexColor: true)), "keg")
            ?? MeshOf(ModelLibrary.Get("quaygoods", new ModelLibrary.Look(TwoSided: true, Affine: 0, VertexColor: true)), "keg");
    }

    private static Mesh? MeshOf(ModelLibrary.Model? m, string node) =>
        m != null && m.Roots.TryGetValue(node, out var n) ? (n as MeshInstance3D)?.Mesh ?? n.GetChildren().OfType<MeshInstance3D>().FirstOrDefault()?.Mesh : null;

    private static MeshInstance3D? Inst(Mesh? m, string name) => m == null ? null : new MeshInstance3D { Mesh = m, Name = name, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off };

    /// <summary>The one sack, sized to fit (length, height, width); its origin is on its underside.</summary>
    public static MeshInstance3D? Sack(float l, float h, float w)
    {
        Look();
        var s = Inst(sack, "sack");
        if (s != null) s.Scale = new Vector3(l / sackSize.X, h / sackSize.Y, w / sackSize.Z);
        return s;
    }

    /// <summary>
    /// The load in a walker's arms, as crowd.ts setLoad holds it: `k` is his body's height over 1.74 m. The node is
    /// named after its kind ("sack", "crate", "fishbox", "keg"); null when the model is not there.
    /// </summary>
    public static Node3D? Load(string kind, float k)
    {
        Look();
        switch (kind)
        {
            case "keg":
            {
                // a keg of 60 pints on its side in both arms before him
                var m = Inst(keg, "keg");
                if (m == null) return null;
                m.Rotation = new Vector3(0, 0, MathF.PI / 2);
                m.Position = new Vector3(KegH / 2, 0.92f * k, 0.4f * k);
                return m;
            }
            case "fishbox":
            {
                // a box of fish from the Vliet, held low before him in both arms
                var boards = Inst(boxBoards, "fishbox");
                if (boards == null) return Load("crate", k);
                var fish = Inst(boxFish, "fish");
                if (fish != null) boards.AddChild(fish);
                boards.Position = new Vector3(0, 0.72f * k, 0.32f * k);
                return boards;
            }
            case "crate":
            {
                // a crate held before the chest in both arms (it stands on its base)
                var m = Inst(crate, "crate");
                if (m != null) m.Position = new Vector3(0, 0.74f * k, 0.36f * k);
                return m;
            }
            default:
            {
                // the one sack model, held across the arms before the chest
                var m = Sack(0.72f, 0.26f, 0.42f);
                if (m == null) return null;
                m.Position = new Vector3(0, 0.98f * k, 0.3f * k);
                m.Basis = Basis.FromEuler(new Vector3(0.12f, 0.08f, 0.04f), EulerOrder.Xyz) * Basis.FromScale(m.Scale);
                return m;
            }
        }
    }

    /// <summary>Where people.glb had a sack of its own (client/src/game/people_sockets.json, written by tools/blender/build_people.py).</summary>
    private static readonly Dictionary<string, (string bone, Vector3 a, Vector3 b, Vector3 up, float r)> Sockets = new()
    {
        ["docker_sack"] = ("spine", new Vector3(0.222f, 1.49f, -0.31f), new Vector3(0.222f, 1.49f, 0.28f), Vector3.Up, 0.118f),
        ["porter"] = ("hips", new Vector3(0, 0.1505f, 1.3242f), new Vector3(0, 0.7629f, 0.7967f), new Vector3(0, 0.6526f, 0.7577f), 0.16f),
    };

    /// <summary>
    /// The one sack hung on a figure's bone where people.glb's own sack was (a docker's shoulder, a porter's sack
    /// truck): placed in the figure's space at rest and attached to the bone, so it goes with the clip (hangSack).
    /// </summary>
    public static void HangSack(string kind, Node3D root)
    {
        if (!Sockets.TryGetValue(kind, out var s)) return;
        var sk = root.GetNodeOrNull<Skeleton3D>("Skeleton3D");
        int bone = sk?.FindBone(s.bone) ?? -1;
        if (bone < 0 || sk!.HasNode("sack_on_" + s.bone)) return;
        float len = s.a.DistanceTo(s.b);
        var x = (s.b - s.a).Normalized();
        var y = (s.up - x * s.up.Dot(x)).Normalized();
        var z = x.Cross(y).Normalized();
        var m = Sack(len * 1.08f, s.r * 2, s.r * 2.3f);
        if (m == null) return;
        // the sack's middle at the ends' middle; its own origin is on its underside, half its thickness below
        // (the one sack's length runs from -0.37 to 0.51 of 0.88: its middle is a little off its origin)
        var mid = (s.a + s.b) * 0.5f - y * s.r - x * (0.07f * m.Scale.X);
        var inFigure = new Transform3D(new Basis(x, y, z) * Basis.FromScale(m.Scale), mid);
        var hold = new BoneAttachment3D { Name = "sack_on_" + s.bone, BoneName = s.bone };
        sk.AddChild(hold);
        m.Transform = sk.GetBoneGlobalRest(bone).AffineInverse() * inFigure;
        hold.AddChild(m);
    }

    // ------------------------------------------------------------------ the lantern

    private static Mesh? glass, cap, halo;
    private static ShaderMaterial? lit, haloMat;

    /// <summary>A small lantern with a warm glow (crowd.ts giveLantern, people.ts handLantern): the glass, the cap, the halo.</summary>
    public static Node3D Lantern()
    {
        if (glass == null)
        {
            var plain = new StandardMaterial3D();
            Psx.Kind Kind(bool unlit, bool add) => new(Unlit: unlit, Blend: add, Scissor: false, TwoSided: add, DepthWrite: !add, Snap: true, Atlas: 0, VertexColor: false, Add: add, Fog: true);
            plain.AlbedoColor = new Color(1, 0.753f, 0.439f).SrgbToLinear();
            lit = BakedWorld.PsxMaterial(plain, Kind(true, false), 0, 1.2);
            plain.AlbedoColor = new Color(0.102f, 0.102f, 0.102f).SrgbToLinear();
            var iron = BakedWorld.PsxMaterial(plain, Kind(false, false), 0);
            var grad = new GradientTexture2D
            {
                Width = 32, Height = 32, Fill = GradientTexture2D.FillEnum.Radial, FillFrom = new Vector2(0.5f, 0.5f), FillTo = new Vector2(1, 0.5f),
                Gradient = new Gradient { Offsets = new[] { 0f, 0.3f, 1f }, Colors = new[] { new Color(1, 1, 1, 1), new Color(0.45f, 0.45f, 0.45f, 1), new Color(0, 0, 0, 1) } },
            };
            plain.AlbedoColor = new Color(1, 0.69f, 0.376f).SrgbToLinear();
            plain.AlbedoTexture = grad;
            haloMat = BakedWorld.PsxMaterial(plain, Kind(true, true), 0, 1.2, 0, 0.45f);
            glass = new CylinderMesh { TopRadius = 0.06f, BottomRadius = 0.05f, Height = 0.16f, RadialSegments = 4, Rings = 1, Material = lit };
            cap = new CylinderMesh { TopRadius = 0, BottomRadius = 0.075f, Height = 0.07f, RadialSegments = 4, Rings = 1, Material = iron };
            halo = new QuadMesh { Size = new Vector2(0.45f, 0.45f), Material = haloMat };
        }
        var g = new Node3D { Name = "lantern" };
        g.AddChild(new MeshInstance3D { Mesh = glass, Position = new Vector3(0, -0.08f, 0), CastShadow = GeometryInstance3D.ShadowCastingSetting.Off });
        g.AddChild(new MeshInstance3D { Mesh = cap, Position = new Vector3(0, 0.035f, 0), CastShadow = GeometryInstance3D.ShadowCastingSetting.Off });
        g.AddChild(new MeshInstance3D { Mesh = halo, Name = "halo", Position = new Vector3(0, -0.08f, 0), CastShadow = GeometryInstance3D.ShadowCastingSetting.Off });
        return g;
    }

    /// <summary>All lanterns breathe together, gently; lit after dark (a horn pane by day). Once a frame.</summary>
    private static readonly StringName AlbedoParameter = "albedo";
    public static void LanternLook(double hour, double timeS)
    {
        if (lit == null) return;
        float dark = (float)LanternPool.DarkAt(hour);
        float flick = 0.4f + 0.06f * MathF.Sin((float)timeS * 13f);
        haloMat!.SetShaderParameter(AlbedoParameter, new Color(new Color(1, 0.69f, 0.376f).SrgbToLinear(), flick * dark));
        lit.SetShaderParameter(AlbedoParameter, new Color(0.42f + 0.58f * dark, 0.35f + 0.4f * dark, 0.27f + 0.17f * dark).SrgbToLinear());
    }

    /// <summary>The halo faces the eye (a sprite in the browser).</summary>
    private static readonly NodePath HaloPath = "halo";
    public static void FaceHalo(Node3D lantern, Vector3 eye)
    {
        if (lantern.GetNodeOrNull<Node3D>(HaloPath) is not { } h) return;
        var p = h.GlobalPosition;
        if (p.DistanceSquaredTo(eye) > 1e-4f) h.LookAt(p - (eye - p), Vector3.Up);
    }
}

/// <summary>
/// Carried lanterns light the world (world/lanternLights.ts): every lit lantern is a source; the nearest few to the
/// eye get a real light from a fixed pool, warm and flickering like the gas lamps. The pool's lights are in the scene
/// from the start and never leave it (energy 0 when idle): the light count never changes. A lantern that joins or
/// leaves the pool fades over half a second. (No shadows, and no light spilt past the pool: the shader's part.)
/// </summary>
public sealed class LanternPool
{
    public const int Pool = 4;
    private const float Range = 10, Power = 3.6f, Fade = 2.2f;

    public sealed class Source
    {
        /// <summary>The flame, world coordinates; the owner moves it and says whether it burns.</summary>
        public Vector3 Pos = new(0, -999, 0);
        public bool On;
        public float Seed;
        internal float Level;
        internal int Slot = -1;
    }

    public static LanternPool? I { get; private set; }
    private readonly OmniLight3D[] lights = new OmniLight3D[Pool];
    private readonly Source?[] slots = new Source?[Pool];
    private readonly List<Source> sources = new();
    private int seedN;
    private double t;
    public int Lit { get; private set; }
    public int Sources => sources.Count;

    public LanternPool(Node parent)
    {
        I = this;
        for (int i = 0; i < Pool; i++)
        {
            // three's light of intensity I is a Godot light of energy I / pi (godot/README.md)
            lights[i] = new OmniLight3D { Name = $"lantern_pool_{i}", LightColor = new Color(1, 0.627f, 0.282f).SrgbToLinear(), LightEnergy = 0, OmniRange = Range, OmniAttenuation = 1.25f, ShadowEnabled = false, LightSpecular = 0 };
            parent.AddChild(lights[i]);
        }
    }

    public Source Add()
    {
        var s = new Source { Seed = (seedN++ * 1.618f) % 7 };
        sources.Add(s);
        return s;
    }

    public void Remove(Source? s)
    {
        if (s == null) return;
        s.On = false;
        sources.Remove(s);
        if (s.Slot >= 0) gone.Add(s);
    }

    /// <summary>Lanterns taken away while lit: their light fades out before the slot is free.</summary>
    private readonly List<Source> gone = new();

    /// <summary>How dark it is for a lantern (0 by day, 1 at night) at this hour (lanternDarkAt).</summary>
    public static double DarkAt(double h)
    {
        double d = h >= 19.5 || h < 5.5 ? 1 : h >= 18 ? (h - 18) / 1.5 : h < 7 ? (7 - h) / 1.5 : 0;
        return Math.Max(0, Math.Min(1, d));
    }

    private static float Flicker(float t, float seed)
    {
        float v = 0.88f + MathF.Sin(t * 1.9f + seed * 2.1f) * 0.05f + MathF.Sin(t * 8.3f + seed * 5.3f) * 0.04f + MathF.Sin(t * 19.1f + seed * 1.7f) * 0.03f;
        if (MathF.Sin(t * 0.83f + seed * 3.3f) * MathF.Sin(t * 2.9f + seed) > 0.94f) v *= 0.75f;
        return v;
    }

    private readonly List<Source> nearest = new(Pool);
    public void Update(double dt, Vector3 eye, double hour)
    {
        t += dt;
        float dark = (float)DarkAt(hour);
        // the nearest burning ones want a light
        var want = nearest;
        want.Clear();
        if (dark > 0.02f) foreach (var source in sources)
        {
            if (!source.On) continue;
            float distance = source.Pos.DistanceSquaredTo(eye);
            int at = 0;
            while (at < want.Count && want[at].Pos.DistanceSquaredTo(eye) <= distance) at++;
            if (at >= Pool) continue;
            if (want.Count == Pool) want.RemoveAt(Pool - 1);
            want.Insert(at, source);
        }
        for (int i = 0; i < Pool; i++)
        {
            var s = slots[i];
            if (s == null) continue;
            bool keep = want.Contains(s);
            s.Level = Math.Clamp(s.Level + (keep ? Fade : -Fade) * (float)dt, 0, 1);
            if (!keep && s.Level <= 0)
            {
                s.Slot = -1;
                slots[i] = null;
                gone.Remove(s);
            }
        }
        foreach (var s in want)
        {
            if (s.Slot >= 0) continue;
            int free = Array.IndexOf(slots, null);
            if (free < 0) break;
            slots[free] = s;
            s.Slot = free;
            s.Level = 0;
        }
        int lit = 0;
        for (int i = 0; i < Pool; i++)
        {
            var s = slots[i];
            if (s == null)
            {
                lights[i].LightEnergy = 0;
                continue;
            }
            lights[i].Position = s.Pos;
            lights[i].LightEnergy = Power / MathF.PI * dark * s.Level * Flicker((float)t, s.Seed);
            if (lights[i].LightEnergy > 0) lit++;
        }
        Lit = lit;
    }
}

/// <summary>
/// A two-wheeled handcart pushed from its grips (world/traffic.ts PushCart): it rests on its wheels on the ground;
/// the grips go where the hands are, so the cart tips about its axle to reach them. It swings round behind the turn
/// and its wheels roll with the ground covered. Let go of it and it settles on its prop legs.
/// </summary>
public sealed class PushCart
{
    /// <summary>Where the grips are on the cart (tr_handcart: origin on the ground under the axle; the shafts point along +z).</summary>
    private const float CartR = 0.57f, GripZ = 2.15f, GripY = 0.75f;

    public readonly Node3D Root = new() { Name = "pushcart" };
    private readonly Node3D pivot = new();
    private readonly Node3D? wheels;
    private double dir, ax, az, spin, tilt, held;
    private bool placed;

    public static bool Has => ModelLibrary.Get("props", new ModelLibrary.Look(TwoSided: true))?.Roots.ContainsKey("tr_handcart") == true;

    public PushCart(Node parent, bool load = true)
    {
        var props = ModelLibrary.Get("props", new ModelLibrary.Look(TwoSided: true))!;
        pivot.Position = new Vector3(0, CartR, 0);
        foreach (string part in load ? new[] { "tr_handcart", "tr_handcart_load" } : new[] { "tr_handcart" })
        {
            if (props.Copy(part) is not { } n) continue;
            n.Position = new Vector3(0, -CartR, 0);
            pivot.AddChild(n);
        }
        wheels = props.Copy("tr_handcart_wheels");
        if (wheels != null)
        {
            wheels.Position = new Vector3(0, CartR, 0);
            Root.AddChild(wheels);
        }
        Root.AddChild(pivot);
        parent.AddChild(Root);
    }

    private static double AngDiff(double a, double b) => Math.Atan2(Math.Sin(a - b), Math.Cos(a - b));

    private double GripReach()
    {
        double dy0 = GripY - CartR, rho = Math.Sqrt(dy0 * dy0 + GripZ * GripZ);
        return rho * Math.Cos(Math.Atan2(dy0, GripZ) - tilt);
    }

    /// <summary>The tilt (about the axle; negative lifts the grips) that brings the grips to height y.</summary>
    private static double TiltFor(double y)
    {
        double dy0 = GripY - CartR, rho = Math.Sqrt(dy0 * dy0 + GripZ * GripZ);
        return Math.Atan2(dy0, GripZ) - Math.Asin(Math.Clamp((y - CartR) / rho, -0.2, 0.5));
    }

    /// <summary>Follow the hands: grip point (x, z) at height y over the ground `ground`, the man walking toward yaw. hold 1: in his hands; 0: let go.</summary>
    public void Push(double dt, double x, double z, double y, double yaw, double hold, double ground)
    {
        if (!placed)
        {
            dir = yaw;
            ax = x + Math.Sin(yaw) * GripZ;
            az = z + Math.Cos(yaw) * GripZ;
            placed = true;
        }
        held += (hold - held) * Math.Min(1, dt * 3);
        if (hold > 0.5)
        {
            // the heading comes round behind the man's (the cart lags on a bend) ...
            dir += AngDiff(yaw, dir) * Math.Min(1, dt * 2.2);
            // ... and the cart hangs from the grips: the axle sits out along the heading
            double ox = ax, oz = az, reach = GripReach();
            // taking hold again after a rest: the cart comes to the hands over a moment, no jump
            double k = held > 0.9 ? 1 : Math.Min(1, dt * 4);
            ax += (x + Math.Sin(dir) * reach - ax) * k;
            az += (z + Math.Cos(dir) * reach - az) * k;
            // the wheels roll with the ground covered along the heading
            spin += ((ax - ox) * Math.Sin(dir) + (az - oz) * Math.Cos(dir)) / CartR;
        }
        // tip about the axle so the grips reach the hands (let go: down onto the legs)
        tilt += (TiltFor(y) * held - tilt) * Math.Min(1, dt * 6);
        Root.Position = new Vector3((float)ax, (float)ground, (float)az);
        Root.Rotation = new Vector3(0, (float)(dir + Math.PI), 0);
        pivot.Rotation = new Vector3((float)tilt, 0, 0);
        if (wheels != null) wheels.Rotation = new Vector3((float)-spin, 0, 0);
    }

    public (double x, double z) Axle => (ax, az);

    public void Dispose() => Root.QueueFree();

    /// <summary>
    /// The carter's model has a handcart baked into its mesh (skinned to the hips, in front of the body): folded to
    /// nothing, once, so the cart on its own wheels takes its place (world/traffic.ts hideBakedCart).
    /// </summary>
    public static void HideBakedCart(Node3D root)
    {
        var sk = root.GetNodeOrNull<Skeleton3D>("Skeleton3D");
        var mi = sk?.GetChildren().OfType<MeshInstance3D>().FirstOrDefault();
        if (mi?.Mesh is not ArrayMesh mesh || mesh.HasMeta("cart_gone")) return;
        int hips = sk!.FindBone("hips");
        // (the mesh's joints are the skin's: the skin's bind for the hips bone)
        var skin = mi.Skin;
        int joint = hips;
        if (skin != null)
            for (int b = 0; b < skin.GetBindCount(); b++)
                if (skin.GetBindName(b) == "hips" || skin.GetBindBone(b) == hips) joint = b;
        var made = new ArrayMesh();
        for (int s = 0; s < mesh.GetSurfaceCount(); s++)
        {
            var arrays = mesh.SurfaceGetArrays(s);
            var pos = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
            var bones = arrays[(int)Mesh.ArrayType.Bones].AsInt32Array();
            var weights = arrays[(int)Mesh.ArrayType.Weights].AsFloat32Array();
            int per = pos.Length > 0 ? bones.Length / pos.Length : 4;
            for (int i = 0; i < pos.Length; i++)
                if (bones[i * per] == joint && weights[i * per] > 0.99f && pos[i].Z > 0.3f) pos[i] = new Vector3(0, 1.0f, 0); // inside the body: the triangles fold to nothing
            arrays[(int)Mesh.ArrayType.Vertex] = pos;
            made.AddSurfaceFromArrays(mesh.SurfaceGetPrimitiveType(s), arrays, null, null, mesh.SurfaceGetFormat(s) & (Mesh.ArrayFormat.FlagUse8BoneWeights));
            made.SurfaceSetMaterial(made.GetSurfaceCount() - 1, mesh.SurfaceGetMaterial(s));
        }
        made.SetMeta("cart_gone", true);
        mi.Mesh = made;
    }
}
