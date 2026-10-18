using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Town;
using Scheldemist.World;

namespace Scheldemist.Play;

// Market, work board, warmth, benches and room keepers (issues #150 #153 #162 #165 #177 #178),
// --market-proof <dir> [--market-proof-only facts,keepers,...]: the real town staged and measured, with pictures.
// Writes market.json; exits 1 when a check fails.
[GamePart(902)]
internal partial class MarketProof : Node
{
    private string dir = "";
    private readonly List<object> checks = new();
    private readonly List<string> pictures = new();
    private readonly Dictionary<string, object?> facts = new();
    private int failed;
    private Townspeople town = null!;

    public override async void _Ready()
    {
        dir = Main.I.Arg("market-proof");
        if (dir == "") { SetProcess(false); return; }
        dir = Paths.Absolute(dir);
        Directory.CreateDirectory(dir);
        string[] stages = Main.I.Arg("market-proof-only", "facts").Split(',', StringSplitOptions.RemoveEmptyEntries);
        try
        {
            town = Main.I.GetNode<Townspeople>("Townspeople");
            for (int i = 0; (town.Data == null || town.Crowd == null) && i < 3600; i++) await Frame();
            for (int i = 0; !Dev.Kit.I.IsReady && i < 1800; i++) await Frame();
            if (town.Data == null || town.Crowd == null || !Dev.Kit.I.IsReady) throw new InvalidOperationException("The market proof needs the native town and the dev API.");
            Game.GameState.I.PlayingWhen = () => false;
            if (Player.Jef.I is { Fly: false } jef) jef.ToggleFly();
            Player.Jef.I.TestInput = true;
            Main.I.Cam.SetProcess(false);
            Input.MouseMode = Input.MouseModeEnum.Visible;
            foreach (string stage in stages)
            {
                try
                {
                    GD.Print("market proof: " + stage);
                    switch (stage)
                    {
                        case "facts": Facts(); break;
                        case "keepers": await Keepers(); break;
                        case "vleeshuis": await Vleeshuis(); break;
                        case "warmth": await Warmth(); break;
                        case "board": await Board(); break;
                        case "boardsurvey": await BoardSurvey(); break;
                        case "benches": await Benches(); break;
                        case "benchplan": await BenchPlan(); break;
                        case "benchsurvey": await BenchSurvey(); break;
                        case "marketsurvey": await MarketSurvey(); break;
                        case "pitchplan": await PitchPlan(); break;
                        case "market": await Market(); break;
                        case "pitchspots": await PitchSpots(); break;
                        default: Check(stage + " is a known stage", false); break;
                    }
                }
                catch (Exception e) { Check(stage + " ran", false, e.ToString()); }
            }
        }
        catch (Exception e) { Check("market proof ran", false, e.ToString()); }
        try
        {
            var options = new JsonSerializerOptions { WriteIndented = true, NumberHandling = System.Text.Json.Serialization.JsonNumberHandling.AllowNamedFloatingPointLiterals };
            File.WriteAllText(Path.Combine(dir, "market.json"), JsonSerializer.Serialize(new { ok = failed == 0, failed, checks, facts, pictures }, options));
        }
        catch (Exception e) { failed++; GD.PrintErr("market proof: the report failed: " + e.Message); }
        GD.Print(failed == 0 ? "market proof: PASS" : $"market proof: FAIL ({failed})");
        GetTree().Quit(failed == 0 ? 0 : 1);
    }

    private SignalAwaiter Frame() => ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
    private async Task Frames(int n) { for (int i = 0; i < n; i++) await Frame(); }

    private void Check(string name, bool ok, object? detail = null)
    {
        checks.Add(new { name, ok, detail });
        GD.Print($"market proof: {(ok ? "PASS" : "FAIL")} {name}");
        if (!ok) { failed++; GD.PrintErr("market proof check failed: " + name + " " + detail); }
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
        await ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
        using var image = Main.I.View.GetTexture().GetImage();
        string path = Path.Combine(dir, name + ".png");
        if (image.SavePng(path) != Error.Ok) throw new IOException(path);
        pictures.Add(name + ".png");
    }

    private static float[] F(Vector3 v) => new[] { MathF.Round(v.X, 2), MathF.Round(v.Y, 2), MathF.Round(v.Z, 2) };

    private static bool InRoom(string room, Vector3 at, float radius)
    {
        if (Main.I.World.NativeRoom(room) is not { } r) return false;
        var local = r.Frame.AffineInverse() * at;
        return r.Bounds.Grow(-radius).HasPoint(new(local.X, local.Z));
    }

    /// <summary>What a standing body of this radius at that floor point touches (all layers), by node path and layer.</summary>
    private static string[] Hits(string room, Vector3 at, float radius)
    {
        float floor = Main.I.World.NativeRoom(room)?.Frame.Origin.Y ?? at.Y;
        using var shape = new CapsuleShape3D { Radius = radius, Height = 1.5f };
        using var q = new PhysicsShapeQueryParameters3D { Shape = shape, CollisionMask = 0xFFFFFFFF, Margin = .001f, Transform = new(Basis.Identity, new(at.X, floor + .85f, at.Z)) };
        return Main.I.World.GetWorld3D().DirectSpaceState.IntersectShape(q, 8)
            .Select(hit => hit["collider"].AsGodotObject() is CollisionObject3D c ? c.GetPath().ToString().Split('/').TakeLast(3).Aggregate((a, b) => a + "/" + b) + " L" + c.CollisionLayer : "?").ToArray();
    }

    /// <summary>Free standing points (radius 0.22) behind a counter: local x from the bar's back to 1 m behind it,
    /// along its whole length; the free ones nearest the keeper anchor, and the gap to the room's wall.</summary>
    private static object Behind(string room, InteriorFurniture counter)
    {
        var free = new List<(float x, float z, float d)>();
        float half = counter.Size.Z * .5f + .3f, keeper = counter.Keeper.X, side = Math.Sign(keeper - counter.Stand.X);
        for (float dx = -.3f; dx <= .6f; dx += .1f)
            for (float z = -half; z <= half; z += .1f)
            {
                var local = new Vector3(keeper + side * dx, 0, z);
                var at = counter.Node.ToGlobal(local);
                if (!InRoom(room, at, .22f) || Hits(room, at, .22f).Length > 0) continue;
                free.Add((local.X, local.Z, new Vector2(local.X - keeper, local.Z - counter.Keeper.Z).Length()));
            }
        return new { keeper = counter.Keeper.X, side, size = F(counter.Size), offset = F(counter.Offset), count = free.Count, nearest = free.OrderBy(f => f.d).Take(4).Select(f => new[] { MathF.Round(f.x, 2), MathF.Round(f.z, 2), MathF.Round(f.d, 2) }).ToArray() };
    }

    private static Godot.Collections.Array<Rid> OwnBodies(Node node) => new(BakedWorld.All(node).OfType<CollisionObject3D>().Select(b => b.GetRid()));

    private static bool Clear(Shape3D shape, Transform3D at, Godot.Collections.Array<Rid> exclude)
    {
        using var q = new PhysicsShapeQueryParameters3D { Shape = shape, CollisionMask = 0xFFFFFFFF, Margin = .001f, Transform = at, Exclude = exclude };
        return Main.I.World.GetWorld3D().DirectSpaceState.IntersectShape(q, 1).Count == 0;
    }

    /// <summary>How far the counter must move toward its customers (local x) before a keeper (radius 0.24)
    /// stands free behind it at the anchor and 0.4 m either side, with the moved counter itself clear.</summary>
    private static object NeededShift(string room, InteriorFurniture counter)
    {
        var own = OwnBodies(counter.Node);
        float toward = Math.Sign(counter.Stand.X - counter.Keeper.X);
        float floor = Main.I.World.NativeRoom(room)?.Frame.Origin.Y ?? 0;
        using var body = new CapsuleShape3D { Radius = .24f, Height = 1.5f };
        var visual = counter.Node.GetChildren().OfType<Node3D>().FirstOrDefault(n => n.HasMethod("_Ready") && n.Get("ModelSize").VariantType == Variant.Type.Vector3);
        var size = visual != null ? visual.Get("ModelSize").AsVector3() : counter.Size;
        var offset = visual != null ? visual.Get("ModelOffset").AsVector3() : counter.Offset;
        using var box = new BoxShape3D { Size = size - new Vector3(.04f, .06f, .04f) };
        for (float s = 0; s <= 1.21f; s += .05f)
        {
            bool keeper = new[] { -.4f, 0f, .4f }.All(dz =>
            {
                var at = counter.Node.ToGlobal(counter.Keeper + new Vector3(toward * s, 0, dz));
                return InRoom(room, at, .24f) && Clear(body, new Transform3D(Basis.Identity, new Vector3(at.X, floor + .85f, at.Z)), own);
            });
            if (!keeper) continue;
            var centre = counter.Node.ToGlobal(offset + new Vector3(toward * s, size.Y * .5f + .03f, 0));
            var barAt = new Transform3D(counter.Node.GlobalBasis.Orthonormalized(), centre);
            bool bar = Clear(box, barAt, own);
            using var q = new PhysicsShapeQueryParameters3D { Shape = box, CollisionMask = 0xFFFFFFFF, Margin = .001f, Transform = barAt, Exclude = own };
            var hits = Main.I.World.GetWorld3D().DirectSpaceState.IntersectShape(q, 6).Select(h => (h["collider"].AsGodotObject() as Node)?.GetPath().ToString().Split('/').TakeLast(3).Aggregate((a, b) => a + "/" + b)).Distinct().ToArray();
            q.Transform = new Transform3D(barAt.Basis, counter.Node.ToGlobal(offset + new Vector3(0, size.Y * .5f + .03f, 0)));
            var before = Main.I.World.GetWorld3D().DirectSpaceState.IntersectShape(q, 6).Select(h => (h["collider"].AsGodotObject() as Node)?.GetPath().ToString().Split('/').TakeLast(3).Aggregate((a, b) => a + "/" + b)).Distinct().ToArray();
            var front = Main.I.World.NativeFurniture!.Where(f => f.Room == room && f != counter && f.Kind is "stool" or "chair" or "bench").Select(f => (f, l: counter.Node.ToLocal(f.Node.GlobalPosition)))
                .Where(p => (p.l.X - counter.Keeper.X) * toward > 0 && Math.Abs(p.l.X - counter.Keeper.X) < 2.6f && Math.Abs(p.l.Z) < size.Z * .5f + .4f).Select(p => p.f.Id).ToArray();
            return new { s = MathF.Round(s, 2), bar, hits, before, toward, axis = F(counter.Node.GlobalBasis.X.Normalized()), id = counter.Id, at = F(counter.Node.GlobalPosition), front };
        }
        return new { s = -1f, bar = false, toward, axis = F(counter.Node.GlobalBasis.X.Normalized()) };
    }

