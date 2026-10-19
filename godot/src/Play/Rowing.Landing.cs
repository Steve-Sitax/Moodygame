using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.People;
using Scheldemist.World;

namespace Scheldemist.Play;

/// <summary>
/// Issue 154: the people of a resident's boat walk down the flight into her before she casts off, and step out onto the
/// landing and walk up the treads to the quay when she comes in (they used to appear in her and on the quay). Their
/// own figures from the boat walk the way: her floor to her end, the landing, the treads (QuayExits.OnFlight), the
/// quay's edge. Played when the player is near (ResidentJourneys asks); a boat far off still ties up at once.
/// </summary>
public partial class Rowing
{
    private sealed class Walker
    {
        public Human Human = null!; public Node3D Frame = null!;
        public readonly List<Vector3> Way = new(); public int I; public float Delay; public bool Done;
        /// <summary>Boarding: where she sits in the boat at the end (in the hull's frame) and what she does there.</summary>
        public Transform3D? Seat; public string Motion = "idle";
        /// <summary>(#195) Up or down a quay ladder: the points of the way on its rungs' line (a leg between two of them is
        /// climbed, facing the wall, with the ladder clip), the ladder and the heading that faces its rungs.</summary>
        public readonly HashSet<int> Rungs = new(); public QuayExits.Ladder? Ladder; public float Face;
    }
    private readonly Dictionary<string, List<Walker>> walkers = new();
    private const float WalkPace = 1.1f;
    /// <summary>Up and down a ladder, hand under hand (a loop of the ladder clip climbs two rungs, 0.58 m, in 1.2 s).</summary>
    private const float ClimbPace = 0.48f;

    /// <summary>(#195) The way between a boat lying at her quay ladder and the quay above it: her floor at her end nearest the
    /// ladder, a step across onto its lowest rung over her floor, up the rungs facing the wall (the node 0.30 m out from them,
    /// as Human2.Ladder climbs), over the coping between the hoops, in onto the quay behind the ladder's head. Null when she
    /// lies out of a step's reach of it. `rungs` gets the indices of the two points on the rungs.</summary>
    private List<Vector3>? LadderWay(ResidentHull b, Exit e, int who, HashSet<int> rungs)
    {
        if (e.Of is not { } l) return null;
        var n = new Vector3(e.Nx, 0, e.Nz);
        var wall = new Vector3(e.Wx, 0, e.Wz);
        var line = wall + n * (l.Rung + 0.30f);
        var hull = new Transform3D(new Basis(Vector3.Up, b.Hull.Yaw), new Vector3(b.Hull.X, Water.Level(b.Hull.X, b.Hull.Z), b.Hull.Z));
        if (ShipWalk.I?.FloorFor(b.Kind) is not { } deck) return null;
        var local = hull.AffineInverse() * line;
        var p = deck.Nearest(new Vector2(local.X, local.Z));
        var floor = hull * new Vector3(p.X, deck.Floor(p.X, p.Y), p.Y);
        if (new Vector2(floor.X - line.X, floor.Z - line.Z).Length() > 2.6f) return null;
        // (the rungs run from under the lowest tide to the coping: the climb starts at her floor, wherever the tide has her)
        float foot = Math.Max(floor.Y + 0.05f, l.Foot);
        var way = new List<Vector3> { floor, new(line.X, foot, line.Z), new(line.X, l.Top + 0.15f, line.Z) };
        rungs.Add(1); rungs.Add(2);
        way.Add(wall - n * 0.45f + Vector3.Up * l.Top);
        way.Add(new Vector3(e.Tx, e.Ty, e.Tz) - n * (0.7f * who));
        return way;
    }

