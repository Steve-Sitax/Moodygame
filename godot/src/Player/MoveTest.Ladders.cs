using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Movers;
using Scheldemist.Play;
using Scheldemist.World;

namespace Scheldemist.Player;

/// <summary>
/// Issue 87 (`--moveonly ladders`): every quay ladder and every stone flight's landing must have open water in front of
/// it for a swimmer: no boat may lie on its hold. Lists each way out with what holds a swimmer off it, and for each
/// blocking moored boat the nearest place along her wall where she lies clear of every way out and of the other hulls.
/// </summary>
public partial class MoveTest
{
    /// <summary>A hull's plan: middle, yaw, half length and half beam.</summary>
    private sealed record Plan(string Kind, Vector2 At, float Yaw, float Half, float Beam)
    {
        public bool Holds(Vector2 p, float margin)
        {
            var d = p - At; float s = MathF.Sin(Yaw), c = MathF.Cos(Yaw);
            float along = d.X * s + d.Y * c, across = d.X * c - d.Y * s;
            return MathF.Abs(along) < Half + margin && MathF.Abs(across) < Beam + margin;
        }
        public IEnumerable<Vector2> Outline(float step = 0.5f)
        {
            float s = MathF.Sin(Yaw), c = MathF.Cos(Yaw);
            for (float a = -Half; a <= Half + 1e-3f; a += step)
                for (float b = -Beam; b <= Beam + 1e-3f; b += step)
                    yield return At + new Vector2(a * s + b * c, a * c - b * s);
        }
        public bool Overlaps(Plan o, float margin) { var me = this; return Outline(0.3f).Any(p => o.Holds(p, margin)) || o.Outline(0.3f).Any(p => me.Holds(p, margin)); }
    }

