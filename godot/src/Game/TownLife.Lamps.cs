using System;
using System.Collections.Generic;
using Godot;
using Scheldemist.Net;
using Scheldemist.Town;
using Scheldemist.World;

namespace Scheldemist.Game;

public partial class TownLife
{
    public readonly record struct LampWindow(bool On, double Start, double Span, double End, double Last, bool Fog);
    public sealed class LampRun
    {
        public LampRound Round = null!;
        public readonly List<LampWindow> Windows = new(12);
        public Townspeople.Sim? Person;
        public LampWindow? Window;
        public int Index, Done;
        public bool Lighting, PartDone;
        public double T, Go, Pace;
        public Node3D? Wear;
    }
    public readonly List<LampRun> LampRuns = new(12);
    public int LampsWorked { get; private set; }
    public Func<LampsHelp?>? LampsHelpNow { get; set; }
    public Func<LampsFog?>? LampsFogNow { get; set; }
    private LampsFog? windowFog;
    private void SetRounds(List<LampRound> rounds)
    {
        bool same = rounds.Count == LampRuns.Count;
        if (same) for (int i = 0; i < rounds.Count; i++) if (rounds[i].Id != LampRuns[i].Round.Id || rounds[i].Lamps.Count != LampRuns[i].Round.Lamps.Count) { same = false; break; }
        if (same) return;
        DropRounds(); foreach (var round in rounds) LampRuns.Add(new LampRun { Round = round });
        windowFog = null; BuildWindows(life?.Fog);
    }
    private void DropLamp(LampRun r, bool release)
    {
        r.Wear?.QueueFree(); r.Wear = null;
        if (r.Person?.P != null) town?.ActionHide(r.Person);
        if (release && r.Person != null) town?.ActionRelease(r.Person);
    }
    private void DropRounds() { foreach (var r in LampRuns) DropLamp(r, true); LampRuns.Clear(); }
    public static void WindowsOf(LampRound round, LampsFog? fog, List<LampWindow> result)
    {
        result.Clear(); bool fogAtDawn = fog?.Start == true;
        if (fog != null) foreach (var turn in fog.Turns) if (turn.H <= 5) fogAtDawn = turn.Fog;
        if (!fogAtDawn) result.Add(new(false, 5, 3.7, 8.7, 9, false));
        if (fog != null) foreach (var turn in fog.Turns)
        {
            if (turn.H <= 5 || turn.H >= round.Dusk || !turn.Fog && turn.H + 3.7 > round.Dusk) continue;
            if ((result.Count == 0 || result[^1].On) == turn.Fog) continue;
            result.Add(new(turn.Fog, turn.H, 3.7, turn.H + 3.7, turn.H + 4.2, true));
        }
        if (result.Count > 0 && !result[^1].On) result.Add(new(true, round.Dusk, 3.7, round.Dusk + 3.7, 21, false));
        for (int i = 0; i < result.Count; i++) { double next = i + 1 < result.Count ? result[i + 1].Start : 24; var w = result[i]; result[i] = w with { End = Math.Min(w.End, next), Last = Math.Min(w.Last, next) }; }
    }
    private void BuildWindows(LampsFog? fog) { windowFog = fog; foreach (var r in LampRuns) WindowsOf(r.Round, fog, r.Windows); }
    public static bool PlannedLamp(LampRun r, int k, double hour)
    {
        bool on = true; double frac = (r.Round.At[k] + k * 14 + 14 * 0.6) / Math.Max(1, r.Round.Len + r.Round.Lamps.Count * 14);
        foreach (var w in r.Windows) { double at = w.Start + frac * w.Span; if (at <= hour && at < w.End + 1e-9) on = w.On; }
        return on;
    }
    public static (double x, double z) PointAlong(LampRound round, double distance)
    {
        if (round.Path.Count == 0) return (0, 0);
        double left = Math.Max(0, distance);
        for (int i = 1; i < round.Path.Count; i++) { var a = round.Path[i - 1]; var b = round.Path[i]; double len = Whereabouts.Hypot(b[0] - a[0], b[1] - a[1]); if (left <= len) { double t = len > 0 ? left / len : 0; return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t); } left -= len; }
        var last = round.Path[^1]; return (last[0], last[1]);
    }
    public static (double x, double z, int done, int at) Planned(LampRun r, LampWindow w, double hour)
    {
        double e = Math.Clamp((hour - w.Start) / w.Span, 0, 1) * (r.Round.Len + r.Round.Lamps.Count * 14); int done = 0, at = -1, stops = 0;
        for (int k = 0; k < r.Round.Lamps.Count; k++) { double s = r.Round.At[k] + k * 14; if (e >= s + 8.4) done = k + 1; if (e >= s && e < s + 14) at = k; if (e >= s + 14) stops++; }
        var pos = PointAlong(r.Round, at >= 0 ? r.Round.At[at] : Math.Min(r.Round.Len, e - stops * 14)); return (pos.x, pos.z, done, at);
    }
    private static (double x, double z) NextMark(LampRun r, Puppet p)
    {
        var round = r.Round; var lamp = round.Lamps[r.Index]; double end = round.At[r.Index], start = r.Index > 0 ? round.At[r.Index - 1] : 0;
        if (end - start <= 20 || round.Path.Count < 2) return (lamp.Sx, lamp.Sz);
        double best = double.PositiveInfinity, along = start;
        for (double a = start; a <= end; a++) { var q = PointAlong(round, a); double d = Whereabouts.Hypot(q.x - p.X, q.z - p.Z); if (d < best) { best = d; along = a; } }
        if (best > 4) return PointAlong(round, along);
        double mark = Math.Ceiling((along - start + 6) / 20) * 20 + start; return mark >= end - 4 ? (lamp.Sx, lamp.Sz) : PointAlong(round, mark);
    }
    private void WalkLamps(double delta)
    {
        if (town?.Crowd == null || Lights.I == null) return;
        var fog = LampsFogNow?.Invoke() ?? GameState.I.Payload?.LampsFog ?? life?.Fog;
        if (!ReferenceEquals(fog, windowFog)) BuildWindows(fog);
        var help = LampsHelpNow?.Invoke() ?? GameState.I.Payload?.LampsHelp;
        double hour = GameState.I.HourF; var eye = Main.I.Cam.GlobalPosition;
        foreach (var r in LampRuns)
        {
            var round = r.Round; if (round.Lamps.Count == 0 || round.At.Count != round.Lamps.Count) continue;
            LampWindow? window = null; foreach (var w in r.Windows) if (hour >= w.Start && hour < w.End) { window = w; break; }
            if (window == null && r.Person?.P != null && r.Window is { } grace && r.Index < round.Lamps.Count && hour >= grace.End && hour < grace.Last) window = grace;
            if (window != r.Window) { DropLamp(r, false); r.Window = window; r.PartDone = false; }
            bool helped = help?.Round == round.Id && help.Day == GameState.I.Day;
            bool holds = false; if (helped && hour >= 12 && hour < help!.Until) foreach (var w in r.Windows) if (w.On && !w.Fog) holds = true;
            int cut = holds ? help!.From : round.Lamps.Count;
            for (int k = 0; k < round.Lamps.Count; k++)
            {
                bool on = PlannedLamp(r, k, hour);
                if (r.Person?.P != null && window is { } seen) on = k < r.Done ? seen.On : PlannedLamp(r, k, seen.Start - 1e-6);
                if (helped && k >= help!.From) { if (hour >= 12 && help.Lit.Contains(round.Lamps[k].Id)) on = true; else if (holds) on = false; }
                Lights.I.SetLampLit(round.Lamps[k].Id, on);
            }
            if (window is not { } active) { if (r.Person?.ActionHeld == true) town.ActionRelease(r.Person); continue; }
            var plan = Planned(r, active, hour);
            if (holds && active.On && (r.PartDone || r.Person?.P == null && plan.done >= cut)) { r.PartDone = true; DropLamp(r, true); continue; }
            r.Person ??= town.ActionPerson(round.Lamplighter);
            bool acting = false; if (Actors.I != null) foreach (var action in Actors.I.Runs) if (action.Action.Npc == round.Lamplighter) { acting = true; break; }
            if (r.Person == null || acting) continue;
            var person = r.Person; town.ActionHold(person);
            if (person.P == null)
            {
                person.X = plan.x; person.Z = plan.z;
                if (Whereabouts.Hypot(plan.x - eye.X, plan.z - eye.Z) > 50) continue;
                // Emerge on the round's own path, away from the eye where possible.
                foreach (double back in emergenceBack)
                {
                    double a = round.At[Math.Min(plan.done, round.At.Count - 1)] - back; if (a < 0 || a > round.Len) continue;
                    var q = PointAlong(round, a); if (Whereabouts.Hypot(q.x - eye.X, q.z - eye.Z) < 12 || !town.Crowd.IsHidden(q.x, q.z) || !town.Crowd.CanStand(q.x, q.z)) continue;
                    person.X = q.x; person.Z = q.z; break;
                }
                if (town.ActionClaim(person) == null) continue;
                r.Done = plan.done; r.Index = plan.at >= plan.done ? plan.at : plan.done; r.Lighting = false; r.Go = 0;
                r.Wear = LeadLooks.Make("lamplighter"); person.P!.Group.AddChild(r.Wear);
            }
            var p = person.P!;
            if (Whereabouts.Hypot(p.X - eye.X, p.Z - eye.Z) > 64) { DropLamp(r, false); continue; }
            while (helped && r.Index < cut && r.Index >= help!.From && help.Lit.Contains(round.Lamps[r.Index].Id)) { r.Index++; r.Done = Math.Max(r.Done, r.Index); r.Lighting = false; r.Go = 0; }
            if (r.Index >= cut) { if (holds) r.PartDone = true; else if (town.Crowd.PuppetBusy(p)) town.Crowd.PuppetStand(p, "idle", p.Yaw); continue; }
            var lamp = round.Lamps[r.Index];
            if (r.Wear is LeadWear wear && wear.Moving != null) wear.Moving.Rotation = new Vector3(0, 0, r.Lighting ? (float)Math.Sin(Math.Min(1, r.T / (2.4 * 0.8)) * Math.PI) * -0.9f : 0);
            if (!r.Lighting)
            {
                double distance = Whereabouts.Hypot(p.X - lamp.Sx, p.Z - lamp.Sz);
                if (distance < 0.9 || distance < 2.2 && !town.Crowd.PuppetBusy(p) && r.Go > 0.5) { r.Lighting = true; r.T = 0; town.Crowd.PuppetStand(p, "idle", Math.Atan2(lamp.X - p.X, lamp.Z - p.Z)); continue; }
                r.Go -= delta;
                if (r.Go <= 0 || !town.Crowd.PuppetBusy(p))
                {
                    double left = (active.End - hour) * 120 - 12 - (round.Lamps.Count - r.Index) * 2.4;
                    double rest = distance * 1.15 + round.At[^1] - round.At[r.Index]; r.Pace = Math.Min(2.5, Math.Max(1.55, left > 0 ? rest / left : 2.5));
                    var mark = NextMark(r, p); town.Crowd.PuppetGo(p, mark.x, mark.z, r.Pace); r.Go = 3;
                }
            }
            else
            {
                r.T += delta;
                if (r.T >= 1.2 && r.Done <= r.Index) { r.Done = r.Index + 1; LampsWorked++; }
                if (r.T >= 2.4) { r.Index++; r.Lighting = false; r.Go = 0; }
            }
        }
    }
    private static readonly double[] emergenceBack = { 26, 32, 40, 48, 20, 14, -26, -32, -40 };
}