    /// <summary>(#195) Her people step out at the ladder she lies by and climb up it to the quay, one on the rungs at a
    /// time (4.5 s apart: the next starts when the one before is 2 m above her).</summary>
    public void ResidentBoatLandLadder(string id, Exit e)
    {
        if (!residentHulls.TryGetValue(id, out var b) || e.Of == null) return;
        // her route ends up to a few metres short of her mooring: she is drawn in to it first (SettleBoats), then they climb
        if (residentHomes.TryGetValue(id, out var home) && b.SettleAt == null && new Vector2(home.X - b.Hull.X, home.Y - b.Hull.Z).Length() is > .05f and < 8f)
        { b.SettleAt = e; b.SettleFrom = new Vector3(b.Hull.X, b.Hull.Z, b.Hull.Yaw); b.Settle = 0; return; }
        var list = new List<Walker>();
        int i = 0;
        foreach (var q in b.Crew)
        {
            var rungs = new HashSet<int>();
            var way = LadderWay(b, e, i, rungs); if (way == null) return;
            var w = new Walker { Human = q.Human, Frame = q.Frame, Delay = i * 4.5f, Ladder = e.Of, Face = MathF.Atan2(-e.Nx, -e.Nz) };
            w.Way.AddRange(way); foreach (int k in rungs) w.Rungs.Add(k);
            var at = q.Frame.GlobalTransform;
            q.Frame.GetParent()?.RemoveChild(q.Frame); root.AddChild(q.Frame); q.Frame.GlobalTransform = new Transform3D(new Basis(Vector3.Up, at.Basis.GetEuler().Y), at.Origin - Vector3.Up * (q.Human.IsPeople2 ? q.Human.SitDrop(0.4f) : 0));
            q.Human.GripTargets(null, null); // (the rower lets go of the oars)
            list.Add(w); i++;
        }
        walkers[id] = list;
    }

    /// <summary>(#195) Her people come down the ladder she lies by and take their places in her; she waits for them.</summary>
    public void ResidentBoatBoardLadder(string id, Exit e)
    {
        if (!residentHulls.TryGetValue(id, out var b) || e.Of == null) return;
        var list = new List<Walker>();
        int i = 0;
        foreach (var q in b.Crew)
        {
            var rungs = new HashSet<int>();
            var way = LadderWay(b, e, i, rungs); if (way == null) return;
            way.Reverse();
            var w = new Walker { Human = q.Human, Frame = q.Frame, Delay = i * 4.5f, Seat = q.Frame.Transform, Motion = q.Human.Motion ?? "sit", Ladder = e.Of, Face = MathF.Atan2(-e.Nx, -e.Nz) };
            // (reversed and without its first point, the quay where the frame starts: the rungs are points 1 and 2 of it)
            foreach (int k in rungs) w.Rungs.Add(way.Count - 1 - k - 1);
            w.Way.AddRange(way.Skip(1));
            w.Way.Add(new Transform3D(new Basis(Vector3.Up, b.Hull.Yaw), new Vector3(b.Hull.X, Water.Level(b.Hull.X, b.Hull.Z), b.Hull.Z)) * q.Frame.Transform.Origin);
            q.Frame.GetParent()?.RemoveChild(q.Frame); root.AddChild(q.Frame); q.Frame.GlobalTransform = new Transform3D(Basis.Identity, way[0]);
            q.Human.Play("idle", 0);
            list.Add(w); i++;
        }
        walkers[id] = list;
    }

    /// <summary>The way between a boat lying at a flight and the quay above it: her floor at her end nearest the
    /// landing, the landing's end, up the middle of the treads, the head, a step in onto the quay.</summary>
    private List<Vector3>? FlightWay(ResidentHull b, QuayExits.Frame f, int who)
    {
        var way = new List<Vector3>();
        var landing = QuayExits.OnFlight(f, QuayExits.FlightEnd - 0.45f, 1.1f);
        // (her place and heading, not her model's node: a boat just made is placed on the next frame)
        var hull = new Transform3D(new Basis(Vector3.Up, b.Hull.Yaw), new Vector3(b.Hull.X, Water.Level(b.Hull.X, b.Hull.Z), b.Hull.Z));
        if (ShipWalk.I?.FloorFor(b.Kind) is { } deck)
        {
            var l = hull.AffineInverse() * landing;
            var p = deck.Nearest(new Vector2(l.X, l.Z));
            way.Add(hull * new Vector3(p.X, deck.Floor(p.X, p.Y), p.Y));
            // she lies alongside another boat: across that boat's floor
            var mid = (way[0] + landing) / 2;
            foreach (var other in ShipWalk.I!.Decks)
            {
                if (!other.Small || !other.Visible() || other.World().Origin.DistanceTo(hull.Origin) < 0.5f || new Vector2(other.World().Origin.X - mid.X, other.World().Origin.Z - mid.Z).Length() > 4) continue;
                var ol = other.World().AffineInverse() * mid; if (!other.Mesh.Stand(ol.X, ol.Z, 0.1f)) continue;
                way.Add(other.At(other.Mesh.Nearest(new Vector2(ol.X, ol.Z)))); break;
            }
            // no near landing (the places by it were taken): she ties up further along, and they go ashore unseen as before
            for (int k = 1; k < way.Count; k++) if (new Vector2(way[k].X - way[k - 1].X, way[k].Z - way[k - 1].Z).Length() > 2.6f) return null;
            if (new Vector2(landing.X - way[^1].X, landing.Z - way[^1].Z).Length() > 2.6f) return null;
        }
        way.Add(landing);
        for (float s = QuayExits.FlightEnd - 1.1f; s > QuayExits.FlightTop; s -= 0.62f) way.Add(QuayExits.OnFlight(f, s, QuayExits.FlightMid));
        way.Add(QuayExits.OnFlight(f, 0.2f, QuayExits.FlightMid));
        way.Add(QuayExits.OnFlight(f, 0.5f + who * 0.6f, -1.2f));
        return way;
    }

