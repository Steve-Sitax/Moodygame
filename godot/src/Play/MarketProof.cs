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


    // ------------------------------------------------------------------ what is there (a survey for the work)
    private void Facts()
    {
        facts["fires"] = Fires.I?.Spots.Select(s => new { at = F(s.at), s.size, s.group }).ToArray();
        facts["benches"] = Day.I?.Benches.Select(b => new { b.Id, b.Label, b.X, b.Z, b.Y, b.Fine }).ToArray();
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
        Check("facts gathered", true);
    }
}
