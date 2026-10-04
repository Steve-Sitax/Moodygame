using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace Scheldemist.Town;

/// <summary>What a person does at an hour (server town/schedule.ts Now).</summary>
public readonly record struct Now(string Act, string Place, double Since, double Left);

/// <summary>
/// Where a townsperson is now: the shared sum of the server's town/whereabouts.ts (with schedule.ts and the three
/// small helpers of wayfind.ts), ported line by line. Pure: the server's town map, the browser and this game run
/// the same sum, so they agree on where a person is that nobody sees. His day plan says what he does now and since
/// when; he left the place of the part before and walks the way on foot (found by the server on its walk map:
/// streets, never through a house) to the place of this part, at his own pace.
/// The mill's man goes by his cart's timetable (shared/mills.ts runNow; the tables: SharedData.cs).
/// </summary>
public static class Whereabouts
{
    /// <summary>The way on foot between two points. known false: not known yet (asked for); null and known: there is none, he is simply there.</summary>
    public delegate Pt[]? WayOf(double ax, double az, double bx, double bz, out bool known);

    // ------------------------------------------------------------------ schedule.ts

    /// <summary>What a person does at this hour (fractional) of this day of the week (1 = Monday, 7 = Sunday).</summary>
    public static Now ActivityAt(Schedule s, int day, double hour)
    {
        var segs = day % 7 == 0 ? s.Sunday : s.Day;
        double h = ((hour % 24) + 24) % 24;
        foreach (var g in segs)
        {
            // a segment may run past midnight (b > 24): test both this day's hour and the hour + 24
            for (int i = 0; i < 2; i++)
            {
                double t = h + 24 * i;
                if (t >= g.A && t < g.B) return new Now(g.Act, g.Where ?? (g.Act == "work" ? "work" : "home"), t - g.A, g.B - t);
            }
        }
        return new Now("home", "home", 0, 1);
    }

    // ------------------------------------------------------------------ wayfind.ts (the pure helpers)

    /// <summary>The length of a way in metres.</summary>
    public static double WayLength(IReadOnlyList<Pt> pts)
    {
        double d = 0;
        for (int i = 1; i < pts.Count; i++) d += Hypot(pts[i].X - pts[i - 1].X, pts[i].Z - pts[i - 1].Z);
        return d;
    }

    /// <summary>The point `d` metres along a way (clamped to its ends), and which way he faces there (yaw = atan2(dx, dz)).</summary>
    public static (double x, double z, double yaw) PointAlong(IReadOnlyList<Pt> pts, double d)
    {
        if (pts.Count == 0) return (0, 0, 0);
        if (pts.Count == 1 || d <= 0)
        {
            var q = pts.Count > 1 ? pts[1] : pts[0];
            return (pts[0].X, pts[0].Z, Math.Atan2(q.X - pts[0].X, q.Z - pts[0].Z));
        }
        for (int i = 1; i < pts.Count; i++)
        {
            var a = pts[i - 1];
            var b = pts[i];
            double len = Hypot(b.X - a.X, b.Z - a.Z);
            if (d <= len)
            {
                double f = len != 0 ? d / len : 0;
                return (a.X + (b.X - a.X) * f, a.Z + (b.Z - a.Z) * f, Math.Atan2(b.X - a.X, b.Z - a.Z));
            }
            d -= len;
        }
        var p = pts[^2];
        var e = pts[^1];
        return (e.X, e.Z, Math.Atan2(e.X - p.X, e.Z - p.Z));
    }

    /// <summary>JavaScript's Math.round (halves go up), as a whole number.</summary>
    public static long JsRound(double v) => (long)Math.Floor(v + 0.5);

    /// <summary>The key a way is kept under: both ends on a 1 m grid (so near-same asks share one way).</summary>
    public static string WayKey(double ax, double az, double bx, double bz) => $"{JsRound(ax)},{JsRound(az)}>{JsRound(bx)},{JsRound(bz)}";

    public static double Hypot(double a, double b) => Math.Sqrt(a * a + b * b);

    // ------------------------------------------------------------------ whereabouts.ts

    /// <summary>Real seconds in a game minute (shared/clock.ts): a pace in m/s is twice that in metres a game minute.</summary>
    private const double RealSPerMin = 2;

    /// <summary>A small fixed number for an id (a spread over a place that stays put): FNV-1a over the UTF-16 units, as the TypeScript.</summary>
    public static uint HashId(string s)
    {
        uint h = 2166136261;
        foreach (char c in s) h = unchecked((h ^ c) * 16777619u);
        return h;
    }

