using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Town;

namespace Scheldemist.People;

// Loads and work poses (issues #148 #130 #151 #131 #129 #169 #172 #128 #132), --carry-proof <dir>
// [--carry-proof-only loads,ride,...]: the real crowd, kits and town staged on the quays, measured (one load per
// person, hands on what they hold, knees on the ground, hands at the work) and photographed close at 13:00 clear.
// Writes carry.json; exits 1 when a check fails.
[GamePart(901)]
internal partial class CarryProof : Node
{
    private string dir = "";
    private readonly List<object> checks = new();
    private readonly List<string> pictures = new();
    private readonly Dictionary<string, object> facts = new();
    private int failed;
    private Townspeople town = null!;
    private Crowd crowd = null!;

    public override async void _Ready()
    {
        dir = Main.I.Arg("carry-proof");
        if (dir == "") { SetProcess(false); return; }
        dir = Paths.Absolute(dir);
        Directory.CreateDirectory(dir);
        string[] stages = Main.I.Arg("carry-proof-only", "loads,ride,grinder,fish,scrub").Split(',', StringSplitOptions.RemoveEmptyEntries);
        try
        {
            town = Main.I.GetNode<Townspeople>("Townspeople");
            for (int i = 0; (town.Data == null || town.Crowd == null) && i < 3600; i++) await Frame();
            for (int i = 0; !Dev.Kit.I.IsReady && i < 1800; i++) await Frame();
            if (town.Data == null || town.Crowd == null || !Dev.Kit.I.IsReady) throw new InvalidOperationException("The carry proof needs the native town and the dev API.");
            crowd = town.Crowd;
            Game.GameState.I.PlayingWhen = () => false;
            if (Player.Jef.I is { Fly: false } jef) jef.ToggleFly();
            Player.Jef.I.TestInput = true;
            Main.I.Cam.SetProcess(false);
            Input.MouseMode = Input.MouseModeEnum.Visible;
            foreach (string stage in stages)
            {
                try
                {
                    GD.Print("carry proof: " + stage);
                    switch (stage)
                    {
                        case "loads": await Loads(); break;
                        case "ride": await Ride(); break;
                        case "grinder": await Grinder(); break;
                        case "fish": await Fish(); break;
                        case "scrub": await Scrub(); break;
                        case "clips": Clips(); break;
                        case "crane": await Crane(); break;
                        case "work": await Work132(); break;
                        case "piles": await Piles(); break;
                        case "works": await Works(); break;
                        case "held": await Held(); break;
                        case "goods": await Goods151(); break;
                        default: Check(stage + " is a known stage", false); break;
                    }
                }
                catch (Exception e) { Check(stage + " ran", false, e.ToString()); }
            }
        }
        catch (Exception e) { Check("carry proof ran", false, e.ToString()); }
        try
        {
            var options = new JsonSerializerOptions { WriteIndented = true, NumberHandling = System.Text.Json.Serialization.JsonNumberHandling.AllowNamedFloatingPointLiterals };
            File.WriteAllText(Path.Combine(dir, "carry.json"), JsonSerializer.Serialize(new { ok = failed == 0, failed, checks, facts, pictures }, options));
        }
        catch (Exception e) { failed++; GD.PrintErr("carry proof: the report failed: " + e.Message); }
        GD.Print(failed == 0 ? "carry proof: PASS" : $"carry proof: FAIL ({failed})");
        GetTree().Quit(failed == 0 ? 0 : 1);
    }

    private SignalAwaiter Frame() => ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
    private async Task Frames(int n) { for (int i = 0; i < n; i++) await Frame(); }
    private async Task Seconds(double s) { ulong end = Time.GetTicksMsec() + (ulong)(s * 1000); while (Time.GetTicksMsec() < end) await Frame(); }

    private void Check(string name, bool ok, object? detail = null)
    {
        checks.Add(new { name, ok, detail });
        if (!ok) { failed++; GD.PrintErr("carry proof check failed: " + name + " " + detail); }
    }

    private async Task Look(Vector3 eye, Vector3 at, int settle = 12)
    {
        Main.I.Cam.LookAtFromPosition(eye, at, Vector3.Up);
        if (Main.I.Cam is Player.FlyCam fly) fly.Face(Main.I.Cam.GlobalBasis.GetRotationQuaternion());
        await Frames(settle);
    }

    private async Task Shot(string name, Vector3 eye, Vector3 at, int settle = 20)
    {
        await Look(eye, at, settle);
        using var image = Main.I.View.GetTexture().GetImage();
        string path = Path.Combine(dir, name + ".png");
        if (image.SavePng(path) != Error.Ok) throw new IOException(path);
        pictures.Add(name + ".png");
    }

    /// <summary>The picture's light: 13:00 clear, whatever hour the town's clock keeps for the work.</summary>
    private static void DayLook() { World.Daylight.I.SetTime(13); World.Daylight.I.SetWeather("clear"); World.Daylight.I.Settle(); }

    private static float Ground(float x, float z)
    {
        float g = World.Lights.I?.GroundAt(x, z) ?? 0;
        return float.IsFinite(g) ? g : 0;
    }

    /// <summary>The real ground under a point (the first solid hit going down from just above it).</summary>
    private static float GroundUnder(Vector3 p)
    {
        var space = Main.I.View.FindWorld3D().DirectSpaceState;
        var hit = space.IntersectRay(PhysicsRayQueryParameters3D.Create(p + Vector3.Up * 0.6f, p + Vector3.Down * 3, World.Solid.Layer));
        return hit.Count > 0 ? ((Vector3)hit["position"]).Y : Ground(p.X, p.Z);
    }

    private static Vector3 Fwd(double yaw) => new((float)Math.Sin(yaw), 0, (float)Math.Cos(yaw));
    private static Vector3 Side(double yaw) => new((float)Math.Cos(yaw), 0, -(float)Math.Sin(yaw));

    // ------------------------------------------------------------------ one load per person (#148)

    /// <summary>Every load drawn on a person now: the kit's things on the skeleton, any other node hung on it,
    /// the nodes in the person's group beside the body (the old kit's loads, a purchase).</summary>
    private static List<string> LoadsOn(Puppet p)
    {
        var list = new List<string>();
        var sk = p.Human.Root.GetNodeOrNull<Skeleton3D>("Skeleton3D");
        if (sk != null)
            foreach (var n in sk.GetChildren())
            {
                if (n is not Node3D n3 || !n3.Visible || n is MeshInstance3D { Skin: not null } || n is BoneAttachment3D) continue;
                if (n3.Name.ToString().StartsWith("held_", StringComparison.Ordinal)) continue;
                if (!BakedWorld(n3).Any(g => g.Visible)) continue;
                list.Add(n3.Name.ToString());
            }
        foreach (var n in p.Group.GetChildren())
            if (n is Node3D n3 && n3 != p.Human.Root && n3.Visible && BakedWorld(n3).Any(g => g.Visible)) list.Add("group:" + n3.Name);
        return list;
    }

    private static IEnumerable<GeometryInstance3D> BakedWorld(Node n) => World.BakedWorld.All(n).OfType<GeometryInstance3D>();

    private static Aabb? WorldBox(Node3D n)
    {
        Aabb? box = null;
        foreach (var m in World.BakedWorld.All(n).OfType<MeshInstance3D>())
        {
            if (m.Mesh == null || !m.IsVisibleInTree()) continue;
            var b = m.GlobalTransform * m.Mesh.GetAabb();
            box = box is { } a ? a.Merge(b) : b;
        }
        return box;
    }

    private static float Outside(Aabb box, Vector3 p)
    {
        var c = p.Clamp(box.Position, box.End);
        return c.DistanceTo(p);
    }

    /// <summary>How far each hand's grip is from a held load's box (0: on or in it).</summary>
    private static (float l, float r) HandGap(Puppet p)
    {
        if (p.LoadNode == null || WorldBox(p.LoadNode) is not { } box) return (-1, -1);
        float Gap(string bone) => p.Human.Socket(bone) is { } at ? Outside(box, at) : -1;
        return (Gap("gripL"), Gap("gripR"));
    }

