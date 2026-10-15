using System;
using System.Collections.Generic;
using System.Text.Json;
using Godot;
using Scheldemist.Models;

namespace Scheldemist.Movers;

/// <summary>
/// The draught horse of horse.scn (art-source/tools/blender/build_horse.py): one model of rigid parts, each on its own
/// pivot, used by every horse in the town (the train and the omnibuses' pool, the drays, the led drays, the hearse, the
/// fire pump, the Rijnkaai's waiting dray and the farrier's horse). The body and the four leg parts take the place of
/// the old ones (same origins, so the gait (HorseGait) moves them as before); the neck with its collar nods a little
/// about the base of the neck, the head nods at the poll, each ear turns on its base and the tail swishes from the dock.
/// Two straps are stretched each frame: the reins from the bit to the hame terrets, and on a shaft horse the traces
/// from the hame tugs' buckles to the hooks on the shafts. Pictures: each coat's colour (2048 px, BPTC) and one normal
/// picture (RGTC) in res://assets/horse-pictures, drawn with the people2 skin shader (the animals' material, no new
/// shader kind).
/// </summary>
public static class HorseModel
{
    public static readonly string[] Parts = { "body", "neck", "head", "ear_l", "ear_r", "tail", "leg_front", "leg_front_lo", "leg_hind", "leg_hind_lo", "rein", "trace" };
    private const string PictureRoot = "res://assets/horse-pictures/";
    private static bool tried;
    private static Node3D? scene;
    private static readonly Dictionary<string, Mesh> meshes = new();
    private static readonly Dictionary<string, ShaderMaterial> materials = new();
    private static readonly Dictionary<string, Texture2D> pictures = new();
    /// <summary>Pivots on the standing horse (the body's frame: x left, y up, z forward, origin on the ground).</summary>
    public static Vector3 NeckPivot, HeadPivot, EarL, EarR, TailPivot;
    /// <summary>Points in their part's own frame: the bit rings (head), the hame terrets and the trace buckles (neck), the
    /// shaft tugs (body), the breath (head).</summary>
    public static Vector3 BitL, BitR, TerretL, TerretR, TraceL, TraceR, TugL, TugR, Breath;
    public static long PictureBytes { get; private set; }

    public static bool Ready
    {
        get
        {
            if (tried) return scene != null;
            tried = true;
            try { Load(); }
            catch (Exception e) { GD.PrintErr("horse model: " + e.Message); scene = null; }
            return scene != null;
        }
    }

    private static Vector3 V(JsonElement a) => new(a[0].GetSingle(), a[1].GetSingle(), a[2].GetSingle());

    private static void Load()
    {
        if (ModelLibrary.NativeScene == null || !ModelLibrary.Available("horse") || ModelLibrary.NativeScene("horse") is not { } root) return;
        foreach (var n in World.BakedWorld.All(root))
            if (n is MeshInstance3D mi && mi.Mesh != null && mi.Name.ToString().StartsWith("horse_", StringComparison.Ordinal))
                meshes[mi.Name.ToString()[6..]] = mi.Mesh;
        foreach (string p in Parts) if (!meshes.ContainsKey(p)) throw new InvalidOperationException("horse.scn has no part " + p);
        if (ModelExtras.Get("horse", "horse_body", "horse") is not { } facts) throw new InvalidOperationException("horse.scn has no extras");
        var pv = facts.GetProperty("pivots");
        NeckPivot = V(pv.GetProperty("neck")); HeadPivot = V(pv.GetProperty("head")); EarL = V(pv.GetProperty("ear_l")); EarR = V(pv.GetProperty("ear_r"));
        TailPivot = V(pv.GetProperty("tail"));
        var pt = facts.GetProperty("points");
        BitL = V(pt.GetProperty("bitL")); BitR = V(pt.GetProperty("bitR")); TerretL = V(pt.GetProperty("terretL")); TerretR = V(pt.GetProperty("terretR"));
        TraceL = V(pt.GetProperty("traceL")); TraceR = V(pt.GetProperty("traceR")); TugL = V(pt.GetProperty("tugL")); TugR = V(pt.GetProperty("tugR"));
        Breath = V(pt.GetProperty("breath"));
        scene = root;
        GD.Print($"horse model: {meshes.Count} parts");
    }

    public static Mesh Mesh(string part) => meshes[part];

    /// <summary>When the town goes: the model's scene freed (the meshes and pictures go with the last copy using them).</summary>
    public static void Forget()
    {
        if (scene != null && GodotObject.IsInstanceValid(scene)) scene.Free();
        scene = null;
        tried = false;
        meshes.Clear();
        materials.Clear();
        pictures.Clear();
        PictureBytes = 0;
    }