    // ------------------------------------------------------------------ keepers behind their counters (#177)
    private async Task Keepers()
    {
        var indoors = town.Indoors ?? throw new InvalidOperationException("no indoor rooms");
        Doors.I.Held = true; foreach (var d in Doors.I.All) Doors.I.Force(d, true);
        await Dev.Kit.I.Light(20, "clear");
        var rows = new List<object>();
        foreach (var h in indoors.Houses)
        {
            var counter = Main.I.World.NativeFurniture?.FirstOrDefault(f => f.Room == h.Id && f.Kind == "counter");
            if (counter == null) continue;
            var spots = indoors.StandingSpots(h);
            var keeper = indoors.KeeperSpot(h, counter);
            float toward = Math.Sign(counter.Stand.X - counter.Keeper.X);
            var first = spots.Count > 0 ? counter.Node.ToLocal(new Vector3((float)spots[0].X, counter.Node.GlobalPosition.Y, (float)spots[0].Z)) : new Vector3(float.NaN, 0, 0);
            // behind: between the anchor's line and the bar's back, within the bar's length
            bool behind = (first.X - counter.Keeper.X) * toward <= .12f && (counter.Keeper.X - first.X) * toward < .4f && Math.Abs(first.Z - counter.Keeper.Z) <= counter.Size.Z * .5f;
            bool lane = h.EntryLane.Count > 1;
            rows.Add(new { h.Id, keeper = keeper == null ? null : F(keeper.Value), local = F(first), behind, lane, spots = spots.Count });
            Check(h.Id + " keeper stands behind the counter", keeper != null && behind && Math.Abs(spots[0].X - keeper.Value.X) < .01 && Math.Abs(spots[0].Z - keeper.Value.Z) < .01, F(first));
            Check(h.Id + " customers still reach the counter", lane);
        }
        facts["keepers"] = rows;
        foreach (var (room, wanted) in new[] { ("tavern:vliet", 20), ("tavern:vliet", 13), ("tavern:zwarte_kat", 20), ("shop:tobacco_markt", 13) })
        {
            var h = indoors.Houses.Single(x => x.Id == room);
            int hour = wanted;
            if (room.StartsWith("shop:") && h.Keeper != null)
                hour = new[] { wanted, 11, 15, 10, 9, 16 }.FirstOrDefault(x => Whereabouts.ActivityAt(h.Keeper.Sched, Game.GameState.I.Day, x).Act == "work", wanted);
            var counter = Main.I.World.NativeFurniture!.First(f => f.Room == room && f.Kind == "counter");
            await Dev.Kit.I.Light(hour, "clear");
            var serve = counter.StandAt; var keeperAt = indoors.StandingSpots(h)[0];
            var k = new Vector3((float)keeperAt.X, counter.Node.GlobalPosition.Y, (float)keeperAt.Z);
            var back = (serve - k) with { Y = 0 };
            var eye = serve + back.Normalized() * 1.3f + Vector3.Up * 1.65f;
            Main.I.Cam.GlobalPosition = eye;
            Player.Jef.I.Place(eye.X, eye.Z, 0, near: counter.Node.GlobalPosition.Y);
            Figure_ keeperFigure = default;
            for (int i = 0; i < 240 && (keeperFigure = KeeperFigure(indoors, h)).Group == null; i++) await Frame();
            string name = room.Replace(':', '-') + "-" + hour;
            if (keeperFigure.Group != null)
            {
                var at = keeperFigure.Group.GlobalPosition;
                Check(room + " keeper figure drawn on the place behind the counter at " + hour, new Vector2(at.X - k.X, at.Z - k.Z).Length() < .3f, F(at));
            }
            else Check(room + " keeper figure drawn at " + hour, false, "no keeper figure (keeper " + h.Keeper?.Id + ")");
            await Shot(name + "-keeper", eye, k + Vector3.Up * 1.2f, 40);
            await Shot(name + "-bar-side", serve + new Vector3(back.Z, 0, -back.X).Normalized() * 2.2f + back.Normalized() * .6f + Vector3.Up * 1.7f, k + Vector3.Up * 1f, 20);
        }
        Doors.I.Held = false;
    }

    private record struct Figure_(Node3D? Group, int Spot);
    private static Figure_ KeeperFigure(Indoors indoors, Indoors.House h)
    {
        if (h.Keeper == null) return default;
        var f = indoors.FigureNode(h, h.Keeper.Id);
        return f == null ? default : new(f.Value.Group, f.Value.Spot);
    }

    // ------------------------------------------------------------------ the Vleeshuis's old frozen figures (#178)
    private async Task Vleeshuis()
    {
        var hall = BakedWorld.All(Main.I.World).FirstOrDefault(n => n.Name.ToString() == "ROOM_vleeshuis") ?? throw new InvalidOperationException("no Vleeshuis room");
        var frozen = BakedWorld.All(hall).OfType<Skeleton3D>().Select(s => s.GetParent()).OfType<Node3D>().Distinct().ToList();
        Check("the Vleeshuis's recovered figures are found", frozen.Count > 0, frozen.Count);
        await Dev.Kit.I.Light(10.5, "clear", day: 2);
        var inside = new Vector3(-118f, 0, 99f);
        Player.Jef.I.Place(inside.X, inside.Z, 0, near: .1f);
        await Look(inside + Vector3.Up * 1.7f, inside + new Vector3(4, 1.2f, -3));
        var halls = Scheldemist.People.HallPeople.I ?? throw new InvalidOperationException("no hall people");
        IEnumerable<Scheldemist.People.HallPeople.Figure> Staff() => halls.Halls.Where(h => h.Id == "vleeshuis").SelectMany(h => h.Figures.Values);
        for (int i = 0; i < 900 && !Staff().Any(); i++) await Frame();
        await Frames(60);
        var staff = Staff().ToList();
        facts["vleeshuisStaff"] = staff.Select(f => new { f.Id, f.Role, f.Kind, people2 = f.Human.IsPeople2, at = F(f.Group.GlobalPosition) }).ToArray();
        Check("the Vleeshuis's own workers stand in the hall when it is open", staff.Count > 0, staff.Count);
        Check("every figure in the Vleeshuis is a people2 figure", staff.All(f => f.Human.IsPeople2), staff.Where(f => !f.Human.IsPeople2).Select(f => f.Kind).ToArray());
        var shown = frozen.Where(p => BakedWorld.All(p).OfType<GeometryInstance3D>().Any(m => m.IsVisibleInTree())).Select(p => p.Name.ToString()).ToArray();
        Check("no recovered old-kit figure shows in the Vleeshuis", shown.Length == 0, shown);
        var solid = frozen.SelectMany(p => BakedWorld.All(p).OfType<CollisionObject3D>()).Where(b => b.CollisionLayer != 0).Select(b => b.GetPath().ToString()).ToArray();
        Check("no recovered old-kit figure keeps a collider", solid.Length == 0, solid);
        Check("the recovered figures are retired snapshots", frozen.All(p => p.HasMeta("native_replaced_event_snapshot")));
        var doors = new[] { new Vector2(-122f, 87.5f), new Vector2(-115.7f, 110.4f) };
        var inDoor = staff.Where(f => doors.Any(d => d.DistanceTo(new(f.Group.GlobalPosition.X, f.Group.GlobalPosition.Z)) < 1.6f)).Select(f => f.Id).ToArray();
        Check("no Vleeshuis figure stands in a doorway", inDoor.Length == 0, inDoor);
        if (staff.FirstOrDefault(f => f.Role == "cellarmaster") is { } master)
            await Shot("vleeshuis-desk-10", master.Group.GlobalPosition + new Vector3(1.7f, 1.3f, 1.1f), master.Group.GlobalPosition + Vector3.Up * 1f, 30);
        if (staff.FirstOrDefault() is { } one)
            await Shot("vleeshuis-staff-10", one.Group.GlobalPosition + new Vector3(2.4f, 1.7f, 1.4f), one.Group.GlobalPosition + Vector3.Up * 1.1f, 30);
    }

    // ------------------------------------------------------------------ warmth at a fire (#162)
    private Net.Api Api => Net.ServerLink.I!.Api!;

    /// <summary>One real clock step (five game minutes) with Jef's own where and place, as the game sends it.</summary>
    private async Task<Net.TickReply> Step()
    {
        await Api.Post<Net.JobsPayload>("api/dev/advance", new { minutes = 0 });
        var jef = Player.Jef.I;
        var r = await Api.Tick(Game.GameState.I.Where(), null, new Net.Pos3(jef.X, jef.Z, jef.Y));
        Game.GameState.I.Apply(r);
        return r;
    }

    private async Task SetNeeds(int hour, int warmth, int day = 2)
    {
        await Dev.Kit.I.Light(hour, "clear", fill: false, day: day);
        Game.GameState.I.Apply(await Api.Post<Net.JobsPayload>("api/dev/set", new Dictionary<string, object> { ["minute"] = 0, ["warmth"] = warmth, ["food"] = 10, ["sleep"] = 10, ["health"] = 10 }));
    }

    /// <summary>Stands Jef at a point and lets game time pass by real ticks (24: two hours); the warmth before
    /// and after, and the warming word the engine gave at the end.</summary>
    private async Task<(double before, double after, int warming, bool? fires)> Stand(Vector3 at, int hour, int warmth, int ticks = 24)
    {
        await SetNeeds(hour, warmth);
        Player.Jef.I.Place(at.X, at.Z, 0, near: at.Y);
        await Frames(10);
        double before = Game.GameState.I.Warmth;
        Net.TickReply? last = null;
        for (int i = 0; i < ticks; i++) last = await Step();
        return (before, Game.GameState.I.Warmth, last?.Where?.Warming ?? -1, last?.Where?.Fires);
    }