    private static uint HashSuffix(string id, string suffix)
    {
        uint h = unchecked((HashId(id) ^ ':') * 16777619u);
        foreach (char c in suffix) h = unchecked((h ^ c) * 16777619u);
        return h;
    }

    /// <summary>
    /// A person's own pace in m/s of real time, the same seen and unseen: fixed per person, and on a leg (`leg`: a
    /// key of that walk) he either walks or runs (the young may run, children most; the old go slower).
    /// </summary>
    public static (double mps, bool run) PaceOf(Resident r, string leg = "")
    {
        int age = r.Age;
        double h = (HashSuffix(r.Id, "pace") & 0xffff) / 65536.0; // 0-1, his own
        double walk = age < 13 ? 1.25 : age < 30 ? 1.4 : age < 50 ? (r.Sex == "f" ? 1.25 : 1.35) : age < 65 ? 1.15 : 0.95;
        if (r.Trade is "soldier" or "sentry" or "corporal") walk = 1.3; // the marching step
        walk *= 0.92 + h * 0.16;
        double runs = age < 13 ? 0.45 : age < 30 ? 0.3 : age < 45 ? 0.1 : 0;
        bool run = leg != "" && runs > 0 && (HashSuffix(r.Id, leg) & 0xffff) / 65536.0 < runs;
        return (run ? (age < 13 ? 2.4 : age < 30 ? 2.7 : 2.3) * (0.95 + h * 0.1) : walk, run);
    }

    /// <summary>A pace in metres a game minute.</summary>
    public static double PerMin(double mps) => mps * RealSPerMin;

    /// <summary>The place of a part of the day: where he goes, whether it is indoors, and a round he walks there.</summary>
    public sealed class Anchor
    {
        public double X, Z;
        public bool Indoor;
        /// <summary>Walked when there (a round, a haul between the quay and a door).</summary>
        public Pt[]? Route;
        public bool Loop = true;
    }

    private static (double x, double z) Spread(string id, double x, double z, double r)
    {
        uint h = HashId(id);
        double a = ((h & 0xffff) / 65536.0) * Math.PI * 2;
        double d = Math.Sqrt(((h >> 16) & 0xffff) / 65536.0) * Math.Max(0, r) * 0.7;
        return (x + Math.Cos(a) * d, z + Math.Sin(a) * d);
    }

    private static Anchor WorkAnchor(Resident r, TownData town)
    {
        var w = r.Work;
        var home = new Anchor { X = r.HomeSx, Z = r.HomeSz, Indoor = true };
        if (w.Place == "home") return home;
        town.Places.TryGetValue(w.Place, out var p);
        if (w.Kind == "inside")
        {
            var d = w.Door ?? p?.Door;
            if (d != null) return new Anchor { X = d.Value.X, Z = d.Value.Z, Indoor = true };
            return p != null ? new Anchor { X = p.X, Z = p.Z, Indoor = true } : home;
        }
        if (w.Kind == "haul" && w.A != null && w.B != null) return new Anchor { X = w.A.Value.X, Z = w.A.Value.Z, Route = HaulRoute(w), Loop = false };
        if (w.Route is { Length: > 0 } && w.Kind is "patrol" or "roam" or "inspect" or "round")
            return new Anchor { X = w.Route[0].X, Z = w.Route[0].Z, Route = w.Route, Loop = w.Kind == "patrol" };
        if (w.At != null) return new Anchor { X = w.At[0], Z = w.At[1] };
        if (w.Stall is int st && st >= 0 && st < town.Stalls.Count) return new Anchor { X = town.Stalls[st].X, Z = town.Stalls[st].Z };
        if (w.Shop != null)
        {
            // (the shop's door step; `out` is the way out of its wall, a direction, not a point)
            var s = town.Shops.FirstOrDefault(q => q.Id == w.Shop);
            if (s != null) return new Anchor { X = s.Door.X, Z = s.Door.Z };
        }
        if (w.Door != null) return new Anchor { X = w.Door.Value.X, Z = w.Door.Value.Z };
        if (p != null)
        {
            var (x, z) = Spread(r.Id, p.X, p.Z, p.R);
            return new Anchor { X = x, Z = z };
        }
        return home;
    }

