using System;
using System.Collections.Generic;
using Godot;
using Scheldemist.Net;
using Scheldemist.Town;
namespace Scheldemist.Play;

/// <summary>walkup.ts: the engine reserves a real resident; the crowd walks them from the street.</summary>
[GamePart(341)]
public partial class Walkups : Node
{
    public static Walkups? I { get; private set; }
    public new sealed class Call : IDisposable
    {
        internal Walkups Owner = null!;
        internal WalkupAsk Ask = null!;
        internal int? Trouble, Action;
        internal string? Fallback;
        internal double Cap, Waited, Poll, Repath, WalkAge, StandPoll;
        internal bool Asking, Arrived;
        internal Townspeople.Sim? Person;
        internal Puppet? Made;
        public bool Gone { get; private set; }
        public bool Urgent { get; internal set; }
        public string? Who => Person?.R.Id;
        public string Name { get; internal set; } = "";
        public string Motion = "idle";
        public bool Present => !Gone && Puppet != null;
        public Puppet? Puppet => Person?.P ?? Made;
        public Vector3 Position => Puppet is { } p ? new((float)p.X, (float)p.Group.Position.Y, (float)p.Z) : Person is { } s ? new((float)s.X, 0, (float)s.Z) : new((float)Ask.X, 0, (float)Ask.Z);
        public bool Moving => !Gone && Target != null && !Arrived;
        internal Vector2? Target, Goal;
        internal double Pace = 1.35, Yaw;
        public double Distance(double x, double z) { var p = Position; return Whereabouts.Hypot(p.X - x, p.Z - z); }
        public void Go(double x, double z, double pace = 1.35)
        {
            if (Target is { } q && Whereabouts.Hypot(q.X - x, q.Y - z) < .6 && Pace == pace) return;
            Target = new((float)x, (float)z); Goal = null; Pace = pace; Arrived = false; Repath = WalkAge = 0;
        }
        public void Face(double x, double z) { var p = Position; Yaw = Math.Atan2(x - p.X, z - p.Z); }
        public void Stop() { Target = null; Arrived = true; if (Puppet is { } p) Owner.town?.Crowd?.PuppetStand(p, Motion, Yaw); }
        public void Load(string kind) { if (Puppet is { } p) Owner.town?.Crowd?.PuppetLoad(p, true, kind); }
        public void Dispose()
        {
            if (Gone) return; Gone = true;
            if (Person != null) { if (Person.P is { } p) Owner.town?.Crowd?.PuppetLoad(p, false); Owner.town?.ActionRelease(Person, this); }
            if (Made != null) Owner.town?.Crowd?.RemovePuppet(Made);
            if (Action is int id && ServerLink.I?.Api is { } api) api.Run(api.WalkupDone(id), _ => { });
        }
    }
    private readonly List<Call> calls = new();
    private readonly List<(double x, double z)> path = new();
    private Townspeople? town;
    private Call? trouble;
    private int troubleId;
    public int Calls => calls.Count;
    public int Arrivals { get; private set; }
    public override void _Ready()
    {
        I = this; town = GetParent().GetNodeOrNull<Townspeople>("Townspeople");
        Trouble.I.Present = PresentTrouble;
        if (Menu.MainMenu.I is { } menu) menu.WorldReplaced += Reset;
    }
    public Call Summon(string role, string why, string reference, double x, double z, double cap = 90, string? fallback = null)
    {
        var c = new Call { Owner = this, Ask = new(role, why, reference, x, z), Cap = cap, Fallback = fallback };
        c.Go(x, z); calls.Add(c); return c;
    }
    private bool PresentTrouble(TroubleView view)
    {
        if (troubleId != view.Id)
        {
            trouble?.Dispose(); troubleId = view.Id;
            trouble = Summon("hand", "trouble", "quest:trouble:" + view.Id, Player.Jef.I.X, Player.Jef.I.Z);
            trouble.Trouble = view.Id;
        }
        if (trouble!.Gone) return trouble.Arrived;
        var j = Player.Jef.I; var p = trouble.Position;
        double d = trouble.Distance(j.X, j.Z), k = 1.8 / Math.Max(1, d);
        trouble.Go(j.X + (p.X - j.X) * k, j.Z + (p.Z - j.Z) * k, trouble.Urgent ? 3.1 : 1.35);
        if (!trouble.Present || d > 2.6) return false;
        trouble.Face(j.X, j.Z); trouble.Motion = "talk"; trouble.Stop(); return true;
    }
    private void Reset(string how, ClientState? state) { foreach (var c in calls) c.Dispose(); calls.Clear(); trouble = null; troubleId = 0; }
    public override void _Process(double delta)
    {
        if (town?.Crowd == null || town.Data == null || town.Paused) return;
        if (trouble != null && (Trouble.I.View?.Id != troubleId || Trouble.I.View.Status != "ready" || Trouble.I.View.JobId != Jobs.I.Active?.Id)) { trouble.Dispose(); trouble = null; troubleId = 0; }
        for (int i = calls.Count - 1; i >= 0; i--) { var c = calls[i]; if (c.Gone) { calls.RemoveAt(i); continue; } Tick(c, delta); }
    }
    private void Tick(Call c, double dt)
    {
        var crowd = town!.Crowd!;
        if (c.Person == null && c.Made == null)
        {
            c.Waited += dt; c.Poll -= dt;
            if (!c.Asking && c.Poll <= 0 && ServerLink.I?.Api is { } api)
            {
                c.Asking = true; c.Poll = 3;
                api.Run(c.Trouble is int id ? api.WalkupTrouble(id, c.Ask.X, c.Ask.Z) : api.WalkupCall(c.Ask), a => Answer(c, a), _ => c.Asking = false);
            }
            if (c.Waited >= c.Cap && c.Fallback != null && HiddenStart(c.Target ?? new((float)c.Ask.X, (float)c.Ask.Z)) is { } from) c.Made = crowd.AddPuppet(c.Fallback, from.x, from.z);
            else if (c.Waited >= c.Cap && c.Fallback == null) { c.Arrived = false; c.Dispose(); }
            return;
        }
        if (c.Person is { } s && !ReferenceEquals(s.ActionOwner, c)) { c.Dispose(); return; }
        if (c.Person is { P: null } person)
        {
            var goal = c.Target ?? new Vector2((float)c.Ask.X, (float)c.Ask.Z);
            if (Whereabouts.Hypot(person.X - Player.Jef.I.X, person.Z - Player.Jef.I.Z) <= 50)
            {
                if (crowd.IsHidden(person.X, person.Z) && !OthersSee(person.X, person.Z)) town.ActionClaim(person);
                else if (HiddenStart(new((float)person.X, (float)person.Z)) is { } from) { person.X = from.x; person.Z = from.z; town.ActionClaim(person); }
            }
            if (person.P == null) { if (Whereabouts.Hypot(person.X - Player.Jef.I.X, person.Z - Player.Jef.I.Z) > 30) town.ActionMoveHidden(person, goal.X, goal.Y, dt * (c.Urgent ? 6 : 3.5)); return; }
        }
        if (c.Puppet is not { } p) return;
        if (c.Target is { } target && !c.Arrived)
        {
            c.WalkAge += dt; c.Repath -= dt;
            c.Goal ??= Reachable(p, target);
            var goal = c.Goal.Value;
            double d = Whereabouts.Hypot(p.X - goal.X, p.Z - goal.Y);
            if (d <= .45) { c.Arrived = true; Arrivals++; crowd.PuppetStand(p, c.Motion, c.Yaw); }
            else if (c.WalkAge >= 40) { c.Stop(); }
            else if (c.Repath <= 0)
            {
                c.Repath = .5;
                if (c.WalkAge > 3 && !crowd.PuppetBusy(p)) c.Goal = Reachable(p, target);
                goal = c.Goal.Value;
                crowd.PuppetGo(p, goal.X, goal.Y, c.Pace);
            }
        }
        else if ((c.StandPoll -= dt) <= 0) { c.StandPoll = .5; crowd.PuppetStand(p, c.Motion, c.Yaw); }
    }
    private void Answer(Call c, WalkupAnswer a)
    {
        c.Asking = false;
        if (c.Gone || c.Made != null) { if (a.Action is int late && ServerLink.I?.Api is { } api) api.Run(api.WalkupDone(late), _ => { }); return; }
        if (a.None) { c.Arrived = true; c.Dispose(); return; }
        if (!a.Ok || a.Npc == null) return;
        var person = town?.ActionPerson(a.Npc);
        if (person == null || !town!.ActionHold(person, c)) { if (a.Action is int id && ServerLink.I?.Api is { } api) api.Run(api.WalkupDone(id, "unavailable"), _ => { }); return; }
        c.Person = person; c.Action = a.Action; c.Name = a.Name ?? person.R.Name; c.Urgent = a.Urgent;
    }
    private static bool OthersSee(double x, double z)
    {
        if (Net.Mp.Together.I is not { On: true } together) return false;
        foreach (var r in together.Roster) if (r.Id != together.PlayerId && together.PlayerAt(r.Id) is { } p && Whereabouts.Hypot(p.X - x, p.Z - z) < 45) return true;
        return false;
    }
    private (double x, double z)? HiddenStart(Vector2 goal)
    {
        var crowd = town!.Crowd!; var j = Player.Jef.I;
        var openGoal = crowd.OpenNear(goal.X, goal.Y);
        if (openGoal == null) return null;
        (double x, double z)? best = null; double distance = double.PositiveInfinity;
        for (int i = 0; i < 48; i++)
        {
            double a = i / 48.0 * Math.PI * 2 + i % 2 * .07, r = 28 + i % 4 * 5;
            var q = crowd.OpenNearFree(j.X + Math.Cos(a) * r, j.Z + Math.Sin(a) * r);
            if (q == null || !crowd.IsHidden(q.Value.x, q.Value.z) || OthersSee(q.Value.x, q.Value.z) || Whereabouts.Hypot(q.Value.x - j.X, q.Value.z - j.Z) < 27) continue;
            double d = Whereabouts.Hypot(q.Value.x - goal.X, q.Value.z - goal.Y);
            if (d < distance && crowd.PathOn(q.Value.x, q.Value.z, openGoal.Value.x, openGoal.Value.z, path) != null) { best = q; distance = d; }
        }
        return best;
    }
    private Vector2 Reachable(Puppet p, Vector2 target)
    {
        var crowd = town!.Crowd!;
        double length = Whereabouts.Hypot(p.X-target.X,p.Z-target.Y);
        for (double back = 0; back <= Math.Min(30,length); back += 2)
        {
            double k=length>0?back/length:0;
            var q=crowd.OpenNear(target.X+(p.X-target.X)*k,target.Y+(p.Z-target.Y)*k);
            if(q!=null&&crowd.PathOn(p.X,p.Z,q.Value.x,q.Value.z,path)!=null)return new((float)q.Value.x,(float)q.Value.z);
        }
        return new((float)p.X,(float)p.Z);
    }
    public override void _ExitTree() { Reset("exit", null); if (Trouble.I.Present == PresentTrouble) Trouble.I.Present = null; if (Menu.MainMenu.I is { } menu) menu.WorldReplaced -= Reset; if (I == this) I = null; }
}
