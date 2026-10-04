using System;
using System.Collections.Generic;
using System.Linq;
using System.IO;
using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Godot;
using Scheldemist.Town;
using Scheldemist.Player;
using Scheldemist.World;

namespace Scheldemist.Dev;

/// <summary>Browser thresholds: 3 s within 0.3 m; 8 s, over 3 m travelled but under 0.8 m net.</summary>
public sealed class StuckWatch
{
    private sealed record Sample(double At, double X, double Z, bool Move, string Goal);
    private readonly Dictionary<string, List<Sample>> tracks = new();
    private readonly HashSet<string> walking = new();
    private readonly Dictionary<string, object> bad = new();
    private readonly HashSet<string> overlaps = new();
    private readonly HashSet<string> solids = new();
    private readonly Dictionary<string, object> solidEvidence = new();
    private readonly List<object> solidReplay = new();
    private readonly PhysicsShapeQueryParameters3D bodyProbe = new()
    {
        Shape = new CapsuleShape3D { Radius = 0.25f, Height = Jef.Tall - Jef.Step },
        CollisionMask = Solid.Layer,
        Margin = 0,
        CollideWithBodies = true,
        CollideWithAreas = false,
    };
    /// <summary>Replay a supplied old report at grounded body height, before this run moves anyone.
    /// Passing vehicles may have moved; the result identifies today's actual collider, never suppresses a finding.</summary>
    public void ReplaySolids(Townspeople town, string file)
    {
        if (!File.Exists(file)) return;
        using var doc = JsonDocument.Parse(File.ReadAllText(file));
        foreach (var entry in doc.RootElement.GetProperty("insideSolids").EnumerateArray())
        {
            string original = entry.GetString()!;
            var english = Regex.Match(original, @" at (-?\d+\.\d{2}),(-?\d+\.\d{2}) ");
            var point = Regex.Match(original, @" at (-?\d+),(\d{2}),(-?\d+),(\d{2}) ");
            if (!point.Success && !english.Success) throw new InvalidDataException("old solid case has unrecognised coordinates: " + original);
            double x = double.Parse(english.Success ? english.Groups[1].Value : point.Groups[1].Value + "." + point.Groups[2].Value, CultureInfo.InvariantCulture);
            double z = double.Parse(english.Success ? english.Groups[2].Value : point.Groups[3].Value + "." + point.Groups[4].Value, CultureInfo.InvariantCulture);
            bodyProbe.Transform = new Transform3D(Basis.Identity, new Vector3((float)x, (float)town.Walk!.BaseAt(x, z) + Jef.Step + (Jef.Tall - Jef.Step) / 2, (float)z));
            var hits = Main.I.View.FindWorld3D().DirectSpaceState.IntersectShape(bodyProbe, 1);
            string hit = hits.Count == 0 ? "" : hits[0]["collider"].AsGodotObject() is Node n ? n.GetPath().ToString() : Solid.I.BodyName(hits[0]["rid"].AsRid());
            bool free = town.Walk!.Free(x, z);
            solidReplay.Add(new { original, x, z, free, hit, groundedContact = hits.Count > 0 });
        }
    }
    public void SampleTown(Townspeople town, double seconds, string place)
    {
        foreach (var s in town.Sims)
        {
            string id = s.R.Id, goal = $"{s.Goal.Mode}:{s.Goal.X:0.0},{s.Goal.Z:0.0}";
            var p = s.P;
            if (p?.Dest is { } destination) goal += $"; walk to {destination.x:0.0},{destination.z:0.0}";
            double x = p?.X ?? s.X, z = p?.Z ?? s.Z;
            // Hidden schedule walkers are covered too, but only while outside and off their current goal.
            var planned = p == null ? town.WhereNow(s) : null;
            var anchor = town.Anchor(s);
            bool hiddenMove = planned != null ? planned.Moving : s.Hw != null && (s.Hw.Pts != null || s.Hw.Straight) && Whereabouts.Hypot(x - anchor.X, z - anchor.Z) > 0.5;
            bool move = !s.Inside && (p != null ? p.Human.Motion is "walk" or "carry" or "push" or "ride" || p.State == "blocked" && p.Held > 3 : hiddenMove);
            if (move) walking.Add(id);
            if (!tracks.TryGetValue(id, out var tr)) tracks[id] = tr = new();
            tr.Add(new(seconds, x, z, move, goal));
            tr.RemoveAll(a => a.At < seconds - 8.5);
            string? how = null;
            var recent = tr.Where(a => a.At >= seconds - 3.25).ToArray();
            if (recent.Length > 1 && seconds - recent[0].At >= 3 && recent.All(a => a.Move && a.Goal == goal) && recent.All(a => Whereabouts.Hypot(a.X - recent[0].X, a.Z - recent[0].Z) < 0.3)) how = "in place";
            // Hidden residents follow scheduled rounds which can legitimately repeat within eight seconds.
            if (p != null && tr.Count > 1 && seconds - tr[0].At >= 8 && tr.All(a => a.Move && a.Goal == goal))
            {
                double travel = 0;
                for (int i = 1; i < tr.Count; i++) travel += Whereabouts.Hypot(tr[i].X - tr[i - 1].X, tr[i].Z - tr[i - 1].Z);
                if (travel > 3 && Whereabouts.Hypot(x - tr[0].X, z - tr[0].Z) < 0.8) how = "to and fro";
            }
            if (how != null) bad.TryAdd(id, new { id, who = s.R.Name, s.R.Trade, how, x, z, place, atSeconds = seconds, goal, shown = p?.Shown ?? false, state = p?.State, dest = p?.Dest is { } d ? new[] { d.x, d.z } : null, replans = p?.Replans, free = town.Walk!.Free(x, z), source = "godot/src/Town/Townspeople.cs; godot/src/Town/Crowd.cs" });
            if (p == null || !p.Shown) continue;
            bodyProbe.Transform = new Transform3D(Basis.Identity, new Vector3((float)x, (float)town.Walk!.BaseAt(x, z) + Jef.Step + (Jef.Tall - Jef.Step) / 2, (float)z));
            var hits = Main.I.View.FindWorld3D().DirectSpaceState.IntersectShape(bodyProbe, 1);
            if (!town.Walk!.Free(x, z) || hits.Count > 0)
            {
                string hit = hits.Count == 0 ? "baked walk map" : hits[0]["collider"].AsGodotObject() is Node collider ? collider.GetPath().ToString() : Solid.I.BodyName(hits[0]["rid"].AsRid());
                solids.Add($"{id} at {x:0.00},{z:0.00} ({place}): {hit}");
                if (hits.Count > 0 && !solidEvidence.ContainsKey(hit))
                {
                    var box = Solid.I.BodyBounds(hits[0]["rid"].AsRid());
                    if (hits[0]["collider"].AsGodotObject() is Node3D n)
                    {
                        bool first = true;
                        foreach (var c in n.GetChildren()) if (c is CollisionShape3D shape && shape.Shape != null)
                        {
                            var b = shape.GlobalTransform * shape.Shape.GetDebugMesh().GetAabb();
                            box = first ? b : box.Merge(b); first = false;
                        }
                    }
                    solidEvidence[hit] = new { hit, x, z, feet = town.Walk!.BaseAt(x, z), state = p.State, motion = p.Human.Motion,
                        bounds = new[] { box.Position.X, box.Position.Y, box.Position.Z, box.End.X, box.End.Y, box.End.Z } };
                }
            }
        }
        var puppets = town.Crowd!.Walking.Where(p => p.Shown).ToArray();
        for (int i = 0; i < puppets.Length; i++) for (int j = i + 1; j < puppets.Length; j++)
            if (Whereabouts.Hypot(puppets[i].X - puppets[j].X, puppets[i].Z - puppets[j].Z) < 0.45)
            {
                string Id(Puppet p) => town.Sims.FirstOrDefault(s => s.P == p)?.R.Id ?? $"puppet {p.Id}";
                overlaps.Add($"{Id(puppets[i])} / {Id(puppets[j])} at {puppets[i].X:0.00},{puppets[i].Z:0.00} ({place})");
            }
    }
    public void ResetWindow() => tracks.Clear();
    public object Report(Townspeople town, double seconds) => new { ok = bad.Count == 0 && overlaps.Count == 0 && solids.Count == 0, watched = town.Sims.Count, walking = walking.Count, seconds, gameHours = seconds / 120, stuck = bad.Values, overlaps = overlaps.Order().ToArray(), insideSolids = solids.Order().ToArray(), solidEvidence = solidEvidence.Values, solidReplay,
        notCovered = new[] { "one three-hour Monday route through five places; other days and overnight plans", "hidden resident oscillation, overlaps and solids (scheduled rounds can repeat; only drawn bodies have physical presence)", "job figures, animals and vehicles outside the town crowd", "waiting for a server route is excluded until the simulation starts its walk" } };
}