    /// <summary>A haul's two ends as one kept array (the round's cache goes by the array, as the TypeScript's WeakMap).</summary>
    private static readonly Dictionary<WorkSpec, Pt[]> HaulRoutes = new(ReferenceEqualityComparer.Instance);
    private static Pt[] HaulRoute(WorkSpec w)
    {
        if (!HaulRoutes.TryGetValue(w, out var r)) HaulRoutes[w] = r = new[] { w.A!.Value, w.B!.Value };
        return r;
    }

    private static readonly System.Text.RegularExpressions.Regex Prefix = new("^[a-z]+:", System.Text.RegularExpressions.RegexOptions.Compiled);

    /// <summary>Where a part of the day is (its act and place, as activityAt gives them).</summary>
    public static Anchor AnchorOf(Resident r, TownData town, string act, string place)
    {
        if (act == "home" || place == "home") return new Anchor { X = r.HomeSx, Z = r.HomeSz, Indoor = true };
        if (act == "work" || place == "work") return WorkAnchor(r, town);
        if (!town.Places.TryGetValue(place, out var p) && !town.Places.TryGetValue(Prefix.Replace(place, ""), out p)) return new Anchor { X = r.HomeSx, Z = r.HomeSz, Indoor = true };
        // before a tavern's door, as the game stands its drinkers (town.ts goalFor): `out` is the way out, a direction
        if (act == "tavern" && p.Door != null) return new Anchor { X = p.Door.Value.X + (p.Out?.X ?? 0) * 2, Z = p.Door.Value.Z + (p.Out?.Z ?? 0) * 2 };
        if (act == "church") return new Anchor { X = p.Door?.X ?? p.X, Z = p.Door?.Z ?? p.Z, Indoor = true };
        var (x, z) = Spread(r.Id, p.X, p.Z, p.R);
        return new Anchor { X = x, Z = z };
    }

    public sealed class Where
    {
        public double X, Z, Yaw;
        /// <summary>In a building (home, an indoor trade, mass): not in the street.</summary>
        public bool Indoor;
        /// <summary>On his way from the last place to this one.</summary>
        public bool Moving;
        public string Act = "home";
        public string Place = "home";
        public Anchor From = null!, To = null!;
        /// <summary>Metres walked of the way, and its length.</summary>
        public double Walked, Total;
        /// <summary>Hours since this part of the day began, and hours left in it.</summary>
        public double Since, Left;
        /// <summary>On his round: the index of the round's point he walks to (the game's puppet walks on from there).</summary>
        public int? Leg;
        /// <summary>On his way: running (the young, now and then).</summary>
        public bool Run;
        /// <summary>His pace now (m/s).</summary>
        public double Mps;
        /// <summary>Which stop of his day as he keeps it he is at or walks to.</summary>
        public int Stop;
        /// <summary>On his way: its points, from where he set off.</summary>
        public Pt[]? Way;
        /// <summary>The mill's man on a run with the cart: which mill, what he takes ("flour", "grain"), and the phase (load, go, unload, back, store).</summary>
        public (Mill mill, string kind, string phase)? Cart;
    }

    internal readonly record struct Part(string Act, string Place, double Start, double End);

    /// <summary>The legs of a round: from each point to the next (and back to the first when it is a loop).</summary>
    private static IEnumerable<(Pt, Pt)> RoundLegs(Pt[] pts, bool loop)
    {
        for (int i = 0; i < pts.Length - (loop ? 0 : 1); i++) yield return (pts[i], pts[(i + 1) % pts.Length]);
    }

    /// <summary>A round walked on foot: the ways between its points joined, and where each point's leg starts (metres).</summary>
    private sealed class RoundWay
    {
        public List<Pt> Pts = new();
        public List<double> Starts = new();
        public double Total;
        public int Generation;
        public bool Complete;
    }

    /// <summary>Rounds by their kept route array; incomplete rounds are refreshed when their requested ways arrive.</summary>
    private static readonly Dictionary<Pt[], RoundWay> RoundCache = new(ReferenceEqualityComparer.Instance);