    private Vector3 QuaySpot()
    {
        // open quay beside haul route rk-m (the work proof's stretch)
        var r = HaulRoute.All.First(x => x.Id == "rk-m");
        double yaw = r.AYaw;
        var p = new Vector3((float)r.A.X, 0, (float)r.A.Z) + Side(yaw) * 6 - Fwd(yaw) * 2;
        for (int k = 0; k < 40 && !crowd.CanStand(p.X, p.Z); k++) p += Side(yaw) * 0.5f;
        p.Y = Ground(p.X, p.Z);
        return p;
    }

    private async Task Loads()
    {
        await Dev.Kit.I.Light(13, "clear");
        town.ClockRuns = false;
        var at = QuaySpot();
        var route = HaulRoute.All.First(x => x.Id == "rk-m");
        double yaw = route.AYaw + Math.PI / 2;
        await Look(at + Fwd(yaw) * 4 + Vector3.Up * 2, at + Vector3.Up, 30);
        var a = crowd.AddPuppet("docker_a", at.X, at.Z, yaw, size: 1);
        if (a == null) { Check("a docker is made", false); return; }
        a.Human.SetIdentity("carryproof:a");
        crowd.PuppetStand(a, "idle", yaw);
        int glass = Play.CrateModel.LabelFor("haul:rk-wa:0");
        // 1 a crate in both arms
        crowd.PuppetLoad(a, true, "crate", glass);
        await Seconds(1.0);
        var gap = HandGap(a);
        var loads = LoadsOn(a);
        Check("crate: one load drawn", loads.Count == 1, loads);
        Check("crate: both hands on the crate (within 6 cm)", gap.l is >= 0 and < 0.06f && gap.r is >= 0 and < 0.06f, new { gap.l, gap.r, clip = a.Human.AnimationState.Clip });
        await Shot("loads-crate-hold", a.Group.GlobalPosition + Fwd(yaw) * 2.2f + Side(yaw) * 1.2f + Vector3.Up * 1.5f, a.Group.GlobalPosition + Vector3.Up * 1.0f);
        // 2 every other motion keeps the hands on the load
        foreach (string motion in new[] { "point", "smoke", "call", "behind", "pockets", "talk", "sit" })
        {
            crowd.PuppetStand(a, motion, yaw);
            await Seconds(0.8);
            var g = HandGap(a);
            Check($"crate while '{motion}': hands stay on it", g.l is >= 0 and < 0.06f && g.r is >= 0 and < 0.06f, new { g.l, g.r, clip = a.Human.AnimationState.Clip });
        }
        crowd.PuppetStand(a, "idle", yaw);
        // 3 a sack taken up while holding the crate: the crate goes, one sack on the shoulder
        crowd.PuppetLoad(a, true, "sack");
        await Seconds(1.0);
        loads = LoadsOn(a);
        Check("crate then sack: one load (the sack)", loads.Count == 1 && a.Human.Carrying == "sack" && a.LoadNode == null, loads);
        await Shot("loads-sack-after-crate", a.Group.GlobalPosition + Fwd(yaw) * 2.2f - Side(yaw) * 1.2f + Vector3.Up * 1.5f, a.Group.GlobalPosition + Vector3.Up * 1.1f);
        // 4 a body back in the pool with a crate in its arms comes out empty-handed
        crowd.PuppetLoad(a, true, "crate", glass);
        await Seconds(0.5);
        crowd.RemovePuppet(a);
        await Frames(3);
        var b = crowd.AddPuppet("docker_a", at.X, at.Z, yaw, size: 1);
        if (b == null) { Check("a pooled docker is made again", false); return; }
        crowd.PuppetStand(b, "idle", yaw);
        await Seconds(0.8);
        loads = LoadsOn(b);
        Check("pooled body: no load left from its last owner", loads.Count == 0 && b.Human.Carrying == null, loads);
        crowd.PuppetLoad(b, true, "sack");
        await Seconds(1.0);
        loads = LoadsOn(b);
        Check("pooled body then a sack: one load", loads.Count == 1, loads);
        await Shot("loads-pooled-sack", b.Group.GlobalPosition + Fwd(yaw) * 2.4f + Side(yaw) * 0.6f + Vector3.Up * 1.5f, b.Group.GlobalPosition + Vector3.Up * 1.1f);
        // 5 a job's own crate (its stencil) handed over: held like a made crate, the old load gone
        var item = Play.CrateModel.Make(Play.CrateModel.LabelFor("job:9"), false, Play.CrateModel.Class["small"]);
        if (item != null)
        {
            Main.I.View.AddChild(item);
            crowd.PuppetLoad(b, true, "crates", node: item);
            await Seconds(1.0);
            loads = LoadsOn(b);
            var g = HandGap(b);
            Check("a job's own crate: one load, hands on it", loads.Count == 1 && b.LoadNode == item && g.l is >= 0 and < 0.06f && g.r is >= 0 and < 0.06f, new { loads, g.l, g.r });
            await Shot("loads-job-crate", b.Group.GlobalPosition + Fwd(yaw) * 2.2f + Side(yaw) * 1.4f + Vector3.Up * 1.4f, b.Group.GlobalPosition + Vector3.Up * 1.0f);
        }
        // 6 a purchase is put away while both arms carry
        crowd.PuppetLoad(b, false);
        crowd.PuppetCarry(b, "parcel");
        await Seconds(0.6);
        crowd.PuppetLoad(b, true, "keg");
        await Seconds(1.0);
        loads = LoadsOn(b);
        Check("purchase and a keg: one load shown", loads.Count == 1, loads);
        await Shot("loads-keg", b.Group.GlobalPosition + Fwd(yaw) * 2.2f + Side(yaw) * 1.4f + Vector3.Up * 1.4f, b.Group.GlobalPosition + Vector3.Up * 1.0f);
        crowd.PuppetLoad(b, false);
        await Seconds(1.5);
        loads = LoadsOn(b);
        Check("keg put down: the purchase back, nothing else", loads.Count == 1 && loads[0].Contains("purchase"), loads);
        crowd.RemovePuppet(b);
    }

    // ------------------------------------------------------------------ the rider's hands (#172)

    private async Task Ride()
    {
        await Dev.Kit.I.Light(13, "clear");
        town.ClockRuns = false;
        var at = QuaySpot();
        var route = HaulRoute.All.First(x => x.Id == "rk-m");
        double yaw = route.AYaw + Math.PI / 2;
        await Look(at + Side(yaw) * 4 + Vector3.Up * 2, at + Vector3.Up, 30);
        var p = crowd.AddPuppet("gentleman", at.X, at.Z, yaw, size: 1);
        if (p == null) { Check("a rider is made", false); return; }
        crowd.PuppetVehicle(p, 1);
        await Seconds(1.5);
        var bike = crowd.PuppetVehicleNode(p);
        if (bike == null) { Check("the rider has a bicycle", false); return; }
        var steer = World.BakedWorld.All(bike).OfType<Node3D>().FirstOrDefault(n => n.Name == "velocipede_steer");
        Vector3 Grip(float x) => steer?.ToGlobal(new Vector3(x, .626f, -.11f)) ?? bike.ToGlobal(new Vector3(x, 1.086f, .45f));
        var worst = 0f;
        for (int k = 0; k < 8; k++)
        {
            crowd.PuppetGo(p, at.X + Fwd(yaw).X * 6 * ((k % 2) * 2 - 1), at.Z + Fwd(yaw).Z * 6 * ((k % 2) * 2 - 1), 2.5);
            await Seconds(0.4);
            float l = p.Human.Socket("gripL") is { } gl ? gl.DistanceTo(Grip(.36f)) : 9, r = p.Human.Socket("gripR") is { } gr ? gr.DistanceTo(Grip(-.36f)) : 9;
            worst = Math.Max(worst, Math.Max(l, r));
        }
        float wristL = p.Human.Hand(false)?.DistanceTo(Grip(.36f)) ?? 9, wristR = p.Human.Hand(true)?.DistanceTo(Grip(-.36f)) ?? 9;
        facts["ride"] = new { gripSocketWorstM = worst, wristToGripL = wristL, wristToGripR = wristR };
        Check("rider: both grip sockets on the handlebar grips (within 3 cm) while riding", worst < 0.03f, new { worst });
        crowd.PuppetStand(p, "idle", p.Yaw);
        await Seconds(0.5);
        var c = p.Group.GlobalPosition;
        await Shot("ride-side", c + Side(p.Yaw) * 2.2f + Fwd(p.Yaw) * 0.4f + Vector3.Up * 1.4f, c + Vector3.Up * 1.0f + Fwd(p.Yaw) * 0.3f);
        await Shot("ride-front", c + Fwd(p.Yaw) * 2.4f + Side(p.Yaw) * 0.6f + Vector3.Up * 1.6f, c + Vector3.Up * 1.0f);
        crowd.PuppetVehicle(p, 0);
        crowd.RemovePuppet(p);
    }

