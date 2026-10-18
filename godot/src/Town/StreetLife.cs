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
    private readonly record struct DoorRoutine(int Day, double From, double To, string Act, string Where, string Key);
    private readonly Dictionary<string, DoorRoutine[]> doorLife = new();
    private static readonly string[] GirlsGames = { "rope", "hopscotch", "tag", "rope", "hopscotch", "hoops" };
    private static readonly string[] BoysGames = { "tag", "hoops", "tops", "marbles", "hoops", "tag" };
    private readonly Dictionary<string, Browse> browsing = new();
    private readonly Dictionary<string, (Puppet puppet, string key, Node3D prop)> lifeProps = new();
    private readonly Dictionary<string,string> forcedGames=new();
    internal void ForceGame(string place,string? kind){if(kind==null)forcedGames.Remove(place);else forcedGames[place]=kind;foreach(var s in sims)if(s.Goal.Place==place)s.GameDay=-1;}
    private sealed class Browse
    {
        public string Phase = "pick";
        public double Time;
        public TownStall? Target;
    }
    public int DoorPlans => doorLife.Count;
    public int Browsing => browsing.Count;
    /// <summary>The street-life scenery supplies its actual Madonna and reachable prayer spot.</summary>
    public Func<double, double, (double x, double z, double sx, double sz)?>? MadonnaAt;

    private void ReadDoorLife(JsonElement plan)
    {
        foreach (var p in plan.GetProperty("door").EnumerateObject())
        {
            var entries = new DoorRoutine[p.Value.GetArrayLength()]; int n = 0;
            foreach (var seg in p.Value.EnumerateArray()) { string act = seg[3].GetString()!; entries[n++] = new DoorRoutine(seg[0].GetInt32(), seg[1].GetDouble(), seg[2].GetDouble(), act, seg[4].GetString()!, "|door:" + act); }
            doorLife[p.Name] = entries;
        }
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
        if(forcedGames.TryGetValue(s.Goal.Place??"",out var forced))return s.GameKind=forced;
        int slice = (int)Math.Floor(hour / 2);
        if (s.GameDay == day && s.GameSlice == slice && s.GamePlace == (s.Goal.Place ?? "")) return s.GameKind;
        s.GameDay = day; s.GameSlice = slice; s.GamePlace = s.Goal.Place ?? "";
        string key = $"{s.Goal.Place}:{day}:{slice}";
        var games = s.R.Sex == "f" ? GirlsGames : BoysGames;
        return s.GameKind = games[(int)(LifeHash(key + (s.R.Sex == "f" ? ":g" : "")) * games.Length)];
    }

    private string? DoorLifeOf(Sim s, Now now)
    {
        if (MorningSweep(s, now)) return "sweep";
        if (!doorLife.TryGetValue(s.R.Id, out var plan)) return null;
        foreach (var seg in plan)
        {
            if (seg.Day != (day - 1) % 7 + 1 || hour < seg.From || hour >= seg.To) continue;
            string act = seg.Act, where = seg.Where;
            if (where == "home" ? now.Act != "home" : now.Act != "work") continue;
            if (Raining() && act is "scrub" or "lace" or "knit") return null;
            // Window figures are handled in StreetWindows; their ordinary resident remains indoors.
            return act == "window" ? null : act;
        }
        return null;
    }

    private string LifeKey(Sim s, Now now)
    {
        var act = DoorLifeOf(s, now);
        if (act == "sweep") return "|door:sweep";
        if (act != null && doorLife.TryGetValue(s.R.Id, out var plan)) foreach (var seg in plan) if (seg.Act == act) return seg.Key;
        if (CaskRunNow(s, now) != null) return "|cask";
        if (StreetSweeper(s, now) != null) return "|streetsweep";
        return "";
    }

    // ---- #132: the work the new people's motions were made for (client-side, from the id and the clock: every PC
    // decides the same; no resident, door plan or route of the server's is changed)

    /// <summary>A man sweeps before his door at home or his shop's door, for a quarter hour or so of a weekday morning
    /// now and then (a shopkeeper most mornings).</summary>
    private bool MorningSweep(Sim s, Now now)
    {
        var r = s.R;
        if (r.Sex != "m" || r.Age < 16 || day % 7 == 0 || hour < 6.75 || hour >= 9.75 || Raining()) return false;
        bool shop = now.Act == "work" && r.Work.Kind == "shop" && r.Work.Door != null;
        if (!shop && now.Act != "home") return false;
        string tag = shop ? "shop" : "home";
        if (LifeHash($"{r.Id}:{day}:sweep{tag}") >= (shop ? 0.6 : 0.18)) return false;
        double start = (shop ? 7.0 : 7.25) + LifeHash($"{r.Id}:{day}:sweepat") * (shop ? 1.0 : 2.0);
        return hour >= start && hour < start + 0.3 + 0.15 * LifeHash($"{r.Id}:{day}:sweepfor");
    }

    /// <summary>Peyrot's cellarmen and the brewer roll casks between the quay and the cellar or the brewery for a
    /// quarter of an hour in every half (each at his own time); null: not now.</summary>
    private HaulRoute? CaskRunNow(Sim s, Now now)
    {
        if (now.Act != "work" || day % 7 == 0 || HaulRoute.CaskRunOf(s.R.Trade) is not { } run) return null;
        double minute = hour * 60 + 30 * LifeHash(s.R.Id + ":cask");
        return minute % 30 < 15 ? run : null;
    }

    private static readonly string[] SweptSquares = { "grote_markt", "steenplein", "handschoenmarkt" };
    /// <summary>A few of the town's loafers earn a little as street sweepers: on weekday mornings each sweeps his
    /// square, a round of stops; null: not now.</summary>
    private string? StreetSweeper(Sim s, Now now)
    {
        var r = s.R;
        if (r.Trade != "loafer" || LifeHash(r.Id + ":sweeper") >= 0.1 || day % 7 == 0 || hour < 6.5 || hour >= 10 || Raining()) return null;
        return SweptSquares[(int)(LifeHash(r.Id + ":square") * SweptSquares.Length) % SweptSquares.Length];
    }

    /// <summary>The stops of a street sweeper's round on his square: free ground on a ring round its middle.</summary>
    private Pt[]? SweepRound(Sim s, string square)
    {
        if (Place(square) is not { } sq) return null;
        var stops = new List<Pt>();
        double turn = LifeHash(s.R.Id + ":turn") * Math.PI * 2, ring = Math.Max(4, sq.R * 0.55);
        for (int i = 0; i < 6; i++)
        {
            double a = turn + i * Math.PI / 3;
            if (LifeFree(sq.X + Math.Cos(a) * ring, sq.Z + Math.Sin(a) * ring) is { } q) stops.Add(new Pt(q.x, q.z));
        }
        return stops.Count >= 2 ? stops.ToArray() : null;
    }
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
    /// <summary>How far out from her door a woman kneels to scrub its step (#169): where the step's raised stone ends
    /// (found under the actual geometry along her way out), plus the reach of the scrubbing strokes, so the brush
    /// works on the step's top while her knees are on the pavement; 0.75 m where no step rises.</summary>
    private readonly Dictionary<string, (double x, double z)?> kneelSpots = new();
    /// <summary>A scrubber who has come to her step kneels where her strokes reach its top (#169): the last few
    /// centimetres the walk map's half-metre cells did not let her walk, when there is room for her there.</summary>
    private void KneelAtStep(Sim s, Puppet p)
    {
        string key = s.R.Id + s.Key;
        if (!kneelSpots.TryGetValue(key, out var spot))
        {
            spot = null;
            var r = s.R;
            bool home = s.Key.Contains("home", StringComparison.Ordinal) || DoorLifeOfHome(s);
            if (home)
            {
                double ox = r.HomeSx - r.HomeX, oz = r.HomeSz - r.HomeZ, len = Math.Max(0.1, Whereabouts.Hypot(ox, oz));
                ox /= len; oz /= len;
                double reach = ScrubReach(r.HomeX, r.HomeZ, ox, oz);
                double x = r.HomeX + ox * reach, z = r.HomeZ + oz * reach;
                if (KneelClear(x, z)) spot = (x, z);
            }
            if (kneelSpots.Count > 256) kneelSpots.Clear();
            kneelSpots[key] = spot;
        }
        if (spot is { } at && Dist(p.X, p.Z, at.x, at.z) is > 0.02 and < 0.6) { p.X = at.x; p.Z = at.z; }
    }
    private bool DoorLifeOfHome(Sim s) => s.Goal.Yaw is { } yaw && Whereabouts.Hypot(s.Goal.X - s.R.HomeX, s.Goal.Z - s.R.HomeZ) < 1.6;

    private static readonly CapsuleShape3D KneelBody = new() { Radius = 0.2f, Height = 0.7f };
    private readonly PhysicsShapeQueryParameters3D kneelQuery = new() { CollisionMask = World.Solid.Layer, Margin = 0 };
    /// <summary>Room for a kneeling body here: nothing solid from just over a step's height to her shoulders.</summary>
    private bool KneelClear(double x, double z)
    {
        var space = Main.I.View.FindWorld3D()?.DirectSpaceState;
        if (space == null || Walk == null) return false;
        kneelQuery.Shape = KneelBody;
        kneelQuery.Transform = new Transform3D(Basis.Identity, new Vector3((float)x, (float)Walk.BaseAt(x, z) + 0.25f + 0.35f, (float)z));
        return space.IntersectShape(kneelQuery, 1).Count == 0;
    }

    /// <summary>For a check: where a resident kneels to scrub his own step (metres out from the door).</summary>
    internal double ScrubReachAtHome(Sim s) { double ox = s.R.HomeSx - s.R.HomeX, oz = s.R.HomeSz - s.R.HomeZ, len = Math.Max(0.1, Whereabouts.Hypot(ox, oz)); return ScrubReach(s.R.HomeX, s.R.HomeZ, ox / len, oz / len); }
    private double ScrubReach(double dx, double dz, double ox, double oz)
    {
        var space = Main.I.View.FindWorld3D()?.DirectSpaceState;
        if (space == null || Walk == null) return 0.75;
        double base0 = Walk.BaseAt(dx + ox * 1.6, dz + oz * 1.6);
        float Height(double d)
        {
            double x = dx + ox * d, z = dz + oz * d;
            var hit = space.IntersectRay(PhysicsRayQueryParameters3D.Create(new Vector3((float)x, (float)base0 + 0.9f, (float)z), new Vector3((float)x, (float)base0 - 0.6f, (float)z), World.Solid.Layer));
            return hit.Count > 0 ? ((Vector3)hit["position"]).Y : float.NaN;
        }
        float far = Height(1.6);
        if (!float.IsFinite(far)) return 0.75;
        double edge = -1;
        for (double d = 0.05; d <= 1.2; d += 0.05)
        {
            float h = Height(d);
            if (float.IsFinite(h) && h > far + 0.05f && h < far + 0.4f) edge = d;
        }
        // (scrub's brush strokes reach 0.37-0.55 m before her: peopleRig.json work.clips.scrub, the brush track)
        return edge < 0 ? 0.75 : edge + 0.025 + 0.33;
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
            if (act == "flowers")
            {
                if (MadonnaAt?.Invoke(r.HomeSx, r.HomeSz) is not { } m) return null;
                return new Goal { Mode = "stand", X = m.sx, Z = m.sz, Yaw = Math.Atan2(m.x - m.sx, m.z - m.sz), Motion = "cross" };
            }
            bool work = now.Act == "work" && r.Work.Door != null;
            double dx = work ? r.Work.Door!.Value.X : r.HomeX, dz = work ? r.Work.Door!.Value.Z : r.HomeZ;
            double ox = work ? 0 : r.HomeSx - r.HomeX, oz = work ? 0 : r.HomeSz - r.HomeZ;
            if (work)
            {
                double best = -1;
                for (int i = 0; i < 8; i++)
                {
                    double a = i * Math.PI / 4, distance = 0;
                    for (double d = 0.5; d <= 6 && Walk!.Free(dx + Math.Sin(a) * d, dz + Math.Cos(a) * d); d += 0.5) distance = d;
                    if (distance > best) { best = distance; ox = Math.Sin(a); oz = Math.Cos(a); }
                }
            }
            double len = Math.Max(0.1, Whereabouts.Hypot(ox, oz));
            ox /= len; oz /= len;
            double reach = act == "scrub" ? ScrubReach(dx, dz, ox, oz) : 0.95;
            double x = dx + ox * reach, z = dz + oz * reach;
            if (act is "lace" or "knit") { x -= oz * 1.25; z += ox * 1.25; }
            var q = LifeFree(x, z);
            if (q == null) return null;
            // a scrubber kneels exactly at her step's reach when the spot is clear of walls and posts (the walk map's
            // half-metre cells can push her back out of the stroke's reach, #169)
            if (act == "scrub" && Whereabouts.Hypot(q.Value.x - x, q.Value.z - z) > 0.05 && KneelClear(x, z)) q = (x, z);
            return new Goal { Mode = "stand", X = q.Value.x, Z = q.Value.z, Yaw = Math.Atan2(act == "scrub" ? -ox : ox, act == "scrub" ? -oz : oz), Motion = act == "knit" ? "lace" : act == "flowers" ? "cross" : act == "sweep" ? "scrub" : act };
        }
        // the works' winch navvy cranks its crab winch, at its crank (#128)
        if (now.Act == "work" && r.Work.Place == "wall:works" && r.Work.Motion == "pull" && WallWorks.I?.Crank is { } crank)
            return new Goal { Mode = "stand", X = crank.X, Z = crank.Z, Yaw = crank.Yaw, Motion = "pull", Place = "wall:works" };
        if (CaskRunNow(s, now) is { } cask) return new Goal { Mode = "haul", X = cask.A.X, Z = cask.A.Z, A = cask.A, B = cask.B, Place = cask.Place };
        if (StreetSweeper(s, now) is { } square && SweepRound(s, square) is { } stops)
            return new Goal { Mode = "patrol", X = stops[0].X, Z = stops[0].Z, Route = stops, Place = square, Motion = "scrub" };
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

    internal bool GamePropDrawn(Sim s) => lifeProps.TryGetValue(s.R.Id, out var prop) && prop.puppet == s.P && prop.key == s.PropKey && GodotObject.IsInstanceValid(prop.prop);
    private static readonly ModelLibrary.Look LifeLook = new(TwoSided: true, Affine: 0, VertexColor: true);
    private void LifeProp(Sim s, string key, string model, string name, Vector3 offset)
    {
        if (lifeProps.TryGetValue(s.R.Id, out var old))
        {
            if (old.puppet == s.P && old.key == key) return;
            if (GodotObject.IsInstanceValid(old.prop)) old.prop.QueueFree();
            lifeProps.Remove(s.R.Id);
        }
        var prop = MakeLifeKit(s, name) ?? ModelLibrary.Get(model, LifeLook)?.Copy(name);
        if (prop == null) return;
        prop.Position = offset;
        s.P!.Group.AddChild(prop);
        lifeProps[s.R.Id] = (s.P, key, prop);
    }

    private bool LifeStep(Sim s, double dt)
    {
        var p = s.P!;
        var g = s.Goal;
        string gameKey = g.Mode == "play" ? GameOf(s) : "";
        if (s.PropBase != s.Key || s.PropGame != gameKey) { s.PropBase = s.Key; s.PropGame = gameKey; s.PropKey = s.Key + gameKey; }
        if (lifeProps.TryGetValue(s.R.Id, out var old) && (old.puppet != p || old.key != s.PropKey))
        {
            if (GodotObject.IsInstanceValid(old.prop)) old.prop.QueueFree();
            lifeProps.Remove(s.R.Id);
        }
        if (g.Mode != "market") { browsing.Remove(s.R.Id);MarketForget?.Invoke(p); }
        if (g.Mode == "market" && (MarketBrowse!=null?MarketBrowse(p,g.Place??"",dt):BrowseStep(s, dt))) return true;
        AnimateLifeKit(s, dt);
        if (g.Mode == "play" && s.R.Age < 16 && p.Human.Scale < 0.9)
        {
            string game = ActualGame(s);
            if (game == "tag") return false;
            if(game=="rope") {LifeProp(s,s.PropKey,"lively",game,Vector3.Zero);return RopeStep(s,dt);}
            if(game is "hopscotch" or "tops" or "marbles") {LifeProp(s,s.PropKey,"lively",game,Vector3.Zero);return ChalkStep(s,game,dt);}
            if (Crowd!.PuppetBusy(p)) return true;
            if (game != "tag") LifeProp(s, s.PropKey, "lively", game, Vector3.Zero);
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
            // people2 (package D3) scrubbers kneel with the bucket by their left hand and the brush in their own
            // hand; sweepers have the broom; washers stoop over the bucket before them; smokers hold their pipe
            string? work = p.Human.IsPeople2 ? p.Human.WorkChoice(g.Motion ?? "") : null;
            if (g.Motion == "scrub" && work == "scrub") KneelAtStep(s, p);
            bool sweeping = work is "sweep" or "man_sweep";
            if (g.Motion == "scrub" && !sweeping) LifeProp(s, s.Key, "lively", work == "scrub" ? "bucket_only" : "bucket", work == "scrub" ? new Vector3(0.30f, 0, 0.30f) : new Vector3(0.5f, 0, 0));
            if (g.Motion == "lace") LifeProp(s, s.Key, "lively", "chair", Vector3.Zero);
            if (g.Motion == "smoke" && work != "smoke") LifeProp(s, s.Key, "lively", "pipe", Vector3.Zero);
            if (g.Motion == "wash") LifeProp(s, s.Key, "lively", work == "wash" ? "wash_people2" : "wash", Vector3.Zero);
            if (g.Motion == "cross") LifeProp(s, s.Key, "lively", "flowers", Vector3.Zero);
            if (g.Place?.StartsWith("cards:") == true) LifeProp(s, s.Key, "lively", "cards", Vector3.Zero);
            if (s.R.Trade == "beggar") { Crowd.PuppetStand(p, "beg", g.Yaw); return true; }
        }
        return false;
    }

    private readonly List<TownStall> browseTargets = new(32);
    private readonly Dictionary<string, string> marketPlaces = new();
    private bool BrowseStep(Sim s, double dt)
    {
        string id = s.Goal.Place ?? "";
        if (!marketPlaces.TryGetValue(id, out string? place)) marketPlaces[id] = place = id.Replace("market:", "");
        var targets = browseTargets;
        targets.Clear();
        foreach (var stall in Data!.Stalls)
            if (stall.Place == place && stall.Keeper != null && byId.TryGetValue(stall.Keeper, out var keeper) && PlanNow(keeper).Act == "work") targets.Add(stall);
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
            if (rng.NextDouble() < 0.6) Crowd!.PuppetCarry(p, b.Target!.Goods switch { "fish" => "fish", "veg" => "sack", "baskets" => "basket", _ => "parcel" });
            Crowd!.PuppetStand(p, "idle");
            b.Phase = "pick"; b.Time = Rnd(0.8, 2);
        }
        return true;
    }
}