    // A shared haul is a work round, with evenly spaced starts at the crew's walking pace.
    private static (double fraction, double mps)? HaulStart(Resident r, TownData town)
    {
        if (r.Work.Kind != "haul") return null;
        var crew = town.HaulCrews;
        if (crew == null)
        {
            crew = new Dictionary<string, (double, double)>();
            var routes = new Dictionary<string, List<Resident>>();
            foreach (var person in town.Residents)
            {
                if (person.Work.Kind != "haul" || person.Work.A == null || person.Work.B == null) continue;
                var (a, b) = (person.Work.A.Value, person.Work.B.Value);
                string key = string.Join(",", new[] { a.X, a.Z, b.X, b.Z }.Select(n => n.ToString("F1", CultureInfo.InvariantCulture)));
                if (!routes.TryGetValue(key, out var people)) routes[key] = people = new List<Resident>();
                people.Add(person);
            }
            foreach (var people in routes.Values)
            {
                // (the TypeScript sorts with localeCompare: the culture's order, not the code points')
                people.Sort((a, b) => string.Compare(a.Id, b.Id, CultureInfo.InvariantCulture, CompareOptions.None));
                double mps = people.Min(p => PaceOf(p).mps);
                for (int i = 0; i < people.Count; i++) crew[people[i].Id] = ((double)i / people.Count, mps);
            }
            town.HaulCrews = crew;
        }
        return crew.TryGetValue(r.Id, out var c) ? c : null;
    }

    /// <summary>The round on foot, leg by leg along the ways. A leg with no way yet is a step straight to its end, cached until new ways arrive.</summary>
    private static RoundWay RoundWayOf(Pt[] pts, bool loop, WayOf way)
    {
        if (RoundCache.TryGetValue(pts, out var hit) && (hit.Complete || hit.Generation == wayGen)) return hit;
        var rw = new RoundWay();
        bool whole = true;
        double d = 0;
        foreach (var (a, b) in RoundLegs(pts, loop))
        {
            var w = way(a.X, a.Z, b.X, b.Z, out _);
            if (w == null) whole = false;
            var leg = w ?? new[] { a, b };
            rw.Starts.Add(d);
            if (rw.Pts.Count > 0) d += Hypot(leg[0].X - rw.Pts[^1].X, leg[0].Z - rw.Pts[^1].Z);
            rw.Pts.AddRange(leg);
            d += WayLength(leg);
        }
        rw.Total = WayLength(rw.Pts);
        rw.Complete = whole; rw.Generation = wayGen;
        RoundCache[pts] = rw;
        return rw;
    }

    /// <summary>A point `d` metres along a round (looped, or there and back), and the index of the point he walks to.</summary>
    private static (double x, double z, double yaw, int leg) OnRound(Pt[] pts, double d0, bool loop, WayOf way, double startFrac)
    {
        var rw = RoundWayOf(pts, loop, way);
        if (rw.Total <= 0) return (pts[0].X, pts[0].Z, 0, 0);
        // (each man starts the round at his own point of it: the men of one round spread along it, never in one clump)
        double d = d0 + startFrac * (loop ? rw.Total : 2 * rw.Total);
        int LegAt(double s)
        {
            int i = 0;
            while (i + 1 < rw.Starts.Count && rw.Starts[i + 1] <= s) i++;
            return i;
        }
        if (loop)
        {
            double s = ((d % rw.Total) + rw.Total) % rw.Total;
            var p = PointAlong(rw.Pts, s);
            return (p.x, p.z, p.yaw, (LegAt(s) + 1) % pts.Length);
        }
        double u = ((d % (2 * rw.Total)) + 2 * rw.Total) % (2 * rw.Total);
        if (u <= rw.Total)
        {
            var p = PointAlong(rw.Pts, u);
            return (p.x, p.z, p.yaw, 1);
        }
        var back = PointAlong(rw.Pts, 2 * rw.Total - u);
        return (back.x, back.z, back.yaw + Math.PI, 0);
    }

    /// <summary>
    /// The part of the day at an hour that may run past midnight or before it (hours relative to `day`), with its true
    /// start and end. Hours no part covers are at home, from the end of the part before to the start of the next.
    /// </summary>
    private static (Part part, double since, double left) PartAt(Resident r, int day, double h)
    {
        Seg[] SegsOf(int d) => ((d % 7) + 7) % 7 == 0 ? r.Sched.Sunday : r.Sched.Day;
        int b0 = (int)Math.Floor(h / 24);
        var list = new List<Part>();
        for (int k = b0 - 1; k <= b0 + 1; k++)
            foreach (var g in SegsOf(day + k))
                list.Add(new Part(g.Act, g.Where ?? (g.Act == "work" ? "work" : "home"), g.A + 24 * k, g.B + 24 * k));
        // (the latest start wins; among equals the first in the list, as a stable sort)
        Part? hit = null;
        foreach (var q in list)
            if (h >= q.Start && h < q.End && (hit == null || q.Start > hit.Value.Start)) hit = q;
        if (hit != null) return (hit.Value, h - hit.Value.Start, hit.Value.End - h);
        double start = h - 24, end = h + 24;
        foreach (var q in list)
        {
            if (q.End <= h) start = Math.Max(start, q.End);
            if (q.Start > h) end = Math.Min(end, q.Start);
        }
        return (new Part("home", "home", start, end), h - start, end - h);
    }

