using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.Models;
using Scheldemist.People;

namespace Scheldemist.Town;

// The layers over a resident's day (game/lively.ts, backlife.ts, market.ts and server/town/doorlife.ts).
// The server supplies the door plans; only their display and the browser's stable game choice live here.
public partial class Townspeople
{
    private readonly Dictionary<string, JsonElement> doorLife = new();
    private readonly Dictionary<string, Browse> browsing = new();
    private readonly Dictionary<string, (Puppet puppet, string key, Node3D prop)> lifeProps = new();
    private sealed class Browse
    {
        public string Phase = "pick";
        public double Time;
        public TownStall? Target;
    }
    public int DoorPlans => doorLife.Count;
    public int Browsing => browsing.Count;

    private void ReadDoorLife(JsonElement plan)
    {
        foreach (var p in plan.GetProperty("door").EnumerateObject()) doorLife[p.Name] = p.Value.Clone();
    }

    // doorlife.ts h01 (different from the town's hash).
    private static double LifeHash(string s)
    {
        uint h = 2166136261;
        foreach (char c in s) h = unchecked((h ^ c) * 16777619);
        h ^= h >> 13;
        h = unchecked(h * 0x5bd1e995);
        h ^= h >> 15;
        return h / 4294967296.0;
    }

    public string GameOf(Sim s)
    {
        string key = $"{s.Goal.Place}:{day}:{(int)Math.Floor(hour / 2)}";
        string[] games = s.R.Sex == "f" ? new[] { "rope", "hopscotch", "tag", "rope", "hopscotch", "hoops" } : new[] { "tag", "hoops", "tops", "marbles", "hoops", "tag" };
        return games[(int)(LifeHash(key + (s.R.Sex == "f" ? ":g" : "")) * games.Length)];
    }

    private string? DoorLifeOf(Sim s, Now now)
    {
        if (!doorLife.TryGetValue(s.R.Id, out var plan)) return null;
        foreach (var seg in plan.EnumerateArray())
        {
            if (seg[0].GetInt32() != (day - 1) % 7 + 1 || hour < seg[1].GetDouble() || hour >= seg[2].GetDouble()) continue;
            string act = seg[3].GetString()!, where = seg[4].GetString()!;
            if (where == "home" ? now.Act != "home" : now.Act != "work") continue;
            if (Raining() && act is "scrub" or "lace" or "knit") return null;
            // The upper-floor window needs its own room opening; leave its resident inside until that is ported.
            return act == "window" ? null : act;
        }
        return null;
    }

    private string LifeKey(Sim s, Now now) => DoorLifeOf(s, now) is { } act ? "|door:" + act : "";
    private (double x, double z)? LifeFree(double x, double z)
    {
        // Goals are chosen across the whole town, even when the viewer's local grid is elsewhere.
        for (double r = 0; r <= 1.2; r += 0.2)
            for (int i = 0; i < (r == 0 ? 1 : 8); i++)
            {
                double a = i * Math.PI / 4, qx = x + Math.Sin(a) * r, qz = z + Math.Cos(a) * r;
                if (Walk!.Free(qx, qz)) return (qx, qz);
            }
        return null;
    }
    private static string? BackKind(string id)
    {
        if (id is "park" or "walk") return id;
        string k = id.Split(':')[0];
        return k is "pump" or "corner" or "cards" or "gossip" or "step" or "lanes" or "knot" or "lovers" or "church" ? k : null;
    }

