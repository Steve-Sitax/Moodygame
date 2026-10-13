using System;
using System.Collections.Generic;
using System.Text.Json;
using Godot;
using Scheldemist.Models;

namespace Scheldemist.People;

// Package D3: what a work clip moves (peopleRig.json work.clips.<clip>.things). One model per thing, the game's
// own: the one sack (People/Carried.cs), the quay's cask, the alleys' birch broom, the lively scrubbing brush and
// pipe. A thing rides a bone (an offset in the bone's frame) or follows a track in the person's frame (positions
// for the clip's body, scaled by the hips). Things without a model in the game (a knife, a book, a rifle, a crank)
// are left out. docs/godot-people2.md "Work".
internal sealed class People2Things
{
    internal sealed class Thing
    {
        public string Name = "", Model = "";
        public string? Bone;
        public Transform3D Offset = Transform3D.Identity;
        public Vector3 Size = Vector3.One;
        public float[] Keys = Array.Empty<float>();
        public int Stride;
        public bool Roll;
        public float Radius = 0.33f;
    }

    internal static Thing[] Parse(JsonElement things)
    {
        var list = new List<Thing>();
        foreach (var p in things.EnumerateObject())
        {
            var v = p.Value;
            // a pair's second man draws nothing: his partner's clip moves the thing between them (the sack passed)
            if (v.TryGetProperty("from", out var from) && from.GetString() == "partner") continue;
            var t = new Thing { Name = p.Name, Model = v.TryGetProperty("model", out var m) ? m.GetString()! : p.Name };
            if (v.TryGetProperty("roll", out var roll) && roll.ValueKind == JsonValueKind.True) t.Roll = true;
            if (v.TryGetProperty("radius", out var r)) t.Radius = r.GetSingle();
            if (v.TryGetProperty("size", out var sz) && sz.ValueKind == JsonValueKind.Array && sz.GetArrayLength() == 3)
                t.Size = new Vector3(sz[0].GetSingle(), sz[2].GetSingle(), sz[1].GetSingle());
            if (v.TryGetProperty("bone", out var b))
            {
                t.Bone = b.GetString();
                var o = v.GetProperty("offset"); var q = v.GetProperty("turn");
                t.Offset = new Transform3D(new Basis(new Quaternion(q[0].GetSingle(), q[1].GetSingle(), q[2].GetSingle(), q[3].GetSingle()).Normalized()),
                    new Vector3(o[0].GetSingle(), o[1].GetSingle(), o[2].GetSingle()));
            }
            else if (v.TryGetProperty("keys", out var keys) && keys.GetArrayLength() > 0)
            {
                int n = keys.GetArrayLength(), stride = keys[0].GetArrayLength();
                t.Stride = stride;
                t.Keys = new float[n * stride];
                int i = 0;
                foreach (var k in keys.EnumerateArray())
                    foreach (var x in k.EnumerateArray()) t.Keys[i++] = x.GetSingle();
            }
            else continue;
            if (Has(t.Model)) list.Add(t);
        }
        return list.ToArray();
    }

    /// <summary>Does the game have a model for this thing?</summary>
    internal static bool Has(string model) => model is "sack" or "cask" or "broom" or "brush" or "pipe";

    private static Mesh? pipeStem, pipeBowl;
    private static readonly ModelLibrary.Look Plain = new(TwoSided: true, Affine: 0, VertexColor: true);