    private async Task LadderCheck()
    {
        var j = Jef.I;
        await Tidy(13);
        await Frames(20);
        // every way out a swimmer is offered: the ladders and the flights' landings (not the steps over the rails)
        var exits = QuayExits.Exits.Where(e => e.Ladder || e.Over == 0).ToList();
        var plans = Boats.I.MooredSpots().Where(m => !m.Gone).Select(m => { var d = Boats.I.Dims(m.Kind); return new Plan(m.Kind, new Vector2(m.X, m.Z), m.Yaw, d.Length / 2, d.Beam / 2); }).ToList();
        foreach (var f in Boats.I.Floats.Where(f => f.Outer.IsVisibleInTree() && f.Outer.GetParent() == Mv.Town))
        {
            var d = Boats.I.Dims(f.Kind);
            plans.Add(new Plan(f.Kind, new Vector2(f.Outer.GlobalPosition.X, f.Outer.GlobalPosition.Z), f.Outer.Rotation.Y, d.Length / 2, d.Beam / 2));
        }
        var rows = new List<object>();
        int blocked = 0;
        var blockers = new Dictionary<Plan, List<Exit>>();
        foreach (var e in exits)
        {
            var g = new Vector2(e.Gx, e.Gz);
            Solid.I.Ensure(new Vector3(e.Gx, 0, e.Gz), 4);
            var on = plans.Where(p => p.Holds(g, 0.45f)).ToList();
            bool free = j.SwimFree(e.Gx, e.Gz) || j.NearestSwim(e.Gx, e.Gz, 0.5f) != null;
            if (!free) blocked++;
            foreach (var p in on) { if (!blockers.TryGetValue(p, out var l)) blockers[p] = l = new(); l.Add(e); }
            rows.Add(new { ladder = e.Ladder, hold = new[] { R(e.Gx), R(e.Gz) }, top = R(e.Ty), free, boats = on.Select(p => $"{p.Kind} at {p.At.X:0.0}, {p.At.Y:0.0}").ToArray() });
        }
        // one plan for all of them: the small boats that hold a swimmer off a way out slide along their own length, the
        // smallest slide first and at most 6 m, clear of every way out by 0.9 m, of every flight and of every other hull;
        // a boat with no such place is taken off her mooring (Steve 2026-10-17: fewer small boats is all right)
        bool OnFlight(Vector2 x) => QuayExits.Flights.Any(fl => { var d = x - new Vector2(fl.Ox, fl.Oz); float sAlong = d.X * fl.Tx + d.Y * fl.Tz, u = d.X * fl.Nx + d.Y * fl.Nz; return sAlong > -0.5f && sAlong < 7.3f && u > -0.2f && u < 3.1f; });
        var todo = blockers.Where(kv => kv.Key.Half < 4.5f && kv.Value.Any(e => !j.SwimFree(e.Gx, e.Gz))).Select(kv => kv.Key).ToList();
        var placed = new Dictionary<Plan, Plan>();
        var current = plans.ToList();
        // the households' own boats (the family boats the residents row out in) keep their place in the town: further to slide
        var family = Rowing.I.Data.Boats.Where(b => b.Id is "boat:canal" or "boat:cartstand" or "boat:north").Select(b => new Vector2(b.Home.X, b.Home.Z)).ToList();
        bool Family(Plan p) => family.Any(f => f.DistanceTo(p.At) < 0.6f);
        var removedPlans = new List<Plan>();
        float? Slide(Plan p)
        {
            var axis = new Vector2(MathF.Sin(p.Yaw), MathF.Cos(p.Yaw));
            for (float d = 0.25f; d <= (Family(p) ? 12 : 6); d += 0.25f)
                foreach (float sgn in new[] { 1f, -1f })
                {
                    var q = p with { At = p.At + axis * d * sgn };
                    if (exits.Any(e => q.Holds(new Vector2(e.Gx, e.Gz), 0.9f))) continue;
                    if (q.Outline(0.4f).Any(x => OnFlight(x) || !Water.In(x.X, x.Y))) continue;
                    if (current.Any(o => !ReferenceEquals(o, p) && q.Overlaps(o, 0.3f))) continue;
                    return d * sgn;
                }
            return null;
        }
        while (todo.Count > 0)
        {
            var options = todo.Select(p => (p, d: Slide(p))).Where(o => o.d != null).OrderBy(o => MathF.Abs(o.d!.Value)).ToList();
            if (options.Count == 0)
            {
                // nobody can move: the longest boat that is not a household's goes, and the rest try again in the room she leaves
                var go = todo.Where(p => !Family(p)).OrderByDescending(p => p.Half).FirstOrDefault();
                if (go == null) break;
                todo.Remove(go); removedPlans.Add(go); current.RemoveAll(o => ReferenceEquals(o, go));
                continue;
            }
            var (bp, bd) = options[0];
            var axis = new Vector2(MathF.Sin(bp.Yaw), MathF.Cos(bp.Yaw));
            var moved = bp with { At = bp.At + axis * bd!.Value };
            current[current.FindIndex(o => ReferenceEquals(o, bp))] = moved;
            placed[bp] = moved;
            todo.Remove(bp);
        }
        var moves = placed.Select(kv => new { kind = kv.Key.Kind, at = new[] { R(kv.Key.At.X), R(kv.Key.At.Y) }, yaw = R(kv.Key.Yaw), to = new[] { R(kv.Value.At.X), R(kv.Value.At.Y) }, dx = R(kv.Value.At.X - kv.Key.At.X), dz = R(kv.Value.At.Y - kv.Key.At.Y), family = Family(kv.Key) }).ToArray();
        var removed = removedPlans.Concat(todo).Select(p => new { kind = p.Kind, at = new[] { R(p.At.X), R(p.At.Y) }, yaw = R(p.Yaw), family = Family(p) }).ToArray();
        // where a boat that comes in to each flight lies (a resident's errand): past the foot of its landing, clear of every way out
        var berths = new List<object>();
        foreach (var fl in QuayExits.Flights)
        {
            var t = new Vector2(fl.Tx, fl.Tz); var n = new Vector2(fl.Nx, fl.Nz); float yaw = MathF.Atan2(t.X, t.Y);
            for (float sAt = 9; sAt < 24; sAt += 0.25f)
            {
                var q = new Plan("rowboat", new Vector2(fl.Ox, fl.Oz) + t * sAt + n * 1.25f, yaw, 3.1f, 0.85f);
                if (exits.Any(e => q.Holds(new Vector2(e.Gx, e.Gz), 0.9f)) || q.Outline(0.4f).Any(x => OnFlight(x) || !Water.In(x.X, x.Y)) || current.Any(o => q.Overlaps(o, 0.3f))) continue;
                berths.Add(new { top = new[] { fl.Ox, fl.Oz }, s = sAt, at = new[] { R(q.At.X), R(q.At.Y) }, yaw = R(yaw) }); break;
            }
        }
        reports.Add(new { flightBerths = berths });
        reports.Add(new { mooringPlan = new { moves, removed } });
        reports.Add(new { ladders = new { exits = exits.Count, blocked, rows } });
        Check(blocked == 0, "every quay ladder and flight landing has open water in front of it", new { blocked, of = exits.Count, boats = blockers.Count });
    }
}
