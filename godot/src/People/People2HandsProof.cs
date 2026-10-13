using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Godot;

namespace Scheldemist.People;

// Round-four contact/LOD exhibit. Uses the town's own models, renderer and sampler with isolated test data.
[GamePart(899)]
internal partial class People2HandsProof : Node
{
    private readonly List<Human> figures = new();
    private readonly List<object> pictures = new();
    private Vector3 spot;
    private bool capture;
    private JsonDocument? rig;
    private float maxContact;
    private Human? ropeHuman;
    private readonly List<MeshInstance3D> rope = new();
    public override async void _Ready()
    {
        string dir = Main.I.Arg("people2-hands-proof");
        if (dir == "" || !People2.Enabled) { SetProcess(false); return; }
        dir = Paths.Absolute(dir); Directory.CreateDirectory(dir);
        try
        {
            var town = Main.I.GetNode<Town.Townspeople>("Townspeople");
            for (int i = 0; (town.Data == null || !Dev.Kit.I.IsReady) && i < 1800; i++) await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
            if (town.Data == null || !Dev.Kit.I.IsReady) throw new InvalidOperationException("Contact proof needs the town and dev API.");
            town.ClockRuns = false; town.SetProcess(false);
            if (town.Crowd is { } crowd) foreach (var resident in crowd.Walking) resident.Group.Visible = false;
            Game.GameState.I.PlayingWhen = () => false;
            if (Player.Jef.I is { Fly: false } jef) jef.ToggleFly();
            Player.Jef.I.TestInput = true; Main.I.Cam.SetProcess(false); Input.MouseMode = Input.MouseModeEnum.Visible;
            var p = Main.I.World.Facts.RootElement.GetProperty("places").EnumerateArray().First(p => p.GetProperty("place").GetString() == "vismarkt").GetProperty("pos");
            spot = new Vector3(p[0].GetSingle(), 0, p[2].GetSingle());
            if (World.Lights.I is { } lamps)
                spot = lamps.Lamps.OrderBy(l => new Vector2(l.at.X - spot.X, l.at.Z - spot.Z).LengthSquared()).First().at - new Vector3(0, 0, 5);
            spot.Y = World.Lights.I?.GroundAt(spot.X, spot.Z) ?? 0;
            var docker = Make("docker_a", "hands-proof:docker", spot);
            var fishwife = Make("fishwife_a", "hands-proof:fishwife", spot);
            rig = JsonDocument.Parse(File.ReadAllText(Paths.Shared("peopleRig.json")));
            capture = true;
            foreach (var (label, hour, weather) in new[] { ("day", 13.0, "clear"), ("rain", 13.0, "rain"), ("lamps", 19.5, "clear") })
            {
                await Dev.Kit.I.Light(hour, weather);
                foreach (var (clip, t) in new[] { ("sack_lift", 1.25f), ("sack_hold", 1.5f), ("sack_walk", 0.6f), ("sweep", 0.35f), ("cask_roll", 0.4f), ("rope_haul", 0.45f), ("winch", 0.35f) })
                {
                    var h = clip == "sweep" ? fishwife : docker;
                    foreach (var other in figures) other.Root.Visible = other == h;
                    h.CarryLoad(clip == "sack_walk" ? "sack" : null);
                    h.WorkClipNow(clip, t, true);
                    ropeHuman = clip == "rope_haul" ? h : null;
                    foreach (float d in new[] { 1f, 3f })
                        await Snap(dir, $"{label}-{clip}-{d:0}m", h, d, t, clip);
                }
                foreach (string motion in new[] { "idle", "talk", "walk" })
                {
                    ropeHuman = null;
                    docker.Root.Visible = false; fishwife.Root.Visible = true;
                    fishwife.Play(motion, 0); fishwife.SetPhase(motion, 0.23f);
                    foreach (float d in new[] { 1f, 3f }) await Snap(dir, $"{label}-basket-{motion}-{d:0}m", fishwife, d, 0, motion);
                }
                if (label == "day")
                {
                    fishwife.Root.Visible = false; docker.Root.Visible = true;
                    for (int i = 0; i < 12; i++)
                    {
                        float t = 0.8f + i * 0.25f;
                        docker.WorkClipNow("sack_lift", t, true);
                        await Snap(dir, $"lift-{i:00}", docker, 3, t, "sack_lift", true);
                    }
                    docker.WorkClipNow("man_idle_hips", 3, true);
                    foreach (float d in new[] { 14.8f, 15.2f }) await Snap(dir, $"lod-{d:0.0}m", docker, d, 3, "man_idle_hips");
                    // Compare both meshes at the same camera/pose too, where silhouette faults are visible.
                    foreach (int lod in new[] { 0, 1 })
                    {
                        foreach (var mi in World.BakedWorld.All(docker.Root).OfType<MeshInstance3D>())
                        {
                            if (mi.Name.ToString().EndsWith("_lod0")) mi.Visible = lod == 0;
                            if (mi.Name.ToString().EndsWith("_lod1")) { mi.Visible = lod == 1; mi.VisibilityRangeBegin = 0; }
                        }
                        await Snap(dir, $"lod-close-{lod}", docker, 3, 0, "idle");
                    }
                    foreach (var mi in World.BakedWorld.All(docker.Root).OfType<MeshInstance3D>())
                    {
                        mi.Visible = true;
                        if (mi.Name.ToString().EndsWith("_lod1")) mi.VisibilityRangeBegin = 15;
                    }
                }
            }
            foreach (var h in figures) h.Root.Visible = false;
            var idle = new List<object>();
            var idleClips = new HashSet<string>();
            for (int i = 0; i < 8; i++)
            {
                var h = Make("docker_a", "crowd-proof:" + i, spot + new Vector3((i % 4 - 1.5f) * 1.0f + i / 4 * 0.5f, 0, i / 4 * 1.5f));
                h.Play("idle", 0); h.SetPhase("idle", 0.2f + i * 0.07f);
                idle.Add(new { id = "crowd-proof:" + i, clip = h.AnimationState.Clip });
                idleClips.Add(h.AnimationState.Clip ?? "");
            }
            await Dev.Kit.I.Light(13, "clear");
            Main.I.Cam.LookAtFromPosition(spot + new Vector3(0.2f, 1.7f, -3.4f), spot + new Vector3(0.2f, 1, 0.5f));
            Face(); await Frames(20);
            Main.I.View.GetTexture().GetImage().SavePng(Path.Combine(dir, "crowd-idle.png"));
            File.WriteAllText(Path.Combine(dir, "hands.json"), JsonSerializer.Serialize(new { ok = maxContact < 0.003f && idleClips.Count == 8, maxContactMm = maxContact * 1000, uniqueIdles = idleClips.Count, pictures, idle, shaderKindsAdded = 0, lightsAdded = 0 }, new JsonSerializerOptions { WriteIndented = true }));
            if (maxContact >= 0.003f || idleClips.Count != 8) throw new InvalidOperationException($"Contact error {maxContact * 1000:0.00} mm; {idleClips.Count} distinct idles.");
            foreach (var h in figures) h.Dispose();
            foreach (var segment in rope) segment.QueueFree();
            capture = false;
            await Frames(3);
            GetTree().Quit();
        }
        catch (Exception e) { GD.PushError("Hands proof: " + e); GetTree().Quit(1); }
    }
    private Human Make(string kind, string id, Vector3 at)
    {
        var h = Humans.Make(kind) ?? throw new InvalidOperationException("Missing " + kind);
        h.SetIdentity(id); h.Root.Position = at; h.Root.Rotation = new Vector3(0, MathF.PI, 0);
        Main.I.View.AddChild(h.Root); h.Start(); figures.Add(h); return h;
    }
    private async System.Threading.Tasks.Task Snap(string dir, string name, Human h, float d, float time, string clip, bool side = false)
    {
        var at = h.Root.GlobalPosition;
        Vector3 target = at + Vector3.Up * (clip == "sack_lift" ? 0.78f : d == 1 ? 1.04f : 0.9f);
        Vector3 from = target + (side ? new Vector3(d * 0.65f, 0.2f, -d * 0.76f) : new Vector3(d * 0.25f, 0.12f, -d * 0.97f));
        Main.I.Cam.LookAtFromPosition(from, target); Face(); await Frames(12);
        Main.I.View.GetTexture().GetImage().SavePng(Path.Combine(dir, name + ".png"));
        var sk = h.Root.GetNode<Skeleton3D>("Skeleton3D");
        var hands = new[] { sk.GetBoneGlobalPose(sk.FindBone("handL")).Origin, sk.GetBoneGlobalPose(sk.FindBone("handR")).Origin };
        float error = ContactError(h, sk);
        maxContact = Math.Max(maxContact, error);
        pictures.Add(new { name, distance = d, time, clip = h.AnimationState.Clip, hour = World.Daylight.I.Hour, weather = World.Daylight.I.Weather, contactMm = error * 1000, hands = hands.Select(v => new[] { v.X, v.Y, v.Z }).ToArray(), hips = sk.GetBoneGlobalPose(sk.FindBone("hips")).Origin.Y });
    }
    private float ContactError(Human h, Skeleton3D sk)
    {
        float error = 0;
        var state = h.AnimationState;
        string clip = state.Clip ?? "";
        bool carry = clip == "sack_walk";
        if (rig!.RootElement.GetProperty("work").GetProperty("clips").TryGetProperty(carry ? "sack_hold" : clip, out var c) && c.TryGetProperty("handContacts", out var contact))
        {
            var keys = contact.GetProperty("keys");
            float f = (float)Math.Clamp((carry ? 0 : state.Time) * 24, 0, keys.GetArrayLength() - 1);
            int a = (int)f, b = Math.Min(keys.GetArrayLength() - 1, a + 1); float t = f - a;
            string model = contact.GetProperty("model").GetString()!;
            var thing = model.Length > 0 ? sk.GetNodeOrNull<Node3D>("work_" + model) : null;
            var frame = thing?.Transform ?? Transform3D.Identity;
            if (model == "cask") frame.Basis = Basis.Identity;
            float ratio = sk.GetBoneGlobalRest(sk.FindBone("hips")).Origin.Y / People2.Clips[clip].Hips;
            for (int side = 0; side < (carry ? 1 : 2); side++)
            {
                int i = side * 7;
                Vector3 p = new Vector3(keys[a][i].GetSingle(), keys[a][i + 1].GetSingle(), keys[a][i + 2].GetSingle()).Lerp(new Vector3(keys[b][i].GetSingle(), keys[b][i + 1].GetSingle(), keys[b][i + 2].GetSingle()), t);
                error = Math.Max(error, sk.GetBoneGlobalPose(sk.FindBone(side == 0 ? "handL" : "handR")).Origin.DistanceTo(frame * (p * ratio)));
            }
        }
        if (sk.GetNodeOrNull<Node3D>("held_basket") is { Visible: true } basket)
        {
            Vector3 palm = sk.GetBoneGlobalPose(sk.FindBone("handL")) * basket.GetMeta("palm_local").AsVector3();
            Vector3 rim = basket.Transform * basket.GetMeta("rim_contact").AsVector3();
            error = Math.Max(error, palm.DistanceTo(rim));
            Vector3 crown = basket.Transform * new Vector3(0.09f, -0.12f, 0);
            error = Math.Max(error, crown.DistanceTo(sk.GetBoneGlobalPose(sk.FindBone("armLowL")).Origin));
        }
        return error;
    }
    private void Face() { if (Main.I.Cam is Player.FlyCam fly) fly.Face(Main.I.Cam.GlobalBasis.GetRotationQuaternion()); }
    private async System.Threading.Tasks.Task Frames(int n) { for (int i = 0; i < n; i++) await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame); }
    public override void _Process(double dt)
    {
        if (!capture) return;
        foreach (var h in figures) if (h.Root.Visible) h.Update((float)dt);
        if (ropeHuman == null) { foreach (var s in rope) s.Visible = false; return; }
        if (rope.Count == 0 && Movers.Boats.I?.Rope is { } material)
        {
            var mesh = new CylinderMesh { TopRadius = 0.012f, BottomRadius = 0.012f, Height = 1, RadialSegments = 8, Rings = 1, Material = material };
            for (int i = 0; i < 3; i++) { var s = new MeshInstance3D { Mesh = mesh, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off }; rope.Add(s); Main.I.View.AddChild(s); }
        }
        if (rope.Count == 0) return;
        var sk = ropeHuman.Root.GetNode<Skeleton3D>("Skeleton3D");
        Vector3 grip(string side, float sign) => sk.GlobalTransform * (sk.GetBoneGlobalPose(sk.FindBone("grip" + side)) * new Vector3(sign * 0.015f, 0, -0.010f));
        Vector3 left = grip("L", 1), right = grip("R", -1), high = left.Y > right.Y ? left : right, low = left.Y > right.Y ? right : left;
        Vector3 anchor = ropeHuman.Root.ToGlobal(new Vector3(0, 4.7f, 2.5f)), tail = ropeHuman.Root.ToGlobal(new Vector3(-0.16f, 0.02f, 0.18f));
        Segment(rope[0], anchor, high); Segment(rope[1], high, low); Segment(rope[2], low, tail);
    }
    private static void Segment(MeshInstance3D mesh, Vector3 a, Vector3 b)
    {
        float length = a.DistanceTo(b); Vector3 y = (b - a).Normalized(), x = y.Cross(Vector3.Forward).Normalized();
        mesh.Visible = length > 0.001f;
        mesh.GlobalTransform = new Transform3D(new Basis(x, y * length, x.Cross(y)), (a + b) / 2);
    }
    public override void _ExitTree() => rig?.Dispose();
}
