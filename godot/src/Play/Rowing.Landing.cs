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
    }
    private readonly Dictionary<string, List<Walker>> walkers = new();
    private const float WalkPace = 1.1f;

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

    /// <summary>Have her people finished walking (out or in)? (True when nobody walks for her.)</summary>
    public bool ResidentWalkersDone(string id) => !walkers.TryGetValue(id, out var l) || l.All(w => w.Done);
    /// <summary>For the checks: where each of her walkers is on the way.</summary>
    public object? ResidentWalkersReport(string id) => walkers.TryGetValue(id, out var l) ? l.Select(w => new { w.I, n = w.Way.Count, w.Done, valid = IsInstanceValid(w.Frame), at = IsInstanceValid(w.Frame) ? new[] { w.Frame.GlobalPosition.X, w.Frame.GlobalPosition.Y, w.Frame.GlobalPosition.Z } : null, next = w.I < w.Way.Count ? new[] { w.Way[w.I].X, w.Way[w.I].Y, w.Way[w.I].Z } : null, w.Delay }).ToArray() : null;

    private void StepWalkers(double dt)
    {
        if (walkers.Count == 0) return;
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
                float step = WalkPace * (float)dt, len = d.Length();
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