    /// <summary>A copy of a thing's model in the thing's own frame (x along it, y up, middle at the origin).</summary>
    private static Node3D? Make(string model)
    {
        var holder = new Node3D { Name = "work_" + model };
        Node3D? part = null;
        switch (model)
        {
            case "sack":
                part = Carried.Sack(0.86f, 0.26f, 0.44f);
                break;
            case "cask":
                part = ModelLibrary.Get("quaygoods", Plain)?.Copy("cask");
                // standing on its head (y up, the origin under it): its axis along x, its middle at the origin
                if (part != null) part.Transform = new Transform3D(new Basis(Vector3.Back, -MathF.PI / 2), Vector3.Zero) * new Transform3D(Basis.Identity, new Vector3(0, -0.44f, 0));
                break;
            case "broom":
                part = ModelLibrary.Get("clutter", Plain)?.Copy("broom");
                // the clutter broom leans on a wall (build_clutter.py broom: moved 0.45 and tipped back): stood up,
                // its head's foot at the origin, the handle along x
                if (part != null)
                {
                    float lean = MathF.Atan2(0.42f, 1.45f);
                    var unlean = new Transform3D(new Basis(Vector3.Right, lean), Vector3.Zero) * new Transform3D(Basis.Identity, new Vector3(0, 0, -0.45f));
                    part.Transform = new Transform3D(new Basis(Vector3.Back, -MathF.PI / 2), Vector3.Zero) * unlean;
                }
                break;
            case "brush":
                part = ModelLibrary.Get("lively", Plain)?.Copy("brush");
                if (part != null) part.Position = new Vector3(0, -0.03f, 0);
                break;
            case "pipe":
                pipeStem ??= Town.StreetWindows.PipeStem;
                pipeBowl ??= Town.StreetWindows.PipeBowl;
                if (pipeStem == null || pipeBowl == null) break;
                part = new Node3D();
                part.AddChild(new MeshInstance3D { Mesh = pipeStem, Position = new Vector3(0.1f, 0, 0), Rotation = new Vector3(0, 0, MathF.PI / 2), CastShadow = GeometryInstance3D.ShadowCastingSetting.Off });
                part.AddChild(new MeshInstance3D { Mesh = pipeBowl, Position = new Vector3(0.2f, 0.025f, 0), CastShadow = GeometryInstance3D.ShadowCastingSetting.Off });
                break;
        }
        if (part == null) { holder.Free(); return null; }
        foreach (var n in World.BakedWorld.All(part))
            if (n is GeometryInstance3D g) g.CastShadow = GeometryInstance3D.ShadowCastingSetting.Off;
        holder.AddChild(part);
        return holder;
    }

    private readonly Skeleton3D sk;
    private readonly Dictionary<string, Node3D?> nodes = new();
    private readonly Dictionary<string, int> bones = new();
    private Node3D? dropped, carried;
    private Basis carriedBasis = Basis.Identity;
    private Vector3 carriedCentre;
    private float droppedFor;
    internal int Shown { get; private set; }

    internal People2Things(Skeleton3D sk) => this.sk = sk;

    private Node3D? Node(string model)
    {
        if (!nodes.TryGetValue(model, out var n))
        {
            n = Make(model);
            if (n != null) sk.AddChild(n);
            nodes[model] = n;
        }
        return n;
    }

    private int BoneOf(string name)
    {
        if (!bones.TryGetValue(name, out int b)) bones[name] = b = sk.FindBone(name);
        return b;
    }

    /// <summary>Place the things of a clip at time t (and the carried load when the clip has none of its own);
    /// hide the others. ratio: this body's hips over the clip body's; roll: the distance walked (a rolled cask).</summary>
    internal void Show(People2.Clip clip, float t, float ratio, string? load, float roll)
    {
        int shown = 0;
        foreach (var model in nodes.Keys) used[model] = false;
        foreach (var th in clip.Things)
        {
            var n = Node(th.Model);
            if (n == null) continue;
            n.Transform = Place(th, t, ratio, roll, out var size);
            Size(n, th.Model, size ?? th.Size);
            n.Visible = true;
            used[th.Model] = true;
            shown++;
        }
        // a load the clip does not move itself rides where the loads table says (the sack on the shoulder)
        if (load != null && !used.GetValueOrDefault(load) && People2Moves.Loads.TryGetValue(load, out var spec) && Has(load))
        {
            int bone = BoneOf(spec.Bone);
            var n = Node(load);
            if (n != null && bone >= 0)
            {
                n.Transform = sk.GetBoneGlobalPose(bone) * spec.Offset;
                Size(n, load, spec.Size);
                n.Visible = true;
                used[load] = true;
                shown++;
            }
        }
        foreach (var (model, n) in nodes)
            if (n != null && !used.GetValueOrDefault(model)) n.Visible = false;
        // the game's own load node (a crate, a box of fish, a keg) held against the belly
        if (carried != null && GodotObject.IsInstanceValid(carried) && load != null && !Has(load) && People2Moves.Loads.TryGetValue("crate", out var crate))
        {
            int bone = BoneOf(crate.Bone);
            if (bone >= 0)
            {
                var at = sk.GetBoneGlobalPose(bone) * crate.Offset;
                var b = new Basis(at.Basis.GetRotationQuaternion()) * carriedBasis;
                carried.Transform = new Transform3D(b, at.Origin - b * carriedCentre);
                shown++;
            }
        }
        Shown = shown;
    }

    private readonly Dictionary<string, bool> used = new();

