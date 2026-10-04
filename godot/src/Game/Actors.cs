using System;
using System.Collections.Generic;
using System.Text.Json;
using Godot;
using Scheldemist.Net;
using Scheldemist.Play;
using Scheldemist.Talks;
using Scheldemist.Town;

namespace Scheldemist.Game;

/// <summary>game/actions.ts. Execute only proposals already accepted by the server's trade,
/// trust, range, reservation and time checks. Arrival/outcome reports go back to that same engine.</summary>
[GamePart(231)]
public partial class Actors : Node
{
    public sealed class Run
    {
        public PublicAction Action = null!;
        public Townspeople.Sim? Person, Other;
        public bool Seen, Reported, Reporting, Indoors;
        public string Phase = "";
        public double Repath, Wait, Lost, Stuck, Best = double.PositiveInfinity, Retry, HiddenPace;
        public Node3D? Wear;
        public Puppet? Dressed;
        public int Said;
        public uint TravelHash;
        public string? WearRole;
        public bool TransitChosen, GaveUp, Anchored;
        public int Replans;
        public double AnchorX, AnchorZ, GoalX, GoalZ, Pace;
        public Scheldemist.Movers.OmnibusLines.Stop? BoardStop, AlightStop;
        public Scheldemist.Movers.Omnibus.Bus? Bus;
        public double BusWait;
    }
    public static Actors? I { get; private set; }
    public readonly List<Run> Runs = new();
    private readonly List<PersonAt> syncPeople = new(64);
    private Townspeople? town;
    private Api? api;
    private double poll, sync, clock;
    private bool polling, syncing, dirty = true;
    private Action<ActionsPayload> applied = null!;
    private Action<ApiException> pollFailed = null!, syncFailed = null!;
    private Action<OkReply> synced = null!;
    public double LogicMs { get; private set; }
    public long AllocatedBytes { get; private set; }
    public int Reports { get; private set; }
    /// <summary>The police/room owner can consume an accepted action in its real prison or cell walk grid.</summary>
    public Func<Run, double, bool>? RoomMovement { get; set; }
    public bool TestHoldsPoll;
    private int ordinaryCapacity;
    public override void _Ready()
    {
        I = this;
        if (Scheldemist.Net.Mp.Together.I is { } together) {together.OtherText += OwnershipText;together.OtherBatch+=ReplicaBatch;}
        town = GetParent().GetNodeOrNull<Townspeople>("Townspeople");
        applied = PollApplied; pollFailed = _ => polling = false; syncFailed = _ => syncing = false; synced = _ => syncing = false;
        if (Scheldemist.Movers.Omnibus.I != null) Scheldemist.Movers.Omnibus.I.ResidentOff += OffBus;
        if (Scheldemist.Menu.MainMenu.I != null) Scheldemist.Menu.MainMenu.I.WorldReplaced += Replaced;
    }
    private void Replaced(string how, ClientState? client) { Reset(); Hearses.I?.Reset(); TownLife.I?.Reset(); dirty = true; poll = 0; }
    private void Push(PushMsg p)
    {
        if (p.Type is "actions" or "events" or "resync" or "loaded") dirty = true;
        if (p.Type == "actions" && p.Body.TryGetProperty("ended", out var ended) && ended.TryGetProperty("line", out var line))
        {
            string id = ended.GetProperty("npc").GetString() ?? "";
            if (town?.PositionOf(id) is { } at && Scheldemist.Player.Jef.I is { } j && Whereabouts.Hypot(at.x - j.X, at.z - j.Z) < 40) GameState.I.Say(line.GetString() ?? "");
        }
    }
    private void PollApplied(ActionsPayload p) { polling = false; Apply(p); }
    public void Apply(ActionsPayload p)
    {
        if (town != null)
        {
            if (ordinaryCapacity == 0) ordinaryCapacity = town.MaxPuppets;
            int attendees = 0; foreach (var a in p.Actions) if (a.Kind == "attend") attendees++;
            town.MaxPuppets = Math.Max(ordinaryCapacity, Math.Min(100, attendees));
        }
        Events.I?.Apply(p);
        foreach (var r in Runs) r.Seen = false;
        foreach (var a in p.Actions)
        {
            // Step routines have their own client executor and server step acknowledgements.
            if (a.Kind == "routine") continue;
            Run? r = null;
            foreach (var run in Runs) if (run.Action.Id == a.Id) { r = run; break; }
            if (r == null) { r = new Run { TravelHash = Whereabouts.HashId(a.Npc + ":" + a.EventId) }; Runs.Add(r); }
            r.Seen = true;
            if (r.Phase != a.Phase || r.Action?.TargetX != a.TargetX || r.Action?.TargetZ != a.TargetZ) { r.Reported = false; r.Repath = 0; r.Best = double.PositiveInfinity; r.Stuck = 0; r.Replans = 0; r.GaveUp = false; r.Anchored = false; }
            r.Action = a; r.Phase = a.Phase;
            bool acquiring = r.Person == null;
            r.Person ??= town?.ActionPerson(a.Npc);
            if (r.Person != null) town!.ActionHold(r.Person, this, true);
            // A new engine action does not inherit the previous action's indoor scene, even when
            // this actor coordinator already owned its hold. The new "in" phase restores indoors.
            if (acquiring && r.Person != null) town!.ActionOutside(r.Person);
        }
        for (int i = Runs.Count - 1; i >= 0; i--)
        {
            var r = Runs[i]; if (r.Seen) continue;
            Runs.RemoveAt(i); End(r);
        }
        foreach (var c in p.Convos) Bubbles.I?.Show(JsonSerializer.Deserialize<Scheldemist.Talks.Convo>(JsonSerializer.Serialize(c, Api.Json), Api.Json)!);
    }
    private bool HeldElsewhere(Townspeople.Sim s)
    {
        foreach (var r in Runs) if (r.Person == s || r.Other == s) return true;
        return false;
    }
    private void End(Run r)
    {
        if (r.Bus != null) { Scheldemist.Movers.Omnibus.I?.RemoveResident(r.Action.Npc); if (r.Person != null) town?.ActionOutside(r.Person); }
        if (GodotObject.IsInstanceValid(r.Wear)) r.Wear!.QueueFree(); r.Wear = null;
        if (r.Person != null && !HeldElsewhere(r.Person)) town?.ActionRelease(r.Person, this);
        if (r.Other != null && !HeldElsewhere(r.Other)) town?.ActionRelease(r.Other, this);
    }
    public void Reset() { ClearReplicas();npcOwners.Clear(); if (town != null && ordinaryCapacity > 0) town.MaxPuppets = ordinaryCapacity; while (Runs.Count > 0) { var r = Runs[^1]; Runs.RemoveAt(Runs.Count - 1); End(r); } Events.I?.Reset(); }
    public override void _Process(double delta)
    {
        if (town?.Data == null || town.Crowd == null) return;
        if (api != ServerLink.I?.Api)
        {
            if (api != null) api.OtherPushed -= Push;
            api = ServerLink.I?.Api; if (api != null) api.OtherPushed += Push; dirty = true;
        }
        if (!TestHoldsPoll && api != null && !polling && ((poll -= delta) <= 0 || dirty))
        {
            dirty = false; polling = true; poll = 2; api.Run(api.Actions(), applied, pollFailed);
        }
        if (api != null && Runs.Count > 0 && !syncing && (sync -= delta) <= 0 && Scheldemist.Player.Jef.I is { } j)
        {
            sync = 2; syncing = true; syncPeople.Clear();
            foreach (var s in town.Sims) if (NpcOwned(s.R.Id) && s.P != null && !s.Inside && Whereabouts.Hypot(s.P.X - j.X, s.P.Z - j.Z) < 60) syncPeople.Add(new PersonAt(s.R.Id, Math.Round(s.P.X, 1), Math.Round(s.P.Z, 1)));
            api.Run(api.ActionsSync(j.X, j.Z, syncPeople), synced, syncFailed);
        }
        Replicate(delta);
        ulong start = Time.GetTicksUsec(); long before = GC.GetAllocatedBytesForCurrentThread(); clock += delta;
        foreach (var r in Runs)
        {
            if (!NpcOwned(r.Action.Npc)) continue;
            Step(r, delta);
            if (GodotObject.IsInstanceValid(r.Wear))
            {
                bool playing = r.WearRole is "organ_grinder" or "fiddler" or "accordionist";
                r.Wear!.Visible = !playing || r.Person?.P is { } p && !town.Crowd!.PuppetBusy(p);
                if (r.Wear.Visible && r.Person?.P?.Shown == true) { LeadLooks.Animate(r.Wear, r.WearRole, clock); LeadLooks.Grip(r.Wear, r.WearRole); }
            }
        }
        LogicMs = (Time.GetTicksUsec() - start) / 1000.0; AllocatedBytes = GC.GetAllocatedBytesForCurrentThread() - before;
    }
    private Vector2? Player(PublicAction a)
    {
        var together = Scheldemist.Net.Mp.Together.I;
        if (a.ForPlayer.HasValue && a.ForPlayer.Value != (together?.PlayerId ?? 1))
            return together?.PlayerAt(a.ForPlayer.Value) is { } at ? new Vector2(at.X, at.Z) : null;
        return Scheldemist.Player.Jef.I is { } j ? new Vector2(j.X, j.Z) : null;
    }
    private void Step(Run r, double dt)
    {
        if (RoomMovement?.Invoke(r, dt) == true) return;
        var a = r.Action; var s = r.Person ??= town!.ActionPerson(a.Npc);
        if (s == null) return;
        if (!ReferenceEquals(s.ActionOwner, this)) town!.ActionHold(s, this, true);
        if (a.Kind == "attend" && a.Phase == "in")
        {
            if (!r.Indoors) { town!.ActionInside(s, a.TargetX ?? s.X, a.TargetZ ?? s.Z); r.Indoors = true; }
            return;
        }
        if (r.Indoors)
        {
            if (a.Phase == "inside" || Scheldemist.People.HallPeople.I?.PositionOf(a.Npc) != null) return;
            town!.ActionOutside(s); r.Indoors = false;
        }
        r.Repath -= dt; r.Retry -= dt;
        var player = Player(a); if (player == null) return;
        double x = a.TargetX ?? player.Value.X, z = a.TargetZ ?? player.Value.Y;
        if (a.Kind is "follow" or "seek") { x = player.Value.X; z = player.Value.Y; }
        else if (a.Kind is "talk_to" or "fetch_police") { if (town!.PositionOf(a.Target) is { } q) { x = q.x; z = q.z; } }
        bool attend = a.Kind == "attend";
        if (attend && Transit(r, s, x, z, dt)) return;
        if (s.P is { Shown: false } hidden && Whereabouts.Hypot(hidden.X - x, hidden.Z - z) > 45 && Whereabouts.Hypot(hidden.X - Main.I.Cam.GlobalPosition.X, hidden.Z - Main.I.Cam.GlobalPosition.Z) > 12) town!.ActionHide(s);
        if (s.P == null)
        {
            double distance = Whereabouts.Hypot(s.X - x, s.Z - z);
            if (a.Kind != "wait")
            {
                // A later stage can move the destination across town. Reuse no slower unseen pace
                // than the new trip needs; do not inherit a nearby gathering's walking speed.
                r.HiddenPace = attend ? Math.Max(r.HiddenPace, Math.Max(6, distance / 6)) : 6;
                town!.ActionMoveHidden(s, x, z, r.HiddenPace * dt);
            }
            double jefDistance = Whereabouts.Hypot(s.X - Main.I.Cam.GlobalPosition.X, s.Z - Main.I.Cam.GlobalPosition.Z);
            if (jefDistance < 58 && r.Retry <= 0) { r.Retry = 0.4; town!.ActionClaim(s); }
            if (s.P == null)
            {
                if (!attend && a.Kind != "follow" && a.Kind != "wait" && distance < 2.5) Report(r, "arrived");
                if (a.Kind == "follow" && (r.Lost += dt) > 5) Report(r, "lost");
                return;
            }
        }
        var p = s.P; var crowd = town!.Crowd!;
        Dress(r, p);
        if (a.Kind == "seek")
        {
            double d = Whereabouts.Hypot(p.X - x, p.Z - z);
            if (d > (a.Phase == "menace" ? 1.9 : 2.6)) { double k = 1.3 / Math.Max(1, d); Go(r, p, x + (p.X - x) * k, z + (p.Z - z) * k, a.Phase == "menace" ? 2.1 : d > 8 ? 1.9 : 1.45); Stuck(r, d, dt, 12); }
            else { Stand(p, x, z, "talk"); if (a.Phase is not ("menace" or "at_jef")) Report(r, "arrived"); }
            return;
        }
        if (a.Kind == "follow")
        {
            double d = Whereabouts.Hypot(p.X - x, p.Z - z);
            r.Lost = d > (a.MaxM > 0 ? a.MaxM : 40) ? r.Lost + dt : 0;
            if (r.Lost > 5) { Report(r, "lost"); return; }
            if (Scheldemist.Player.Jef.I?.Swimming == true || Scheldemist.World.Water.In((float)x, (float)z)) { Stand(p, x, z); Report(r, "blocked", "water"); return; }
            if (d > 2.6) { Go(r, p, x + (p.X - x) / d * 1.8, z + (p.Z - z) / d * 1.8, d > 10 ? 2.3 : d > 4.5 ? 1.75 : 1.35); Stuck(r, d, dt, 12); }
            else Stand(p, x, z);
            return;
        }
        if (a.Kind == "wait") { Stand(p, player.Value.X, player.Value.Y); return; }
        if (a.Kind == "look_for")
        {
            var other = town.ActionPerson(a.Target);
            if (other?.P is { Shown: true } seen && Whereabouts.Hypot(seen.X - p.X, seen.Z - p.Z) < 12) { Stand(p, seen.X, seen.Z, "talk"); Report(r, "done", found: true); return; }
            if (!crowd.PuppetBusy(p) && (r.Wait -= dt) <= 0)
            {
                double radius = Math.Max(6, Math.Min(a.MaxM > 0 ? a.MaxM : 40, 40));
                for (int i = 0; i < 6; i++)
                {
                    double angle = (clock + a.Id * 13 + i) * 2.399963, rr = 6 + (radius - 6) * (i + 1) / 6;
                    var q = crowd.OpenNear(x + Math.Cos(angle) * rr, z + Math.Sin(angle) * rr);
                    if (q != null) { Go(r, p, q.Value.x, q.Value.z, 1.2); break; }
                }
                r.Wait = 5;
            }
            return;
        }
        if (a.Kind is "talk_to" or "fetch_police")
        {
            double d = Whereabouts.Hypot(p.X - x, p.Z - z);
            if (a.Phase == "talking" || r.Reported)
            {
                Stand(p, x, z, "talk");
                r.Other ??= town.ActionPerson(a.Target);
                if (r.Other != null) { town.ActionHold(r.Other, this, true); var other = town.ActionClaim(r.Other); if (other != null) Stand(other, p.X, p.Z, "talk"); }
            }
            else if (d > 2.3) { Go(r, p, x + (p.X - x) / d * 1.5, z + (p.Z - z) / d * 1.5, d > 12 ? 1.9 : 1.4); Stuck(r, d, dt, 12); }
            else { Stand(p, x, z, "talk"); Report(r, "arrived"); }
            return;
        }
        if (a.Kind is not ("attend" or "go_to")) return;
        var live = Events.I?.Find(a.EventId); var st = live == null ? null : Events.StageOf(live.Event);
        if (attend && live?.Event.Scene is { Resolved: false } scene && a.Lead != null && Scene(r, p, scene, dt)) return;
        bool column = attend && a.Phase is "procession" or "inside" or "leave";
        if (column)
        {
            Run? partner = null;
            if (a.Lead == "bride" || a.Lead == "bearers" && a.N % 2 == 1)
                foreach (var other in Runs) if (other.Action.EventId == a.EventId && (a.Lead == "bride" ? other.Action.Lead == "groom" : other.Action.Lead == "bearers" && other.Action.N == a.N - 1)) { partner = other; break; }
            if (partner?.Person?.P is { } alongside && Whereabouts.Hypot(p.X - alongside.X, p.Z - alongside.Z) < 14) { crowd.PuppetFollow(p, alongside); return; }
        }
        crowd.PuppetFollow(p, null);
        if (column && a.Order > 0 && live != null && a.Order - 1 < live.Event.People.Count)
        {
            var ahead = town.ActionPerson(live.Event.People[a.Order - 1])?.P;
            if (ahead != null && Whereabouts.Hypot(ahead.X - x, ahead.Z - z) > 3)
            {
                double d = Math.Max(1, Whereabouts.Hypot(ahead.X - p.X, ahead.Z - p.Z));
                x = ahead.X + (p.X - ahead.X) / d * 1.6; z = ahead.Z + (p.Z - ahead.Z) / d * 1.6;
            }
        }
        if (attend && a.Phase == "leave" && a.Order == 0 && Hearses.I?.BackOf(a.EventId) is { } back) { x = back.X; z = back.Y; }
        double goalD = Whereabouts.Hypot(p.X - x, p.Z - z);
        if (r.GaveUp)
        {
            if (crowd.IsHidden(p.X, p.Z) && crowd.IsHidden(x, z)) { town.ActionHide(s); r.GaveUp = false; r.Replans = 0; r.Repath = 0; }
            return;
        }
        if (goalD > (column ? 1.6 : 1.2))
        {
            double pace = !attend ? 1.5 : column ? a.Phase == "procession" ? 0.95 : a.Phase == "leave" ? 1.1 : 1.05 : a.Role == "chain" || a.Role == "crowd" && r.TravelHash / 4294967296.0 > 0.6 ? 2.5 : goalD > 15 ? 1.75 : 1.45;
            Go(r, p, x, z, pace); Stuck(r, goalD, dt, attend ? 10 : 12); return;
        }
        r.Stuck = 0; r.Best = double.PositiveInfinity;
        if (attend && a.Phase == "inside") { town.ActionInside(s, x, z); r.Indoors = true; Report(r, "arrived"); return; }
        double faceX = st?.X ?? player.Value.X, faceZ = st?.Z ?? player.Value.Y;
        if (attend && st?.Groups != null) foreach (var group in st.Groups) if (group.Ids.Contains(a.Npc)) { faceX = group.X; faceZ = group.Z; break; }
        if (a.Lead != null && a.Lead is not ("bearers" or "victim" or "pickpocket") && Whereabouts.Hypot(p.X - player.Value.X, p.Z - player.Value.Y) < 30) { faceX = player.Value.X; faceZ = player.Value.Y; }
        Stand(p, faceX, faceZ, a.Lead is "priest" or "widow" ? "fold" : a.Lead is "speaker" or "auctioneer" ? "talk" : "idle");
        if (a.Phase is "going" or "walking" || !attend) Report(r, "arrived");
    }
    private void Go(Run r, Puppet p, double x, double z, double pace)
    {
        if (r.Repath > 0) return;
        r.GoalX = x; r.GoalZ = z; r.Pace = pace;
        r.Repath = 0.45; town!.Crowd!.PuppetGo(p, x, z, pace);
    }
    private void Stand(Puppet p, double x, double z, string motion = "idle")
    {
        double yaw = Math.Atan2(x - p.X, z - p.Z);
        if (town!.Crowd!.PuppetBusy(p) || Math.Abs(p.Yaw - yaw) > 0.1 || p.Human.Motion != motion) town.Crowd.PuppetStand(p, motion, yaw);
    }
    private void Stuck(Run r, double d, double dt, double limit)
    {
        var p = r.Person?.P;
        if (p != null && (!r.Anchored || Whereabouts.Hypot(p.X - r.AnchorX, p.Z - r.AnchorZ) > 2))
        {
            bool moved = r.Anchored; r.Anchored = true; r.AnchorX = p.X; r.AnchorZ = p.Z;
            if (moved) { r.Stuck = 0; return; }
        }
        if (d < r.Best - 0.3) { r.Best = d; r.Stuck = 0; } else r.Stuck += dt;
        if (r.Stuck <= limit || p == null) return;
        bool attend = r.Action.Kind == "attend";
        // Errands and attendance step out of an occupied collider before trying another way.
        if (r.Action.Kind is "attend" or "go_to")
        {
            Recover(r);
            return;
        }
        Report(r, "blocked", "wall");
    }
    public void Recover(Run r)
    {
        var p = r.Person?.P; if (p == null || town?.Crowd == null) return;
        var crowd = town.Crowd;
        if (!crowd.CanStand(p.X, p.Z))
        {
            for (double radius = 0.5; radius <= 2; radius += 0.5) for (int k = 0; k < 8; k++)
            {
                double x = p.X + Math.Cos(k * Math.PI / 4) * radius, z = p.Z + Math.Sin(k * Math.PI / 4) * radius;
                if (!crowd.CanStand(x, z)) continue;
                p.X = x; p.Z = z; r.Stuck = 0; r.Best = double.PositiveInfinity; r.Repath = 0; return;
            }
        }
        if (r.Action.Kind != "attend" && r.Replans >= 4) { Report(r, "blocked", "wall"); return; }
        r.Replans++; r.Stuck = 0; r.Best = double.PositiveInfinity;
        if (r.Replans <= 4)
        {
            double angle = (r.TravelHash / 4294967296.0 + r.Replans * 0.61803398875) * Math.PI * 2, radius = 1.5 + r.Replans * 1.5;
            var q = crowd.OpenNear(r.GoalX + Math.Cos(angle) * radius, r.GoalZ + Math.Sin(angle) * radius);
            crowd.PuppetGo(p, q?.x ?? r.GoalX, q?.z ?? r.GoalZ, r.Pace > 0 ? r.Pace : 1.45); r.Repath = 4;
        }
        else { r.GaveUp = true; crowd.PuppetStand(p, "idle", p.Yaw); }
    }
    private void Report(Run r, string phase, string? why = null, bool? found = null)
    {
        if (!NpcOwned(r.Action.Npc) || api == null || r.Reported || r.Reporting) return;
        if (r.Action.ForPlayer.HasValue && r.Action.ForPlayer.Value != (Scheldemist.Net.Mp.Together.I?.PlayerId ?? 1)) return;
        r.Reporting = true; Reports++;
        api.Run(api.ActionReport(r.Action.Id, phase, r.Person?.P?.X ?? r.Person?.X, r.Person?.P?.Z ?? r.Person?.Z, found, why), reply =>
        {
            r.Reporting = false; r.Reported = true;
            var state = reply.Deserialize<JobsPayload>(Api.Json); if (state != null) GameState.I.Apply(state);
            dirty = true;
        }, e => { r.Reporting = false; r.Reported = e.Status == 404 || e.Status == 409; r.Repath = 2; });
    }
    private void Dress(Run r, Puppet p)
    {
        if (r.Dressed == p) return;
        if (GodotObject.IsInstanceValid(r.Wear)) r.Wear!.QueueFree(); r.Wear = null; r.Dressed = p;
        r.WearRole = r.Action.Lead ?? (r.Action.Role == "musicians" ? r.Action.Order % 3 == 0 ? "organ_grinder" : r.Action.Order % 3 == 1 ? "fiddler" : "accordionist" : null);
        if (r.WearRole == null) return;
        r.Wear = LeadLooks.Make(r.WearRole); p.Group.AddChild(r.Wear);
        ((LeadWear)r.Wear).Bind(p.Human);
    }
    private bool Scene(Run r, Puppet p, EventScene scene, double dt)
    {
        string me = r.Action.Npc;
        if (me != scene.A && me != scene.B && me != scene.Agent) return false;
        var live = Events.I!.Find(r.Action.EventId)!;
        double t = Events.I.StageT(r.Action.EventId);
        var pa = town!.ActionPerson(scene.A)?.P; var pb = town.ActionPerson(scene.B)?.P;
        var agent = scene.Agent == null ? null : town.ActionPerson(scene.Agent)?.P;
        var stage = Events.StageOf(live.Event)!;
        double x = r.Action.TargetX ?? stage.X, z = r.Action.TargetZ ?? stage.Z;
        if (scene.Kind == "scuffle")
        {
            if (pa == null || pb == null) return false;
            if (live.MeetSince < 0)
            {
                live.MeetSince = clock;
                var mid = town.Crowd!.OpenNear((pa.X + pb.X) * 0.5, (pa.Z + pb.Z) * 0.5);
                live.MeetX = mid?.x ?? stage.X; live.MeetZ = mid?.z ?? stage.Z;
                double gap = Math.Max(0.01, Whereabouts.Hypot(pb.X - pa.X, pb.Z - pa.Z));
                live.MeetUx = (pb.X - pa.X) / gap; live.MeetUz = (pb.Z - pa.Z) / gap;
            }
            double separation = Whereabouts.Hypot(pa.X - pb.X, pa.Z - pb.Z);
            if (live.MetAt < 0 && (separation < 1.9 || clock - live.MeetSince > 12 && separation < 8)) live.MetAt = clock;
            double since = live.MetAt < 0 ? -1 : clock - live.MetAt;
            bool agentThere = agent != null && Whereabouts.Hypot(agent.X - stage.X, agent.Z - stage.Z) < 3;
            bool parted = t >= 0.97 || since > 19 || agentThere && since > 13;
            if (me == scene.Agent)
            {
                if (Whereabouts.Hypot(p.X - x, p.Z - z) > 1.4) Go(r, p, x, z, since >= 0 ? 2.4 : 1.5);
                else { var wrong = me == scene.Wrong ? p : scene.Wrong == scene.A ? pa : pb; Stand(p, wrong.X, wrong.Z, "talk"); if (parted) SceneSay(r, scene, "agent", 1); }
                return true;
            }
            var other = me == scene.A ? pb : pa;
            double sign = me == scene.A ? 1 : -1;
            double gx = live.MeetX - sign * live.MeetUx * (parted ? 1.6 : 0.6), gz = live.MeetZ - sign * live.MeetUz * (parted ? 1.6 : 0.6);
            if (parted || since < 5)
            {
                p.Human.Root.Rotation = Vector3.Zero;
                if (Whereabouts.Hypot(p.X - gx, p.Z - gz) > 0.6) Go(r, p, gx, gz, parted ? 1 : 1.5);
                else Stand(p, agentThere && parted ? agent!.X : other.X, agentThere && parted ? agent!.Z : other.Z, parted ? "fold" : "talk");
                if (parted && me == scene.Wrong && (agentThere || t >= 0.9)) SceneSay(r, scene, "sorry", 2);
                return true;
            }
            long cycle = (long)(clock / 1.5); double u = clock % 1.5 / 1.5;
            string shover = (cycle % 3 == 2) == (scene.Wrong == scene.A) ? scene.B : scene.A;
            bool pushing = me == shover;
            Stand(p, other.X, other.Z, pushing && u < 0.5 ? "talk" : "idle");
            double k = pushing ? u < 0.35 ? Math.Sin(u / 0.35 * Math.PI) : 0 : u > 0.15 && u < 0.65 ? Math.Sin((u - 0.15) / 0.5 * Math.PI) : 0;
            double off = (pushing ? 0.5 : -0.65) * k;
            double nx = live.MeetX - sign * live.MeetUx * 0.55 + sign * live.MeetUx * off, nz = live.MeetZ - sign * live.MeetUz * 0.55 + sign * live.MeetUz * off;
            double distance = Whereabouts.Hypot(nx - p.X, nz - p.Z), step = distance > 0.8 ? Math.Min(distance, 2.2 * dt) / distance : 1;
            nx = p.X + (nx - p.X) * step; nz = p.Z + (nz - p.Z) * step;
            if (town.Walk!.Free(nx, nz)) { p.X = nx; p.Z = nz; }
            p.Human.Root.Rotation = new Vector3((float)((pushing ? 0.38 : -0.3) * k), 0, 0);
            return true;
        }
        if (live.LiftedAt < 0 && t >= 0.9) live.LiftedAt = clock;
        bool lifted = live.LiftedAt >= 0;
        if (me == scene.B)
        {
            if (!lifted && Whereabouts.Hypot(p.X - x, p.Z - z) > 1.2) Go(r, p, x, z, 1.2);
            else if (lifted && pa != null) { Stand(p, pa.X, pa.Z, "talk"); SceneSay(r, scene, "shout", 4); }
            else if (town.Crowd!.PuppetBusy(p)) town.Crowd.PuppetStand(p, "idle", p.Yaw);
            return true;
        }
        if (me == scene.A)
        {
            if (r.Wear is LeadWear wear && wear.Purse != null) wear.Purse.Visible = lifted;
            if (!lifted)
            {
                if (t < 0.3) { if (Whereabouts.Hypot(p.X - x, p.Z - z) > 1.4) Go(r, p, x, z, 1.1); else Stand(p, pb?.X ?? x, pb?.Z ?? z, "behind"); }
                else if (pb != null)
                {
                    double bx = pb.X - Math.Sin(pb.Yaw) * 0.55, bz = pb.Z - Math.Cos(pb.Yaw) * 0.55;
                    if (Whereabouts.Hypot(p.X - bx, p.Z - bz) > 0.6) { Go(r, p, bx, bz, 0.8); r.Wait = 1.5; }
                    else { Stand(p, pb.X, pb.Z); if ((r.Wait -= dt) <= 0 && t >= 0.35) live.LiftedAt = clock; }
                }
                return true;
            }
            double fx = scene.Flee?.X ?? x, fz = scene.Flee?.Z ?? z;
            double d = Whereabouts.Hypot(p.X - fx, p.Z - fz);
            bool caught = scene.Caught == true && agent != null && Whereabouts.Hypot(agent.X - p.X, agent.Z - p.Z) < 1.6 && (pb == null || Whereabouts.Hypot(pb.X - p.X, pb.Z - p.Z) > 8 || d <= 1.2);
            if (d > 1.2 && !caught) Go(r, p, fx, fz, 2.9);
            else Stand(p, agent?.X ?? fx, agent?.Z ?? fz, scene.Caught == true ? "behind" : "idle");
            return true;
        }
        if (!lifted || pa == null) { if (Whereabouts.Hypot(p.X - x, p.Z - z) > 1.5) Go(r, p, x, z, 1.3); else Stand(p, x, z, "behind"); return true; }
        double chase = Whereabouts.Hypot(p.X - pa.X, p.Z - pa.Z);
        if (chase > 1.3 && (scene.Caught == true || clock - live.LiftedAt < 9 && t < 0.97)) Go(r, p, pa.X, pa.Z, scene.Caught == true ? 2.7 : 2.5);
        else { Stand(p, pa.X, pa.Z, scene.Caught == true ? "talk" : "idle"); SceneSay(r, scene, "agent", 1); }
        return true;
    }
    private static void SceneSay(Run r, EventScene scene, string key, int bit)
    {
        if ((r.Said & bit) != 0 || !scene.Lines.TryGetValue(key, out string? text) || text == "") return;
        r.Said |= bit;
        Bubbles.I?.Show(new Scheldemist.Talks.Convo { Id = -Math.Abs((r.Action.EventId ?? 0) * 100 + bit), A = r.Action.Npc, B = r.Action.Npc, Purpose = "scene", Lines = new List<Scheldemist.Talks.ConvoLine> { new() { Who = r.Action.Npc, Name = Folk.NameOf(r.Action.Npc), Text = text } } });
    }
    public override void _ExitTree()
    {
        if (api != null) api.OtherPushed -= Push;
        if (Scheldemist.Movers.Omnibus.I != null) Scheldemist.Movers.Omnibus.I.ResidentOff -= OffBus;
        if (Scheldemist.Menu.MainMenu.I != null) Scheldemist.Menu.MainMenu.I.WorldReplaced -= Replaced;
        if (Scheldemist.Net.Mp.Together.I is { } together) {together.OtherText -= OwnershipText;together.OtherBatch-=ReplicaBatch;}
        Reset(); if (I == this) I = null;
    }
}