    // ------------------------------------------------------------------ the grinder and the fish table (#129)

    private async Task Grinder()
    {
        var grinder = town.Sims.FirstOrDefault(s => s.R.Trade == "grinder");
        if (grinder == null) { Check("a grinder lives in town", false); return; }
        var work = grinder.R.Sched.Day.First(seg => seg.Act == "work");
        double hour = (work.A + work.B) / 2;
        await Dev.Kit.I.Light(hour, "clear");
        town.ClockRuns = true;
        var start = grinder.R.Work.Route![0];
        await Look(new Vector3((float)start.X + 4, Ground((float)start.X, (float)start.Z) + 1.6f, (float)start.Z + 4), new Vector3((float)start.X, 1, (float)start.Z), 10);
        town.Refill();
        Puppet? p = null;
        Node3D? kit = null;
        for (int i = 0; i < 6000; i++)
        {
            await Frame();
            p = grinder.P;
            if (p != null) Main.I.Cam.LookAtFromPosition(p.Group.GlobalPosition + Side(p.Yaw) * 3.5f + Vector3.Up * 1.8f, p.Group.GlobalPosition + Vector3.Up);
            else Main.I.Cam.Position = new Vector3((float)grinder.X + 4, Ground((float)grinder.X, (float)grinder.Z) + 1.6f, (float)grinder.Z + 4);
            kit = Main.I.View.GetNodeOrNull<Node3D>("street_trade_" + grinder.R.Id);
            if (p != null && kit != null && p.Human.Motion == "grind" && !crowd.PuppetBusy(p) && i > 120) break;
            if (i % 600 == 599) town.Refill();
        }
        if (p == null || kit == null || p.Human.Motion != "grind") { Check("the grinder stops to grind", false, new { motion = p?.Human.Motion }); return; }
        town.ClockRuns = false;
        await Seconds(2.0);
        DayLook();
        if (Main.I.GetNode<StreetTrades>("StreetTrades").GrinderStone(grinder.R.Id) is not { } stone || !stone.Grinding) { Check("the grinder works between his handles", false); return; }
        grinder.Wait = 120; // (stays at this stop while he is measured and photographed)
        var local = p.Group.GlobalTransform.AffineInverse() * stone.Stone;
        float r = p.Human.WorkRatio("grind");
        // the grind clip holds the knife to a stone 0.5 m before him, 0.98 m up (its body)
        float off = new Vector3(local.X, local.Y - 0.98f * r, local.Z - 0.5f * r).Length();
        float hand = 9;
        for (int k = 0; k < 40; k++) { await Seconds(0.125); hand = Math.Min(hand, p.Human.Socket("gripR")?.DistanceTo(stone.Stone) ?? 9); }
        facts["grinder"] = new { stoneInFrame = new[] { local.X, local.Y, local.Z }, offFromClipStoneM = off, gripRToStoneAxleM = hand };
        Check("grinder: the stone where his grinding hands are (within 8 cm of the clip's stone)", off < 0.08f, new { off, local = local.ToString() });
        var c = p.Group.GlobalPosition;
        await Shot("grinder-side", c + Side(p.Yaw) * 2.3f + Fwd(p.Yaw) * 0.6f + Vector3.Up * 1.4f, c + Fwd(p.Yaw) * 0.5f + Vector3.Up * 0.95f);
        await Shot("grinder-front", c + Fwd(p.Yaw) * 2.6f - Side(p.Yaw) * 1.4f + Vector3.Up * 1.7f, c + Fwd(p.Yaw) * 0.4f + Vector3.Up * 0.95f);
        await Shot("grinder-behind", c - Fwd(p.Yaw) * 2.0f + Side(p.Yaw) * 1.0f + Vector3.Up * 1.7f, c + Fwd(p.Yaw) * 0.6f + Vector3.Up * 0.9f);
    }

    private async Task Fish()
    {
        await Dev.Kit.I.Light(10, "clear", day: 1);
        town.ClockRuns = false;
        Dev.Kit.I.Go("vismarkt");
        var near = new Vector3(-130, 0, 28);
        Puppet? seller = null;
        for (int i = 0; i < 3600 && seller == null; i++)
        {
            await Frame();
            if (i % 60 == 0) { var j = Player.Jef.I; Main.I.Cam.Position = new Vector3(j.X, j.Y + 2.5f, j.Z); }
            // a seller at her own fish table (the layout's seller spot)
            var market0 = Main.I.GetNodeOrNull<NativeMarket>("NativeMarket");
            seller = crowd.Walking.FirstOrDefault(q => q.Human.Work == "fish_stall" && market0 != null && market0.LaidOut.Any(i => i.Kind == "fishtable" && Math.Abs(i.Seller.X - q.X) + Math.Abs(i.Seller.Z - q.Z) < 1.5));
        }
        if (seller == null) { Check("a fishwife stands at a fish table", false); return; }
        {
            var m0 = Main.I.GetNodeOrNull<NativeMarket>("NativeMarket")!;
            facts["fishSellers"] = crowd.Walking.Where(q => q.Human.Work == "fish_stall").Select(q =>
            {
                var it = m0.LaidOut.Where(i => i.Kind == "fishtable").OrderBy(i => Math.Abs(i.Seller.X - q.X) + Math.Abs(i.Seller.Z - q.Z)).First();
                return new { at = new[] { q.X, q.Z }, spot = new[] { it.Seller.X, it.Seller.Z }, it.Sits, motion = q.Human.Motion, clip = q.Human.AnimationState.Clip, q.State, ahead = (q.X - it.Seller.X) * Math.Sin(it.Yaw) + (q.Z - it.Seller.Z) * Math.Cos(it.Yaw) };
            }).ToArray();
        }
        DayLook();
        await Frames(3);
        var c = new Vector3((float)seller.X, seller.Group.GlobalPosition.Y, (float)seller.Z);
        await Look(c + Fwd(seller.Yaw) * 2.5f + Vector3.Up * 1.6f, c + Vector3.Up, 30);
        await Seconds(1.5);
        // the table before her: the layout's fish table nearest her, its model's bounds in its own frame
        var market = Main.I.GetNodeOrNull<NativeMarket>("NativeMarket");
        var item = market?.LaidOut.Where(i => i.Kind == "fishtable").OrderBy(i => (i.Seller.X - c.X) * (i.Seller.X - c.X) + (i.Seller.Z - c.Z) * (i.Seller.Z - c.Z)).FirstOrDefault();
        if (item == null || NativeMarket.FishTableBox() is not { } box) { Check("her fish table is laid out", false); return; }
        var tableFrame = new Transform3D(new Basis(Vector3.Up, (float)item.Yaw), new Vector3((float)item.X, c.Y, (float)item.Z));
        var fwd = Fwd(seller.Yaw);
        float edge = (tableFrame * new Vector3(0, 0, box.Position.Z) - c).Dot(fwd);
        float reach = 9;
        bool knife = false, fish = false;
        var top = new Aabb(new Vector3(box.Position.X, box.End.Y - 0.12f, box.Position.Z), new Vector3(box.Size.X, 0.24f, box.Size.Z));
        var sellerSk = seller.Human.Root.GetNode<Skeleton3D>("Skeleton3D");
        for (int k = 0; k < 160 && (reach > 0.05f || !fish); k++)
        {
            await Seconds(0.25);
            if (seller.Human.AnimationState.Clip != "gut") { if (k % 8 == 0) crowd.PuppetStand(seller, "idle", seller.Yaw); continue; }
            if (seller.Human.Socket("gripR") is { } g) reach = Math.Min(reach, Outside(top, tableFrame.AffineInverse() * g));
            knife |= sellerSk.GetNodeOrNull<Node3D>("work_knife") is { Visible: true };
            fish |= sellerSk.GetNodeOrNull<Node3D>("work_fish") is { Visible: true };
        }
        Check("fishwife: her gutting knife in her right hand and a herring under her left", knife && fish, new { knife, fish });
        facts["fishItem"] = new { item = new[] { item.X, item.Z, item.Yaw }, seller = new[] { c.X, c.Z, seller.Yaw }, sellerAt = new[] { item.Seller.X, item.Seller.Z } };
        facts["fish"] = new { nearEdgeAheadM = edge, gripRToTableTopM = reach, clip = seller.Human.AnimationState.Clip, box = box.ToString() };
        Check("fishwife: the table's near edge 0.30 m (+-5 cm) before her", Math.Abs(edge - 0.30f * seller.Human.WorkRatio("gut")) < 0.05f, new { edge });
        Check("fishwife: her knife hand reaches the table top", reach < 0.05f, new { reach });
        await Shot("fish-side", c + Side(seller.Yaw) * 2.2f + Fwd(seller.Yaw) * 0.6f + Vector3.Up * 1.5f, c + fwd * 0.45f + Vector3.Up * 0.9f);
        await Shot("fish-front", c + fwd * 2.3f + Side(seller.Yaw) * 0.8f + Vector3.Up * 1.6f, c + fwd * 0.3f + Vector3.Up * 0.95f);
    }

