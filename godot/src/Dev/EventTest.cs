using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Audio;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.Town;
using Scheldemist.World;

namespace Scheldemist.Dev;

/// <summary>--eventtest dir: real dev routes, each engine stage photographed, lifecycle and steady-frame checks.</summary>
[GamePart(980)]
public partial class EventTest : Node
{
    private string dir = "";
    private bool started;
    private readonly List<object> rows = new();
    private readonly List<string> failures = new();
    private readonly List<double> costs = new();
    private readonly List<long> allocations = new();
    private bool measuring;
    private int day = 2;
    private string current = "";
    public override void _Ready() { dir = Main.I.Arg("eventtest"); if (dir == "") SetProcess(false); }
    public override void _Process(double delta)
    {
        if (measuring && Actors.I != null && Events.I != null)
        {
            costs.Add(Actors.I.LogicMs + Events.I.LogicMs + (TownLife.I?.LogicMs ?? 0) + (Hearses.I?.LogicMs ?? 0));
            allocations.Add(Actors.I.AllocatedBytes + Events.I.AllocatedBytes + (TownLife.I?.AllocatedBytes ?? 0) + (Hearses.I?.AllocatedBytes ?? 0));
        }
        if (started || ServerLink.I?.Api == null || !GameState.I.Live || Main.I.GetNodeOrNull<Townspeople>("Townspeople")?.Data == null) return;
        started = true; _ = Run();
    }
    private async Task Frames(int n) { for (int i = 0; i < n; i++) await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame); }
    private async Task Wait(double seconds) => await ToSignal(GetTree().CreateTimer(seconds), SceneTreeTimer.SignalName.Timeout);
    private void Check(bool condition, string why) { if (!condition) { failures.Add(current + ": " + why); GD.PrintErr("eventtest: " + current + ": " + why); } }
    private async Task Refresh(Api api) { Actors.I!.Apply(await api.Actions()); await Frames(2); }
    private async Task Advance(Api api, int minutes)
    {
        GameState.I.Apply(await api.DevAdvance(minutes));
        GameState.I.Apply(await api.Tick());
        await Refresh(api);
    }
    private void Place(EventStage stage, Events.Live? live = null)
    {
        var town = Main.I.GetNode<Townspeople>("Townspeople");
        double x = stage.X, z = stage.Z, near = 30;
        if (live != null) foreach (var lead in live.Event.Leads)
        {
            if (town.ActionPerson(lead.Id)?.P is not { } actor) continue;
            double d = Whereabouts.Hypot(actor.X - stage.X, actor.Z - stage.Z);
            if (d < near) { near = d; x = actor.X; z = actor.Z; }
        }
        var q = ViewNear(x, z, 4);
        float yaw = MathF.Atan2((float)-(x - q.X), (float)-(z - q.Z));
        Jef.I.Place((float)q.X, (float)q.Z, yaw, -0.08f, (float)Main.I.GetNode<Townspeople>("Townspeople").Walk!.BaseAt(q.X, q.Z));
        Main.I.GetNode<Townspeople>("Townspeople").Refill();
    }
    private static Pt ViewNear(double x, double z, double radius, double heading = 0)
    {
        var town = Main.I.GetNode<Townspeople>("Townspeople");
        Vector3 target = new((float)x, (float)town.Walk!.BaseAt(x, z) + 1.3f, (float)z);
        var space = Main.I.Cam.GetWorld3D().DirectSpaceState;
        for (int i = 0; i < 16; i++)
        {
            double angle = heading + i * Math.PI / 8;
            var q = Kit.I.FreeNear(x + Math.Sin(angle) * radius, z + Math.Cos(angle) * radius);
            Vector3 eye = new((float)q.X, (float)town.Walk.BaseAt(q.X, q.Z) + 1.6f, (float)q.Z);
            var ray = PhysicsRayQueryParameters3D.Create(eye, target, Solid.Layer);
            var hit = space.IntersectRay(ray);
            if (hit.Count == 0 || ((Vector3)hit["position"]).DistanceTo(target) < 1) return q;
        }
        return Kit.I.FreeNear(x + 4, z + 6);
    }
    private async Task PropPicture(string nodeName, string filename)
    {
        var prop = Main.I.View.FindChild(nodeName, true, false) as Node3D;
        Check(prop != null, "missing visible prop " + nodeName); if (prop == null) return;
        Vector3 at = prop.GlobalPosition; var q = ViewNear(at.X, at.Z, 4.5);
        var town = Main.I.GetNode<Townspeople>("Townspeople");
        Jef.I.Place((float)q.X, (float)q.Z, MathF.Atan2(at.X - (float)q.X, at.Z - (float)q.Z) + MathF.PI, -0.08f, (float)town.Walk!.BaseAt(q.X, q.Z));
        town.Refill(); await Frames(5);
        await ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
        GetViewport().GetTexture().GetImage().SavePng(Path.Combine(dir, filename));
    }
    private async Task Run()
    {
        Directory.CreateDirectory(dir);
        var api = ServerLink.I!.Api!; var town = Main.I.GetNode<Townspeople>("Townspeople");
        try
        {
            Actors.I!.TestHoldsPoll = true;
            Jef.I.TestInput = true; GameState.I.PlayingWhen = () => false;
            AudioServer.SetBusMute(AudioServer.GetBusIndex("Master"), true);
            await Kit.I.Light(13.5, "clear"); await Wait(3);
            string[] kinds = { "musicians", "fish_auction", "quarrel", "scuffle", "street_robbery", "wedding", "funeral", "emigrant_ship", "house_fire", "tempest", "hiring", "ballad", "tavern_brawl", "burglary", "smuggling", "night_watch" };
            var only = Main.I.Arg("eventonly").Split(',', StringSplitOptions.RemoveEmptyEntries);
            foreach (string kind in kinds)
            {
                if (only.Length > 0 && !only.Contains(kind)) continue;
                current = kind; GD.Print("eventtest starts " + kind);
                await Advance(api, 600);
                await api.Post<JobsPayload>("api/dev/set", new { day, hour = 13, minute = 30, weather = "clear", food = 10, warmth = 10, sleep = 10, health = 10 });
                town.SetClock(day, 13.5); town.ClockRuns = false; Daylight.I!.SetTime(13.5f); Daylight.I.SetWeather("clear"); Daylight.I.Settle();
                // No long calendar jump: later kinds reuse the same dev day after the previous event finished.
                var plan = await api.DevEvent(kind); Check(plan.Ok, "engine refused the event: " + plan.Why); if (!plan.Ok) continue;
                int soundBefore = Events.I!.SoundStarts, cueBefore = Events.I.CueStarts;
                await Advance(api, 2);
                var live = Events.I!.Find(plan.Id); Check(live != null && live.Event.Status == "running", "not running after the engine tick"); if (live == null) continue;
                var ids = new List<string>(live.Event.People);
                Soundscape.I?.Rung.Clear();
                bool propsEver = false, cuesExpected = false, cueFired = false, soundExpected = false; int maxThere = 0;
                int guard = 0;
                while (live != null && live.Event.Status == "running" && guard++ < 24)
                {
                    var stage = Events.StageOf(live.Event)!; int stageIndex = live.Event.Stage;
                    Place(live.Event.Hiring is { Spots.Count: > 0 } hiring ? stage with { X = hiring.Spots[0].X, Z = hiring.Spots[0].Z } : stage, live);
                    await Wait(stageIndex == 0 ? 30 : 3);
                    await Refresh(api); live = Events.I.Find(plan.Id); if (live == null) break;
                    stage = Events.StageOf(live.Event)!;
                    foreach (string id in live.Event.People) if (!ids.Contains(id)) ids.Add(id);
                    int there = 0, held = 0, drawn = 0;
                    foreach (string id in ids)
                    {
                        var s = town.ActionPerson(id); if (s?.ActionHeld == true) held++;
                        if (s?.P != null) drawn++;
                        if (town.PositionOf(id) is { } p && Whereabouts.Hypot(p.x - stage.X, p.z - stage.Z) < live.Event.R + 6) there++;
                    }
                    int atTargets = 0;
                    foreach (var run in Actors.I.Runs) if (run.Action.EventId == plan.Id && town.PositionOf(run.Action.Npc) is { } at && Whereabouts.Hypot(at.x - (run.Action.TargetX ?? stage.X), at.z - (run.Action.TargetZ ?? stage.Z)) < live.Event.R + 6) atTargets++;
                    there = Math.Max(there, atTargets);
                    maxThere = Math.Max(maxThere, there); propsEver |= live.Props.Count > 0; cuesExpected |= stage.Cues?.Count > 0; soundExpected |= stage.Sound != "none";
                    if (Soundscape.I != null) foreach (string rung in Soundscape.I.Rung) cueFired |= rung.StartsWith("cue ", StringComparison.Ordinal);
                    string picture = Path.Combine(dir, kind + "-" + live.Event.Stage + "-" + stage.Op + ".png");
                    await ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
                    GetViewport().GetTexture().GetImage().SavePng(picture);
                    rows.Add(new { kind, stage = live.Event.Stage, op = stage.Op, soundKind = stage.Sound, propsKind = stage.Props, people = ids.Count, held, drawn, there, props = live.Props.Count, sound = live.Sound != null, cues = live.Cues != null, picture, left = live.Left, fire = TownLife.I?.FiresDrawn, buckets = TownLife.I?.BucketCount, chainHands = TownLife.I?.ChainHands, hearses = Hearses.I?.Count, sounds = Soundscape.I?.Rung.ToArray() });
                    if (stageIndex == 0) foreach (var lead in live.Event.Leads)
                    {
                        if (town.ActionPerson(lead.Id)?.P is not { } actor) continue;
                        var close = ViewNear(actor.X, actor.Z, 2.6, actor.Yaw);
                        float yaw = MathF.Atan2((float)-(actor.X - close.X), (float)-(actor.Z - close.Z));
                        Jef.I.Place((float)close.X, (float)close.Z, yaw, -0.08f, (float)town.Walk!.BaseAt(close.X, close.Z));
                        await Frames(4); await ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
                        GetViewport().GetTexture().GetImage().SavePng(Path.Combine(dir, kind + "-lead-" + lead.Role + ".png"));
                    }
                    if (kind == "house_fire" && stageIndex == 2)
                    {
                        await Wait(20);
                        Check(TownLife.I!.ChainHands >= 2 && TownLife.I.BucketCount > 0, "no buckets passed between chain hands");
                        rows.Add(new { kind = "chain", hands = TownLife.I.ChainHands, buckets = TownLife.I.BucketCount });
                    }
                    if (kind == "house_fire" && stageIndex == 1) await PropPicture("fire_pump", "house_fire-pump.png");
                    if (kind == "funeral" && stage.Op == "depart") await PropPicture("event_hearse", "funeral-hearse.png");
                    Place(stage, live);
                    if (stage.Props != "none") Check(live.Props.Count > 0, "no " + stage.Props + " props at stage " + live.Event.Stage);
                    foreach (var run in Actors.I.Runs) if (run.Action.EventId == plan.Id) Check(run.Person?.ActionHeld == true, "person not reserved at stage " + live.Event.Stage + ": " + run.Action.Npc);
                    if (kind == "street_robbery" && stageIndex == 1 && costs.Count == 0)
                    {
                        // This engine scene runs on the Grote Markt. Keep Jef by its actors;
                        // changing dev time here would restart the stage under test.
                        await Wait(2); measuring = true; await Frames(240); measuring = false;
                    }
                    await Advance(api, Math.Max(1, (int)Math.Ceiling(live.Left) + 1));
                    live = Events.I.Find(plan.Id);
                }
                Check(guard < 24, "stage loop exceeded its bound");
                // Night watch splits into independent patrols, including single-person groups.
                Check(ids.Count == 0 || maxThere >= Math.Min(kind == "night_watch" ? 1 : 2, ids.Count), "nobody attended near an assigned target");
                if (soundExpected) Check(Events.I.SoundStarts > soundBefore, "stage sound never started");
                if (cuesExpected) Check(Events.I.CueStarts > cueBefore, "composed cues never started");
                if (cuesExpected) Check(cueFired, "Soundscape did not fire a composed cue");
                await Advance(api, 10); await Frames(5);
                var remains = Events.I.Find(plan.Id); Check(remains == null || remains.Props.Count == 0 && remains.Sound == null && remains.Cues == null, "props or sound survived the end");
                foreach (string id in ids) Check(town.ActionPerson(id)?.ActionHeld != true || Actors.I.Runs.Any(r => r.Action.EventId != plan.Id && (r.Action.Npc == id || r.Other?.R.Id == id)), "still held after event without another engine action: " + id);
                if (kind == "house_fire")
                {
                    var life = (await api.TownLife()).Deserialize<TownLifeData>(Api.Json)!;
                    TownLife.I!.ApplyLife(life); await Frames(3);
                    Check(life.Soot.Any(s => s.Event == plan.Id) && TownLife.I.SootOpacity(plan.Id) > 0, "engine's soot did not survive fire");
                    await PropPicture("soot_0", "house_fire-soot.png");
                    TownLife.I.ApplyLife(life with { Day = life.Day + 2 }); await Frames(2);
                    Check(Math.Abs(TownLife.I.SootOpacity(plan.Id) - (0.85f / 3 + 0.05f)) < 0.001, "soot did not fade over three days");
                    TownLife.I.ApplyLife(life with { Soot = new() }); await Frames(2);
                    Check(TownLife.I.SootCount == 0, "expired soot remained");
                    rows.Add(new { kind = "soot", persisted = true, day2Opacity = 0.85f / 3 + 0.05f, expired = true });
                }
                rows.Add(new { kind, ended = true, propsEver, maxThere, released = ids.Count(id => town.ActionPerson(id)?.ActionHeld != true), reassigned = ids.Count(id => town.ActionPerson(id)?.ActionHeld == true), cueFired, soundStarts = Events.I.SoundStarts - soundBefore, cueStarts = Events.I.CueStarts - cueBefore });
                GD.Print("eventtest finished " + kind);
            }
            if (only.Length == 0 || only.Contains("family_ui")) await FamilyUi();
            if (only.Length == 0 || only.Contains("lamps")) await Lamps(api);
            if (only.Length == 0 || only.Contains("dreams")) await Dreams();
        }
        catch (Exception e) { failures.Add(current + ": " + e); GD.PrintErr(e); }
        finally
        {
            measuring = false;
            costs.Sort(); allocations.Sort();
            double mean = costs.Count == 0 ? 0 : costs.Average(), p95 = costs.Count == 0 ? 0 : costs[(int)((costs.Count - 1) * 0.95)];
            if (costs.Count > 0) Check(mean < 0.5, "events and actors exceed 0.5 ms mean: " + mean);
            if (allocations.Count > 0) Check(allocations[(int)((allocations.Count - 1) * 0.95)] == 0, "steady frames allocate managed memory");
            File.WriteAllText(Path.Combine(dir, "eventtest.json"), JsonSerializer.Serialize(new { ok = failures.Count == 0, failures, stages = rows, frame = new { count = costs.Count, meanMs = mean, p95Ms = p95, maxMs = costs.Count == 0 ? 0 : costs[^1], meanBytes = allocations.Count == 0 ? 0 : allocations.Average(), p95Bytes = allocations.Count == 0 ? 0 : allocations[(int)((allocations.Count - 1) * 0.95)] }, notCovered = new[] { "AI-invented event content (no AI in this test)", "Multiplayer ownership and actual omnibus attendance", "Full indoor ceremony choreography and exit walks", "Persistent soot and lamplighter rounds", "Individual player-requested actions and family menace choices" } }, new JsonSerializerOptions { WriteIndented = true }));
            GD.Print("eventtest wrote " + dir + " failures=" + failures.Count);
            GetTree().Quit(failures.Count == 0 ? 0 : 1);
        }
    }
    private async Task Lamps(Api api)
    {
        current = "lamps";
        var data = (await api.TownLife()).Deserialize<TownLifeData>(Api.Json)!;
        Check(data.Rounds.Count > 0, "engine supplied no rounds"); if (data.Rounds.Count == 0) return;
        var round = data.Rounds[0];
        GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set", new { hour = (int)round.Dusk, minute = (int)Math.Round((round.Dusk % 1) * 60), weather = "clear", food = 10, warmth = 10, sleep = 10, health = 10 }));
        TownLife.I!.ApplyLife(data);
        var lamp = round.Lamps[0]; var q = ViewNear(lamp.Sx, lamp.Sz, 4);
        Jef.I.Place((float)q.X, (float)q.Z, MathF.Atan2((float)(q.X - lamp.Sx), (float)(q.Z - lamp.Sz)), -0.1f);
        await Wait(18);
        Check(TownLife.I.LampsWorked > 0, "nearby lamplighter did not finish a lamp stop");
        var run = TownLife.I.LampRuns[0];
        Check(run.Person?.P != null && run.Wear != null, "lamplighter missing body and pole");
        await ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
        GetViewport().GetTexture().GetImage().SavePng(Path.Combine(dir, "lamplighter-round.png"));
        var windows = new List<TownLife.LampWindow>();
        TownLife.WindowsOf(round, new LampsFog { Start = true }, windows);
        Check(windows.Count == 0, "fog from midnight incorrectly walked dawn or dusk");
        TownLife.WindowsOf(round, new LampsFog { Turns = new() { new FogTurn { H = 10, Fog = true }, new FogTurn { H = 14, Fog = false } } }, windows);
        Check(windows.Any(w => w.Fog && w.On && w.Start == 10), "daytime fog did not light lamps");
        rows.Add(new { kind = "lamps", rounds = data.Rounds.Count, lamps = data.Rounds.Sum(r => r.Lamps.Count), worked = TownLife.I.LampsWorked, fogWindows = windows.Count });
    }

    private async Task Dreams()
    {
        current = "dreams";
        void Push(string text) { using var doc = JsonDocument.Parse(JsonSerializer.Serialize(new { dream = text })); FamilyPeople.I!.ActionReceived?.Invoke(doc.RootElement); }
        Push("The river carries a small light.");
        GameState.I.Apply(new TickReply { Night = new Night { Where = "rough", Summary = new() { "You sleep beneath a tarpaulin." } } });
        await Frames(3);
        Check(DaySheets.I!.Lines.Contains("You dream. The river carries a small light."), "waiting dream missing from night paper");
        Push("The bells sound across the water."); await Frames(3);
        Check(DaySheets.I.Lines.Count(x => x.StartsWith("You dream.")) == 1 && DaySheets.I.Lines.Contains("You dream. The bells sound across the water."), "open paper did not replace dream once");
        await ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
        GetViewport().GetTexture().GetImage().SavePng(Path.Combine(dir, "night-dream.png"));
        DaySheets.I.OnKey("Escape", "Escape"); await Frames(2);
        Check(DaySheets.I.Shown == "none", "dream kept night paper open");
        rows.Add(new { kind = "dreams", waiting = true, replacement = true, closed = true, presentationFixtures = true });
    }

    private async Task FamilyUi()
    {
        current = "family_ui";
        // Presentation fixtures only: no invented engine action is ever submitted by this check.
        void Push(string json) { using var doc = JsonDocument.Parse(json); FamilyPeople.I!.ActionReceived?.Invoke(doc.RootElement); }
        Push("""{"menace":{"action":2000000000,"npc":"presentation_fixture","name":"A townsman","kind":"mug","demand_c":15,"line":"Give me fifteen centimes."}}""");
        await Frames(3); Check(FamilyScenes.I?.MenaceOpen == true, "menace choices did not open");
        await ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
        GetViewport().GetTexture().GetImage().SavePng(Path.Combine(dir, "family-menace.png"));
        Push("""{"menace_end":{"outcome":"mugged","text":"He takes the money and goes."}}""");
        await Frames(2); Check(FamilyScenes.I?.MenaceOpen == false && FamilyScenes.I.Veiled, "harm did not close choices and show the veil");
        await ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
        GetViewport().GetTexture().GetImage().SavePng(Path.Combine(dir, "family-harm.png"));
        await Wait(8);
        Push("""{"menace":{"action":2000000001,"npc":"presentation_fixture","name":"A townsman","kind":"mug","demand_c":15,"line":"Give me fifteen centimes."}}""");
        Push("""{"menace_end":{"outcome":"paid","text":"You pay him and he goes."}}""");
        await Frames(2); Check(FamilyScenes.I?.MenaceOpen == false && !FamilyScenes.I.Veiled, "payment wrongly showed a harm veil");
        rows.Add(new { kind = "family_ui", presentationFixtures = true, choices = true, harmVeil = true, harmlessNotice = true });
    }
}