    private async Task Warmth()
    {
        var spots = Fires.BakedSpots(Main.I.World);
        var basket = spots.Where(s => Fires.IsBasket(s.size, s.room, s.at)).OrderBy(s => s.at.DistanceTo(new Vector3(-141, 0, 26.5f))).First();
        facts["heatSpots"] = spots.Select(s => new { at = F(s.at), s.size, s.room, basket = Fires.IsBasket(s.size, s.room, s.at) }).ToArray();
        // the free ground a metre from the basket, on the walk map
        var near = Dev.Kit.I.FreeNear(basket.at.X + 1.1f, basket.at.Z);
        var by = new Vector3((float)near.X, 0, (float)near.Z);
        float gap = new Vector2(by.X - basket.at.X, by.Z - basket.at.Z).Length();
        facts["basketStand"] = new { basket = F(basket.at), stand = F(by), gap };

        var night = await Stand(by, 21, 3);
        Check("by a burning fire basket at night warmth rises", night.after > night.before && night.warming > 0 && night.fires == true, new { night.before, night.after, night.warming, night.fires, gap });
        await Frames(70);
        var fireAt = Fires.I!.Burning().OrderBy(f => f.at.DistanceTo(basket.at)).First();
        Check("the fire baskets burn at night", fireAt.lit);
        Player.Jef.I.Place(by.X, by.Z, 0, near: 0);
        await Look(by + new Vector3(2.2f, 1.7f, 2.4f), basket.at + Vector3.Up * .4f, 30);
        await ShotWithHud("warmth-basket-21");

        var far = Dev.Kit.I.FreeNear(basket.at.X + 9, basket.at.Z + 3);
        var away = await Stand(new Vector3((float)far.X, 0, (float)far.Z), 21, 3);
        Check("ten metres from the basket at night warmth does not rise", away.after <= away.before && away.warming == 0, new { away.before, away.after, away.warming });

        var day = await Stand(by, 11, 3);
        Check("the fire baskets are out by day and give no warmth", day.after <= day.before && day.warming == 0 && day.fires == false, new { day.before, day.after, day.warming, day.fires });
        await Frames(70);
        Check("the fire basket is out by day", !Fires.I!.Burning().OrderBy(f => f.at.DistanceTo(basket.at)).First().lit);

        // a tavern with a hearth: close by, and shut (a cold hearth)
        var hearth = spots.Where(s => s.room != null).OrderBy(s => s.room).First();
        var room = Main.I.World.NativeRoom(hearth.room!)!.Value;
        var indoors = town.Indoors!;
        var h = indoors.Houses.Single(x => x.Id == hearth.room);
        Doors.I.Held = true; foreach (var d in Doors.I.All) Doors.I.Force(d, true);
        int openHour = new[] { 21, 20, 19, 22, 18 }.FirstOrDefault(x => h.Keeper != null && Whereabouts.ActivityAt(h.Keeper.Sched, 2, x).Act == "work", 21);
        Vector3 Floor(Vector3 p)
        {
            for (float r = 0; r < 2.5f; r += .25f)
                for (int i = 0; i < 12; i++)
                {
                    var q = p + new Vector3(MathF.Cos(i * MathF.Tau / 12) * r, 0, MathF.Sin(i * MathF.Tau / 12) * r);
                    q.Y = room.Frame.Origin.Y;
                    if (indoors.FloorFree(h, q, .3f)) return q;
                }
            return p with { Y = room.Frame.Origin.Y };
        }
        var inward = (room.Frame.Origin - hearth.at) with { Y = 0 };
        var close = Floor(hearth.at + inward.Normalized() * 1.2f);
        var inHearth = await Stand(close, openHour, 3);
        Check(hearth.room + ": by the lit hearth warmth rises", inHearth.after > inHearth.before && inHearth.warming == 2, new { inHearth.before, inHearth.after, inHearth.warming, at = F(close), hour = openHour });
        await Frames(70);
        Check(hearth.room + ": its hearth burns while it is open", Fires.I!.Burning().OrderBy(f => f.at.DistanceTo(hearth.at)).First().lit);
        var back = (close - hearth.at) with { Y = 0 };
        await Look(close + Vector3.Up * 1.65f + back.Normalized() * 1.2f, hearth.at + Vector3.Up * .3f, 30);
        await ShotWithHud("warmth-hearth-" + hearth.room!.Replace(':', '-'));
        int shutHour = new[] { 4, 5, 3, 6 }.FirstOrDefault(x => h.Keeper == null || Whereabouts.ActivityAt(h.Keeper.Sched, 2, x).Act != "work", 4);
        var cold = await Stand(close, shutHour, 3, 12);
        Check(hearth.room + ": a shut tavern's cold hearth gives no warmth", cold.after <= cold.before && cold.warming == 0, new { cold.before, cold.after, cold.warming, hour = shutHour });
        // (the rooms ask the server which places are open every 15 s)
        bool HearthLit() => Fires.I!.Burning().OrderBy(f => f.at.DistanceTo(hearth.at)).First().lit;
        for (ulong until = Time.GetTicksMsec() + 25000; HearthLit() && Time.GetTicksMsec() < until;) await Frame();
        Check(hearth.room + ": its hearth is out while it is shut", !HearthLit());
        Doors.I.Held = false;
    }

    private async Task ShotWithHud(string name)
    {
        await ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
        using var image = GetTree().Root.GetTexture().GetImage();
        string path = Path.Combine(dir, name + ".png");
        if (image.SavePng(path) != Error.Ok) throw new IOException(path);
        pictures.Add(name + ".png");
    }


    // ------------------------------------------------------------------ benches (#165): a survey of what stands there now
    private async Task BenchSurvey()
    {
        await Dev.Kit.I.Light(13, "clear");
        using var doc = JsonDocument.Parse(Godot.FileAccess.GetFileAsString("res://services/data/native-rules.json"));
        var server = doc.RootElement.GetProperty("benches").EnumerateArray().Select(b => (id: b.GetProperty("id").GetString()!, x: b.GetProperty("x").GetSingle(), y: b.GetProperty("y").GetSingle(), z: b.GetProperty("z").GetSingle())).ToList();
        var meshes = BakedWorld.All(Main.I.World).OfType<MeshInstance3D>().Where(m => m.Mesh != null && m.IsVisibleInTree())
            .Select(m => (m, box: m.GlobalTransform * m.GetAabb())).Where(p => p.box.Size.X < 4 && p.box.Size.Z < 4 && p.box.Size.Y < 2.5f).ToList();
        var rows = new List<object>();
        foreach (var b in server)
        {
            var at = new Vector3(b.x, b.y, b.z);
            var near = meshes.Where(p => new Vector2(p.box.GetCenter().X - b.x, p.box.GetCenter().Z - b.z).Length() < 1.6f && Math.Abs(p.box.Position.Y - b.y) < 1.5f)
                .Select(p => new { path = p.m.GetPath().ToString().Split("/town/").Last(), name = p.m.Name.ToString(), size = F(p.box.Size), centre = F(p.box.GetCenter()), tris = p.m.Mesh!.GetFaces().Length / 3 }).Take(6).ToArray();
            var multi = BakedWorld.All(Main.I.World).OfType<MultiMeshInstance3D>().Where(m => m.Multimesh != null && m.IsVisibleInTree()).SelectMany(m =>
                Enumerable.Range(0, m.Multimesh.VisibleInstanceCount < 0 ? m.Multimesh.InstanceCount : m.Multimesh.VisibleInstanceCount).Select(i => (m, i, t: m.GlobalTransform * m.Multimesh.GetInstanceTransform(i))))
                .Where(q => new Vector2(q.t.Origin.X - b.x, q.t.Origin.Z - b.z).Length() < 1.2f && Math.Abs(q.t.Origin.Y - b.y) < 1.5f)
                .Select(q => new { path = q.m.GetPath().ToString().Split("/town/").Last(), q.i, at = F(q.t.Origin), yaw = MathF.Round(q.t.Basis.GetEuler().Y, 3), mesh = q.m.Multimesh.Mesh?.ResourcePath, aabb = F(q.m.Multimesh.Mesh?.GetAabb().Size ?? Vector3.Zero) }).Take(4).ToArray();
            var holders = BakedWorld.All(Main.I.World).OfType<MeshInstance3D>().Where(m => m.Mesh != null && m.IsVisibleInTree()).Where(m => (m.GlobalTransform * m.GetAabb()).Grow(.05f).HasPoint(at + Vector3.Up * .45f) && (m.GlobalTransform * m.GetAabb()).Size.Length() < 80)
                .Select(m => new { path = m.GetPath().ToString().Split("/town/").Last(), size = F((m.GlobalTransform * m.GetAabb()).Size) }).Take(4).ToArray();
            rows.Add(new { b.id, at = F(at), client = Day.I?.Benches.Any(c => c.Id == b.id) == true, near, multi, holders });
        }
        facts["benchSurvey"] = rows;
        facts["benchCams"] = null;
        var cams = new Dictionary<string, float[]>();
        string camFile = Main.I.Arg("bench-cams");
        Dictionary<string, float[]>? given = camFile != "" ? JsonSerializer.Deserialize<Dictionary<string, float[]>>(File.ReadAllText(camFile)) : null;
        foreach (var id in new[] { "rond:0", "green:lijnwaadmarkt:0", "green:court_green:0", "park:0", "steen:1", "stop:vismarkt:kaaien", "stop:meir:markt", "wall:0", "wall:2", "wall:7", "wall:10", "wall:29", "green:stjacob_yard:0" })
        {
            var b = server.First(s => s.id == id);
            var place = BenchPlaces.Get(id);
            var at = place?.At ?? new Transform3D(Basis.Identity, new Vector3(b.x, b.y, b.z));
            if (given != null && given.TryGetValue(id, out var g)) at = new Transform3D(Basis.FromEuler(new Vector3(0, g[3], 0)), new Vector3(g[0], g[1], g[2]));
            cams[id] = new[] { at.Origin.X, at.Origin.Y, at.Origin.Z, at.Basis.GetEuler().Y };
            await Shot("bench-" + id.Replace(':', '-'), at * new Vector3(1.5f, 1.25f, 2.1f), at * new Vector3(0, .45f, 0), 25);
        }
        facts["benchCams"] = cams;
        File.WriteAllText(Path.Combine(dir, "bench-cams.json"), JsonSerializer.Serialize(cams));
        var iron = BakedWorld.All(Main.I.World).OfType<Node3D>().FirstOrDefault(n => n.Name.ToString().Contains("stadspark-bench-west-1"));
        if (iron != null) await Shot("bench-now-iron", iron.GlobalPosition + new Vector3(1.6f, 1.2f, 1.4f), iron.GlobalPosition + Vector3.Up * .45f, 25);
        Check("benches surveyed", true);
    }

    // ------------------------------------------------------------------ new benches (#165): try the planned places
    private sealed record PlanEntry(string id, string label, string model, string mode, string? place, float x, float z, float yaw, float[]? along, float[]? reference);

    /// <summary>For each planned bench, the first candidate place where the bench stands free on level ground, a
    /// person can stand in front of it, and a route runs from there to the street; written to bench-plan.json.</summary>
    private async Task BenchPlan()
    {
        await Dev.Kit.I.Light(13, "clear");
        var plan = JsonSerializer.Deserialize<List<PlanEntry>>(File.ReadAllText(Main.I.Arg("bench-plan")))!;
        var found = new List<object>();
        var taken = BenchPlaces.All.Select(b => new Vector2(b.At.Origin.X, b.At.Origin.Z)).ToList();
        using var box = new BoxShape3D { Size = new Vector3(1.95f, .85f, .62f) };
        foreach (var e in plan)
        {
            var tries = new List<(Vector3 at, float yaw)>();
            if (e.mode == "door" && e.place != null && town.Data!.Places.TryGetValue(e.place, out var pl) && pl.Door is { } door && pl.Out is { } o)
            {
                var outV = new Vector2((float)o.X, (float)o.Z).Normalized(); var along = new Vector2(-outV.Y, outV.X);
                float yaw = MathF.Atan2(outV.X, outV.Y);
                foreach (float a in e.along ?? new[] { 2.2f, -2.2f, 3.2f, -3.2f, 4.2f, -4.2f })
                    foreach (float d in new[] { .42f, .52f, .65f, .8f })
                    { var p = new Vector2((float)door.X, (float)door.Z) + along * a + outV * d; tries.Add((new Vector3(p.X, 0, p.Y), yaw)); }
            }
            else
                foreach (float r in new[] { 0f, .5f, 1f, 1.5f })
                    for (int k = 0; k < (r == 0 ? 1 : 8); k++)
                        tries.Add((new Vector3(e.x + r * MathF.Cos(k * MathF.Tau / 8), 0, e.z + r * MathF.Sin(k * MathF.Tau / 8)), e.yaw));
            string why = "no candidate";
            object? chosen = null;
            // the crowd's walk grid is built round the viewer: stand there first
            if (tries.Count > 0)
            {
                var near = tries[0].at;
                Player.Jef.I.Place(near.X, near.Z + 3, 0, near: 0);
                await Look(near + new Vector3(0, 6, 6), near, 45);
            }
            foreach (var (at0, yaw) in tries)
            {
                var basis = Basis.FromEuler(new Vector3(0, yaw, 0));
                float ground = GroundUnder(at0 + Vector3.Up * 1.5f);
                var at = at0 with { Y = ground };
                var xf = new Transform3D(basis, at);
                var corners = new[] { new Vector3(-.92f, 0, .2f), new Vector3(.92f, 0, .2f), new Vector3(-.92f, 0, -.28f), new Vector3(.92f, 0, -.28f) }.Select(c => GroundUnder(xf * c + Vector3.Up * 1.0f)).ToArray();
                if (corners.Any(c => Math.Abs(c - ground) > .07f)) { why = "uneven ground"; continue; }
                using var q = new PhysicsShapeQueryParameters3D { Shape = box, CollisionMask = Solid.Layer, Margin = .001f, Transform = new Transform3D(basis, xf * new Vector3(0, .5f, -.04f)) };
                var hits = Main.I.World.GetWorld3D().DirectSpaceState.IntersectShape(q, 4);
                if (hits.Count > 0) { why = "blocked by " + string.Join(",", hits.Select(h => (h["collider"].AsGodotObject() as Node)?.Name.ToString())); continue; }
                if (taken.Any(t => t.DistanceTo(new Vector2(at.X, at.Z)) < 2.4f)) { why = "too near another bench"; continue; }
                var front = xf * new Vector3(0, 0, .95f);
                if (!Player.Jef.I.StandFree(front.X, front.Z, ground)) { why = "no room in front"; continue; }
                var reference = e.reference is { Length: 2 } rf ? new Vector2(rf[0], rf[1]) : new Vector2(front.X, front.Z) + new Vector2(MathF.Sin(yaw), MathF.Cos(yaw)) * 6;
                var route = town.Crowd!.PathOn(front.X, front.Z, reference.X, reference.Y);
                if (route == null) { why = "no route from the front to the street"; continue; }
                chosen = new { e.id, e.label, e.model, at = F(at), yaw = MathF.Round(yaw, 4), routeSteps = route.Count };
                taken.Add(new Vector2(at.X, at.Z));
                await Shot("plan-" + e.id, xf * new Vector3(1.6f, 1.4f, 2.6f), at + Vector3.Up * .5f, 15);
                break;
            }
            found.Add(chosen ?? new { e.id, e.label, e.model, at = (float[]?)null, yaw = 0f, routeSteps = 0, why });
            Check("planned bench " + e.id + " has a free place", chosen != null, chosen == null ? why : null);
        }
        File.WriteAllText(Path.Combine(dir, "bench-plan.json"), JsonSerializer.Serialize(found, new JsonSerializerOptions { WriteIndented = true }));
    }