    /// <summary>Her people step out at the flight whose head is at `top` and walk up to the quay.</summary>
    public void ResidentBoatLand(string id, Vector2 top)
    {
        if (!residentHulls.TryGetValue(id, out var b) || QuayExits.FlightAt(top.X, top.Y) is not { } f) return;
        var list = new List<Walker>();
        int i = 0;
        foreach (var q in b.Crew)
        {
            var way = FlightWay(b, f, i); if (way == null) return;
            var w = new Walker { Human = q.Human, Frame = q.Frame, Delay = i * 0.9f };
            w.Way.AddRange(way);
            var at = q.Frame.GlobalTransform;
            q.Frame.GetParent()?.RemoveChild(q.Frame); root.AddChild(q.Frame); q.Frame.GlobalTransform = new Transform3D(new Basis(Vector3.Up, at.Basis.GetEuler().Y), at.Origin - Vector3.Up * (q.Human.IsPeople2 ? q.Human.SitDrop(0.4f) : 0));
            q.Human.GripTargets(null, null); // (the rower lets go of the oars)
            list.Add(w); i++;
        }
        walkers[id] = list;
    }

    /// <summary>Her people come down the flight whose head is at `top` and take their places in her; she waits for them.</summary>
    public void ResidentBoatBoard(string id, Vector2 top)
    {
        if (!residentHulls.TryGetValue(id, out var b) || QuayExits.FlightAt(top.X, top.Y) is not { } f) return;
        var list = new List<Walker>();
        int i = 0;
        foreach (var q in b.Crew)
        {
            var way = FlightWay(b, f, i); if (way == null) return; way.Reverse();
            var w = new Walker { Human = q.Human, Frame = q.Frame, Delay = i * 0.9f, Seat = q.Frame.Transform, Motion = q.Human.Motion ?? "sit" };
            w.Way.AddRange(way.Skip(1));
            w.Way.Add(new Transform3D(new Basis(Vector3.Up, b.Hull.Yaw), new Vector3(b.Hull.X, Water.Level(b.Hull.X, b.Hull.Z), b.Hull.Z)) * q.Frame.Transform.Origin);
            q.Frame.GetParent()?.RemoveChild(q.Frame); root.AddChild(q.Frame); q.Frame.GlobalTransform = new Transform3D(Basis.Identity, way[0]);
            q.Human.Play("idle", 0);
            list.Add(w); i++;
        }
        walkers[id] = list;
    }

    /// <summary>Have her people finished walking (out or in)? (True when nobody walks for her and she is not being drawn in
    /// to her ladder.)</summary>
    public bool ResidentWalkersDone(string id) => !(residentHulls.TryGetValue(id, out var b) && b.SettleAt != null) && (!walkers.TryGetValue(id, out var l) || l.All(w => w.Done));