    private Transform3D Place(Thing th, float t, float ratio, float roll, out Vector3? size)
    {
        size = null;
        if (th.Bone != null)
        {
            int bone = BoneOf(th.Bone);
            return bone >= 0 ? sk.GetBoneGlobalPose(bone) * th.Offset : Transform3D.Identity;
        }
        int st = th.Stride, n = th.Keys.Length / st;
        float f = Math.Clamp(t * 24f, 0, n - 1);
        int i = Math.Min(n - 2, (int)f);
        if (n < 2) i = 0;
        float u = n < 2 ? 0 : f - i;
        int a = i * st, b = Math.Min(n - 1, i + 1) * st;
        var k = th.Keys;
        var p = new Vector3(Mathf.Lerp(k[a + 1], k[b + 1], u), Mathf.Lerp(k[a + 2], k[b + 2], u), Mathf.Lerp(k[a + 3], k[b + 3], u)) * ratio;
        var qa = new Quaternion(k[a + 4], k[a + 5], k[a + 6], k[a + 7]).Normalized();
        var qb = new Quaternion(k[b + 4], k[b + 5], k[b + 6], k[b + 7]).Normalized();
        var q = qa.Slerp(qb, u);
        if (th.Roll) q = new Quaternion(Vector3.Right, roll / Math.Max(0.05f, th.Radius));
        if (st >= 11) size = new Vector3(Mathf.Lerp(k[a + 8], k[b + 8], u), Mathf.Lerp(k[a + 9], k[b + 9], u), Mathf.Lerp(k[a + 10], k[b + 10], u));
        return new Transform3D(new Basis(q), p);
    }

    /// <summary>The one sack scaled to its size now (length, thickness, width), its middle at the frame's origin.</summary>
    private static void Size(Node3D n, string model, Vector3 size)
    {
        if (model != "sack" || n.GetChildCount() == 0 || n.GetChild(0) is not MeshInstance3D m || m.Mesh == null) return;
        var box = m.Mesh.GetAabb().Size;
        if (box.X <= 0 || box.Y <= 0 || box.Z <= 0) return;
        m.Scale = new Vector3(size.X / box.X, size.Y / box.Y, size.Z / box.Z);
        m.Position = new Vector3(-0.07f * m.Scale.X, -size.Y / 2, 0);
    }

    /// <summary>The sack set down stays where it was put (in the world) until the docker takes up the next one, or
    /// for half a minute.</summary>
    internal void Drop()
    {
        if (!nodes.TryGetValue("sack", out var n) || n == null || !n.Visible || !GodotObject.IsInstanceValid(n)) return;
        DropClear();
        var at = n.GlobalTransform;
        nodes.Remove("sack");
        n.GetParent()?.RemoveChild(n);
        Main.I.View.AddChild(n);
        n.GlobalTransform = at;
        dropped = n;
        droppedFor = 30;
    }

    internal void Tick(float dt)
    {
        if (dropped == null) return;
        if ((droppedFor -= dt) <= 0) DropClear();
    }

    internal void DropClear()
    {
        if (dropped != null && GodotObject.IsInstanceValid(dropped)) dropped.QueueFree();
        dropped = null;
    }

    /// <summary>The game's load node for a load the kit has no model of its own for: it rides the belly.</summary>
    internal void Attach(Node3D? node)
    {
        carried = node;
        if (node == null) return;
        // its own turn kept (a keg lies on its side), its middle (the boxes of its meshes) where the hands hold it
        carriedBasis = node.Basis;
        var box = new Aabb();
        bool any = false;
        foreach (var n in World.BakedWorld.All(node))
            if (n is MeshInstance3D mi && mi.Mesh != null)
            {
                var t = Transform3D.Identity;
                if (mi != node)
                {
                    t = mi.Transform;
                    for (var up = mi.GetParent(); up != null && up != node; up = up.GetParent())
                        if (up is Node3D q) t = q.Transform * t;
                }
                var b = t * mi.Mesh.GetAabb();
                box = any ? box.Merge(b) : b;
                any = true;
            }
        carriedCentre = any ? box.GetCenter() : Vector3.Zero;
        node.GetParent()?.RemoveChild(node);
        sk.AddChild(node);
    }

    internal void HideAll()
    {
        foreach (var n in nodes.Values) if (n != null) n.Visible = false;
        Shown = 0;
    }

    internal void Dispose()
    {
        DropClear();
        foreach (var n in nodes.Values) if (n != null && GodotObject.IsInstanceValid(n)) n.QueueFree();
        nodes.Clear();
    }
}