    // ------------------------------------------------------------------ kneeling on the step (#169)

    // ------------------------------------------------------------------ the crane's winch (#128)

    private async Task Crane()
    {
        await Dev.Kit.I.Light(13, "clear");
        var rail = Main.I.GetNodeOrNull<Movers.Railway>("Railway");
        if (rail == null) { Check("the railway and its cranes are there", false); return; }
        var all = rail.CraneWinches.ToList();
        facts["cranes"] = all.Select(c => new { drumTris = c.Winch?.DrumTris ?? 0, crankTris = c.Winch?.CrankTris ?? 0 }).ToArray();
        Check("every portal crane has its winch drum and crankshaft as turning parts", all.Count > 0 && all.All(c => c.Winch is { DrumTris: > 100, CrankTris: > 50 }), facts["cranes"]);
        // a crane at work: the first whose hook moves; the drum and the crankshaft turn with it
        var start = all.Select(c => c.Winch?.Angle ?? 0).ToArray();
        int busy = -1;
        for (int k = 0; k < 360 && busy < 0; k++)
        {
            await Seconds(0.5);
            var now = rail.CraneWinches.ToList();
            for (int i = 0; i < now.Count && busy < 0; i++) if (Math.Abs((now[i].Winch?.Angle ?? 0) - start[i]) > 0.3f) busy = i;
        }
        if (busy < 0) { Check("a crane hoists within three minutes", false); return; }
        var (jib, winch, _) = rail.CraneWinches.ElementAt(busy);
        float a0 = winch!.Angle;
        await Look(jib.ToGlobal(new Vector3(2.25f, 1.8f, -0.72f)), jib.ToGlobal(new Vector3(-0.35f, 1.35f, -0.05f)), 10);
        for (int k = 0; k < 3; k++)
        {
            // from the cabin's aisle (cranes.py: the machinery in the left half, the aisle down the +x side)
            await Shot($"crane-winch-{k}", jib.ToGlobal(new Vector3(0.95f, 1.85f, 0.75f)), jib.ToGlobal(new Vector3(-0.45f, 1.3f, -0.1f)), 25);
            await Seconds(0.6);
        }
        float moved = Math.Abs(winch.Angle - a0) + 0.3f;
        facts["craneTurn"] = new { crane = busy, radians = moved, drum = winch.Drum?.Rotation.X, crankshaft = winch.Crank?.Rotation.X };
        Check("the crane's drum and crankshaft turn while it hoists", moved > 0.5f && winch.Drum != null && winch.Crank != null, new { moved });
        await Shot("crane-outside", jib.ToGlobal(new Vector3(6f, 0.5f, -5f)), jib.ToGlobal(new Vector3(0, 1.5f, 0)), 25);
    }

    // ------------------------------------------------------------------ cask rolling and sweeping (#132)

    /// <summary>Follow a resident until his puppet plays one of the clips (camera on him); null: not within the time.</summary>
    private async Task<Puppet?> Watch(Townspeople.Sim who, Func<Puppet, bool> ready, int seconds)
    {
        ulong end = Time.GetTicksMsec() + (ulong)seconds * 1000;
        int k = 0;
        while (Time.GetTicksMsec() < end)
        {
            await Frame();
            var at = who.P != null ? who.P.Group.GlobalPosition : new Vector3((float)who.X, Ground((float)who.X, (float)who.Z), (float)who.Z);
            Main.I.Cam.LookAtFromPosition(at + new Vector3(3.2f, 2.2f, 3.2f), at + Vector3.Up * 0.8f);
            if (++k % 240 == 0) town.Refill();
            if (who.P is { } p && ready(p)) return p;
        }
        return null;
    }