    private static Texture2D Picture(string name, bool normal)
    {
        if (pictures.TryGetValue(name, out var t)) return t;
        var tex = ResourceLoader.Load<Texture2D>(PictureRoot + name + ".png") ?? throw new System.IO.FileNotFoundException("horse picture " + name);
        using var image = tex.GetImage();
        if (image == null || !image.IsCompressed() || !image.HasMipmaps())
            throw new System.IO.InvalidDataException("Horse pictures require imported GPU compression and mipmaps: " + name);
        var want = normal ? Image.Format.RgtcRg : Image.Format.BptcRgba;
        if (image.GetFormat() != want) throw new System.IO.InvalidDataException("Horse picture format must be " + want + ": " + name);
        PictureBytes += image.GetData().LongLength;
        return pictures[name] = tex;
    }

    /// <summary>The coats of the horse's pictures.</summary>
    public static readonly string[] Coats = { "bay", "chestnut", "black", "roan", "brown", "grey" };

    /// <summary>The coats of a herd, the common ones twice (the draught breeds' bays and chestnuts).</summary>
    public static readonly string[] Herd = { "bay", "bay", "chestnut", "chestnut", "brown", "brown", "black", "roan", "grey" };

    /// <summary>The coat of the team or horse numbered `key` in a herd drawn with `seed`: the same in every game.</summary>
    public static string CoatOf(int key, int seed)
    {
        uint x = unchecked((uint)(key * 374761393 + seed * 668265263 + 1013904223));
        x = unchecked((x ^ (x >> 13)) * 1274126177u);
        x ^= x >> 16;
        return Herd[(int)(x % (uint)Herd.Length)];
    }

    /// <summary>The coat's material: one of Coats (anything else is bay).</summary>
    public static ShaderMaterial Material(string coat)
    {
        if (Array.IndexOf(Coats, coat) < 0) coat = "bay";
        if (materials.TryGetValue(coat, out var m)) return m;
        m = new ShaderMaterial { Shader = People.People2Material.Skin(), ResourceName = "horse_" + coat };
        m.SetShaderParameter("layered_pictures", false);
        m.SetShaderParameter("albedo", Colors.White);
        m.SetShaderParameter("tex", Picture("horse_" + coat + "_colour", false));
        m.SetShaderParameter("skin_normal", Picture("horse_normal", true));
        return materials[coat] = m;
    }

    // ---- where the moving parts are, from the body's frame and the pose

    public struct Frames
    {
        public Transform3D Body, Neck, Head, EarL, EarR, Tail, ReinL, ReinR, TraceL, TraceR;
    }

    /// <summary>All parts' frames for a horse whose body frame (its ground origin, turned, lifted by the pose's bob) is
    /// `body`, posed by `p`.</summary>
    public static void Place(in Transform3D body, HorseGait.Pose p, ref Frames f, bool traces)
    {
        f.Body = body;
        f.Neck = body * new Transform3D(new Basis(Vector3.Right, p.NeckNod), NeckPivot);
        f.Head = f.Neck * new Transform3D(new Basis(Vector3.Right, p.HeadNod), HeadPivot - NeckPivot);
        f.EarL = f.Head * new Transform3D(new Basis(Vector3.Up, p.EarYawL) * new Basis(Vector3.Right, p.EarPitchL), EarL - HeadPivot);
        f.EarR = f.Head * new Transform3D(new Basis(Vector3.Up, -p.EarYawR) * new Basis(Vector3.Right, p.EarPitchR), EarR - HeadPivot);
        f.Tail = body * new Transform3D(new Basis(Vector3.Up, p.TailYaw) * new Basis(Vector3.Right, p.TailPitch), TailPivot);
        f.ReinL = Strap(f.Head * BitL, f.Neck * TerretL);
        f.ReinR = Strap(f.Head * BitR, f.Neck * TerretR);
        if (traces)
        {
            // a shaft horse: from the tug's buckle back and down to the hook on the shaft, just ahead of the shaft's tug
            f.TraceL = Strap(f.Neck * TraceL, body * (TugL + new Vector3(-0.012f, 0.012f, 0.13f)));
            f.TraceR = Strap(f.Neck * TraceR, body * (TugR + new Vector3(0.012f, 0.012f, 0.13f)));
        }
    }