    private Goal? LifeGoal(Sim s, Now now)
    {
        var r = s.R;
        if (DoorLifeOf(s, now) is { } act)
        {
            if (act == "flowers_church" && Place("church") is { } church) return new Goal { Mode = "church", X = church.X, Z = church.Z };
            double ox = r.HomeSx - r.HomeX, oz = r.HomeSz - r.HomeZ;
            double len = Math.Max(0.1, Whereabouts.Hypot(ox, oz));
            ox /= len; oz /= len;
            double x = r.HomeX + ox * 0.95, z = r.HomeZ + oz * 0.95;
            if (act is "lace" or "knit") { x -= oz * 1.25; z += ox * 1.25; }
            var q = LifeFree(x, z);
            if (q == null) return null;
            return new Goal { Mode = "stand", X = q.Value.x, Z = q.Value.z, Yaw = Math.Atan2(act == "scrub" ? -ox : ox, act == "scrub" ? -oz : oz), Motion = act == "knit" ? "lace" : act == "flowers" ? "cross" : act };
        }
        if (now.Act == "work" && r.Work.Kind == "round" && r.Work.Route is { Length: > 0 } route)
            return new Goal { Mode = "patrol", X = route[0].X, Z = route[0].Z, Route = route, Faces = r.Work.Faces, Place = r.Work.Place };
        if (now.Act is "home" or "tavern" or "play") return null;
        string id = now.Act == "work" ? r.Work.Place : now.Place;
        string? kind = BackKind(id);
        var pl = Place(id);
        if (kind == null || pl == null) return null;
        if (kind == "church") return new Goal { Mode = "church", X = pl.X, Z = pl.Z, Place = id };
        if (kind is "park" or "walk" or "lanes")
        {
            var path = pl.Route;
            if (path is not { Length: > 0 }) return null;
            var start = path.OrderBy(p => Dist(p.X, p.Z, r.HomeSx, r.HomeSz)).First();
            return new Goal { Mode = "roam", X = start.X, Z = start.Z, Route = path, Place = id };
        }
        var roster = sims.Where(o => { var a = PlanNow(o); return (a.Act == "work" ? o.R.Work.Place : a.Place) == id; }).ToList();
        int k = Math.Max(0, roster.IndexOf(s)), n = Math.Max(2, Math.Min(6, roster.Count));
        double angle = k * Math.PI * 2 / n + LifeHash(id) * Math.PI * 2;
        double radius = kind == "pump" ? (n <= 4 ? 1.55 : 2) : kind == "cards" ? (k < 4 ? 0.8 : 1.6) : n >= 4 ? 0.85 : 0.62;
        double tx = pl.X + Math.Sin(angle) * radius, tz = pl.Z + Math.Cos(angle) * radius;
        var at = LifeFree(tx, tz);
        if (at == null) return null;
        return new Goal { Mode = "stand", X = at.Value.x, Z = at.Value.z, Yaw = Math.Atan2(pl.X - at.Value.x, pl.Z - at.Value.z), Place = id,
            Motion = kind == "pump" ? "wash" : kind == "step" ? "smoke" : kind == "corner" ? "pockets" : kind == "cards" ? "crouch" : "talk" };
    }

    private void LifeProp(Sim s, string key, string model, string name, Vector3 offset)
    {
        if (lifeProps.TryGetValue(s.R.Id, out var old))
        {
            if (old.puppet == s.P && old.key == key) return;
            if (GodotObject.IsInstanceValid(old.prop)) old.prop.QueueFree();
            lifeProps.Remove(s.R.Id);
        }
        var prop = ModelLibrary.Get(model, new ModelLibrary.Look(TwoSided: true, Affine: 0, VertexColor: true))?.Copy(name);
        if (prop == null) return;
        prop.Position = offset;
        s.P!.Group.AddChild(prop);
        lifeProps[s.R.Id] = (s.P, key, prop);
    }