    private async Task Work132()
    {
        // 1 a cellarman of Peyrot's rolls a cask from the canal quay to the Vleeshuis cellar: at a time of his runs
        var cellarman = town.Sims.FirstOrDefault(s => s.R.Trade == "cellarman");
        if (cellarman == null) { Check("a cellarman lives in town", false); }
        else
        {
            double offset = 30 * Townspeople.TradeHash(cellarman.R.Id + ":cask");
            double hour = 9;
            while (((hour * 60 + offset) % 30) is < 1 or > 6) hour += 1.0 / 60;
            await Dev.Kit.I.Light(hour, "clear", day: 1);
            town.ClockRuns = true;
            var roller = await Watch(cellarman, q => q.Human.AnimationState.Clip == "cask_roll", 150);
            facts["caskRun"] = new { who = cellarman.R.Id, hour, goal = cellarman.Goal.Mode, place = cellarman.Goal.Place, clip = cellarman.P?.Human.AnimationState.Clip };
            Check("a cellarman rolls a cask from the quay to the Vleeshuis cellar", roller != null, facts["caskRun"]);
            if (roller != null)
            {
                DayLook();
                var sk = roller.Human.Root.GetNode<Skeleton3D>("Skeleton3D");
                float roll0 = sk.GetNodeOrNull<Node3D>("work_cask")?.Rotation.X ?? 0;
                await Seconds(0.8);
                var cask = sk.GetNodeOrNull<Node3D>("work_cask");
                bool rolling = cask != null && cask.Visible && Math.Abs(cask.Rotation.X - roll0) > 0.05f;
                float onGround = cask != null && WorldBox(cask) is { } box ? box.Position.Y - GroundUnder(box.GetCenter()) : 9;
                Check("the cask turns as it rolls, on the ground (within 4 cm)", rolling && Math.Abs(onGround) < 0.04f, new { rolling, onGround });
                var c = roller.Group.GlobalPosition;
                await Shot("cask-roll-side", c + Side(roller.Yaw) * 2.4f + Fwd(roller.Yaw) * 1.4f + Vector3.Up * 2.0f, c + Fwd(roller.Yaw) * 0.5f + Vector3.Up * 0.5f, 3);
                c = roller.Group.GlobalPosition;
                await Shot("cask-roll-front", c + Fwd(roller.Yaw) * 2.8f + Side(roller.Yaw) * 0.9f + Vector3.Up * 2.0f, c + Fwd(roller.Yaw) * 0.5f + Vector3.Up * 0.5f, 3);
                // he reaches the cellar door with it
                var door = HaulRoute.CaskRunOf("cellarman")!.B;
                bool there = false;
                for (int k = 0; k < 4800 && !there; k++) { await Frame(); there = Math.Abs(roller.X - door.X) + Math.Abs(roller.Z - door.Z) < 2.6; }
                Check("he reaches the Vleeshuis cellar door with it", there, new { at = new[] { roller.X, roller.Z } });
            }
        }
        // 2 street sweepers on the squares, and men sweeping before their doors, on a weekday morning
        await Dev.Kit.I.Light(7.5, "clear", day: 2);
        town.ClockRuns = true;
        await Seconds(2);
        var sweeper = town.Sims.FirstOrDefault(s => s.Goal.Mode == "patrol" && s.Goal.Motion == "scrub");
        facts["streetSweepers"] = town.Sims.Where(s => s.Goal.Mode == "patrol" && s.Goal.Motion == "scrub").Select(s => new { s.R.Id, s.Goal.Place }).ToArray();
        Check("street sweepers work the squares in the morning", sweeper != null, facts["streetSweepers"]);
        if (sweeper != null && await Watch(sweeper, q => q.Human.AnimationState.Clip == "man_sweep" && !crowd.PuppetBusy(q), 150) is { } sw)
        {
            DayLook();
            await Seconds(1.2);
            var c = sw.Group.GlobalPosition;
            await Shot("street-sweeper", c + Fwd(sw.Yaw) * 2.6f + Side(sw.Yaw) * 1.2f + Vector3.Up * 1.4f, c + Vector3.Up * 0.7f, 4);
            Check("a street sweeper sweeps with his broom", sw.Human.Root.GetNode<Skeleton3D>("Skeleton3D").GetNodeOrNull<Node3D>("work_broom") is { Visible: true });
        }
        else if (sweeper != null) Check("a street sweeper sweeps at a stop of his round", false);
        var doorSweeper = town.Sims.FirstOrDefault(s => s.Goal.Mode == "stand" && s.Goal.Motion == "scrub" && s.R.Sex == "m");
        for (int k = 0; k < 8 && doorSweeper == null; k++)
        {
            await Dev.Kit.I.Light(7.25 + k * 0.3, "clear", day: 2);
            await Seconds(1.5);
            doorSweeper = town.Sims.FirstOrDefault(s => s.Goal.Mode == "stand" && s.Goal.Motion == "scrub" && s.R.Sex == "m");
        }
        Check("men sweep before their doors in the morning", doorSweeper != null);
        if (doorSweeper != null && await Watch(doorSweeper, q => q.Human.AnimationState.Clip == "man_sweep" && !crowd.PuppetBusy(q), 150) is { } ds)
        {
            DayLook();
            town.ClockRuns = false;
            await Seconds(0.5);
            var c = ds.Group.GlobalPosition;
            await Shot("door-sweeper", c + Fwd(ds.Yaw) * 2.6f + Side(ds.Yaw) * 1.3f + Vector3.Up * 1.4f, c + Vector3.Up * 0.7f, 30);
            facts["doorSweeper"] = new { doorSweeper.R.Id, doorSweeper.R.Trade, at = new[] { ds.X, ds.Z }, group = ds.Group.GlobalPosition.ToString(), visible = ds.Group.IsVisibleInTree(), shown = ds.Shown, clip = ds.Human.AnimationState.Clip, inside = doorSweeper.Inside, alive = crowd.Alive(ds), same = doorSweeper.P == ds };
        }
        town.ClockRuns = false;
    }

    // ------------------------------------------------------------------ the sack piles (#130)

    private async Task Piles()
    {
        await Dev.Kit.I.Light(13, "clear", day: 1);
        town.ClockRuns = false;
        for (int i = 0; i < 600 && !Play.Goods.I.Loaded; i++) await Frame();
        var sacks = Play.Goods.I.All.Values.Where(i => i.Kind == "sacks").ToList();
        var baked = World.BakedWorld.All(Main.I.World).OfType<MeshInstance3D>().Where(m => m.Name.ToString().StartsWith("goods_sacks", StringComparison.Ordinal) || (m.GetParent()?.Name.ToString().StartsWith("goods_sacks", StringComparison.Ordinal) ?? false)).ToList();
        var boxes = baked.Select(m => m.GlobalTransform * m.Mesh.GetAabb()).ToList();
        facts["bakedSacks"] = baked.Select((m, i) => new { name = m.Name.ToString(), parent = m.GetParent()?.Name.ToString(), box = boxes[i].ToString(), visible = m.IsVisibleInTree() }).ToArray();
        facts["sackItems"] = sacks.GroupBy(i => System.Text.RegularExpressions.Regex.Replace(i.Id, @":\d+$", "")).Select(g => new { lot = g.Key, n = g.Count(), drawn = g.Count(i => i.Obj != null && i.Obj.IsVisibleInTree()), inBaked = g.Count(i => boxes.Any(b => b.Grow(0.05f).HasPoint(new Vector3(i.X, i.Y + 0.1f, i.Z)))), at = new[] { g.First().X, g.First().Z } }).ToArray();
        var mask = Main.I.GetNodeOrNull<Play.HaulPiles>("HaulPiles");
        facts["haulPiles"] = new { sacks = mask?.Sacks, triangles = mask?.TrianglesTaken };
        Check("the bake's copies of the 87 pile and cart sacks are taken out", mask is { Sacks: 87, TrianglesTaken: > 1000 }, facts["haulPiles"]);
        var piled = Play.Goods.I.All.Values.Where(i => Play.HaulPiles.Drawn(i.Id) && i.Kind == "sacks" && i.S.Lies).ToList();
        Check("every lying pile sack is drawn as itself", piled.Count > 0 && piled.All(i => i.Obj != null && i.Obj.IsVisibleInTree()), new { piled.Count, drawn = piled.Count(i => i.Obj?.IsVisibleInTree() == true) });
        // the rk-m pile while its dockers work at 13:00: it shrinks as they take from it; the sack a docker carries is
        // the pile's own sack model
        var rkm = HaulRoute.All.First(x => x.Id == "rk-m");
        Dev.Kit.I.Go(FormattableString.Invariant($"{rkm.A.X - 3} {rkm.A.Z + 3}"));
        town.ClockRuns = true;
        var pileAt = new Vector3((float)rkm.A.X, 0, (float)rkm.A.Z); pileAt.Y = Ground(pileAt.X, pileAt.Z);
        int Count() => Play.Goods.I.All.Values.Count(i => i.Id.StartsWith("haul:rk-ma:", StringComparison.Ordinal) && i.S.Lies);
        int before = Count(), least = before;
        await Shot("pile-rk-m-before", pileAt - Fwd(rkm.AYaw) * 2.6f + Side(rkm.AYaw) * 1.8f + Vector3.Up * 1.8f, pileAt + Fwd(rkm.AYaw) * 0.8f + Vector3.Up * 0.2f, 30);
        Puppet? carrier = null;
        for (int k = 0; k < 240 && (least >= before || carrier == null); k++)
        {
            await Seconds(0.5);
            least = Math.Min(least, Count());
            carrier ??= town.Sims.FirstOrDefault(x => x.HaulGid != null && x.HaulGid.StartsWith("haul:rk-ma:", StringComparison.Ordinal) && x.P != null)?.P;
            Main.I.Cam.LookAtFromPosition(pileAt - Fwd(rkm.AYaw) * 4f + Side(rkm.AYaw) * 3f + Vector3.Up * 2.5f, pileAt + Vector3.Up * 0.5f);
        }
        facts["rkmPile"] = new { before, least, refusal = Play.Goods.I.LastRefusal, dockers = town.Sims.Where(x => x.Goal.Mode == "haul" && HaulRoute.Of(x.Goal.A, x.Goal.B, 1)?.Id == "rk-m").Select(x => new { x.R.Id, x.R.Kind, puppet = x.P != null, x.ToB, x.Arrived, x.HaulAsking, x.HaulGid, at = new[] { x.X, x.Z }, motion = x.P?.Human.Motion }).ToArray(), haulers = town.Sims.Count(x => x.Goal.Mode == "haul") };
        Check("the rk-m pile shrinks as its dockers take sacks from it", least < before, facts["rkmPile"]);
        await Shot("pile-rk-m-after", pileAt - Fwd(rkm.AYaw) * 2.6f + Side(rkm.AYaw) * 1.8f + Vector3.Up * 1.8f, pileAt + Fwd(rkm.AYaw) * 0.8f + Vector3.Up * 0.2f, 10);
        if (carrier != null)
        {
            await Seconds(1.5);
            var shoulder = carrier.Human.Root.GetNode<Skeleton3D>("Skeleton3D").GetNodeOrNull<Node3D>("work_sack");
            var pileSack = Play.Goods.I.All.Values.FirstOrDefault(i => i.Id.StartsWith("haul:rk-ma:", StringComparison.Ordinal) && i.Obj != null)?.Obj;
            Mesh? MeshOf(Node3D? n) => n == null ? null : World.BakedWorld.All(n).OfType<MeshInstance3D>().FirstOrDefault()?.Mesh;
            Check("the sack on his shoulder is the pile's sack model (the same mesh and mark)", MeshOf(shoulder) != null && MeshOf(shoulder) == MeshOf(pileSack), new { shoulder = MeshOf(shoulder)?.ResourceName, pile = MeshOf(pileSack)?.ResourceName });
            var c = carrier.Group.GlobalPosition;
            await Shot("pile-rk-m-carrier", c + Fwd(carrier.Yaw) * 2.4f + Side(carrier.Yaw) * 1.2f + Vector3.Up * 1.6f, c + Vector3.Up * 1.2f, 3);
        }
        town.ClockRuns = false;
        foreach (var id in new[] { "rk-e1", "en-1" })
        {
            var r = HaulRoute.All.First(x => x.Id == id);
            var a = new Vector3((float)r.A.X, 0, (float)r.A.Z); a.Y = Ground(a.X, a.Z);
            var f = Fwd(r.AYaw);
            await Shot("pile-" + id, a - f * 2.4f + Side(r.AYaw) * 1.6f + Vector3.Up * 1.8f, a + f * 0.8f + Vector3.Up * 0.2f, 30);
        }
    }

