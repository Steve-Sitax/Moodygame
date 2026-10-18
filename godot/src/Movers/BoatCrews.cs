using System;
using System.Collections.Generic;
using Godot;
using Scheldemist.People;

namespace Scheldemist.Movers;

/// <summary>
/// Issue 154: no boat sails with nobody on board. Every single vessel that is underway (the river's traffic, the tows
/// to and from the anchorage, the lock's boats, the ships passing the opening bridges) gets her people, on her own
/// floor (Play/ShipWalk's deck of the model) so they ride her heave and roll: a rowing boat a rower on her thwart with
/// her oars out; a bigger boat her steersman aft, a hand forward, and on the big ships a third amidships. They come
/// aboard when she first moves and stay while she is drawn; past 150 m they are not drawn (or updated). The
/// residents' own boats have their crews already (Play/Rowing.Residents.cs); moored boats have their families
/// (ShipLife) or lie empty, as moored boats do.
/// Multiplayer: the traffic is the movers' (every PC runs the same movers clock and dice), so the crews are the same
/// on every PC with no extra traffic on the wire.
/// </summary>
[GamePart(52)]
public partial class BoatCrews : Node
{
    public static BoatCrews? I { get; private set; }
    private sealed class Hand { public Human Human = null!; public Node3D Frame = null!; public string Motion = "idle"; }
    private sealed class Crew
    {
        public Node3D Root = null!;
        public readonly List<Hand> Hands = new();
        public Scheldemist.Play.Rowing.Drawn? Oars;
        public float Phase;
    }
    private sealed class Track { public Vector3 Last; public float Speed, Since = 999; public bool Seen; }
    private readonly Dictionary<Boats.Float, Crew> crews = new();
    private readonly Dictionary<Boats.Float, Track> tracks = new();
    private static readonly string[] Sailors = { "sailor_b", "boatman", "docker_a", "docker_b" };
    private const float Far = 150;
    public int Aboard { get { int n = 0; foreach (var c in crews.Values) n += c.Hands.Count; return n; } }
    public int Boats_ => crews.Count;

    public override void _Ready()
    {
        I = this;
        if (Boats.I == null || !Humans.Ready) SetProcess(false);
    }

    private static string Kind(int i)
    {
        for (int k = 0; k < Sailors.Length; k++) { string s = Sailors[(i + k) % Sailors.Length]; if (Humans.IsKind(s)) return s; }
        return "docker_a";
    }

    /// <summary>The crew of a vessel: who stands where on her floor (local, bow toward +z), and what they do.</summary>
    private Crew? Make(Boats.Float f)
    {
        var deck = Scheldemist.Play.ShipWalk.I?.FloorFor(f.Kind);
        var root = new Node3D { Name = "crew_" + f.Kind };
        f.Inner.AddChild(root);
        var crew = new Crew { Root = root };
        var dim = Boats.I.Dims(f.Kind);
        int seed = Math.Abs((int)(f.Outer.GlobalPosition.X * 7 + f.Outer.GlobalPosition.Z * 13));
        void Add(Vector3 at, float yaw, string motion, int who)
        {
            var h = Humans.Make(Kind(seed + who)); if (h == null) return;
            var frame = new Node3D { Position = at, Rotation = new Vector3(0, yaw, 0) };
            root.AddChild(frame); frame.AddChild(h.Root); h.Start(); h.Play(motion, 0);
            crew.Hands.Add(new Hand { Human = h, Frame = frame, Motion = motion });
        }
        Vector3 Stand(float x, float z)
        {
            if (deck == null) return new Vector3(x, 0.5f, z);
            var p = deck.Nearest(new Vector2(x, z));
            return new Vector3(p.X, deck.Floor(p.X, p.Y), p.Y);
        }
        var oars = Scheldemist.Play.Rowing.I?.Oarsman(f.Inner, f.Kind);
        if (oars != null)
        {
            // a rower on her thwart, facing aft, her oars out (the oars laid in are hidden while she is rowed)
            foreach (var n in Scheldemist.World.BakedWorld.All(f.Inner)) if (n is Node3D c && c.Name.ToString().EndsWith("_stow")) c.Visible = false;
            crew.Oars = oars;
            var h = Humans.Make(Kind(seed)); if (h != null)
            {
                var frame = new Node3D { Position = new Vector3(0, oars.Hull.SeatY + h.SitDrop(0) + 0.02f, oars.Hull.SeatZ), Rotation = new Vector3(0, MathF.PI, 0) };
                root.AddChild(frame); frame.AddChild(h.Root); h.Start(); h.Play("row", 0);
                Scheldemist.Play.Rowing.SeatRower(h, frame, oars.Hull, f.Kind);
                crew.Hands.Add(new Hand { Human = h, Frame = frame, Motion = h.IsPeople2 ? "sit" : "row" });
            }
            return crew;
        }
        // a steersman aft at the helm, a hand forward; a third amidships on a ship of 30 m and more
        Add(Stand(0, -dim.Length / 2 + Math.Min(2.2f, dim.Length * 0.12f)), 0, "idle", 0);
        Add(Stand(dim.Beam * 0.15f, dim.Length / 2 - Math.Min(3f, dim.Length * 0.18f)), 0, seed % 2 == 0 ? "lean" : "idle", 1);
        if (dim.Length >= 30) Add(Stand(-dim.Beam * 0.3f, dim.Length * 0.05f), MathF.PI / 2, "pull", 2);
        return crew;
    }