    private static float GroundUnder(Vector3 p)
    {
        var space = Main.I.View.FindWorld3D().DirectSpaceState;
        var hit = space.IntersectRay(PhysicsRayQueryParameters3D.Create(p, p + Vector3.Down * 4, Solid.Layer));
        return hit.Count > 0 ? ((Vector3)hit["position"]).Y : float.NaN;
    }

    // ------------------------------------------------------------------ benches (#165): every bench usable, on a route, solid where it is drawn
    private async Task Benches()
    {
        await Dev.Kit.I.Light(13, "clear");
        var all = BenchPlaces.All.ToList();
        var day = Day.I!;
        facts["benchCount"] = new { placed = all.Count, swapped = all.Count(b => !b.Id.StartsWith("bench-") && b.Id.Contains(':')), listed = day.Benches.Count };
        Check("every bench in the town is placed with the new models (76 old, 24 new, the park's and the corner's)", all.Count >= 100, all.Count);
        Check("Day lists every placed bench for sleeping", all.All(b => day.Benches.Any(d => d.Id == b.Id)), all.Where(b => day.Benches.All(d => d.Id != b.Id)).Select(b => b.Id).ToArray());
        var rows = new List<object>();
        int routeless = 0, hollow = 0;
        var unmapped = new List<string>();
        foreach (var b in all)
        {
            var front = b.At * new Vector3(0, 0, .95f);
            float ground = b.At.Origin.Y;
            Player.Jef.I.Place(front.X, front.Z, b.Facing + MathF.PI, near: ground);
            await Look(front + new Vector3(0, 7, 5), front, 30);
            bool stand = Player.Jef.I.StandFree(front.X, front.Z, ground);
            // on from the front: ahead, or either way along the bench (a wall walk, a quay), or a little ahead and aside
            List<(double x, double z)>? route = null;
            foreach (var to in new[] { new Vector3(0, 0, 6.95f), new Vector3(6, 0, .95f), new Vector3(-6, 0, .95f), new Vector3(4, 0, 3.5f), new Vector3(-4, 0, 3.5f) })
            { var t = b.At * to; route = town.Crowd!.PathOn(front.X, front.Z, t.X, t.Z); if (route != null) break; }
            // the seat's collider top under each sitting place, and the body across its legs
            var space = Main.I.World.GetWorld3D().DirectSpaceState;
            float SeatHit(Vector3 p) { var hit = space.IntersectRay(PhysicsRayQueryParameters3D.Create(p + Vector3.Up * .5f, p + Vector3.Down * .8f, Solid.Layer)); return hit.Count > 0 ? ((Vector3)hit["position"]).Y - ground : float.NaN; }
            float s0 = SeatHit(b.Sit(0)), s1 = SeatHit(b.Sit(1));
            float seat = b.SeatY - ground;
            bool solid = Math.Abs(s0 - seat) < .06f && Math.Abs(s1 - seat) < .06f;
            // a square the town's walk map leaves closed (an old gap, also without the benches) is noted, not counted
            bool mapless = town.Walk is { } wm && !Enumerable.Range(-6, 13).SelectMany(i => Enumerable.Range(-6, 13).Select(j => (i, j))).Any(c => wm.Free(front.X + c.i * .5, front.Z + c.j * .5));
            if (mapless) unmapped.Add(b.Id);
            else if (route == null || !stand) routeless++;
            if (!solid) hollow++;
            rows.Add(new { b.Id, b.Model, at = F(b.At.Origin), yaw = MathF.Round(b.Facing, 3), stand, route = route?.Count ?? -1, seatHits = new[] { s0, s1 }, seat });
        }
        facts["benchChecks"] = rows;
        await Shot("bench-rond-above", new Vector3(20.01f, 22, 296.01f), new Vector3(20, 0, 296), 30);
        if (town.Walk is { } walk)
        {
            var grid = new System.Text.StringBuilder();
            for (float z = 288; z <= 304; z += .5f) { for (float x = 12; x <= 28; x += .5f) grid.Append(walk.Free(x, z) ? '.' : '#'); grid.AppendLine(); }
            File.WriteAllText(Path.Combine(dir, "rond-walk.txt"), grid.ToString());
        }
        Check("a person can stand in front of every bench and walk on from there", routeless == 0, routeless);
        facts["benchesOutsideWalkMap"] = unmapped;
        Check("every bench's collider is where its seat is drawn", hollow == 0, hollow);
        // E: sleep (the engine knows every bench), F: sit, E stands up again
        if (Player.Jef.I.Fly) Player.Jef.I.ToggleFly();
        Main.I.Cam.SetProcess(true);
        foreach (var id in new[] { "bench-tavern-vliet", "wall:16", "stop:vismarkt:kaaien", "rond:0", "stadspark-bench-west-1" })
        {
            if (BenchPlaces.Get(id) is not { } b) { Check(id + " is placed", false); continue; }
            var front = b.At * new Vector3(0, 0, .85f);
            // Jef's own eyes, facing the bench and looking down at its seat
            Player.Jef.I.Place(front.X, front.Z, b.Facing, -.45f, b.At.Origin.Y);
            await Frames(30);
            Interact.I.RepeatPrompt();
            string prompt = Interact.I.Text;
            Check(id + ": the prompt offers sleep (E) and sitting (F)", prompt.Contains("sleep on the bench") && prompt.Contains("sit on the bench"), prompt);
            bool sat = Interact.I.Press(Key.F);
            await Frames(20);
            var seats = Main.I.GetNodeOrNull<TavernSeats>("TavernSeats");
            Check(id + ": F seats Jef on the bench", sat && seats?.OnStreetBench == true && new Vector2(Player.Jef.I.X - b.At.Origin.X, Player.Jef.I.Z - b.At.Origin.Z).Length() < .7f, new { sat, x = Player.Jef.I.X, z = Player.Jef.I.Z });
            if (id is "bench-tavern-vliet" or "rond:0")
            {
                using var image = Main.I.View.GetTexture().GetImage();
                image.SavePng(Path.Combine(dir, "bench-seated-" + id.Replace(':', '-') + ".png")); pictures.Add("bench-seated-" + id.Replace(':', '-') + ".png");
            }
            Interact.I.RepeatPrompt();
            Check(id + ": seated, F offers to sleep on it", Interact.I.Text.Contains("sleep on the bench"), Interact.I.Text);
            Interact.I.Press(Key.E);
            await Frames(10);
            Check(id + ": E stands Jef up again", seats?.Sitting == null && !Player.Jef.I.Frozen);
            try
            {
                var at = b.At * new Vector3(0, 0, .02f);
                var reply = await Api.Sleep(new Net.RestAsk { Place = "bench", Bench = id, Hours = 1, Pos = new Net.Pos3(at.X, at.Z, b.At.Origin.Y) });
                Check(id + ": the engine lets Jef sleep on it", reply.Rest != null);
                Game.GameState.I.Apply(await Api.Post<Net.JobsPayload>("api/sleep/wake"));
            }
            catch (Net.ApiException e) { Check(id + ": the engine lets Jef sleep on it", false, e.Message); }
            await SetNeeds(13, 8);
        }
        Main.I.Cam.SetProcess(false);
        if (!Player.Jef.I.Fly) Player.Jef.I.ToggleFly();
        // pictures of the new models where they stand: by day, in rain and at night
        foreach (var id in new[] { "bench-tavern-vliet", "bench-cathedral-west-1", "bench-rijnkaai-1", "stop:vismarkt:kaaien", "rond:0", "wall:16", "green:stjacob_yard:0", "steen:0", "bench-groenplaats-1", "park:3" })
        {
            if (BenchPlaces.Get(id) is not { } b) continue;
            await Shot("bench-day-" + id.Replace(':', '-'), b.At * new Vector3(1.1f, 1.15f, 2.0f), b.At * new Vector3(0, .45f, 0), 25);
            await Shot("bench-close-" + id.Replace(':', '-'), b.At * new Vector3(.55f, .62f, .75f), b.At * new Vector3(.75f, .40f, 0), 15);
        }
        foreach (var (weather, hour) in new[] { ("rain", 13), ("clear", 22) })
        {
            await Dev.Kit.I.Light(hour, weather);
            await Frames(30);
            foreach (var id in new[] { "bench-tavern-vliet", "rond:0", "bench-rijnkaai-1" })
                if (BenchPlaces.Get(id) is { } b)
                    await Shot("bench-" + weather + hour + "-" + id.Replace(':', '-'), b.At * new Vector3(1.1f, 1.15f, 2.0f), b.At * new Vector3(0, .45f, 0), 25);
        }
        await Dev.Kit.I.Light(13, "clear");
    }