    private static readonly Dictionary<Pt[], Pt[]> reversedMillRoutes = ReverseMillRoutes();
    private static Dictionary<Pt[], Pt[]> ReverseMillRoutes()
    {
        var routes = new Dictionary<Pt[], Pt[]>();
        foreach (var mill in SharedData.Mills)
        {
            var bakery = (Pt[])mill.RouteBakery.Clone(); Array.Reverse(bakery); routes[mill.RouteBakery] = bakery;
            var dock = (Pt[])mill.RouteDock.Clone(); Array.Reverse(dock); routes[mill.RouteDock] = dock;
        }
        return routes;
    }
    /// <summary>A mill's two runs of a day (shared/mills.ts runsOf): flour to the bakery at dawn, grain from the dock after dinner.</summary>
    public static (string kind, string phase, double since, double left)? RunNow(Mill m, int day, double hour)
    {
        if (day % 7 == 0) return null;
        double b = m.WayBakery / SharedData.CartPace / 120, g = m.WayGrain / SharedData.CartPace / 120, L = SharedData.LoadH;
        double f0 = SharedData.FlourOut, g0 = SharedData.GrainOut;
        (string kind, string phase, double since, double left)? Phase(string kind, string phase, double from, double to) =>
            hour >= from && hour < to ? (kind, phase, hour - from, to - hour) : null;
        return Phase("flour", "load", f0, f0 + L) ?? Phase("flour", "go", f0 + L, f0 + L + b)
            ?? Phase("flour", "unload", f0 + L + b, f0 + L + b + L) ?? Phase("flour", "back", f0 + L + b + L, f0 + L + b + L + b)
            ?? Phase("grain", "go", g0, g0 + g) ?? Phase("grain", "load", g0 + g, g0 + g + L)
            ?? Phase("grain", "back", g0 + g + L, g0 + g + L + g) ?? Phase("grain", "store", g0 + g + L + g, g0 + g + L + g + L);
    }

    /// <summary>
    /// The mill's man on a run (whereabouts.ts millRun): along the cart's way on the way out and back, at the stop
    /// while loading or unloading, at the cart's stand in the store. False when he is not on a run.
    /// </summary>
    private static bool MillRun(Resident r, int day, double hour, Where o)
    {
        if (r.Trade != "miller_man") return false;
        Mill? m = null;
        foreach (var mill in SharedData.Mills) if (mill.Id == r.Work.Place) { m = mill; break; }
        if (m == null || RunNow(m, day, hour) is not { } run) return false;
        o.Cart = (m, run.kind, run.phase);
        o.Indoor = false;
        if (run.phase is "go" or "back")
        {
            var route = run.kind == "flour" ? m.RouteBakery : m.RouteDock;
            var way = run.phase == "back" ? reversedMillRoutes[route] : route;
            double f = run.since / Math.Max(1e-6, run.since + run.left);
            double total = WayLength(way);
            (o.X, o.Z, o.Yaw) = PointAlong(way, f * total);
            o.Moving = true;
            o.Walked = f * total;
            o.Total = total;
            o.Way = way;
            o.Mps = SharedData.CartPace;
            return true;
        }
        var at = (run.kind == "flour" && run.phase == "load") || (run.kind == "grain" && run.phase == "store") ? m.Park : run.kind == "flour" ? m.StopBakery : m.StopDock;
        o.X = at.X;
        o.Z = at.Z;
        o.Yaw = 0;
        o.Moving = false;
        o.Walked = o.Total = 0;
        o.Mps = 0;
        return true;
    }

    private static bool Same(Anchor a, Anchor b) => Math.Abs(a.X - b.X) < 0.5 && Math.Abs(a.Z - b.Z) < 0.5;

    /// <summary>A walk between two places at a pace: its way and length.</summary>
    internal sealed class Walk
    {
        public Pt[] Pts = Array.Empty<Pt>();
        public double Total, Mps, Hours, Dep;
        public bool Run;
    }