    // ------------------------------------------------------------------ the wall works' winch (#128)

    private async Task Works()
    {
        var ww = Main.I.GetNodeOrNull<WallWorks>("WallWorks");
        facts["wallWorks"] = new { taken = ww?.TrianglesTaken, crank = ww?.Crank?.ToString() };
        Check("the bake's low crab winch is taken out and the works' crab winch placed", ww is { TrianglesTaken: > 50, Crank: not null }, facts["wallWorks"]);
        await Dev.Kit.I.Light(10, "clear", day: 1);
        town.ClockRuns = true;
        await Seconds(2);
        var navvy = town.Sims.FirstOrDefault(s => s.Goal.Place == "wall:works" && s.Goal.Motion == "pull");
        if (navvy == null) { Check("the winch navvy works at the wall works", false, town.Sims.Where(s => s.R.Work.Place == "wall:works").Select(s => new { s.R.Id, s.R.Trade, s.Goal.Mode, s.Goal.Motion, s.Goal.Place }).ToArray()); return; }
        var p = await Watch(navvy, q => !crowd.PuppetBusy(q) && q.Human.AnimationState.Clip == "winch", 180);
        if (p == null || ww?.Winch == null) { Check("the winch navvy cranks at the crab winch", false, new { clip = navvy.P?.Human.AnimationState.Clip, motion = navvy.P?.Human.Motion, winch = ww?.Winch != null, at = navvy.P == null ? null : new[] { navvy.P.X, navvy.P.Z }, goal = new[] { navvy.Goal.X, navvy.Goal.Z }, crank = ww?.Crank?.ToString(), work = navvy.P?.Human.Work, kind = navvy.R.Kind, p2 = navvy.P?.Human.IsPeople2 }); return; }
        DayLook();
        var crankNode = World.BakedWorld.All(ww.Winch).OfType<Node3D>().First(n => n.Name == "winch_crank");
        await Seconds(1.5); // (the clip faded in)
        float worstL = 0, worstR = 0, a0 = ww.CrankAngle, turned = 0;
        for (int k = 0; k < 28; k++)
        {
            await Seconds(0.125);
            // the handle: from the arm's end (0.24 up at rest) out along -x, 0.36 long
            var h0 = crankNode.GlobalTransform * new Vector3(0, 0.24f, 0); var h1 = crankNode.GlobalTransform * new Vector3(-0.36f, 0.24f, 0);
            float Seg(Vector3 q) { var d = h1 - h0; float u = Math.Clamp((q - h0).Dot(d) / d.LengthSquared(), 0, 1); return q.DistanceTo(h0 + d * u); }
            worstL = Math.Max(worstL, p.Human.Socket("gripL") is { } gl ? Seg(gl) : 9);
            worstR = Math.Max(worstR, p.Human.Socket("gripR") is { } gr ? Seg(gr) : 9);
            turned += Math.Abs(Mathf.AngleDifference(a0, ww.CrankAngle)); a0 = ww.CrankAngle;
        }
        var clipCrank = p.Human.Root.GetNode<Skeleton3D>("Skeleton3D").GetNodeOrNull<Node3D>("work_crank");
        var handsInThing = new List<object>();
        for (int k = 0; k < 4 && clipCrank != null; k++)
        {
            await Seconds(0.2);
            var inv = clipCrank.GlobalTransform.AffineInverse();
            handsInThing.Add(new { l = (inv * (p.Human.Socket("gripL") ?? Vector3.Zero)).ToString(), r = (inv * (p.Human.Socket("gripR") ?? Vector3.Zero)).ToString(), axleOff = clipCrank.GlobalPosition.DistanceTo(crankNode.GlobalPosition), angle = ww.CrankAngle,
                ourArmEnd = (inv * (crankNode.GlobalTransform * new Vector3(0, 0.24f, 0))).ToString(), ourHandleEnd = (inv * (crankNode.GlobalTransform * new Vector3(-0.36f, 0.24f, 0))).ToString(), ourAxle = (inv * crankNode.GlobalPosition).ToString(),
                thingZinMan = (p.Group.GlobalTransform.Basis.Inverse() * clipCrank.GlobalTransform.Basis * Vector3.Back).Normalized().ToString(), crankXinMan = (p.Group.GlobalTransform.Basis.Inverse() * crankNode.GlobalTransform.Basis * Vector3.Right).Normalized().ToString() });
        }
        facts["winch"] = new { worstL, worstR, turned, handsInThing };
        Check("the crank turns as he cranks", turned > 3, new { turned });
        Check("both his hands on the crank's handle all round (within 6 cm)", worstL < 0.06f && worstR < 0.06f, new { worstL, worstR });
        town.ClockRuns = false;
        var c = p.Group.GlobalPosition;
        await Shot("works-winch-side", c + Side(p.Yaw) * -2.4f + Fwd(p.Yaw) * 0.5f + Vector3.Up * 1.5f, c + Fwd(p.Yaw) * 0.45f + Vector3.Up * 0.95f, 20);
        await Shot("works-winch-front", c + Fwd(p.Yaw) * 2.8f + Side(p.Yaw) * -1.3f + Vector3.Up * 1.7f, c + Fwd(p.Yaw) * 0.4f + Vector3.Up * 0.9f, 20);
        await Shot("works-wide", c - Fwd(p.Yaw) * 6f + Side(p.Yaw) * 3f + Vector3.Up * 4f, c + Fwd(p.Yaw) * 2f + Vector3.Up * 1.5f, 20);
        // what of the old winch remains, the new one hidden for a moment
        ww.Winch.Visible = false;
        await Shot("works-old-left", c + Fwd(p.Yaw) * 2.8f + Side(p.Yaw) * -1.3f + Vector3.Up * 1.7f, c + Fwd(p.Yaw) * 0.4f + Vector3.Up * 0.6f, 10);
        ww.Winch.Visible = true;
    }