    // ------------------------------------------------------------------ the Vismarkt as it stands (#150)
    private async Task MarketSurvey()
    {
        await Dev.Kit.I.Light(9, "clear");
        await Frames(60);
        var market = People.NativeMarket.I ?? throw new InvalidOperationException("no market part");
        var items = market.ItemsAt("vismarkt");
        facts["vismarktItems"] = items.Select(it => new { it.Rank, it.Kind, it.Goods, it.SellerKind, x = MathF.Round((float)it.X, 2), z = MathF.Round((float)it.Z, 2), yaw = MathF.Round((float)it.Yaw, 3), half = MathF.Round((float)it.HalfLength, 2), seller = new[] { MathF.Round((float)it.Seller.X, 2), MathF.Round((float)it.Seller.Z, 2) }, sellerAt = new[] { MathF.Round((float)it.SellerAt.X, 2), MathF.Round((float)it.SellerAt.Z, 2) } }).ToArray();
        facts["vismarktStalls"] = town.Data!.Stalls.Where(s => s.Place == "vismarkt").Select(s => new { s.Keeper, s.Goods, x = s.X, z = s.Z }).ToArray();
        facts["markets"] = market.Inspect().ToJsonString();
        facts["residents"] = town.Data.Residents.Count;
        facts["fishwives"] = town.Data.Residents.Where(r => r.Trade is "fishwife" or "market_woman").Select(r => new { r.Id, r.Trade, r.Work.Place, r.Work.Kind, r.Household }).ToArray();
        await Shot("vismarkt-9-above", new Vector3(-117, 38, 2), new Vector3(-117, 0, 29), 40);
        await Shot("vismarkt-9-street", new Vector3(-104, 2.2f, 14), new Vector3(-120, 1.2f, 30), 30);
        Check("market surveyed", items.Count > 0, items.Count);
    }

