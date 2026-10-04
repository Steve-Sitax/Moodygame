using System;
using System.Collections.Generic;
using Godot;
using Scheldemist.Game;
using Scheldemist.Town;
namespace Scheldemist.Play;

public sealed partial class HaulRun
{
    internal Walkups.Call? Stranger => stranger;
    private Walkups.Call? stranger, foreman;
    private bool strangerDone, foremanSeen;
    private void StartTwists()
    {
        strangerDone = sold > 0;
        if (Walkups.I == null || from == null || to == null) return;
        if (task.Twist == "stranger_offer" && !strangerDone)
        {
            var at = Beside(from.X, from.Z, to.X, to.Z, 3.5);
            stranger = Walkups.I.Summon("thief", "twist", $"job:{job.Id}:stranger", at.X, at.Y, 45, "stranger");
        }
        if (task.Twist == "foreman_watches")
        {
            var at = Beside(to.X, to.Z, to.X + to.DirX, to.Z + to.DirZ, 2.6);
            foreman = Walkups.I.Summon("hand", "twist", $"job:{job.Id}:foreman", at.X, at.Y, 40, "foreman");
        }
    }
    private static Vector2 Beside(float ax, float az, float bx, float bz, double side)
    {
        var town = Dev.Kit.I?.People ?? Main.I.GetNodeOrNull<Townspeople>("Townspeople");
        double dx = bx - ax, dz = bz - az, length = Math.Max(.1, Whereabouts.Hypot(dx, dz));
        for (int i = 0; i < 8; i++)
        {
            double f = .45 + i * .025, k = i % 2 == 0 ? side : -side;
            double x = ax + dx * f + dz / length * k, z = az + dz * f - dx / length * k;
            if (town?.Walk?.Free(x, z) == true) return new((float)x, (float)z);
        }
        return new(ax, az);
    }
    private void StepTwists(double dt)
    {
        if (stranger is { Present: true, Gone: false } s)
        {
            if (strangerDone) { if (!s.Moving) s.Dispose(); }
            else if (!s.Moving) s.Face(Player.Jef.I.X, Player.Jef.I.Z);
        }
        if (foreman is { Present: true, Moving: false, Gone: false } f && to != null)
        {
            f.Face(to.X, to.Z); f.Motion = "fold";
            if (!foremanSeen) { foremanSeen = true; ctx.Toast($"A man from {job.EmployerName}'s side stands by {to.Label}, arms folded, watching."); }
        }
    }
    private void StrangerAction(List<Act> actions, Item? item)
    {
        if (strangerDone || stranger is not { Present: true, Gone: false } s || s.Distance(Player.Jef.I.X, Player.Jef.I.Z) >= 3) return;
        actions.Add(Act.At(Key.F, item == null ? "sell the parcel to the stranger (60 c)" : $"sell it to the stranger ({(IsCarry ? 35 : 60)} c)", s.Position + Vector3.Up * 1.3f, () => Sell(item)));
    }
    private void Sell(Item? item)
    {
        if (strangerDone || stranger is not { Present: true, Gone: false } s) return;
        if (item != null && Goods.I.Carried == item) Goods.I.HandTo(item, s, "sold");
        strangerDone = true; sold++; ctx.Sfx("coins", null);
        ctx.Toast("He counts coins into your hand and is gone in the fog.");
        var p = s.Position; s.Go(p.X + (p.X - Player.Jef.I.X) * 8, p.Z + (p.Z - Player.Jef.I.Z) * 8, 1.4);
        Changed();
    }
}

