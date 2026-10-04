using System;
using System.Collections.Generic;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.Talks;
using Scheldemist.Town;

namespace Scheldemist.Play;

/// <summary>Gifts, tavern rounds and the street execution of server owned hired routines.</summary>
[GamePart(915)]
public partial class Hands : Node
{
    public static Hands? I { get; private set; }
    public IReadOnlyList<TreatInfo> Treats => treats;
    public IReadOnlyList<RoutineInfo> Routines => routines;
    public TreatRoundReply? LastRound { get; private set; }
    public TreatEnterReply? LastEntry { get; private set; }
    public string LastError { get; private set; } = "";
    public string? Room => room;
    public readonly List<string> Shown = new();
    private sealed class Walk
    {
        public RoutineInfo Info = null!;
        public Townspeople.Sim? Sim;
        public int Index = -1;
        public bool Reported;
        public double Stuck;
        public double Best = double.PositiveInfinity;
        public double Retry;
    }
    private Townspeople? town;
    private readonly Dictionary<int, Walk> walks = new();
    private readonly List<int> ended = new();
    private List<RoutineInfo> routines = new();
    private List<TreatInfo> treats = new();
    private readonly List<Interact.Entry> prompts = new();
    private readonly StandardMaterial3D sleeve = new() { AlbedoColor = new Color(0.24f,0.17f,0.11f), Roughness = 1 };
    private readonly StandardMaterial3D skin = new() { AlbedoColor = new Color(0.72f,0.49f,0.34f), Roughness = 1 };
    private readonly StandardMaterial3D parcel = new() { AlbedoColor = new Color(0.61f,0.48f,0.31f), Roughness = 1 };
    private Node3D? hand, taken;
    private string? handedTo;
    private GiftHandover? gift;
    private double handT, takenT, roomT, pollT, walkT;
    private bool polling, roomBusy, roundBusy, disposed, pushBound;
    private string? room;
    private string? guestId;
    private string roundLabel = "";
    private Act guestAction = null!;
    private Api? Api => ServerLink.I?.Api;
    public override void _Ready()
    {
        I = this;
        town = Main.I.GetNodeOrNull<Townspeople>("Townspeople");
        guestAction = Act.Me(Key.F, "talk to your guest", TalkGuest);
        if (TavernSeats.I != null) TavernSeats.I.GuestAction = SeatedGuest;
        if (Talk.I is { } talk) talk.OnReply += TalkReplied;
        foreach (var counter in InsideCounters.I.Counters)
            if (counter.Kind == "tavern") prompts.Add(Interact.I.Add(counter.At, 1.6f,
                () => room == counter.Id && GuestHere() is { Rounds: < 3 } ? roundLabel : null,
                () => _ = Round(counter.Id), Key.G));
        if (Scheldemist.Menu.MainMenu.I is { } m) m.WorldReplaced += Replaced;
        ServerLink.I?.WhenUp(() => { if (!pushBound && Api != null) { Api.OtherPushed += OnPush; pushBound = true; } _ = Poll(); _ = PollTreats(); });
    }
    private void OnPush(PushMsg msg)
    {
        if (msg.Type == "actions") { pollT = 0; return; }
        if (msg.Type != "hands") return;
        var body = msg.Body;
        if (body.TryGetProperty("line",out var line) && line.ValueKind == System.Text.Json.JsonValueKind.String)
            GameState.I.Say((body.TryGetProperty("name",out var name) ? name.GetString() ?? "A hand" : "A hand") + ": " + line.GetString());
        else if (body.TryGetProperty("say",out var say) && say.ValueKind == System.Text.Json.JsonValueKind.String) GameState.I.Say(say.GetString() ?? "");
        pollT = 0;
    }
    private void Replaced(string how, ClientState? state)
    {
        ClearWalks(); treats.Clear(); routines.Clear(); room = guestId = null; roundLabel = "";
        DropHand(); _ = Poll(); _ = PollTreats();
    }
    private void TalkReplied(string id, TalkLine reply)
    {
        if (reply.Handover is { } h) HandOver(id,h);
    }
    private static MeshInstance3D Block(Vector3 size, Material material, Vector3 at) => new() { Mesh = new BoxMesh { Size = size }, MaterialOverride = material, Position = at, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off };
    public void HandOver(string id, GiftHandover item)
    {
        DropHand();
        hand = new Node3D(); hand.AddChild(Block(new Vector3(.08f,.09f,.34f),sleeve,new(.02f,-.025f,.22f)));
        hand.AddChild(Block(new Vector3(.075f,.04f,.1f),skin,new(0,0,0)));
        hand.AddChild(Block(new Vector3(.14f,.08f,.11f),parcel,new(0,.065f,-.07f)));
        Jef.I.Cam.AddChild(hand); handT = 0; handedTo = id; gift = item;
        Shown.Add(id + ":" + item.Item + (item.Eaten ? ":eaten" : ""));
    }
    private void DropHand() { if (hand != null && GodotObject.IsInstanceValid(hand)) hand.QueueFree(); hand = null; if (taken != null && GodotObject.IsInstanceValid(taken)) taken.QueueFree(); taken = null; }
    private void TheyTake()
    {
        if (hand == null || handedTo == null || gift == null) return;
        hand.GetChild<MeshInstance3D>(2).Visible = false;
        var sim = town?.ActionPerson(handedTo);
        if (sim?.P == null) return;
        town!.Crowd!.PuppetStand(sim.P,"talk",Math.Atan2(Jef.I.X-sim.P.X,Jef.I.Z-sim.P.Z));
        taken = new Node3D { Position = new Vector3(.23f,1.07f,.13f) };
        taken.AddChild(Block(new Vector3(.12f,.07f,.1f),parcel,Vector3.Zero));
        sim.P.Group.AddChild(taken); takenT = gift.Eaten ? 3 : 8;
    }
    private TreatInfo? GuestHere()
    {
        if (room == null) return null;
        foreach (var t in treats) if (t.Inside == room) return t;
        return null;
    }
    private Act? SeatedGuest()
    {
        var guest = GuestHere();
        if (guest == null || TavernSeats.I.Sitting?.Room.Id != room) return null;
        if (guestId != guest.Npc) { guestId = guest.Npc; guestAction.Text = "talk to " + guest.First; }
        return guestAction;
    }
    private void TalkGuest()
    {
        if (GuestHere() is { } g) Talk.I?.Open(g.Npc,g.Name,"your guest");
    }
    private async System.Threading.Tasks.Task RoomChanged(string? place)
    {
        if (roomBusy || Api == null) return;
        roomBusy = true;
        try
        {
            if (room != null) await Api.TreatLeave();
            room = place;
            if (room != null)
            {
                var entered = await Api.TreatEnter(room); LastEntry = entered;
                if (entered.Guests.Count > 0) GameState.I.Say(entered.Guests[0].Name + " comes in behind you.");
            }
            await PollTreats();
        }
        catch (ApiException e) { LastError = e.Message; GameState.I.Say(e.Message); }
        finally { roomBusy = false; }
    }
    private async System.Threading.Tasks.Task PollTreats()
    {
        if (Api == null || disposed) return;
        try
        {
            treats = (await Api.Treats()).Treats;
            if (disposed) return;
            if (room != null && town != null)
                foreach (var insideGuest in treats) if (insideGuest.Inside == room)
                    foreach (var w in walks.Values) if (w.Info.Npc == insideGuest.Npc && w.Sim != null)
                        foreach (var tavern in TavernSeats.I.Rooms) if (tavern.Id == room) { town.ActionInside(w.Sim,tavern.Origin.X,tavern.Origin.Z); break; }
            if (GuestHere() is { } guest) roundLabel = guest.Rounds > 0 ? "another round for you and " + guest.First : "stand " + guest.First + " a beer (a round for two)";
            else roundLabel = "";
        }
        catch (ApiException) { }
    }
    public async System.Threading.Tasks.Task Round(string place, string kind = "beer")
    {
        if (roundBusy || Api == null || room != place || GuestHere() is not { Rounds: < 3 }) return;
        roundBusy = true;
        try
        {
            var r = await Api.TreatRound(place,kind); LastRound = r;
            GameState.I.Apply(r); GameState.I.Say(r.Line + (r.Note.Length > 0 ? " " + r.Note : ""));
            await PollTreats();
        }
        catch (ApiException e) { GameState.I.Say(e.Message); }
        finally { roundBusy = false; }
    }
    public async System.Threading.Tasks.Task Poll()
    {
        if (polling || Api == null || disposed) return; polling = true;
        try
        {
            var list = (await Api.Routines()).Routines; if (disposed) return;
            routines = list; ended.Clear();
            foreach (var walk in walks) ended.Add(walk.Key);
            foreach (var r in list)
            {
                if (r.Player != 1 && Scheldemist.Net.Mp.Together.I?.PlayerId != r.Player) continue;
                if (!walks.TryGetValue(r.Id,out var w)) walks[r.Id] = w = new Walk();
                if (w.Index != r.I)
                {
                    if (w.Index >= 0 && r.Purpose == "hire") GameState.I.Say(r.Name + ": " + r.I + " of " + r.N + " steps in the work.");
                    w.Index = r.I; w.Reported = false; w.Stuck = 0; w.Best = double.PositiveInfinity;
                }
                w.Info = r; ended.Remove(r.Id);
            }
            foreach (int id in ended) { Release(walks[id]); walks.Remove(id); }
        }
        catch (ApiException) { }
        finally { polling = false; }
    }
    private void Release(Walk w)
    {
        if (w.Sim == null) return;
        foreach (var other in walks.Values) if (other != w && other.Sim == w.Sim) { w.Sim = null; return; }
        town?.ActionRelease(w.Sim,this); w.Sim = null;
    }
    private void ClearWalks() { foreach (var w in walks.Values) if (w.Sim != null) town?.ActionRelease(w.Sim,this); walks.Clear(); }
    private async System.Threading.Tasks.Task Report(Walk w, bool ok, string why)
    {
        if (w.Reported || Api == null) return; w.Reported = true;
        try
        {
            var r = await Api.RoutineStep(w.Info.Id,w.Index,ok,why,w.Sim?.P?.X ?? w.Sim?.X ?? Jef.I.X,w.Sim?.P?.Z ?? w.Sim?.Z ?? Jef.I.Z,w.Info.Step?.Count ?? 1);
            if (r.Player.Day > 0) GameState.I.Apply(r);
            await Poll();
        }
        catch (ApiException) { w.Reported = false; }
    }
    private void Step(Walk w, double dt)
    {
        var r = w.Info; var step = r.Step;
        if (step == null || town == null || town.Crowd == null) return;
        if (r.Purpose != "hire") foreach (var other in walks.Values)
            if (other != w && other.Info.Npc == r.Npc && other.Info.Purpose == "hire") return;
        if (step.Kind == "wait")
        {
            if (w.Sim is { P: null, Inside: false } still && (still.X-Jef.I.X)*(still.X-Jef.I.X)+(still.Z-Jef.I.Z)*(still.Z-Jef.I.Z)<15*15 && (w.Retry-=dt)<=0)
            { w.Retry=2; town.ActionClaim(still); }
            return;
        }
        if (step.Kind is "enter" or "sit" or "leave" or "buy" or "give" or "pay") return;
        var sim = w.Sim ?? town.ActionPerson(r.Npc); if (sim == null) return;
        if (w.Sim == null)
        {
            if (!town.ActionHold(sim,this)) return;
            w.Sim = sim;
        }
        if (sim.Inside) town.ActionOutside(sim);
        double tx = step.X ?? sim.X, tz = step.Z ?? sim.Z;
        if (step.Kind == "follow")
        {
            tx = Jef.I.X + Math.Sin(Jef.I.Yaw)*1.8; tz = Jef.I.Z + Math.Cos(Jef.I.Yaw)*1.8;
            if (room != null) return;
        }
        else if (step.Who is { Length: > 0 } who && Folk.At(who) is { } at) { tx = at.X; tz = at.Z; }
        double dx = tx - sim.X, dz = tz - sim.Z, dist = Math.Sqrt(dx*dx+dz*dz);
        if (step.Kind != "follow" && dist < 1.6)
        {
            if (sim.P == null && town.Crowd.CanStand(sim.X,sim.Z)) town.ActionClaim(sim);
            if (!w.Reported) _ = Report(w,true,"arrived"); return;
        }
        if (dist + .1 < w.Best) { w.Best = dist; w.Stuck = 0; } else w.Stuck += dt;
        if (w.Stuck > 16 && !w.Reported) { _ = Report(w,false,"blocked"); return; }
        double jx=sim.X-Jef.I.X, jz=sim.Z-Jef.I.Z, jefDist2=jx*jx+jz*jz;
        if (sim.P != null && dist > 15 && jefDist2 > 20*20 && (town.Crowd.IsHidden(sim.X,sim.Z) || w.Stuck > 3))
        { town.ActionHide(sim); w.Stuck = 0; }
        if (sim.P == null && (step.Kind != "follow" || jefDist2 > 4*4))
        {
            town.ActionMoveHidden(sim,tx,tz,dt*6);
        }
        else
        {
            if (sim.P == null && town.ActionClaim(sim) == null) return;
            town.Crowd.PuppetGo(sim.P!,tx,tz,r.Purpose == "hire" ? 1.6 : 1.4);
            if (r.Holding > 0 && !sim.P!.Loaded) town.Crowd.PuppetLoad(sim.P,true,"sack");
            else if (r.Holding == 0 && sim.P!.Loaded && sim.P.HandCarry) town.Crowd.PuppetLoad(sim.P,false);
        }
    }
    public override void _Process(double delta)
    {
        if (disposed) return;
        if (hand != null)
        {
            handT += delta; float outT = handT < .8 ? (float)(handT/.8) : handT < 1.3 ? 1 : MathF.Max(0,1-(float)((handT-1.3)/.6));
            hand.Position = new Vector3(.24f-.12f*outT,-.36f+.20f*outT,-.38f-.23f*outT);
            if (handT >= 1.05 && hand.GetChild<MeshInstance3D>(2).Visible) TheyTake();
            if (handT >= 1.9) { hand.QueueFree(); hand = null; }
        }
        if (taken != null && (takenT -= delta) <= 0) { if (GodotObject.IsInstanceValid(taken)) taken.QueueFree(); taken = null; }
        if ((roomT -= delta) <= 0)
        {
            roomT = .4;
            string? at = GameState.I.Where().At;
            if (at is not { } name || !name.StartsWith("tavern:",StringComparison.Ordinal)) at = null;
            if (at != room && !roomBusy) _ = RoomChanged(at);
        }
        if ((pollT -= delta) <= 0) { pollT = routines.Count > 0 || treats.Count > 0 ? 1.5 : 8; _ = Poll(); if (room != null) _ = PollTreats(); }
        if ((walkT -= delta) <= 0) { walkT = .1; foreach (var w in walks.Values) Step(w,.1); }
    }
    public override void _ExitTree()
    {
        disposed = true; ClearWalks(); DropHand(); foreach (var e in prompts) e.Dispose();
        if (TavernSeats.I != null && TavernSeats.I.GuestAction == SeatedGuest) TavernSeats.I.GuestAction = null;
        if (Talk.I is { } t) t.OnReply -= TalkReplied;
        if (Api != null) Api.OtherPushed -= OnPush;
        if (Scheldemist.Menu.MainMenu.I is { } m) m.WorldReplaced -= Replaced;
        if (I == this) I = null;
    }
}