    // ------------------------------------------------------------------ the Vismarkt's sellers (#150): real people, carts, set-up, selling, packing
    private async Task Market()
    {
        // (`--market-place grote_markt`: the Grote Markt's sellers, #192; the fish checks are the Vismarkt's)
        string place = Main.I.Arg("market-place") is { Length: > 0 } mp ? mp : "vismarkt";
        bool fish = place == "vismarkt";
        string prefix = fish ? People.NativeMarket.SellerPrefix : "gm_seller_";
        string Ware(string goods) => goods switch { "fish" => "herring", "veg" => "apple", "cloth" => "shawl", "pots" => "plant", "junk" => "scarf", "hot" => "soup", _ => goods };
        System.Text.Json.Nodes.JsonArray Here() => new(market0().PitchState().Where(p => p!["place"]?.GetValue<string>() == place).Select(p => p!.DeepClone()).ToArray());
        People.NativeMarket market0() => People.NativeMarket.I!;
        var market = People.NativeMarket.I ?? throw new InvalidOperationException("no market part");
        var api = Net.ServerLink.I!.Api!;
        var crowd = town.Crowd!;
        await Dev.Kit.I.Light(4.5, "clear", day: 1);
        await Frames(120);
        var sellers = town.Data!.Residents.Where(r => r.Id.StartsWith(prefix, StringComparison.Ordinal)).OrderBy(r => r.Work.Pitch).ToList();
        var pitches = market.ItemsAt(place);
        var item = pitches.Where(it => it.Pitch >= 0).ToDictionary(it => it.Pitch);
        int count = pitches.Count;
        var centre = fish ? new Vector3(-117, 0, 29) : new Vector3((float)pitches.Average(i => i.X), 0, (float)pitches.Average(i => i.Z));
        Vector3 above = fish ? new Vector3(-117, 38, 2) : centre + new Vector3(0, 38, -27), look = fish ? new Vector3(-117, 30, 4) : centre + new Vector3(0, 30, -25);
        Vector3 street = fish ? new Vector3(-104, 2.2f, 14) : centre + new Vector3(14, 2.2f, -16), streetAt = fish ? new Vector3(-120, 1.2f, 30) : centre + new Vector3(-2, 1.2f, 2);
        Check($"the {place} market-day stalls are its pitches, each kept by its own seller", count == (fish ? 16 : 20) && item.Count == count && sellers.Count == count && sellers.All(r => r.Work.Pitch is { } k && item.ContainsKey(k) && r.Work.Place == place) && sellers.Select(r => r.Work.Pitch).Distinct().Count() == count, new { pitches = pitches.Count, sellers = sellers.Count });
        Check("every seller is a woman with her own home and market hours Monday to Saturday", sellers.All(r => r.Sex == "f" && r.HomeHouse >= 0 && r.Sched.Day.Any(s => s.Act == "work") && r.Sched.Sunday.All(s => s.Act != "work")));
        facts["sellers"] = sellers.Select(r => new { r.Id, r.Name, r.Kind, r.Trade, pitch = r.Work.Pitch, home = new[] { Math.Round(r.HomeSx, 1), Math.Round(r.HomeSz, 1) }, day = r.Sched.Day.Select(s => $"{s.A:0.00}-{s.B:0.00} {s.Act}").ToArray() }).ToArray();
        var transport = await api.TownTransport();
        var carts = sellers.Select(r => (r, cart: transport.Vehicles.FirstOrDefault(v => v.Kind == "handcart" && v.Owner == r.Id))).ToList();
        bool ParkedBy((Resident r, Net.ResidentVehicle? cart) c) => c.cart != null && c.cart.Parks.Any(p => p.Key.StartsWith("work", StringComparison.Ordinal) && p.Value.Length >= 2 && Math.Sqrt(Math.Pow(p.Value[0] - item[c.r.Work.Pitch!.Value].Seller.X, 2) + Math.Pow(p.Value[1] - item[c.r.Work.Pitch!.Value].Seller.Z, 2)) < 4.0);
        Check("every seller has her family's handcart, parked beside her pitch at work", carts.All(ParkedBy), carts.Where(c => !ParkedBy(c)).Select(c => new { c.r.Id, cart = c.cart?.Id, parks = c.cart?.Parks.Select(p => p.Key + ":" + string.Join(",", p.Value)).ToArray() }).ToArray());
        var onPitch = transport.Vehicles.Where(v => !v.Owner.StartsWith(prefix, StringComparison.Ordinal)).SelectMany(v => v.Parks.Values.Append(v.Home).Select(q => (v.Id, q)))
            .Where(c => c.q.Length >= 2 && pitches.Any(it => it.Rects.Any(r => r.Contains(c.q[0], c.q[1], .8)) || Math.Sqrt(Math.Pow(c.q[0] - it.Seller.X, 2) + Math.Pow(c.q[1] - it.Seller.Z, 2)) < 1.2)).Select(c => c.Id + " " + string.Join(",", c.q)).ToArray();
        Check("no one else's cart or velocipede is parked on a pitch", onPitch.Length == 0, onPitch);
        // a native way on foot from her door to her place behind the stall
        var noWay = new List<object>();
        foreach (var r in sellers)
        {
            var it = item[r.Work.Pitch!.Value];
            var way = World.Ways.NativePath(town.Walk!, new Vector2((float)r.HomeSx, (float)r.HomeSz), new Vector2((float)it.Seller.X, (float)it.Seller.Z));
            double end = way is { Count: > 0 } ? way[^1].DistanceTo(new Vector2((float)it.Seller.X, (float)it.Seller.Z)) : 99;
            if (end > 1.2) noWay.Add(new { r.Id, end = Math.Round(end, 2), points = way?.Count ?? 0 });
        }
        Check("every seller has a walking route from her door to her pitch", noWay.Count == 0, noWay);
        Check("before dawn every pitch is empty: no stall without its seller", Here().All(p => p!["level"]!.GetValue<int>() == -1), Here().ToJsonString());
        double stockDawn = await Stock(api);

        // one seller from her door to her pitch with her handcart
        var first = carts.Where(ParkedBy).Select(c => c.r).OrderBy(r => Math.Abs(Math.Sqrt(Math.Pow(r.HomeSx - item[r.Work.Pitch!.Value].Seller.X, 2) + Math.Pow(r.HomeSz - item[r.Work.Pitch!.Value].Seller.Z, 2)) - 50)).First();
        var firstAt = item[first.Work.Pitch!.Value];
        double walkH = Math.Sqrt(Math.Pow(first.HomeSx - firstAt.Seller.X, 2) + Math.Pow(first.HomeSz - firstAt.Seller.Z, 2)) * 1.5 / 2.0 / 60;
        double leave = first.Sched.Day.First(s => s.Act == "work").A - walkH;
        await Dev.Kit.I.Light(leave - .25, "clear", day: 1);
        Game.GameState.I.PlayingWhen = () => true;
        town.Refill();
        var door = new Vector3((float)first.HomeSx, 0, (float)first.HomeSz);
        await Look(door + new Vector3(4, 3, 4), door + Vector3.Up, 30);
        bool pushed = false, cartShot = false;
        var phases = new List<string>();
        var keys = new List<string>();
        for (int i = 0; i < 60 * 300; i++)
        {
            await Frame();
            var s = town.ActionPerson(first.Id);
            var trip = ResidentJourneys.I?.Trips.FirstOrDefault(t => t.Person.R.Id == first.Id);
            if (trip != null && (phases.Count == 0 || phases[^1] != trip.Phase)) phases.Add(trip.Phase);
            if (s != null && (keys.Count == 0 || !keys[^1].EndsWith(s.Key))) keys.Add($"{town.Hour:0.000} drawn={s.P != null} inside={s.Inside} {s.Key}");
            if (s?.P is { } p)
            {
                if (i % 30 == 0) await Look(new Vector3((float)p.X, 0, (float)p.Z) + new Vector3(3.5f, 2.6f, 3.5f), new Vector3((float)p.X, 1, (float)p.Z), 1);
                bool withCart = crowd.PuppetVehicleNode(p) != null;
                pushed |= withCart;
                if (withCart && !cartShot && i > 120) { cartShot = true; await Shot("market-0515-cart", new Vector3((float)p.X, 0, (float)p.Z) + new Vector3(3, 2.2f, 3), new Vector3((float)p.X, .9f, (float)p.Z), 4); }
            }
            if (pushed && trip == null && s != null && Math.Abs(s.X - firstAt.Seller.X) + Math.Abs(s.Z - firstAt.Seller.Z) < 2.5) break;
        }
        Game.GameState.I.PlayingWhen = () => false;
        var sNow = town.ActionPerson(first.Id);
        facts["firstSeller"] = new { first.Id, first.Name, leave, phases, keys, pushed, at = sNow == null ? null : new[] { Math.Round(sNow.X, 2), Math.Round(sNow.Z, 2) }, pitch = new[] { firstAt.Seller.X, firstAt.Seller.Z }, hour = town.Hour };
        Check("a seller pushes her handcart from her door to her pitch", pushed && sNow != null && Math.Abs(sNow.X - firstAt.Seller.X) + Math.Abs(sNow.Z - firstAt.Seller.Z) < 2.5, facts["firstSeller"]);
        await Frames(60);
        var fc = new Vector3((float)firstAt.X, 0, (float)firstAt.Z);
        await Shot("market-0530-arrived", fc + new Vector3(MathF.Sin((float)firstAt.Yaw), 0, MathF.Cos((float)firstAt.Yaw)) * 4.5f + new Vector3(0, 2.4f, 0), fc + Vector3.Up * .8f, 30);

        // setting up: before seven the stalls stand part-built, and nobody sells yet
        await Dev.Kit.I.Light(6.25, "clear", day: 1);
        town.Refill();
        await Look(look, centre, 60);
        await AtPitches(market, count, 240, place);
        var setup = Here();
        int building = setup.Count(p => p!["level"]!.GetValue<int>() is 0 or 1), ready = setup.Count(p => p!["level"]!.GetValue<int>() == 2);
        facts["setup0615"] = setup.ToJsonString();
        Check("at 6:15 the sellers are building their stalls: frames and awnings up, no goods", building >= count * 3 / 4 && ready == 0, new { building, ready });
        var seller = sellers[0];
        string? shut = market.NotOpen(seller.Id);
        string refused = "";
        try { await api.Buy(seller.Id, Ware(item[seller.Work.Pitch!.Value].Goods)); } catch (Net.ApiException e) { refused = e.Message; }
        Check("before seven a seller says she is not open yet, and sells nothing", shut != null && shut.StartsWith("not open yet") && refused.Contains("Not open yet"), new { shut, refused });
        await Shot(place + "-0615-setup", street, streetAt, 20);

        // the market: every pitch kept and selling, each seller at her own place, the fishwives gutting
        await Dev.Kit.I.Light(9, "clear", day: 1);
        town.Refill();
        await Look(look, centre, 60);
        await AtPitches(market, count, 240, place);
        var nine = Here();
        facts["market0900"] = nine.ToJsonString();
        Check("at 9:00 every pitch stands with its goods out and its own seller behind it", nine.All(p => p!["level"]!.GetValue<int>() == 2), nine.Where(p => p!["level"]!.GetValue<int>() != 2).Select(p => p!.ToJsonString()).ToArray());
        Check($"no anonymous sellers on the {place}", market.Inspect().Any(f => f!["place"]!.GetValue<string>() == place && f["sellers"]!.GetValue<int>() == 0));
        await Shot(place + "-0900-above", above, centre, 30);
        await Shot(place + "-0900-street", street, streetAt, 20);
        // close to a few sellers: the camera beside each, their bodies drawn
        var close = new List<(string Id, string Kind, bool Drawn, string? Work, string? Clip, double Off)>();
        foreach (var r in fish ? sellers.Where(r => item[r.Work.Pitch!.Value].Kind == "fishtable").Take(3).Concat(sellers.Where(r => item[r.Work.Pitch!.Value].Kind == "stall").Take(1)) : sellers.GroupBy(r => item[r.Work.Pitch!.Value].Kind).Select(g => g.First()).Take(6))
        {
            var it = item[r.Work.Pitch!.Value];
            var front = new Vector3((float)it.X, 0, (float)it.Z) + new Vector3(MathF.Sin((float)it.Yaw), 0, MathF.Cos((float)it.Yaw)) * 2.6f;
            await Look(front + Vector3.Up * 1.6f, new Vector3((float)it.Seller.X, 1, (float)it.Seller.Z), 60);
            // (a stall-keeper takes a few steps round her stall now and then: wait until she is back at it)
            var s = town.ActionPerson(r.Id);
            for (int k = 0; k < 60 * 40 && !(s?.P is { State: not "walk" } q && Math.Sqrt(Math.Pow(q.X - it.Seller.X, 2) + Math.Pow(q.Z - it.Seller.Z, 2)) < .45); k++) await Frame();
            await Frames(60);
            close.Add((r.Id, it.Kind, s?.P != null, s?.P?.Human.Work, s?.P?.Human.AnimationState.Clip, s?.P == null ? -1 : Math.Round(Math.Sqrt(Math.Pow(s.P.X - it.Seller.X, 2) + Math.Pow(s.P.Z - it.Seller.Z, 2)), 2)));
            await Shot($"{place}-0900-{it.Kind}-{r.Work.Pitch}", front + Vector3.Up * 1.6f, new Vector3((float)it.Seller.X, 1, (float)it.Seller.Z), 30);
        }
        facts["closeSellers"] = close.Select(c => new { c.Id, c.Kind, c.Drawn, c.Work, c.Clip, c.Off }).ToArray();
        if (fish) Check("behind a fish table the seller guts the catch while she sells", close.Where(c => c.Kind == "fishtable").All(c => c.Drawn && c.Work == "fish_stall"), facts["closeSellers"]);
        Check("each seller stands at her own place behind her stall", close.All(c => c.Drawn && c.Off is >= 0 and < .45), facts["closeSellers"]);
        // talk and trade: E talks, F buys; a sale takes one portion off the fish market's stock
        var buyer = sellers.Where(r => item[r.Work.Pitch!.Value].Goods == (fish ? "fish" : "cheese")).OrderBy(r => town.ActionPerson(r.Id)?.P is { State: not "walk" } q && Math.Abs(q.X - item[r.Work.Pitch!.Value].Seller.X) + Math.Abs(q.Z - item[r.Work.Pitch!.Value].Seller.Z) < .6 ? 0 : 1).First();
        var bit = item[buyer.Work.Pitch!.Value];
        // Jef at the stall's front edge (the layout's front point is 0.6 m out from it)
        var stand = new Vector3((float)(bit.Front.X - Math.Sin(bit.Yaw) * .4), 0, (float)(bit.Front.Z - Math.Cos(bit.Yaw) * .4));
        if (Player.Jef.I.Fly) Player.Jef.I.ToggleFly();
        Main.I.Cam.SetProcess(true);
        var sb = town.ActionPerson(buyer.Id);
        // (the camera looks down its -z: the yaw points from her back to Jef)
        float yaw = MathF.Atan2((float)(stand.X - (sb?.P?.X ?? bit.Seller.X)), (float)(stand.Z - (sb?.P?.Z ?? bit.Seller.Z)));
        Player.Jef.I.Place(stand.X, stand.Z, yaw, -.05f, 0);
        await Frames(60);
        // (settled on the ground, face her again: the first frames can turn him)
        Player.Jef.I.Place(Player.Jef.I.X, Player.Jef.I.Z, yaw, -.05f, 0);
        await Frames(2);
        Interact.I.RepeatPrompt();
        string prompt = Interact.I.Text;
        facts["talk"] = new { buyer = buyer.Id, buyer.First, jef = new[] { Player.Jef.I.X, Player.Jef.I.Z }, seller = sb?.P == null ? null : new[] { sb.P.X, sb.P.Z }, sells = Talks.Talk.I?.Sells(buyer.Id), shut = Interact.I.IsShut, fly = Player.Jef.I.Fly, dialogs = Windows.Dialogs.I?.Up.ToArray(), acts = Interact.I.Find().Select(a => a.Key + " " + a.Text).ToArray(), carried = Goods.I.Carried?.Kind, setYaw = yaw, jefYaw = Player.Jef.I.Yaw, pitch = Player.Jef.I.Pitch, eye = F(Player.Jef.I.Cam.GlobalPosition), aim = sb?.P == null ? null : Interact.Aim((float)sb.P.X, 1.3f, (float)sb.P.Z), only = ((System.Collections.IEnumerable)typeof(Interact).GetField("providers", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)!.GetValue(Interact.I)!).Cast<Func<float, float, Offers?>>().Select(f => (f, o: f(Player.Jef.I.X, Player.Jef.I.Z))).Where(q => q.o?.Only != null).Select(q => q.f.Method.DeclaringType?.Name + "." + q.f.Method.Name + ":" + string.Join("|", q.o!.Only!.Select(a => a.Text))).ToArray(), near = Folk.Near(Player.Jef.I.X, Player.Jef.I.Z, 2.6f).Select(n => n.Name + " " + n.Dist.ToString("0.00")).ToArray() };
        Check("at her stall E talks to the seller and F buys from her", prompt.Contains("talk to " + buyer.First) && prompt.Contains("buy from " + buyer.First), prompt);
        await Shot(place + "-0900-talk", Main.I.Cam.GlobalPosition, Main.I.Cam.GlobalPosition - Main.I.Cam.GlobalBasis.Z, 4);
        Main.I.Cam.SetProcess(false);
        if (!Player.Jef.I.Fly) Player.Jef.I.ToggleFly();
        await Api.Post<Net.JobsPayload>("api/dev/set", new Dictionary<string, object> { ["money_c"] = 500 });
        double before = await Stock(api), soldBefore = await Stock(api, "soldPlayers");
        string sold = "";
        try { var reply = await api.Buy(buyer.Id, Ware(item[buyer.Work.Pitch!.Value].Goods)); sold = reply.Line + " (" + reply.PriceC + " c)"; } catch (Net.ApiException e) { sold = "refused: " + e.Message; }
        double after = await Stock(api), soldAfter = await Stock(api, "soldPlayers");
        // (the stock itself may also rise meanwhile: the porters' crates come in from the quay)
        if (fish) Check("she sells a herring from the fish market's own stock", !sold.StartsWith("refused") && soldAfter == soldBefore + 1, new { sold, before, after, soldBefore, soldAfter });
        else Check($"she sells her {Ware(item[buyer.Work.Pitch!.Value].Goods)} at her stall", !sold.StartsWith("refused"), new { sold });
        facts["stock"] = new { dawn = stockDawn, nine = before, sold = after };

        // packing up after half past twelve: goods first, then the awning; nobody sells
        await Dev.Kit.I.Light(12.75, "clear", day: 1);
        town.Refill();
        await Look(look, centre, 60);
        await AtPitches(market, count, 240, place);
        var pack = Here();
        facts["pack1245"] = pack.ToJsonString();
        int packing = pack.Count(p => p!["level"]!.GetValue<int>() is 0 or 1), full = pack.Count(p => p!["level"]!.GetValue<int>() == 2);
        string late = "";
        try { await api.Buy(seller.Id, Ware(item[seller.Work.Pitch!.Value].Goods)); } catch (Net.ApiException e) { late = e.Message; }
        Check("at 12:45 the sellers are packing up and sell nothing", packing >= count * 3 / 4 && full == 0 && late.Contains("packing up") && market.NotOpen(seller.Id)?.StartsWith("packing up") == true, new { packing, full, late });
        await Shot(place + "-1245-packing", street, streetAt, 20);

        // the market gone by 13:30: each frame struck as its seller leaves with her cart
        await Dev.Kit.I.Light(13, "clear", day: 1);
        town.Refill();
        await Look(look, centre, 240);
        facts["gone1300"] = Here().ToJsonString();
        await Shot(place + "-1300-above", above, centre, 20);
        await Shot(place + "-1300-street", street, streetAt, 20);
        double home = sellers.Max(r => r.Sched.Day.First(q => q.Act == "work").B) + .05;
        await Dev.Kit.I.Light(home, "clear", day: 1);
        town.Refill();
        await Look(look, centre, 240);
        // (a seller fetching her cart for the way home: up to a minute more)
        for (int i = 0; i < 60 * 60 && Here().Any(p => p!["level"]!.GetValue<int>() != -1); i += 30) await Frames(30);
        var gone = Here();
        facts["goneAt"] = home;
        Check("when the last seller's day ends every seller has gone home and her pitch is empty", gone.All(p => p!["level"]!.GetValue<int>() == -1), gone.Where(p => p!["level"]!.GetValue<int>() != -1).Select(p => p!.ToJsonString()).ToArray());
        // Sunday: no market
        await Dev.Kit.I.Light(9, "clear", day: 7);
        town.Refill();
        await Look(look, centre, 240);
        Check("on Sunday there is no market", Here().All(p => p!["level"]!.GetValue<int>() == -1) && market.NotOpen(seller.Id) == "no market on Sunday", new { shut = market.NotOpen(seller.Id), day = town.Day, up = Here().Where(p => p!["level"]!.GetValue<int>() != -1).Select(p => p!.ToJsonString()).ToArray() });
        await Dev.Kit.I.Light(13, "clear", day: 1);
    }