    /// <summary>A strap a metre long along +z (the rein and trace models), stretched from a to b.</summary>
    public static Transform3D Strap(Vector3 a, Vector3 b)
    {
        var d = b - a;
        float len = d.Length();
        if (len < 1e-3f) return new Transform3D(Basis.FromScale(Vector3.Zero), a);
        var dir = d / len;
        var up = Math.Abs(dir.Y) > 0.98f ? Vector3.Forward : Vector3.Up;
        return new Transform3D(Basis.LookingAt(dir, up, true) * Basis.FromScale(new Vector3(1, 1, len)), a);
    }
}

/// <summary>
/// One horse made of nodes (the drays' horses, the led drays, the hearse, the fire pump, the standing horses): the old
/// body and leg nodes keep their names and places (the gait still moves them) and their meshes become the new parts';
/// the neck, head, ears, tail, reins and (on a shaft horse) traces are new nodes beside the body, set from its frame.
/// </summary>
public sealed class HorseNodes
{
    private readonly Node3D body;
    private readonly MeshInstance3D neck, head, earL, earR, tail, reinL, reinR;
    private readonly MeshInstance3D? traceL, traceR;
    private HorseModel.Frames frames;
    public readonly int Id;

    private static MeshInstance3D Part(Node parent, string part, string name, Material m)
    {
        var mi = new MeshInstance3D { Name = name, Mesh = HorseModel.Mesh(part), MaterialOverride = m };
        parent.AddChild(mi);
        return mi;
    }

    /// <summary>The node's mesh: the node itself or the first mesh under it (a model copy is a scene).</summary>
    public static MeshInstance3D? MeshOf(Node? n) => n as MeshInstance3D ?? (n == null ? null : System.Linq.Enumerable.FirstOrDefault(System.Linq.Enumerable.OfType<MeshInstance3D>(World.BakedWorld.All(n))));

    /// <summary>`body` and `legs` (upper, lower per leg: FL, FR, HL, HR) are the old nodes; null when any is missing.</summary>
    public static HorseNodes? Make(Node3D? body, IList<Node3D?> legs, string coat, bool traces, int id)
    {
        if (!HorseModel.Ready || body == null || body.GetParent() == null || legs.Count != 8 || MeshOf(body) == null) return null;
        foreach (var l in legs) if (MeshOf(l) == null) return null;
        return new HorseNodes(body, legs, coat, traces, id);
    }

    private HorseNodes(Node3D body, IList<Node3D?> legs, string coat, bool traces, int id)
    {
        Id = id;
        this.body = body;
        var m = HorseModel.Material(coat);
        var shadow = MeshOf(body)!.CastShadow;
        var b = MeshOf(body)!;
        b.Mesh = HorseModel.Mesh("body");
        b.MaterialOverride = m;
        for (int k = 0; k < legs.Count; k++)
        {
            bool front = k < 4, lower = k % 2 == 1;
            var l = MeshOf(legs[k])!;
            l.Mesh = HorseModel.Mesh((front ? "leg_front" : "leg_hind") + (lower ? "_lo" : ""));
            l.MaterialOverride = m;
        }
        var parent = body.GetParent();
        neck = Part(parent, "neck", "horse_neck", m);
        head = Part(parent, "head", "horse_head", m);
        earL = Part(parent, "ear_l", "horse_ear_l", m);
        earR = Part(parent, "ear_r", "horse_ear_r", m);
        tail = Part(parent, "tail", "horse_tail", m);
        reinL = Part(parent, "rein", "horse_rein_l", m);
        reinR = Part(parent, "rein", "horse_rein_r", m);
        if (traces)
        {
            traceL = Part(parent, "trace", "horse_trace_l", m);
            traceR = Part(parent, "trace", "horse_trace_r", m);
        }
        foreach (var n in new[] { neck, head, earL, earR, tail }) n.CastShadow = shadow;
        foreach (var n in new[] { reinL, reinR, traceL, traceR }) if (n != null) n.CastShadow = GeometryInstance3D.ShadowCastingSetting.Off;
    }

    /// <summary>After the body node is placed (its transform: the horse's ground frame lifted by the bob).</summary>
    public void Set(HorseGait.Pose p)
    {
        HorseModel.Place(body.Transform, p, ref frames, traceL != null);
        neck.Transform = frames.Neck; head.Transform = frames.Head; earL.Transform = frames.EarL; earR.Transform = frames.EarR;
        tail.Transform = frames.Tail; reinL.Transform = frames.ReinL; reinR.Transform = frames.ReinR;
        if (traceL != null) { traceL.Transform = frames.TraceL; traceR!.Transform = frames.TraceR; }
    }
}