    /// <summary>One place of his day as he really keeps it: the part, when he gets there and leaves, and the walk there.</summary>
    public sealed class Stop
    {
        internal Part Part;
        internal Anchor At = null!;
        internal double Arrive, Leave;
        /// <summary>The walk that brought him here, and when he set off.</summary>
        internal Walk? Walk;
        /// <summary>Where he stands once there: the walk's end for a place in the street, the place itself when indoors.</summary>
        internal Pt Stand;
    }

    /// <summary>A stay shorter than this (hours, or half the part if that is less) is not worth the walk: he skips that part of his day.</summary>
    private const double MinStayH = 0.5;
    /// <summary>The day's route is worked out from this long before midnight (so a night part is followed in).</summary>
    private const double LeadH = 6;

    /// <summary>Routes worked out and routes found in the cache (the frame cost: a route is worked out once a day per person).</summary>
    public static int RoutesMade, RouteHits, RoutesUnknown;
    private static int wayGen;
    /// <summary>The way function knows more ways now: routes worked out without them are worked out again.</summary>
    public static void WaysLearnt() => wayGen++;
    public static void Forget() { RoundCache.Clear(); HaulRoutes.Clear(); wayGen++; }

    /// <summary>
    /// His day as he keeps it: he sets off early enough to be at the next part at its hour, at his pace; a young one
    /// late for it runs; a part he would reach too late to stay is skipped. Hours relative to `day`.
    /// </summary>
    private static Stop[] DayRoute(Resident r, TownData town, int day, WayOf way)
    {
        if (r.RouteCache.TryGetValue(day, out var hit))
        {
            RouteHits++;
            return hit;
        }
        if (r.PartialRoute is { } pr && pr.day == day && pr.gen == wayGen)
        {
            RouteHits++;
            return pr.stops;
        }
        RoutesMade++;
        bool known = true;
        Walk? WalkOf(Anchor a, Anchor b, string leg, bool run)
        {
            if (Same(a, b)) return null;
            var pts = way(a.X, a.Z, b.X, b.Z, out bool k);
            if (!k) known = false;
            if (pts == null) return null;
            double total = WayLength(pts);
            var p = PaceOf(r, leg);
            double mps = run && !p.run ? RunPace(r) ?? p.mps : p.mps;
            return new Walk { Pts = pts, Total = total, Mps = mps, Run = p.run || mps > p.mps, Hours = total / PerMin(mps) / 60 };
        }
        // the parts in order
        var parts = new List<Part>();
        for (double h = -LeadH; h < 24 + LeadH;)
        {
            var q = PartAt(r, day, h).part;
            parts.Add(q);
            h = q.End > h ? q.End + 1e-6 : h + 0.25;
        }
        var stops = new List<Stop>();
        var first = parts[0];
        var at0 = AnchorOf(r, town, first.Act, first.Place);
        stops.Add(new Stop { Part = first, At = at0, Arrive = first.Start, Leave = double.PositiveInfinity, Stand = new Pt(at0.X, at0.Z) });
        foreach (var q in parts.Skip(1))
        {
            var cur = stops[^1];
            var at = AnchorOf(r, town, q.Act, q.Place);
            string leg = $"{day}:{JsRound(q.Start * 60)}";
            var w = WalkOf(cur.At, at, leg, false);
            double minStay = Math.Min(MinStayH, (q.End - q.Start) / 2);
            double dep = w != null ? Math.Max(cur.Arrive, q.Start - w.Hours) : q.Start;
            double arrive = w != null ? dep + w.Hours : Math.Max(cur.Arrive, q.Start);
            if (w != null && q.End - arrive < minStay)
            {
                // late: a young one runs for it
                var fast = WalkOf(cur.At, at, leg, true);
                if (fast != null && fast.Mps > w.Mps)
                {
                    double d2 = Math.Max(cur.Arrive, q.Start - fast.Hours);
                    if (q.End - (d2 + fast.Hours) >= minStay)
                    {
                        w = fast;
                        dep = d2;
                        arrive = d2 + fast.Hours;
                    }
                }
            }
            if (q.End - arrive < minStay && !Same(cur.At, at)) continue; // not worth it: on to the next part
            if (Same(cur.At, at))
            {
                // the same place: he stays (the part changes, the place does not)
                stops.Add(new Stop { Part = q, At = at, Arrive = Math.Max(cur.Arrive, q.Start), Leave = double.PositiveInfinity, Stand = cur.Stand });
                cur.Leave = Math.Max(cur.Arrive, q.Start);
                continue;
            }
            cur.Leave = dep;
            if (w != null) w.Dep = dep;
            stops.Add(new Stop { Part = q, At = at, Arrive = arrive, Leave = double.PositiveInfinity, Walk = w, Stand = w != null && !at.Indoor ? w.Pts[^1] : new Pt(at.X, at.Z) });
        }
        var arr = stops.ToArray();
        if (!known)
        {
            RoutesUnknown++;
            r.PartialRoute = (day, wayGen, arr);
        }
        else
        {
            if (r.RouteCache.Count > 8) r.RouteCache.Clear();
            r.RouteCache[day] = arr;
        }
        return arr;
    }