    // ------------------------------------------------------------------ things in the hands (#131)

    private async Task Held()
    {
        await Dev.Kit.I.Light(13, "clear");
        town.ClockRuns = false;
        var at = QuaySpot();
        var route = HaulRoute.All.First(x => x.Id == "rk-m");
        double yaw = route.AYaw + Math.PI / 2;
        await Look(at + Fwd(yaw) * 4 + Vector3.Up * 2, at + Vector3.Up, 30);
        int n = 0;
        foreach (var (kind, motion, thing) in new[] { ("gentleman", "write", "work_ledger"), ("tourist", "point", "work_book"), ("sentry", "idle", "held_rifle"), ("docker_a", "grind", "work_knife") })
        {
            var spot = at + Side(yaw) * (2.2f * n++);
            var p = crowd.AddPuppet(kind, spot.X, spot.Z, yaw, size: 1);
            if (p == null) { Check($"a {kind} is made", false); continue; }
            p.Human.SetIdentity("carryproof:held:" + kind);
            crowd.PuppetStand(p, motion, yaw);
            // (the guide points up at the spire with his book when his id picks that clip: try a few)
            for (int k = 0; motion == "point" && p.Human.AnimationState.Clip != "point_up" && k < 12; k++) { p.Human.SetIdentity("carryproof:held:guide" + k); crowd.PuppetStand(p, "idle", yaw); await Frames(2); crowd.PuppetStand(p, "point", yaw); await Frames(2); }
            await Seconds(1.5);
            var sk = p.Human.Root.GetNode<Skeleton3D>("Skeleton3D");
            bool drawn = World.BakedWorld.All(sk).OfType<Node3D>().Any(x => x.Name.ToString().StartsWith(thing, StringComparison.Ordinal) && x.IsVisibleInTree());
            Check($"{kind} '{motion}': the {thing.Replace("work_", "").Replace("held_", "")} in the hands", drawn, new { clip = p.Human.AnimationState.Clip });
            var c = p.Group.GlobalPosition;
            await Shot($"held-{thing}", c + Fwd(yaw) * 1.6f + Side(yaw) * 0.7f + Vector3.Up * 1.55f, c + Vector3.Up * 1.05f + Fwd(yaw) * 0.3f, 15);
        }
    }

    // ------------------------------------------------------------------ the goods at our detail level (#151)

    private async Task Goods151()
    {
        await Dev.Kit.I.Light(13, "clear", day: 2);
        town.ClockRuns = true;
        // the new goods in a row on the Rijnkaai, beside the old shapes' sizes
        var at = QuaySpot();
        var route = HaulRoute.All.First(x => x.Id == "rk-m");
        double yaw = route.AYaw + Math.PI / 2;
        var row = new List<Node3D>();
        int i = 0;
        foreach (string kind in new[] { "chests", "hides", "parcel", "sacks", "barrels" })
        {
            var g = Play.Goods.I.MakeGoods(kind);
            Main.I.View.AddChild(g);
            var p = at + Side(yaw) * (1.1f * i++) + Fwd(yaw) * 1.5f; p.Y = Ground(p.X, p.Z);
            g.GlobalPosition = p; g.Rotation = new Vector3(0, (float)yaw, 0);
            row.Add(g);
            bool primitive = World.BakedWorld.All(g).OfType<MeshInstance3D>().Any(m => m.Mesh is PrimitiveMesh);
            Check($"job goods '{kind}' are a real model (no plain shape)", !primitive);
        }
        var mid = at + Side(yaw) * 2.2f + Fwd(yaw) * 1.5f;
        await Shot("goods-row", mid - Fwd(yaw) * 2.6f + Vector3.Up * 1.6f, mid + Vector3.Up * 0.2f, 30);
        await Shot("goods-row-low", mid - Fwd(yaw) * 1.8f + Side(yaw) * -1.6f + Vector3.Up * 0.6f, mid + Vector3.Up * 0.25f, 10);
        foreach (var g in row) g.QueueFree();
        // the emigrants' camp on the Rijnkaai (a family waiting for its ship)
        var em = Play.Emigrants.I;
        for (int k = 0; k < 240 && (em == null || em.CampCount == 0 || em.CampProp == null); k++) { await Seconds(0.5); em = Play.Emigrants.I; if (k % 20 == 0) Dev.Kit.I.Go("31 27"); }
        if (em?.CampProp is not { } camp) { Check("an emigrant family camps on the quay", false); return; }
        Main.I.Cam.Position = camp + new Vector3(3, 2, 3);
        await Seconds(1);
        DayLook();
        var props = World.BakedWorld.All(Main.I.View).OfType<Node3D>().Where(x => x.GetParent() is Node3D pp && pp.GetChildren().Count > 0 && x.GlobalPosition.DistanceTo(camp) < 6 && x.IsVisibleInTree()).ToList();
        bool plain = World.BakedWorld.All(Main.I.View).OfType<MeshInstance3D>().Any(m => m.Mesh is SphereMesh or CylinderMesh && m.GlobalPosition.DistanceTo(camp) < 5 && m.IsVisibleInTree());
        Check("the emigrants' luggage is real models (no plain shapes)", !plain);
        await Shot("emigrant-camp", camp + new Vector3(2.6f, 1.6f, 2.6f), camp + Vector3.Up * 0.3f, 25);
        await Shot("emigrant-camp-low", camp + new Vector3(-1.8f, 0.7f, 1.9f), camp + Vector3.Up * 0.3f, 10);
    }

    private void Clips()
    {
        var hipsInfo = new Dictionary<string, object>();
        foreach (string name in new[] { "scrub", "crouch", "child_crouch", "gut", "sack_lift", "man_sit_bench", "woman_sit_bench", "lace", "wash" })
            if (People2.Clips.TryGetValue(name, out var clip))
            {
                var at0 = clip.PositionTrack >= 0 ? clip.Animation.PositionTrackInterpolate(clip.PositionTrack, 0) : Vector3.Zero;
                var atMid = clip.PositionTrack >= 0 ? clip.Animation.PositionTrackInterpolate(clip.PositionTrack, clip.Length / 2) : Vector3.Zero;
                hipsInfo[name] = new { track = clip.PositionTrack, keys = clip.PositionTrack >= 0 ? clip.Animation.TrackGetKeyCount(clip.PositionTrack) : 0, at0 = at0.ToString(), atMid = atMid.ToString(), clip.Hips, tracks = clip.Animation.GetTrackCount() };
            }
        hipsInfo["trackBase"] = HumanLayers.TrackBase.ToString();
        facts["clipHips"] = hipsInfo;
    }