    /// <summary>After a jump in time the sellers walk to their pitches in real time: wait until this many stand at theirs.</summary>
    private async Task AtPitches(People.NativeMarket market, int want, double seconds, string place = "vismarkt")
    {
        for (int i = 0; i < seconds * 60; i++)
        {
            await Frame();
            if (i % 30 == 0 && market.PitchState().Count(p => p!["place"]?.GetValue<string>() == place && p["level"]!.GetValue<int>() >= 0) >= want) break;
        }
        await Frames(30);
    }

    private static async Task<double> Stock(Net.Api api, string field = "stock")
    {
        var data = await api.Get<JsonElement>("api/trade");
        foreach (var p in data.GetProperty("posts").EnumerateArray()) if (p.GetProperty("id").GetString() == "vismarkt") return p.GetProperty(field).GetDouble();
        return double.NaN;
    }

    // ------------------------------------------------------------------ the Vismarkt pitches (#150): each seller's place behind her stall on open ground, and her cart's place beside it
    private async Task PitchSpots()
    {
        var market = People.NativeMarket.I ?? throw new InvalidOperationException("no market part");
        await Dev.Kit.I.Light(4.5, "clear", day: 1);
        market.ShowAll = true;
        await Frames(60);
        var crowd = town.Crowd!;
        // (`--pitch-place grote_markt` for the Grote Markt's pitches, #192)
        string place = Main.I.Arg("pitch-place") is { Length: > 0 } pp ? pp : "vismarkt";
        var items = market.ItemsAt(place);
        var data = System.Text.Json.Nodes.JsonNode.Parse(File.ReadAllText(Path.Combine(Paths.NativeDataRoot ?? Paths.Root, "services", "native-extras.json")))!["fields"]!.AsArray().First(f => f!["place"]!.GetValue<string>() == place)!["pitches"]!["list"]!.AsArray();
        bool InStall(double x, double z, double pad) => items.Any(it => it.Rects.Any(r => r.Contains(x, z, pad)));
        // the sellers' places: the layout's own, or the nearest open ground behind the stall
        var sellers = new (double x, double z)[items.Count];
        var moved = new double[items.Count];
        foreach (var it in items)
        {
            var at = new Vector3((float)it.X, 0, (float)it.Z);
            await Look(at + new Vector3(0, 14, 7), at, 40);
            double c = Math.Cos(it.Yaw), s = Math.Sin(it.Yaw);
            (double x, double z)? best = null;
            foreach (double back in new[] { 0, .1, .2, .3, .4, .5, .6, .7, .8, .9, 1.0, 1.2 })
            {
                foreach (double side in new[] { 0, .15, -.15, .3, -.3, .45, -.45, .6, -.6 })
                {
                    double u = it.SellerAt.X + side, v = it.SellerAt.Z - back, x = it.X + u * c + v * s, z = it.Z - u * s + v * c;
                    if (!crowd.CanStand(x, z) || InStall(x, z, .3) || sellers.Take(it.Pitch).Any(q => Math.Sqrt(Math.Pow(q.x - x, 2) + Math.Pow(q.z - z, 2)) < 1.2)) continue;
                    best = (x, z); moved[it.Pitch] = Math.Sqrt(back * back + side * side); break;
                }
                if (best != null) break;
            }
            sellers[it.Pitch] = best ?? (double.NaN, double.NaN);
        }
        // the carts' places: 2.3 m by 1.1 m on open ground, clear of every stall, seller and other cart
        var carts = new List<(double x, double z, double yaw)?>();
        bool CartFits(double x, double z, double yaw)
        {
            double fx = Math.Sin(yaw), fz = Math.Cos(yaw);
            for (double a = -1.15; a <= 1.151; a += .23)
                for (double b = -.55; b <= .551; b += .275)
                {
                    double px = x + fx * a - fz * b, pz = z + fz * a + fx * b;
                    if (!town.Walk!.Free(px, pz) || InStall(px, pz, .2)) return false;
                    if (sellers.Any(q => Math.Sqrt(Math.Pow(q.x - px, 2) + Math.Pow(q.z - pz, 2)) < .9)) return false;
                    if (carts.Any(q => q is { } o && Math.Abs(px - o.x) < 1.6 && Math.Abs(pz - o.z) < 1.6)) return false;
                }
            return true;
        }
        foreach (var it in items)
        {
            var had = data[it.Pitch]!["cart"] as System.Text.Json.Nodes.JsonArray;
            (double x, double z, double yaw)? best = had != null && CartFits(had[0]!.GetValue<double>(), had[1]!.GetValue<double>(), had[2]!.GetValue<double>()) ? (had[0]!.GetValue<double>(), had[1]!.GetValue<double>(), had[2]!.GetValue<double>()) : null;
            var me = sellers[it.Pitch];
            double fx = Math.Sin(it.Yaw), fz = Math.Cos(it.Yaw), sx = fz, sz = -fx;
            foreach (double back in new[] { 1.0, 1.3, 1.6, 2.0, 2.5, 3.0, 3.5 })
                foreach (double side in new[] { 1.2, -1.2, 1.8, -1.8, .6, -.6, 2.4, -2.4, 0, 3.0, -3.0 })
                    foreach (double turn in new[] { Math.PI / 2, 0 })
                    {
                        if (best != null) break;
                        double x = me.x - fx * back + sx * side, z = me.z - fz * back + sz * side, yaw = it.Yaw + turn;
                        if (CartFits(x, z, yaw)) best = (x, z, yaw);
                    }
            carts.Add(best);
        }
        market.ShowAll = false;
        double R2(double v) => Math.Round(v, 2);
        var list = items.Select(it => new { kind = it.Kind, goods = it.Goods, x = R2(it.X), z = R2(it.Z), yaw = Math.Round(it.Yaw, 3), length = R2(it.HalfLength * 2), seller = new[] { R2(sellers[it.Pitch].x), R2(sellers[it.Pitch].z) }, cart = carts[it.Pitch] is { } c ? new[] { R2(c.x), R2(c.z), Math.Round(c.yaw, 3) } : null }).ToArray();
        facts["pitchesNew"] = list;
        facts["moved"] = moved.Select(R2).ToArray();
        Check("every pitch has an open place for its seller behind the stall", sellers.All(q => double.IsFinite(q.x)), facts["moved"]);
        Check("every pitch has a place for its seller's cart beside it", carts.All(c => c != null));
    }

    // ------------------------------------------------------------------ the Vismarkt pitches (#150): the kept stalls and a cart place beside each
    private async Task PitchPlan()
    {
        await Dev.Kit.I.Light(9, "clear");
        await Frames(60);
        var market = People.NativeMarket.I ?? throw new InvalidOperationException("no market part");
        // (`--pitch-place grote_markt --pitch-keep 0,2,5` or `all`: another market's plan, #192)
        string place = Main.I.Arg("pitch-place") is { Length: > 0 } pp ? pp : "vismarkt";
        var items = market.ItemsAt(place);
        string keepArg = Main.I.Arg("pitch-keep");
        int[] keep = keepArg == "all" ? items.Select(i => i.Rank).ToArray() : keepArg != "" ? keepArg.Split(',').Select(int.Parse).ToArray() : new[] { 0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 12, 13, 14, 17, 22, 30 };
        var kept = keep.Where(k => k < items.Count).Select(k => items.First(i => i.Rank == k)).ToList();
        var crowd = town.Crowd!;
        var stalls = town.Data!.Stalls.Where(s => s.Place == place).ToList();
        var carts = new List<(double x, double z, double yaw)>();
        bool InItem(double x, double z, double pad) => kept.Any(it => it.Rects.Any(r => r.Contains(x, z, pad)) || Math.Abs(x - it.Seller.X) + Math.Abs(z - it.Seller.Z) < .8 + pad)
            || stalls.Any(s => Math.Abs(x - s.X) < 1.6 + pad && Math.Abs(z - s.Z) < 1.6 + pad);
        bool Fits(double x, double z, double yaw)
        {
            double fx = Math.Sin(yaw), fz = Math.Cos(yaw);
            for (double a = -1.15; a <= 1.151; a += .23)
                for (double b = -.55; b <= .551; b += .275)
                {
                    double px = x + fx * a - fz * b, pz = z + fz * a + fx * b;
                    if (!town.Walk!.Free(px, pz) || InItem(px, pz, .2)) return false;
                    if (carts.Any(c => Math.Abs(px - c.x) < 1.6 && Math.Abs(pz - c.z) < 1.6)) return false;
                }
            return true;
        }
        var plan = new List<object>();
        foreach (var it in kept)
        {
            double fx = Math.Sin(it.Yaw), fz = Math.Cos(it.Yaw), sx = fz, sz = -fx;
            (double x, double z, double yaw)? best = null;
            foreach (double back in new[] { 1.0, 1.3, 1.6, 2.0, 2.5 })
                foreach (double side in new[] { 0.0, .6, -.6, 1.2, -1.2, 1.8, -1.8, 2.4, -2.4 })
                    foreach (double turn in new[] { Math.PI / 2, 0 })
                    {
                        if (best != null) break;
                        double x = it.Seller.X - fx * back + sx * side, z = it.Seller.Z - fz * back + sz * side, yaw = it.Yaw + turn;
                        if (Fits(x, z, yaw)) best = (x, z, yaw);
                    }
            if (best is { } b) carts.Add(b);
            double R2(double v) => Math.Round(v, 2);
            plan.Add(new { kind = it.Kind, goods = it.Goods, x = R2(it.X), z = R2(it.Z), yaw = Math.Round(it.Yaw, 3), length = R2(it.HalfLength * 2), seller = new[] { R2(it.Seller.X), R2(it.Seller.Z) }, cart = best is { } c ? new[] { R2(c.x), R2(c.z), Math.Round(c.yaw, 3) } : null, rank = it.Rank });
        }
        facts["pitches"] = plan;
        facts["standAtSellers"] = kept.Select(it => new { stand = crowd.CanStand(it.Seller.X, it.Seller.Z), free = town.Walk!.Free(it.Seller.X, it.Seller.Z) }).ToArray();
        Check("every kept pitch has a free cart place beside it", plan.Count == kept.Count && carts.Count == kept.Count, new { kept = kept.Count, carts = carts.Count });
        var centre = place == "vismarkt" ? new Vector3(-117, 0, 29) : new Vector3((float)kept.Average(i => i.X), 0, (float)kept.Average(i => i.Z));
        await Shot("pitchplan-9-above", centre + new Vector3(0, 38, -27), centre, 40);
    }