    /// <summary>(#195) Boats being drawn in to their own ladder's mooring: over a second and a half, eased, her heading
    /// turned to the mooring's; then her people climb out.</summary>
    private void SettleBoats(double dt)
    {
        foreach (var b in residentHulls.Values)
        {
            if (b.SettleAt is not { } e || !residentHomes.TryGetValue(b.Id, out var home)) { if (b.SettleAt != null) b.SettleAt = null; continue; }
            b.Settle = Math.Min(1, b.Settle + (float)dt / 1.5f);
            float u = Mathf.SmoothStep(0, 1, b.Settle);
            b.Hull.X = Mathf.Lerp(b.SettleFrom.X, home.X, u); b.Hull.Z = Mathf.Lerp(b.SettleFrom.Y, home.Y, u);
            b.Hull.Yaw = b.SettleFrom.Z + Mathf.Wrap(home.Z - b.SettleFrom.Z, -MathF.PI, MathF.PI) * u;
            if (b.Settle >= 1) { b.SettleAt = null; ResidentBoatLandLadder(b.Id, e); }
        }
    }
    /// <summary>For the checks: where each of her walkers is on the way.</summary>
    public object? ResidentWalkersReport(string id) => walkers.TryGetValue(id, out var l) ? l.Select(w => new { w.I, n = w.Way.Count, w.Done, valid = IsInstanceValid(w.Frame), at = IsInstanceValid(w.Frame) ? new[] { w.Frame.GlobalPosition.X, w.Frame.GlobalPosition.Y, w.Frame.GlobalPosition.Z } : null, next = w.I < w.Way.Count ? new[] { w.Way[w.I].X, w.Way[w.I].Y, w.Way[w.I].Z } : null, w.Delay, motion = w.Human.Motion, ladder = w.Ladder != null }).ToArray() : null;

    /// <summary>For the proofs: her walkers stand still where they are (while a picture is taken).</summary>
    public bool HoldWalkers { get; set; }

    private void StepWalkers(double dt)
    {
        if (walkers.Count == 0 || HoldWalkers) return;
        foreach (var (id, list) in walkers.ToArray())
        {
            bool all = true;
            foreach (var w in list)
            {
                if (w.Done || !IsInstanceValid(w.Frame)) continue;
                all = false;
                if ((w.Delay -= (float)dt) > 0) { w.Human.Update((float)dt); continue; }
                var at = w.Frame.GlobalPosition;
                // boarding: the last point is her seat in the boat, which moves with the water
                if (w.Seat is { } seat && w.I == w.Way.Count - 1 && residentHulls.TryGetValue(id, out var bh)) w.Way[^1] = bh.Hull.Root.GlobalTransform * seat.Origin;
                var to = w.Way[w.I];
                var d = to - at;
                // (#195) a leg between two points on a ladder's rungs is climbed
                bool climb = w.Ladder != null && w.I > 0 && w.Rungs.Contains(w.I) && w.Rungs.Contains(w.I - 1);
                float step = (climb ? ClimbPace : WalkPace) * (float)dt, len = d.Length();
                if (len <= step)
                {
                    w.Frame.GlobalPosition = to; w.I++;
                    if (w.I >= w.Way.Count)
                    {
                        w.Done = true;
                        if (w.Seat is { } s && residentHulls.TryGetValue(id, out var b)) { w.Frame.GetParent()?.RemoveChild(w.Frame); b.Hull.Root.AddChild(w.Frame); w.Frame.Transform = s; w.Human.Play(w.Motion, 0.2f); }
                        else w.Human.Play("idle", 0.2f);
                    }
                }
                else if (climb)
                {
                    var p = at + d / len * step;
                    w.Frame.GlobalPosition = p;
                    // facing the rungs (turned to them over a few tenths of a second at the head and the foot)
                    float yaw = w.Frame.GlobalRotation.Y, turn = Mathf.Wrap(w.Face - yaw, -MathF.PI, MathF.PI);
                    w.Frame.GlobalRotation = new Vector3(0, yaw + Math.Clamp(turn, -6 * (float)dt, 6 * (float)dt), 0);
                    if (!w.Human.ClimbLadder(p.Y - w.Ladder!.Foot) && w.Human.Motion != "idle") w.Human.Play("idle", 0.15f);
                }
                else
                {
                    w.Frame.GlobalPosition = at + d / len * step;
                    if (new Vector2(d.X, d.Z).LengthSquared() > 1e-4f) w.Frame.GlobalRotation = new Vector3(0, MathF.Atan2(d.X, d.Z), 0);
                    if (w.Human.Motion != "walk") { w.Human.Play("walk", 0.15f); w.Human.SetPace(WalkPace); }
                }
                w.Human.Update((float)dt);
            }
            if (all) walkers.Remove(id);
        }
    }
}