    private async Task Scrub()
    {
        // the door plans' scrubbing is in the morning; the town's clock keeps it, the picture's light is 13:00
        Townspeople.Sim? who = null;
        foreach (double hour in new[] { 7.5, 8.0, 8.5, 9.0, 9.5, 10.0, 10.5, 11.0 })
        {
            await Dev.Kit.I.Light(hour, "clear", day: 1);
            town.ClockRuns = true;
            await Seconds(1.5);
            who = town.Sims.FirstOrDefault(s => s.Goal.Motion == "scrub" && !s.Inside);
            if (who != null) break;
        }
        if (who == null) { Check("a woman scrubs her step", false); return; }
        Puppet? p = null;
        // (try the scrubbers in turn: one may be inside or out of reach of the drawn crowd)
        foreach (var cand in town.Sims.Where(s => s.Goal.Motion == "scrub" && !s.Inside && s.R.Sex == "f").Take(4).ToList())
        {
            who = cand;
            var goal = new Vector3((float)who.Goal.X, 0, (float)who.Goal.Z);
            goal.Y = Ground(goal.X, goal.Z);
            for (int i = 0; i < 3600; i++)
            {
                await Frame();
                Main.I.Cam.LookAtFromPosition(goal + new Vector3(3, 2, 3), goal + Vector3.Up * 0.5f);
                if (i % 300 == 0) town.Refill();
                p = who.P;
                if (p != null && p.Human.Motion == "scrub" && p.Human.AnimationState.Clip == "scrub" && !crowd.PuppetBusy(p) && i > 200) break;
            }
            if (p != null && p.Human.AnimationState.Clip == "scrub") break;
        }
        if (p == null || p.Human.Motion != "scrub") { Check("the scrubber kneels at her step", false, new { motion = p?.Human.Motion, goal = who.Goal.Motion }); return; }
        await Seconds(2.5);
        town.ClockRuns = false;
        DayLook();
        facts["scrubPlace"] = new { reach = town.ScrubReachAtHome(who), fromDoor = Math.Sqrt(Math.Pow(p.X - who.R.HomeX, 2) + Math.Pow(p.Z - who.R.HomeZ, 2)), door = new[] { who.R.HomeX, who.R.HomeZ }, street = new[] { who.R.HomeSx, who.R.HomeSz } };
        await Report169(p, "scrub");
        // her brush on the step: through one loop, the scrubbing brush in her frame, the surface under it (the step's
        // top or the pavement), which hand is at it
        var sk = p.Human.Root.GetNode<Skeleton3D>("Skeleton3D");
        var samples = new List<object>();
        float onStep = 0, total = 0, worstOver = 0;
        var space = Main.I.View.FindWorld3D().DirectSpaceState;
        for (int k = 0; k < 52; k++)
        {
            await Seconds(0.125);
            if (sk.GetNodeOrNull<Node3D>("work_brush") is not { Visible: true } brush || WorldBox(brush) is not { } bb) continue;
            var mid = bb.GetCenter();
            var hit = space.IntersectRay(PhysicsRayQueryParameters3D.Create(new Vector3(mid.X, bb.Position.Y + 0.25f, mid.Z), new Vector3(mid.X, bb.Position.Y - 0.6f, mid.Z), World.Solid.Layer));
            float surface = hit.Count > 0 ? ((Vector3)hit["position"]).Y : float.NaN;
            var local = p.Group.GlobalTransform.AffineInverse() * mid;
            float l = p.Human.Socket("gripL")?.DistanceTo(mid) ?? 9, r = p.Human.Socket("gripR")?.DistanceTo(mid) ?? 9;
            float over = bb.Position.Y - surface;
            float rise = surface - (float)Walk(p);
            // (a stroke: the brush low before her, not on its way to or from the bucket)
            bool stroke = local.Y < 0.3f && local.X < 0.0f;
            if (stroke) total++;
            if (stroke && rise > 0.05f) { onStep++; worstOver = Math.Max(worstOver, Math.Abs(over)); }
            samples.Add(new { t = k * 0.125f, local = new[] { local.X, local.Y, local.Z }, over, rise, l, r, collider = hit.Count > 0 ? (hit["collider"].AsGodotObject() as Node)?.Name.ToString() : null });
        }
        facts["scrubBrush"] = new { samples, onStepShare = total > 0 ? onStep / total : 0, worstOverStepM = worstOver };
        Check("scrub: the brush strokes work on the step's top (most strokes, within 5 cm of it)", total > 0 && onStep / total > 0.6f && worstOver < 0.05f, new { onStep, total, worstOver });
        // the same kneeling and crouching beside her, on the same pavement: a maid (her basket set down), a child at
        // marbles, a fishwife crouched (her basket set down)
        var c = p.Group.GlobalPosition;
        var side = Side(p.Yaw);
        int n = 0;
        foreach (var (kind, motion) in new[] { ("maid", "scrub"), ("girl", "crouch"), ("fishwife_a", "crouch") })
        {
            var at = c + side * (1.3f * ++n);
            if (!crowd.CanStand(at.X, at.Z)) at = c - side * (1.3f * n);
            var q = crowd.AddPuppet(kind, at.X, at.Z, p.Yaw, size: 1);
            if (q == null) { Check($"a {kind} is made", false); continue; }
            q.Human.SetIdentity("carryproof:" + kind);
            crowd.PuppetStand(q, motion, p.Yaw);
            await Seconds(2.5);
            await Report169(q, kind + "-" + motion);
            var bags = World.BakedWorld.All(q.Human.Root).OfType<Node3D>().Where(b => b.Name.ToString() is "held_basket" or "held_basket_cloth" or "held_mussels" && b.IsVisibleInTree()).ToList();
            foreach (var bag in bags)
                if (WorldBox(bag) is { } box)
                {
                    float gap = box.Position.Y - GroundUnder(new Vector3(box.GetCenter().X, box.Position.Y, box.GetCenter().Z));
                    Check($"{kind}: her basket stands on the ground beside her (within 3 cm)", Math.Abs(gap) < 0.03f, new { gap });
                }
            crowd.RemovePuppet(q);
        }
    }

    private float Walk(Puppet p) => (float)town.Walk!.BaseAt(p.X, p.Z);

    private async Task Report169(Puppet p, string name)
    {
        var sk = p.Human.Root.GetNode<Skeleton3D>("Skeleton3D");
        var gaps = new Dictionary<string, float>();
        foreach (string bone in new[] { "legLowL", "legLowR", "toeL", "toeR" })
        {
            int b = sk.FindBone(bone);
            if (b < 0) continue;
            var at = sk.GlobalTransform * sk.GetBoneGlobalPose(b).Origin;
            gaps[bone] = at.Y - GroundUnder(at);
        }
        facts[name] = new { gaps, clip = p.Human.AnimationState.Clip, at = p.Group.GlobalPosition.ToString() };
        // a knee joint rests a knee's half thickness over the ground, a toe joint a toe's
        // kneeling: both knee joints rest a knee's half thickness over the ground; a crouch keeps one knee up: its
        // lowest knee or toe rests on the ground; nothing goes under it
        float knees = Math.Min(gaps.GetValueOrDefault("legLowL", 9) - 0.055f * p.Human.WorkRatio("scrub"), gaps.GetValueOrDefault("legLowR", 9) - 0.055f * p.Human.WorkRatio("scrub"));
        float toes = Math.Min(gaps.GetValueOrDefault("toeL", 9) - 0.02f, gaps.GetValueOrDefault("toeR", 9) - 0.02f);
        bool kneel = p.Human.Motion == "scrub";
        bool ok = gaps.Count == 4 && gaps.Values.All(g => g > -0.03f) && (kneel ? gaps.Where(g => g.Key.StartsWith("legLow")).All(g => g.Value > 0.02f && g.Value < 0.09f) : Math.Min(knees, toes) < 0.03f);
        Check(name + (kneel ? ": both knees and the toes on the ground" : ": the lowest knee or toe on the ground, nothing under it"), ok, gaps);
        var c = p.Group.GlobalPosition;
        await Shot(name + "-side", c + Side(p.Yaw) * 2.0f + Fwd(p.Yaw) * 0.3f + Vector3.Up * 0.9f, c + Vector3.Up * 0.4f + Fwd(p.Yaw) * 0.2f);
        await Shot(name + "-back", c - Fwd(p.Yaw) * 2.2f + Side(p.Yaw) * 0.8f + Vector3.Up * 1.3f, c + Vector3.Up * 0.4f);
    }
}