    /// <summary>For a check: his day as he keeps it, one stop a line (the part, when he gets there, the walk there).</summary>
    public static string DescribeDay(Resident r, TownData town, int day, WayOf way) =>
        string.Join(" | ", DayRoute(r, town, day, way).Select(s => FormattableString.Invariant($"{s.Part.Act}:{s.Part.Place} {s.Part.Start:F2}-{s.Part.End:F2} at {s.At.X:F1},{s.At.Z:F1} arrive {s.Arrive:F3} walk {(s.Walk == null ? "none" : $"{s.Walk.Total:F1} m {s.Walk.Pts.Length} pts")}")));

    /// <summary>His running pace, if he is one who runs at all (the young and children), else null.</summary>
    private static double? RunPace(Resident r)
    {
        int age = r.Age;
        if (age >= 45) return null;
        double h = (HashSuffix(r.Id, "pace") & 0xffff) / 65536.0;
        return (age < 13 ? 2.4 : age < 30 ? 2.7 : 2.3) * (0.95 + h * 0.1);
    }

    /// <summary>
    /// Where the sum puts a resident at this clock (day 1 = Monday; hour fractional): on his day's route, walking or
    /// running between two places, or at one (indoors, at his stand, on his round since he got there). Act, Place,
    /// Since and Left are those of the part he is at or walking to (the game sets his goal by them).
    /// </summary>
    public static Where WhereAt(Resident r, TownData town, int day, double hour, WayOf way, Where? reuse = null)
    {
        var stops = DayRoute(r, town, day, way);
        int k = stops.Length - 1;
        for (int i = 1; i < stops.Length; i++)
        {
            double dep = stops[i].Walk != null ? stops[i].Walk!.Dep : stops[i].Arrive;
            if (hour < dep)
            {
                k = i - 1;
                break;
            }
        }
        // stop k: he is there, or it is the last he left; stop k + 1 is the one he walks to once he set off
        var here = stops[k];
        var prev = k > 0 ? stops[k - 1].At : here.At;
        var o = reuse ?? new Where();
        o.X = o.Z = o.Yaw = o.Walked = o.Total = o.Mps = 0;
        o.Indoor = o.Moving = o.Run = false; o.Leg = null; o.Cart = null; o.Way = null;
        o.Act = here.Part.Act; o.Place = here.Part.Place; o.Since = Math.Max(0, hour - here.Part.Start);
        o.Left = Math.Max(0, here.Part.End - hour); o.From = prev; o.To = here.At; o.Stop = k;
        // (the mill's man keeps the cart's timetable to its end: he sets off for the evening's place after the sacks are in)
        if (MillRun(r, day, hour, o))
        {
            o.From = o.To = here.At;
            return o;
        }
        var w = here.Walk;
        if (w != null && hour < here.Arrive)
        {
            double walked = Math.Max(0, Math.Min(w.Total, (hour - w.Dep) * 60 * PerMin(w.Mps)));
            var p = PointAlong(w.Pts, walked);
            o.Walked = walked;
            o.Total = w.Total;
            (o.X, o.Z, o.Yaw) = p;
            o.Moving = true;
            o.Run = w.Run;
            o.Mps = w.Mps;
            o.Way = w.Pts;
            return o;
        }
        double total = w?.Total ?? 0;
        o.Walked = total;
        o.Total = total;
        var A = here.At;
        if (A.Route is { Length: > 1 })
        {
            // on his round since he got there, at his walk
            var crew = HaulStart(r, town);
            double walk = crew?.mps ?? PaceOf(r).mps;
            // (his own start point on the round: "not bunching like 100 people in one job spot/pile")
            r.RoundHash ??= HashId(r.Id + ":round");
            var p = OnRound(A.Route, (hour - (crew != null ? here.Part.Start : here.Arrive)) * 60 * PerMin(walk), A.Loop, way, crew?.fraction ?? (r.RoundHash.Value & 0xffff) / 65536.0);
            (o.X, o.Z, o.Yaw) = (p.x, p.z, p.yaw);
            o.Moving = true;
            o.Leg = p.leg;
            o.Mps = walk;
            return o;
        }
        o.X = here.Stand.X;
        o.Z = here.Stand.Z;
        o.Indoor = A.Indoor;
        return o;
    }