    public override void _Process(double delta)
    {
        MoverCost.Begin("boat_crews");
        float dt = (float)Math.Max(1e-4, MoverClock.Dt);
        var eye = Main.I.Cam?.GlobalPosition ?? Vector3.Zero;
        var floats = Boats.I.Floats;
        for (int i = 0; i < floats.Count; i++)
        {
            var f = floats[i];
            if (!IsInstanceValid(f.Outer)) continue;
            bool shown = f.Outer.IsVisibleInTree();
            if (!tracks.TryGetValue(f, out var t)) tracks[f] = t = new Track();
            var at = f.Outer.GlobalPosition;
            if (t.Seen && shown) { float v = new Vector2(at.X - t.Last.X, at.Z - t.Last.Z).Length() / dt; t.Speed += (Math.Min(v, 20) - t.Speed) * Math.Min(1, dt * 2); }
            t.Last = at; t.Seen = shown;
            t.Since = t.Speed > 0.15f ? 0 : t.Since + dt;
            bool underway = shown && t.Since < 30;
            bool near = underway && new Vector2(at.X - eye.X, at.Z - eye.Z).LengthSquared() < Far * Far;
            if (!crews.TryGetValue(f, out var crew))
            {
                if (!near) continue;
                var made = Make(f); if (made == null) continue;
                crews[f] = crew = made;
            }
            crew.Root.Visible = near;
            if (!near) continue;
            crew.Phase = (crew.Phase + dt / 2) % 1;
            foreach (var h in crew.Hands)
            {
                if (h.Motion == "row") h.Human.SetPhase("row", t.Speed > 0.15f ? crew.Phase : 0.7f);
                h.Human.Update(dt);
            }
            if (crew.Oars != null) Scheldemist.Play.Rowing.OarPhase(crew.Oars, t.Speed > 0.15f ? crew.Phase : -1);
        }
        MoverCost.End("boat_crews");
    }

    /// <summary>For the checks: every vessel underway now, whether she has her people aboard and how many.</summary>
    public IEnumerable<(string Kind, Vector3 At, bool Underway, int Hands, bool Drawn)> Report()
    {
        foreach (var f in Boats.I.Floats)
        {
            if (!IsInstanceValid(f.Outer) || !tracks.TryGetValue(f, out var t)) continue;
            bool underway = f.Outer.IsVisibleInTree() && t.Since < 30;
            crews.TryGetValue(f, out var c);
            yield return (f.Kind, f.Outer.GlobalPosition, underway, c?.Hands.Count ?? 0, c?.Root.Visible == true);
        }
    }
}