    private bool LifeStep(Sim s, double dt)
    {
        var p = s.P!;
        var g = s.Goal;
        if (lifeProps.TryGetValue(s.R.Id, out var old) && (old.puppet != p || old.key != s.Key + (g.Mode == "play" ? GameOf(s) : "")))
        {
            if (GodotObject.IsInstanceValid(old.prop)) old.prop.QueueFree();
            lifeProps.Remove(s.R.Id);
        }
        if (g.Mode != "market") browsing.Remove(s.R.Id);
        if (g.Mode == "market" && BrowseStep(s, dt)) return true;
        if (g.Mode == "play" && s.R.Age < 16 && p.Human.Scale < 0.9)
        {
            string game = GameOf(s);
            if (game == "tag") return false;
            if (Crowd!.PuppetBusy(p)) return true;
            if (game is "hoops" or "tops") LifeProp(s, s.Key + game, "lively", game == "hoops" ? "hoop" : "top", new Vector3(0, 0, 0.5f));
            if ((s.Wait -= dt) <= 0)
            {
                Crowd.PuppetStand(p, game == "rope" ? "rope" : game == "hopscotch" ? "hop" : game == "marbles" ? "crouch" : "idle", g.Yaw);
                if (game == "hoops") Crowd.PuppetGo(p, g.X + Rnd(-3, 3), g.Z + Rnd(-3, 3), 1.4);
                s.Wait = Rnd(2, 5);
            }
            return true;
        }
        if (g.Mode == "stand" && !Crowd!.PuppetBusy(p) && Dist(p.X, p.Z, g.X, g.Z) < 1.4)
        {
            if (g.Motion == "scrub") LifeProp(s, s.Key, "lively", "bucket", new Vector3(0.5f, 0, 0));
            if (g.Motion == "lace") LifeProp(s, s.Key, "lively", "chair", Vector3.Zero);
            if (s.R.Trade == "beggar") { Crowd.PuppetStand(p, "beg", g.Yaw); return true; }
        }
        return false;
    }

    private bool BrowseStep(Sim s, double dt)
    {
        string place = (s.Goal.Place ?? "").Replace("market:", "");
        var targets = Data!.Stalls.Where(t => t.Place == place && t.Keeper != null && byId.TryGetValue(t.Keeper, out var keeper) && PlanNow(keeper).Act == "work").ToList();
        if (targets.Count == 0) return false;
        if (!browsing.TryGetValue(s.R.Id, out var b)) browsing[s.R.Id] = b = new Browse();
        b.Time -= dt;
        var p = s.P!;
        if (b.Phase == "pick" && b.Time <= 0)
        {
            b.Target = targets[rng.Next(targets.Count)];
            var st = b.Target;
            var q = Crowd!.OpenNearFree(st.X + st.Face.X * 1.45, st.Z + st.Face.Z * 1.45);
            if (q == null) { b.Time = 1; return true; }
            Crowd.PuppetGo(p, q.Value.x, q.Value.z, Rnd(0.8, 1.05));
            b.Phase = "go"; b.Time = 30;
        }
        else if (b.Phase == "go" && (!Crowd!.PuppetBusy(p) || b.Time <= 0))
        {
            if (Dist(p.X, p.Z, b.Target!.X, b.Target.Z) > 3.5) { b.Phase = "pick"; b.Time = 1; return true; }
            Crowd.PuppetStand(p, "idle", Math.Atan2(-b.Target.Face.X, -b.Target.Face.Z));
            b.Phase = "look"; b.Time = Rnd(1.5, 3.5);
        }
        else if (b.Phase == "look" && b.Time <= 0)
        {
            Crowd!.PuppetStand(p, "talk", Math.Atan2(-b.Target!.Face.X, -b.Target.Face.Z));
            if (byId.GetValueOrDefault(b.Target.Keeper ?? "")?.P is { } seller) Crowd.PuppetStand(seller, "talk", Math.Atan2(p.X - seller.X, p.Z - seller.Z));
            b.Phase = "haggle"; b.Time = Rnd(2.5, 4.5);
        }
        else if (b.Phase == "haggle" && b.Time <= 0)
        {
            if (rng.NextDouble() < 0.6) Crowd!.PuppetLoad(p, true, b.Target!.Goods == "fish" ? "fishbox" : "sack");
            Crowd!.PuppetStand(p, "idle");
            b.Phase = "pick"; b.Time = Rnd(0.8, 2);
        }
        return true;
    }
}