    // ------------------------------------------------------------------ progress reports (the trade plan, part A)
    // Near a player a townsperson is walked by the game, and a crowd or the player himself may slow him. When he leaves
    // the view the sum would have him further on than he got. So the game that walks him keeps how far behind the sum
    // he is (his lag, in game hours): his clock runs that much late, until he stops at a place of his day where the
    // sum without the lag has him too.

    /// <summary>A lag is never more than this (game hours): a man held up longer has lost his way and goes by the plain sum.</summary>
    public const double LagMaxH = 1;
    private const double LagSlackM = 1.5;
    private const double LagOffWayM = 6;

    /// <summary>The sum with his lag: his day as he keeps it, that much late.</summary>
    public static Where WhereLate(Resident r, TownData town, int day, double hour, WayOf way, double lagH, Where? reuse = null) =>
        WhereAt(r, town, day, hour - (lagH > 0 ? Math.Min(lagH, LagMaxH) : 0), way, reuse);

    /// <summary>The metres along a way of the point on it nearest (x, z), and how far off it that point is.</summary>
    public static (double s, double off) ProjectOn(IReadOnlyList<Pt> pts, double x, double z)
    {
        (double s, double off) best = (0, double.PositiveInfinity);
        double acc = 0;
        for (int i = 1; i < pts.Count; i++)
        {
            double ax = pts[i - 1].X, az = pts[i - 1].Z;
            double dx = pts[i].X - ax, dz = pts[i].Z - az;
            double l2 = dx * dx + dz * dz;
            double t = l2 > 0 ? Math.Max(0, Math.Min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
            double off = Hypot(ax + dx * t - x, az + dz * t - z);
            if (off < best.off) best = (acc + Math.Sqrt(l2) * t, off);
            acc += Math.Sqrt(l2);
        }
        return best;
    }

    /// <summary>A lag kept or let go: gone when he is at a place of his day and the plain sum has him at the same stop, not walking; gone too at LagMaxH.</summary>
    public static double SettleLag(Resident r, TownData town, int day, double hour, WayOf way, double lagH)
    {
        if (!(lagH > 0) || lagH >= LagMaxH) return 0;
        var late = WhereLate(r, town, day, hour, way, lagH, r.WhereValue);
        if (late.Moving) return lagH;
        var plain = WhereAt(r, town, day, hour, way, r.WhereSecond);
        return !plain.Moving && plain.Stop == late.Stop ? 0 : lagH;
    }

    /// <summary>
    /// The progress report of a person the game walks (at x, z): his new lag. On his way, he is compared with the sum
    /// at his lag: behind it, the lag grows by the time the missing metres take at his pace; ahead of it, it shrinks.
    /// </summary>
    public static double ReportLag(Resident r, TownData town, int day, double hour, WayOf way, double lagH, double x, double z)
    {
        double lag = Math.Max(0, Math.Min(LagMaxH, double.IsNaN(lagH) ? 0 : lagH));
        var w = WhereLate(r, town, day, hour, way, lag, r.WhereValue);
        // (the mill's man keeps the cart's timetable: he is never late by the sum)
        if (w.Cart != null) return 0;
        if (!w.Moving || w.Way == null || w.Leg != null || !(w.Mps > 0)) return SettleLag(r, town, day, hour, way, lag);
        var p = ProjectOn(w.Way, x, z);
        if (p.off > LagOffWayM) return lag;
        double behind = w.Walked - p.s;
        if (Math.Abs(behind) < LagSlackM) return lag;
        double next = lag + behind / PerMin(w.Mps) / 60;
        // (an hour or more behind: he has lost his way and goes by the plain sum, as settleLag)
        return next >= LagMaxH ? 0 : Math.Max(0, next);
    }
}