    // ------------------------------------------------------------------ the hiring board (#153): what stands there now
    private async Task BoardSurvey()
    {
        await Dev.Kit.I.Light(13, "clear");
        var (bx, bz) = Spots.Board;
        var at = new Vector3(bx, 0, bz);
        var meshes = BakedWorld.All(Main.I.World).OfType<MeshInstance3D>().Where(m => m.Mesh != null && m.IsVisibleInTree())
            .Select(m => (m, box: m.GlobalTransform * m.GetAabb())).Where(p => p.box.Intersects(new Aabb(at - new Vector3(1.6f, 0, 1.6f), new Vector3(3.2f, 2.8f, 3.2f)))).ToList();
        facts["boardMeshes"] = meshes.Select(p => new { path = p.m.GetPath().ToString().Split("/town/").Last(), size = F(p.box.Size), centre = F(p.box.GetCenter()), tris = p.m.Mesh!.GetFaces().Length / 3 }).ToArray();
        facts["boardSpot"] = F(at);
        await Shot("board-front", at + new Vector3(0, 1.6f, -3.2f), at + Vector3.Up * 1.5f, 30);
        await Shot("board-back", at + new Vector3(1.5f, 1.6f, 3.0f), at + Vector3.Up * 1.4f, 20);
        Check("board surveyed", true);
    }

    // ------------------------------------------------------------------ the hiring board (#153): model, notes, places, taking by a note
    private async Task Board()
    {
        await Dev.Kit.I.Light(13, "clear");
        Game.GameState.I.Apply(await Api.Jobs());
        await Frames(30);
        var board = WorkBoard.I ?? throw new InvalidOperationException("no work board part");
        var frame = board.Frame;
        // the bake's plain board is gone; the new one stands where it stood
        var (bx, bz) = Spots.Board;
        var oldShown = BakedWorld.All(Main.I.World).OfType<MeshInstance3D>().Where(m => m.IsVisibleInTree() && m.Mesh != null && m.GetParent() is Node3D g && g.GetParent()?.Name.ToString() == "town")
            .Select(m => (m, box: m.GlobalTransform * m.GetAabb())).Where(p => p.box.Size.Length() < 2.6f && new Vector2(p.box.GetCenter().X - bx, p.box.GetCenter().Z - bz).Length() < 1.2f).Select(p => p.m.Name.ToString()).ToArray();
        Check("the old plain board is not drawn", oldShown.Length == 0, oldShown);
        var model = BakedWorld.All(Main.I.World).OfType<Node3D>().FirstOrDefault(n => n.Get("ObjectId").VariantType == Variant.Type.String && n.Get("ObjectId").AsString() == "hiring-board");
        Check("the new hiring board stands by the Hessenatie", model != null && BakedWorld.All(model).OfType<GeometryInstance3D>().Any(g => g.IsVisibleInTree()) && new Vector2(model.GlobalPosition.X - bx, model.GlobalPosition.Z - bz).Length() < .3f);
        int Offered() => Game.GameState.I.Jobs.Count(j => j.Status == "offered" && j.Source is not ("night" or "emigrant"));
        var slots = Game.GameState.I.BoardSlots;
        Check("the engine gives each open job on the board a place, eight at most", slots != null && slots.Count == Math.Min(8, Offered()) && slots.Values.Distinct().Count() == slots.Count && slots.Values.All(v => v is >= 0 and < 8), slots);
        Check("one note hangs for each open job on the board", board.Notes.Count == (slots?.Count ?? -1), board.Notes.Count);
        Check("every note says what the work is, who gives it and the pay", board.Notes.All(n => n.Title.Text == n.Job.Title && n.Giver.Text.Length > 5 && n.Pay.Text.Contains(n.Job.PayC.ToString())));
        // readable from a metre: the title's letters at least 2.5 cm high
        Check("a note's letters are big enough to read from a metre", board.Notes.All(n => n.Title.FontSize * n.Title.PixelSize >= .028f && n.Giver.FontSize * n.Giver.PixelSize >= .022f));
        await Shot("board-13-front", frame * new Vector3(0, 1.62f, 2.6f), frame * new Vector3(0, 1.5f, .09f), 30);
        await Shot("board-13-metre", frame * new Vector3(-.3f, 1.62f, 1.0f), frame * new Vector3(-.43f, 1.56f, .09f), 20);
        // fill the board: more open jobs than places; the newest wait off the board
        string[] employers = { "peeters", "sooi", "tuur", "mertens", "van_aken" };
        for (int i = 0; Offered() < 11 && i < 12; i++)
        {
            await Api.Post<JsonElement>("api/dev/job", new Dictionary<string, object> { ["type"] = "carry", ["items"] = 1 + i % 2, ["goods"] = "crates", ["employer"] = employers[i % employers.Length] });
            Game.GameState.I.Apply(await Api.Jobs());
        }
        await Frames(30);
        slots = Game.GameState.I.BoardSlots;
        var waiting = Game.GameState.I.Jobs.Where(j => j.Status == "offered" && j.Source is not ("night" or "emigrant") && slots?.ContainsKey(j.Id.ToString()) != true).ToList();
        Check("a full board holds eight notes and no more", board.Notes.Count == 8 && slots?.Count == 8, new { notes = board.Notes.Count, offered = Offered() });
        Check("the jobs that do not fit wait off the board and off its list", waiting.Count > 0 && Jobs.I.VisibleJobs().All(j => !waiting.Contains(j)), waiting.Count);
        await Shot("board-13-full", frame * new Vector3(0, 1.62f, 2.4f), frame * new Vector3(0, 1.5f, .09f), 30);
        await Shot("board-13-full-metre", frame * new Vector3(.25f, 1.6f, .95f), frame * new Vector3(.43f, 1.56f, .09f), 20);
        // take a job by looking at its note and pressing E
        var note = board.Notes.FirstOrDefault(n => n.Job.Playable && n.Job.Source == "dev") ?? board.Notes.First(n => n.Job.Playable);
        int place = note.Place, taken = note.Job.Id;
        var at = note.At;
        var stand = frame * new Vector3(WorkBoard.Places[place].X, 0, 1.05f);
        if (Player.Jef.I.Fly) Player.Jef.I.ToggleFly();
        Main.I.Cam.SetProcess(true);
        float yaw = MathF.Atan2(stand.X - at.X, stand.Z - at.Z);
        Player.Jef.I.Place(stand.X, stand.Z, yaw, -.05f, 0);
        await Frames(40);
        Interact.I.RepeatPrompt();
        string prompt = Interact.I.Text;
        Check("looking at a note, E offers to take that job", prompt.Contains("take the job: " + note.Job.Title), prompt);
        bool pressed = Interact.I.Press(Key.E);
        for (int i = 0; i < 240 && Game.GameState.I.Jobs.FirstOrDefault(j => j.Id == taken)?.Status != "taken"; i++) await Frame();
        Game.GameState.I.Apply(await Api.Jobs());
        await Frames(30);
        slots = Game.GameState.I.BoardSlots;
        Check("E on the note takes the job", pressed && Game.GameState.I.Jobs.FirstOrDefault(j => j.Id == taken)?.Status == "taken");
        Check("the taken job's note comes down", board.Notes.All(n => n.Job.Id != taken));
        Check("a waiting job goes up in the freed place", board.Notes.Count == 8 && board.Notes.Any(n => n.Place == place && waiting.Any(w => w.Id == n.Job.Id)), board.Notes.Select(n => new { n.Place, n.Job.Id }).ToArray());
        Main.I.Cam.SetProcess(false);
        if (!Player.Jef.I.Fly) Player.Jef.I.ToggleFly();
        foreach (var (weather, hour) in new[] { ("rain", 13), ("clear", 21) })
        {
            await Dev.Kit.I.Light(hour, weather);
            await Frames(30);
            await Shot($"board-{weather}{hour}", frame * new Vector3(.8f, 1.65f, 2.4f), frame * new Vector3(0, 1.5f, .09f), 25);
        }
        await Dev.Kit.I.Light(13, "clear");
        await Shot("board-13-side", frame * new Vector3(2.0f, 1.5f, 1.2f), frame * new Vector3(0, 1.6f, 0), 20);
        await Shot("board-13-back", frame * new Vector3(-1.0f, 1.6f, -2.2f), frame * new Vector3(0, 1.5f, 0), 20);
    }

    // ------------------------------------------------------------------ what is there (a survey for the work)
    private void Facts()
    {
        facts["fires"] = Fires.I?.Spots.Select(s => new { at = F(s.at), s.size, s.group }).ToArray();
        facts["benches"] = Day.I?.Benches.Select(b => new { b.Id, b.Label, b.X, b.Z, b.Y, b.Fine }).ToArray();
        facts["places"] = town.Data!.Places.Select(p => new { id = p.Key, p.Value.Label, x = Math.Round(p.Value.X, 1), z = Math.Round(p.Value.Z, 1), door = p.Value.Door is { } d ? new[] { Math.Round(d.X, 2), Math.Round(d.Z, 2) } : null, @out = p.Value.Out is { } o ? new[] { Math.Round(o.X, 2), Math.Round(o.Z, 2) } : null }).ToArray();
        facts["benchPlaces"] = BenchPlaces.All.Select(b => new { b.Id, b.Model, at = F(b.At.Origin), yaw = MathF.Round(b.Facing, 3), b.Label }).ToArray();
        var indoors = town.Indoors;
        if (indoors != null)
            facts["rooms"] = indoors.Houses.Select(h =>
            {
                var counter = Main.I.World.NativeFurniture?.FirstOrDefault(f => f.Room == h.Id && f.Kind == "counter");
                var spots = indoors.StandingSpots(h);
                return new
                {
                    h.Id,
                    keeperAnchor = counter == null ? null : F(counter.KeeperAt),
                    stand = counter == null ? null : F(counter.StandAt),
                    first = spots.Count == 0 ? null : new[] { spots[0].X, spots[0].Z },
                    anchorFree = counter != null && indoors.FloorFree(h, counter.KeeperAt),
                    anchorHits = counter == null ? null : Hits(h.Id, counter.KeeperAt, .32f).Distinct().ToArray(),
                    behind = counter == null ? null : Behind(h.Id, counter),
                    shift = counter == null ? null : NeededShift(h.Id, counter),
                    inBounds = counter == null ? (bool?)null : InRoom(h.Id, counter.KeeperAt, .32f),
                    furniture = Main.I.World.NativeFurniture?.Where(f => f.Room == h.Id).Select(f => f.Kind).GroupBy(k => k).ToDictionary(g => g.Key, g => g.Count()),
                };
            }).ToArray();
        var hall = BakedWorld.All(Main.I.World).FirstOrDefault(n => n.Name.ToString() == "ROOM_vleeshuis");
        if (hall != null)
            facts["vleeshuis"] = BakedWorld.All(hall).Where(n => n is Skeleton3D || n.Name.ToString().Contains("keeper", StringComparison.OrdinalIgnoreCase))
                .Select(n => new { path = n.GetPath().ToString(), type = n.GetClass(), at = n is Node3D d ? F(d.GlobalPosition) : null, visible = n is Node3D v && v.IsVisibleInTree(),
                    bodies = BakedWorld.All(n.GetParent()).OfType<CollisionObject3D>().Select(b => new { path = b.GetPath().ToString(), layer = b.CollisionLayer }).ToArray() }).ToArray();
        if (town.Walk is { } walk)
        {
            var grid = new System.Text.StringBuilder();
            for (float z = 288; z <= 304; z += .5f) { for (float x = 12; x <= 28; x += .5f) grid.Append(walk.Free(x, z) ? '.' : walk.Open(x, z) ? 'o' : '#'); grid.AppendLine(); }
            File.WriteAllText(Path.Combine(dir, "rond-walk.txt"), grid.ToString());
            facts["walkBounds"] = new { walk.X0, walk.Z0, walk.W, walk.D };
        }
        Check("facts gathered", true);
    }
}
