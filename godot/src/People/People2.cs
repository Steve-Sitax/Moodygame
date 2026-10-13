using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using Godot;
using Scheldemist.Models;
using Scheldemist.World;

namespace Scheldemist.People;

// Opt-in model routing and data prepared once, before any new body is drawn.
public static class People2
{
    public static bool Enabled { get; set; } = Array.IndexOf(OS.GetCmdlineUserArgs(), "--people2") >= 0;
    private static ModelLibrary.Model? model;
    private static bool tried;
    private static readonly Dictionary<string, string> map = new();
    internal static readonly Dictionary<string, Clip> Clips = new();
    internal static string[] BoneNames = Array.Empty<string>();
    internal static readonly Dictionary<string, (float hips, bool female, string style)> Bodies = new();
    private sealed record Held(string Model, string Socket, float Tilt, Vector3 Offset);
    private static readonly Dictionary<string, Held[]> held = new();
    private static readonly Dictionary<string, (string body, float handsHard)> kindBase = new();
    internal sealed class Clip
    {
        public Animation Animation = null!;
        public float Length, Cycle, Stride, Speed, Duty = 0.6f, Hips = 0.9118f;
        public bool Loop = true;
        public int[] RotationTracks = Array.Empty<int>();
        public int PositionTrack = -1;
    }
    internal static Mesh? PreparedMesh
    {
        get
        {
            if (model != null) foreach (var n in BakedWorld.All(model.Scene))
                if (n is MeshInstance3D mi && mi.Mesh != null) return mi.Mesh;
            return null;
        }
    }
    public static IEnumerable<string> Kinds
    {
        get { Load(); if (model != null) foreach (var k in model.Roots.Keys) if (Bodies.ContainsKey(k)) yield return "p2:" + k; }
    }
    public static IEnumerable<string> ClipNames { get { Load(); return Clips.Keys; } }
    internal static bool Has(string kind)
    {
        if (!Enabled) return false;
        Load();
        return model != null && Bodies.ContainsKey(Body(kind)) && model.Roots.ContainsKey(Body(kind));
    }
    private static string Body(string kind) => kind.StartsWith("p2:", StringComparison.Ordinal) ? kind[3..] : map.GetValueOrDefault(kind, kind);
    public static void Forget() { model?.Scene.Free(); model = null; tried = false; Clips.Clear(); Bodies.Clear(); held.Clear(); kindBase.Clear(); map.Clear(); HumanLayers.Forget(); People2Material.Forget(); People2Faces.Forget(); }
    public static void Load()
    {
        if (tried) return;
        tried = true;
        var args = OS.GetCmdlineUserArgs();
        int arg = Array.IndexOf(args, "--people2-map");
        if (arg >= 0 && arg + 1 < args.Length)
            foreach (string pair in args[arg + 1].Split(','))
            {
                var parts = pair.Split('=', 2);
                if (parts.Length == 2) map[parts[0]] = parts[1];
            }
        model = People2Material.Load();
        if (model == null) return;
        using var rig = JsonDocument.Parse(File.ReadAllText(Paths.Shared("peopleRig.json")));
        foreach (var b in rig.RootElement.GetProperty("bodies").EnumerateObject())
        {
            float hips = b.Value.GetProperty("hipsBone").GetSingle();
            bool female = b.Name.Contains("woman", StringComparison.Ordinal);
            string style = b.Name.StartsWith("old_", StringComparison.Ordinal) ? "old" : b.Name.StartsWith("child_", StringComparison.Ordinal) ? "child" : b.Name.EndsWith("stout", StringComparison.Ordinal) ? "stout" : female ? "woman" : "man";
            Bodies[b.Name] = (hips, female, style);
        }
        if (rig.RootElement.TryGetProperty("kinds", out var kinds))
            foreach (var kind in kinds.EnumerateObject())
            {
                Bodies[kind.Name] = Bodies[kind.Value.GetProperty("body").GetString()!];
                float hard = kind.Value.TryGetProperty("shapeKeys", out var sk) && sk.TryGetProperty("hands_hard", out var hh) ? hh.GetSingle() : 0;
                kindBase[kind.Name] = (kind.Value.GetProperty("body").GetString()!, hard);
                var items = new List<Held>();
                if (kind.Value.TryGetProperty("held", out var kit))
                    foreach (var item in kit.EnumerateArray())
                    {
                        string name = item.GetProperty("model").GetString()!, socket = item.GetProperty("socket").GetString()!;
                        // The truncheon is drawn only during future police actions, as the author's studio sheet.
                        if (name == "held_truncheon") continue;
                        float tilt = 0;
                        if (rig.RootElement.GetProperty("held").GetProperty("hang").TryGetProperty(name == "held_sabre" ? "held_scabbard" : name, out var hang))
                            tilt = hang.GetProperty("tiltBackDeg").GetSingle();
                        var offset = Vector3.Zero;
                        if (name == "held_sabre")
                        {
                            var a = rig.RootElement.GetProperty("held").GetProperty("sheathed").GetProperty("offset");
                            offset = new Vector3(a[0].GetSingle(), a[1].GetSingle(), a[2].GetSingle());
                        }
                        items.Add(new Held(name, socket, tilt, offset));
                    }
                held[kind.Name] = items.ToArray();
            }
        var meta = rig.RootElement.GetProperty("locomotion").GetProperty("clips");
        // All skeletons have the same names; tracks from the source armature are rebound by name.
        var reference = model.Roots["man_middling"].GetNode<Skeleton3D>("Skeleton3D");
        BoneNames = new string[reference.GetBoneCount()];
        for (int b = 0; b < BoneNames.Length; b++) BoneNames[b] = reference.GetBoneName(b);
        foreach (var (name, animation) in model.Clips)
        {
            if (name == "RESET") continue;
            var c = new Clip { Animation = animation, Length = (float)animation.Length, RotationTracks = new int[reference.GetBoneCount()] };
            Array.Fill(c.RotationTracks, -1);
            for (int t = 0; t < animation.GetTrackCount(); t++)
            {
                string path = animation.TrackGetPath(t).ToString();
                int colon = path.LastIndexOf(':');
                int bone = colon >= 0 ? reference.FindBone(path[(colon + 1)..]) : -1;
                if (bone < 0) continue;
                if (animation.TrackGetType(t) == Animation.TrackType.Rotation3D) c.RotationTracks[bone] = t;
                else if (bone == reference.FindBone("hips") && animation.TrackGetType(t) == Animation.TrackType.Position3D) c.PositionTrack = t;
            }
            if (meta.TryGetProperty(name, out var m))
            {
                c.Loop = m.GetProperty("loop").GetBoolean();
                if (m.TryGetProperty("cycle", out var cycle)) c.Cycle = cycle.GetSingle();
                if (m.TryGetProperty("stride", out var stride)) c.Stride = stride.GetSingle();
                if (m.TryGetProperty("speed", out var speed)) c.Speed = speed.GetSingle();
                if (m.TryGetProperty("duty", out var duty)) c.Duty = duty.GetSingle();
                c.Hips = Bodies[m.GetProperty("body").GetString()!].hips;
            }
            Clips[name] = c;
        }
        foreach (var root in model.Roots.Values)
        {
            root.Position = Vector3.Zero;
            foreach (var n in BakedWorld.All(root))
                if (n is MeshInstance3D mi)
                {
                    mi.CastShadow = GeometryInstance3D.ShadowCastingSetting.Off;
                    if (mi.Name.ToString().EndsWith("_lod0", StringComparison.Ordinal)) mi.VisibilityRangeEnd = 15;
                    if (mi.Name.ToString().EndsWith("_lod1", StringComparison.Ordinal)) mi.VisibilityRangeBegin = 15;
                }
        }
    }
    internal static Human? Make(string kind)
    {
        Load();
        string body = Body(kind);
        if (!Bodies.ContainsKey(body)) return null;
        if (model?.Copy(body) is not { } root) return null;
        People2Material.Assign(root, body);
        var sk = root.GetNode<Skeleton3D>("Skeleton3D");
        float height = sk.GetBoneRest(sk.FindBone("hips")).Origin.Y;
        bool female = Humans.Women.Contains(kind);
        string style = height < 0.75f ? "child" : kind.StartsWith("old_", StringComparison.Ordinal) ? "old" : female ? "woman" : "man";
        var info = Bodies.GetValueOrDefault(body, (height, female, style));
        var runtime = new Human2(kind, root, info);
        if (held.TryGetValue(body, out var items) && model.Roots.TryGetValue("people2_held", out var props))
            foreach (var item in items)
                if (props.GetNodeOrNull<Node3D>(item.Model) is { } source)
                {
                    var attachment = new BoneAttachment3D { Name = item.Model + "_socket", BoneName = item.Socket, BoneIdx = sk.FindBone(item.Socket) };
                    sk.AddChild(attachment);
                    var copy = (Node3D)source.Duplicate();
                    copy.Position = new Basis(Vector3.Right, Mathf.DegToRad(item.Tilt)) * item.Offset;
                    copy.Rotation = new Vector3(Mathf.DegToRad(item.Tilt), 0, 0);
                    People2Material.Assign(copy, "people2_held");
                    attachment.AddChild(copy);
                }
        var human = new Human(kind, root, new AnimationLibrary(), new Dictionary<string, float>(), info.Item1 / 0.95f, runtime);
        // who this is for the face recipe: the requested kind, the base body that carries the hair pieces
        var (baseBody, handsHard) = kindBase.GetValueOrDefault(body, (body, 0f));
        root.SetMeta("people2_kind", kind.StartsWith("p2:", StringComparison.Ordinal) ? kind[3..] : kind);
        root.SetMeta("people2_body", baseBody);
        root.SetMeta("people2_female", female || info.Item2);
        root.SetMeta("people2_hands_hard", handsHard);
        People2Faces.Next(human);
        return human;
    }
}