public sealed partial class WatchRun
{
    internal Walkups.Call? Briber => briber;
    internal string BriberState => briberState;
    private Walkups.Call? thief, briber, foreman;
    private string thiefState = "none", briberState = "none", foremanState = "none";
    private double briberWait, foremanLook;
    private bool bribeTaken, seenAway;
    private List<Act> TwistActions()
    {
        var o = new List<Act>(); if (ended) return o;
        var j = Player.Jef.I;
        if (thief is { Present: true, Gone: false } th && thiefState == "coming" && th.Distance(j.X, j.Z) < 10) o.Add(Act.At(Key.E, "shout at him", th.Position + Vector3.Up * 1.3f, Chase, 50));
        if (briber is { Present: true, Gone: false } b && briberState == "waiting" && b.Distance(j.X, j.Z) < 3)
        {
            o.Add(Act.At(Key.F, "take his coin and look away (50 c)", b.Position + Vector3.Up * 1.3f, Bribe));
            o.Add(Act.At(Key.E, "send him off", b.Position + Vector3.Up * 1.3f, SendOff));
        }
        return o;
    }
    private Vector2 Escape(double radius, bool away = false)
    {
        var town = Main.I.GetNodeOrNull<Townspeople>("Townspeople"); Vector2 best = new(post.X, post.Z); double far = -1;
        for (double r = radius; r >= Math.Min(4, radius); r *= .7)
        {
            for (int i = 0; i < 16; i++)
            {
                double a = i * .7 + .31, x = post.X + Math.Cos(a) * r, z = post.Z + Math.Sin(a) * r;
                if (town?.Walk?.Free(x, z) != true) continue;
                double d = Whereabouts.Hypot(x - Player.Jef.I.X, z - Player.Jef.I.Z);
                if (!away) return new((float)x, (float)z);
                if (d > far) { best = new((float)x, (float)z); far = d; }
            }
            if (far >= 0) return best;
        }
        return best;
    }
    private void Leave(Walkups.Call c, double pace, bool away = false) { var q = Escape(30, away); c.Go(q.X, q.Y, pace); }
    private void Chase() { if (thief == null || thiefState != "coming") return; thiefState = "chased"; Leave(thief, 3.2, true); ctx.Toast("He bolts into the fog. You hear him run, then nothing."); }
    private void Bribe() { if (briberState != "waiting" || briber == null) return; bribeTaken = true; briberState = "paid"; ctx.Sfx("coins", null); ctx.Toast("Coins, warm from his hand. You turn to look at the water."); briber.Go(post.X, post.Z, 1.1); }
    private void SendOff() { if (briber == null) return; briberState = "sent"; Leave(briber, 1.3); ctx.Toast("He shrugs, and the fog takes him."); }
    private void TakePile(Walkups.Call by)
    {
        for (int i = pile.Count - 1; i >= 0; i--) { var it = pile[i]; if (!Goods.I.IsLying(it) || Goods.I.Above(it)) continue; pile.RemoveAt(i); Goods.I.HandTo(it, by, "taken"); break; }
    }
    private void WatchTwists(double dt)
    {
        if (Walkups.I == null) return;
        double duration = task.DurationS; var j = Player.Jef.I;
        if (task.Twist == "thief" && thief == null && t > duration * .05) thief = Walkups.I.Summon("thief", "twist", $"job:{job.Id}:thief", post.X, post.Z, duration * .45, "thief");
        if (thief is { Present: true, Gone: false } th)
        {
            if (thiefState == "none") thiefState = "coming";
            if (thiefState == "coming")
            {
                Vector2 aim = new(post.X, post.Z); double nearest = double.PositiveInfinity;
                foreach (var it in pile) { if (!Goods.I.IsLying(it)) continue; double d = th.Distance(it.X, it.Z); if (d < nearest) { nearest = d; aim = new(it.X, it.Z); } }
                th.Go(aim.X, aim.Y, th.Distance(aim.X, aim.Y) > 18 ? 1.35 : .85);
                if (th.Distance(j.X, j.Z) < 3.2 || th.Who != null && th.Distance(j.X, j.Z) < 5.5 && Near()) Chase();
                else if (th.Distance(aim.X, aim.Y) < 1.6) { thiefState = "stole"; TakePile(th); Leave(th, 2.2); ctx.Toast("Something moves by the goods, and then it is gone. One is missing."); }
            }
            else if (!th.Moving) th.Dispose();
        }
        else if (thief != null && t > duration * .8) thief.Dispose();
        if (task.Twist == "bribe" && briber == null && t > duration * .1) briber = Walkups.I.Summon("thief", "twist", $"job:{job.Id}:briber", post.X, post.Z, duration * .4, "stranger");
        if (briber is { Present: true, Gone: false } b)
        {
            if (briberState == "none") briberState = "coming";
            if (briberState == "coming")
            {
                if (b.Distance(j.X, j.Z) < 2) { b.Face(j.X, j.Z); b.Stop(); briberState = "waiting"; ctx.Toast("Cold work. What if you looked at the river a while?"); }
                else { var p = b.Position; double k = 1.4 / Math.Max(1, b.Distance(j.X, j.Z)); b.Go(j.X + (p.X - j.X) * k, j.Z + (p.Z - j.Z) * k, b.Distance(j.X, j.Z) > 15 ? 1.35 : 1.1); }
            }
            else if (briberState == "waiting") { b.Face(j.X, j.Z); if ((briberWait += dt) > 25) SendOff(); }
            else if (briberState == "paid" && !b.Moving) { TakePile(b); Leave(b, 1.3); briberState = "sent"; }
            else if (briberState == "sent" && !b.Moving) b.Dispose();
        }
        else if (briber != null && t > duration * .75) briber.Dispose();
        if (task.Twist == "foreman_watches" && foreman == null && t > duration * .3)
        {
            var q = Escape(3); foreman = Walkups.I.Summon("hand", "twist", $"job:{job.Id}:foreman", post.X, post.Z, duration * .35, "foreman"); foreman.Go(q.X, q.Y);
        }
        if (foreman is { Present: true, Gone: false } f)
        {
            if (foremanState == "none") foremanState = "coming";
            if (foremanState == "coming" && !f.Moving) { foremanState = "looking"; f.Face(post.X, post.Z); f.Motion = "fold"; seenAway = !Near(); if (!seenAway) ctx.Toast($"{job.EmployerName}'s man looks you over, nods once, and says nothing."); }
            else if (foremanState == "looking" && (foremanLook += dt) > 12) { Leave(f, 1); foremanState = "leaving"; }
            else if (foremanState == "leaving" && !f.Moving) f.Dispose();
        }
        else if (foreman != null && t > duration * .8) foreman.Dispose();
    }
}
