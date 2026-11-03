using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

/// <summary>
/// The Ruien's folding footbridges (#286, #283; docs/ruien-native.md "Fold bridges"): the server owns every leaf, so
/// all players see the same bridge. Rest is down (people cross). A giant within `giantRaise` of a bridge's middle
/// (and within `giantHeight` of its deck level) raises both leaves; they come down once no giant is within
/// `giantLower`. The rule for people: a leaf never moves while anyone stands in the zone it sweeps (its deck, and its
/// rails' swing behind the hinge); the giant waits `giantHold` short of the bridge until both leaves stand.
/// The phase is not saved: after a load it is derived from where the giants are and stands there at once.
/// </summary>
public sealed class NativeRuienBridges : INativeServiceModule
{
    public sealed record Bridge(string Id, double Ax, double Ay, double Az, double Bx, double By, double Bz);
    public sealed record Numbers(double DeckAbove, double RaiseSeconds, double GiantRaise, double GiantLower, double GiantHold, double GiantHeight, double SweepBehind, double SweepHalf, double SweepAbove);
    public readonly record struct Spot(double X, double Y, double Z);
    private sealed class State { public double Phase; public bool Raising, Held, Known; }
    private sealed class Walker { public Spot[] Path = Array.Empty<Spot>(); public int Seg; public double Frac, Speed, Yaw, Waited; public Spot At; public bool Waiting; }
    private readonly NativeServiceHost host;
    private readonly Bridge[] bridges;
    private readonly Numbers k;
    private readonly Dictionary<string, State> states = new();
    private Walker? proof;
    private long last;
    /// <summary>The giants the world has now (the live Antigoon), at their feet.</summary>
    public Func<IEnumerable<Spot>> LiveGiants = () => Array.Empty<Spot>();
    /// <summary>Everyone who must not be swept: the players (and people who walk the Ruien), at their feet.</summary>
    public Func<IEnumerable<Spot>> People = () => Array.Empty<Spot>();

    public NativeRuienBridges(NativeServiceHost host, IEnumerable<Bridge> bridges, Numbers numbers)
    {
        this.host = host; this.bridges = bridges.ToArray(); k = numbers;
        foreach (var b in this.bridges) states[b.Id] = new State();
    }
    public IReadOnlyList<Bridge> Bridges => bridges;
    internal System.Threading.Tasks.Task<T> WithState<T>(Func<NativeRuienBridges, T> operation) => host.WithState(_ => operation(this));

    public void Register(NativeServiceHost service)
    {
        service.Loaded += Reset; service.NewGame += Reset;
        service.Register("GET", "/api/ruien/bridges", _ => { Advance(); return View(); });
        // A proof's giant (the host only): walks the path at its speed through the bridges, by the same rules.
        service.Register("POST", "/api/dev/ruien/giant", r =>
        {
            if (r.PlayerId != 1) throw new NativeServiceException("Only the host walks a proof giant.", 403);
            Advance();
            var path = (r.Body["path"] as JsonArray ?? new()).OfType<JsonArray>().Select(p => new Spot(N(p[0]), N(p[1]), N(p[2]))).ToArray();
            proof = path.Length >= 2 ? new Walker { Path = path, At = path[0], Speed = Math.Clamp(N(r.Body["speed"]), .2, 3) } : null;
            return View();
        });
    }
    private static double N(JsonNode? n) => n is JsonValue v && v.TryGetValue<double>(out var d) && double.IsFinite(d) ? d : 0;
    private void Reset() { last = 0; proof = null; foreach (var s in states.Values) { s.Known = false; s.Held = false; } }

    private (double x, double z, double y, double ux, double uz, double span) Line(Bridge b)
    {
        double dx = b.Bx - b.Ax, dz = b.Bz - b.Az, span = Math.Sqrt(dx * dx + dz * dz);
        return ((b.Ax + b.Bx) / 2, (b.Az + b.Bz) / 2, (b.Ay + b.By) / 2 + k.DeckAbove, dx / span, dz / span, span);
    }
    private IEnumerable<Spot> Giants() => LiveGiants().Concat(proof != null ? new[] { proof.At } : Array.Empty<Spot>());
    /// <summary>A giant's distance from the bridge's middle in plan, or infinity when he is not at its level.</summary>
    private double GiantDistance(Bridge b, Spot g)
    {
        var l = Line(b);
        return Math.Abs(g.Y - l.y) > k.GiantHeight ? double.PositiveInfinity : Math.Sqrt((g.X - l.x) * (g.X - l.x) + (g.Z - l.z) * (g.Z - l.z));
    }
    /// <summary>Someone in the zone a leaf sweeps: along the span from behind one hinge to behind the other, across the
    /// rails' width, from just under the deck to above a man's head.</summary>
    public bool Occupied(Bridge b, Spot p)
    {
        var l = Line(b);
        double rx = p.X - b.Ax, rz = p.Z - b.Az, t = rx * l.ux + rz * l.uz, s = -rx * l.uz + rz * l.ux;
        return t > -k.SweepBehind && t < l.span + k.SweepBehind && Math.Abs(s) < k.SweepHalf && p.Y > l.y - .6 && p.Y < l.y + k.SweepAbove;
    }
    /// <summary>People may cross a bridge only while both leaves are down; a giant may pass only while both stand.</summary>
    public bool OpenToPeople(string id) => states.TryGetValue(id, out var s) && s.Phase <= 0;
    public bool OpenToGiant(string id) => states.TryGetValue(id, out var s) && s.Phase >= 1;

    private void Advance()
    {
        long now = host.Context.Now;
        double dt = last == 0 || now - last > 1000 ? 0 : Math.Clamp((now - last) / 1000.0, 0, .5); last = now;
        if (host.Saves.Paused) dt = 0;
        var people = People().ToArray();
        // the proof's giant walks first, waiting short of any bridge that does not stand yet
        while (dt > 0)
        {
            double step = Math.Min(.05, dt); dt -= step;
            Walk(step);
            foreach (var b in bridges) Leaf(b, states[b.Id], step, people);
        }
        foreach (var b in bridges)
        {
            var s = states[b.Id];
            if (s.Known) continue;
            // not saved: after a load or a new game the leaves stand where the giants say, at once
            s.Raising = Giants().Any(g => GiantDistance(b, g) < k.GiantLower); s.Phase = s.Raising ? 1 : 0; s.Known = true;
        }
    }
    private void Leaf(Bridge b, State s, double dt, Spot[] people)
    {
        if (!s.Known) return;
        double near = Giants().Select(g => GiantDistance(b, g)).DefaultIfEmpty(double.PositiveInfinity).Min();
        if (near < k.GiantRaise) s.Raising = true;
        else if (near > k.GiantLower) s.Raising = false;
        double want = s.Raising ? 1 : 0;
        s.Held = s.Phase != want && people.Any(p => Occupied(b, p));
        if (!s.Held) s.Phase = Math.Clamp(s.Phase + (s.Raising ? 1 : -1) * dt / k.RaiseSeconds, 0, 1);
    }
    private void Walk(double dt)
    {
        var w = proof;
        if (w == null || w.Seg >= w.Path.Length - 1) { if (w != null) w.Waiting = false; return; }
        var a = w.Path[w.Seg]; var b = w.Path[w.Seg + 1];
        double len = Math.Max(.001, Math.Sqrt((b.X - a.X) * (b.X - a.X) + (b.Y - a.Y) * (b.Y - a.Y) + (b.Z - a.Z) * (b.Z - a.Z)));
        double f = Math.Min(1, w.Frac + w.Speed * dt / len);
        var next = new Spot(a.X + (b.X - a.X) * f, a.Y + (b.Y - a.Y) * f, a.Z + (b.Z - a.Z) * f);
        foreach (var br in bridges)
        {
            double d0 = GiantDistance(br, w.At), d1 = GiantDistance(br, next);
            if (d1 < k.GiantHold && d1 < d0 && states[br.Id].Phase < 1) { w.Waiting = true; w.Waited += dt; return; }
        }
        w.Waiting = false; w.Yaw = Math.Atan2(-(b.X - a.X), -(b.Z - a.Z));
        w.At = next; w.Frac = f;
        if (f >= 1) { w.Seg++; w.Frac = 0; }
    }
    private JsonObject View()
    {
        var list = new JsonArray();
        foreach (var b in bridges)
        {
            var s = states[b.Id];
            list.Add(new JsonObject { ["id"] = b.Id, ["phase"] = s.Phase, ["raising"] = s.Raising, ["held"] = s.Held, ["people"] = s.Phase <= 0, ["giant"] = s.Phase >= 1 });
        }
        var giants = new JsonArray();
        if (proof is { } w)
            giants.Add(new JsonObject { ["id"] = "proof", ["x"] = w.At.X, ["y"] = w.At.Y, ["z"] = w.At.Z, ["yaw"] = w.Yaw, ["waiting"] = w.Waiting, ["waited"] = w.Waited, ["done"] = w.Seg >= w.Path.Length - 1 });
        return new JsonObject { ["bridges"] = list, ["giants"] = giants, ["server_ms"] = host.Context.Now };
    }
}
