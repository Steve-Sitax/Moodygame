using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.Models;

namespace Scheldemist.World.Ruien;

/// <summary>
/// The ways down into the Ruien from the street (docs/ruien-native.md, "Entrances"): a door in a wall that is already
/// there, a lined bluestone flight down to the level of its Ruien line, and a small landing that ends at a locked iron
/// grille or a bricked-up arch where the network joins later. Each entrance is one entry of entrances.json and this kit
/// builds all of it from that entry, so a stair can be moved, turned or deepened by editing the data.
///
/// Frames. `Local`: origin the middle of the doorway on the wall's face at street level, X to the right as seen from the
/// street, Y up, Z out to the street (the entrance lies at Z &lt; 0). `Run`: the tunnel's own frame, u along it from its
/// closed start (u 0, y 0 the top landing), v across it (v = u x up, so the frame is a rotation, never a mirror).
/// Layout "L": the door in the tunnel's side wall, the tunnel along the wall behind it (a rampart bank); "I": the door in
/// its end wall, the tunnel straight in (a gate house). A tunnel is top landing, one straight flight, bottom landing.
/// </summary>
public static partial class RuienEntrance
{
    public const string File = "res://world/ruien/entrances.json";

    public sealed class Opening
    {
        /// <summary>Along the wall (a), half its width, its floor (sill), springing and arch rise (0: a flat head), ring depth.</summary>
        public float C, H, Floor, Spring, Rise, Ring = .22f;
        public float Top => Spring + Rise;
    }

    public sealed class Spec
    {
        public string Id = "", Name = "", Host = "rampart", Line = "", Layout = "L", Flight = "right", Closure = "grille", ClosureSide = "street", Head = "arch", Frame = "bluestone";
        public string ConnectArea = "";
        public float ConnectLength;
        public bool LowerSill;
        public WalkUnderpass? Underpass;
        public int Survey;
        public Vector2 Door, Out;
        public float Street, Depth = -3.6f, Wall = .9f, Width = 1.3f, DoorWidth = 1.2f, DoorHeight = 2.0f, Post = .08f, KeepAbove;
        public float Riser = .18f, PitchDeg = 35, TopLanding = 1.5f, BottomLanding = 1.5f, Lining = .28f, Spring = 2.45f, VaultRise = .32f;
        public string[] Cut = Array.Empty<string>(), Clear = Array.Empty<string>(), Foliage = Array.Empty<string>(), FoliageMaterials = Array.Empty<string>();
        /// <summary>How far out from the face the walk starts (a gateway's passage is narrow), how far the leaf opens; the way there from the street (world x, z).</summary>
        public float Approach = 1.6f, OpenDeg = 86;
        public Vector2[] From = Array.Empty<Vector2>();
        /// <summary>
        /// A door in a building (a gateway's passage, a house): above the street the stair stays inside the building, and
        /// where it runs on under the street or a yard its masonry, its cut and its cover follow the flight down, so
        /// nothing of it shows or darkens the street above (the rampart's bank and a gate house hide all of it).
        /// </summary>
        public bool Buried => Host is "passage" or "house";
        /// <summary>The leaf hangs on the post away from the flight, so open it lies along the landing's closed end (layout L, flight left: the right post).</summary>
        public bool HingeRight => Layout == "L" && Flight == "left";
        /// <summary>How far the reveal's brick reaches beside and over the opening behind the face (a house's windows stay clear).</summary>
        public float RevealMargin => Buried ? .13f : .45f;
        public float Top => Spring + VaultRise + .26f;
        /// <summary>The top of the tunnel's masonry at u along the run (level over the landings, falling with the flight).</summary>
        public float Ceiling(float u) => Top - Drop * Math.Clamp((u - TopLanding) / FlightLength, 0, 1);
        public float Drop => Street - Depth;
        public int Steps => (int)MathF.Ceiling(Drop / Riser - 1e-4f);
        public float Rise => Drop / Steps;
        public float Going => Rise / MathF.Tan(Mathf.DegToRad(PitchDeg));
        public float FlightLength => Going * Steps;
        public float RunLength => TopLanding + FlightLength + BottomLanding;
        public string DoorId => "entrance_" + Id;
        public string LightId => "entrance_" + Id + "_door";
        public bool Gate => Host == "gate_house";
        /// <summary>A free-standing stair-house (RuienStairHouse) over the stair's top, on a square, green or quay.</summary>
        public bool House => Host == "stair_house";
        /// <summary>A stair-house: along the run (u) where its back wall stands, the flight's vault being under the paving from there.</summary>
        public float HouseBack;
        /// <summary>Local (see the class) to world.</summary>
        public Transform3D Local;
        /// <summary>The tunnel's frame (u, y, v) to local.</summary>
        public Transform3D Run;
        /// <summary>+1 when the run's +v side faces the street (layout L), else -1.</summary>
        public float StreetSide = 1;
        /// <summary>The door's opening in the door wall (a = local x) and the closure's in its own wall.</summary>
        public Opening DoorOpening = new(), ClosureOpening = new();
        /// <summary>The closure's wall: its frame (a, y, n: n out of the room) to local; and how deep the wall is.</summary>
        public Transform3D ClosureWall;
        /// <summary>The leaf's rebate: the leaf's outer face (local z) and the top of the frame.</summary>
        public float LeafFace => Gate ? -.06f : -.18f;
        public float FrameDepth => Gate ? .13f : .12f;
        public float FrameTop => Gate ? 2.75f : DoorHeight + .08f;
        /// <summary>The way a body walks in, as local points: the street, the doorway, the landing, the flight's head and foot, the bottom landing, before the closure.</summary>
        public Vector3[] Route = Array.Empty<Vector3>();
        public Vector3 World(Vector3 local) => Local * local;
        public Vector3 RunToWorld(Vector3 run) => Local * (Run * run);
    }

    private static List<Spec>? all;
    public static IReadOnlyList<Spec> All => all ??= Load();

    public static List<Spec> Load()
    {
        var list = new List<Spec>();
        if (!Godot.FileAccess.FileExists(File)) return list;
        var root = JsonDocument.Parse(Godot.FileAccess.GetFileAsString(File)).RootElement;
        var defaults = root.TryGetProperty("defaults", out var df) ? df : default;
        float F(JsonElement e, string k, float d)
        {
            if (e.ValueKind == JsonValueKind.Object && e.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.Number) return v.GetSingle();
            if (defaults.ValueKind == JsonValueKind.Object && defaults.TryGetProperty(k, out var w) && w.ValueKind == JsonValueKind.Number) return w.GetSingle();
            return d;
        }
        string S(JsonElement e, string k, string d) => e.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString()! : d;
        string[] A(JsonElement e, string k) => e.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.Array ? v.EnumerateArray().Select(x => x.GetString()!).ToArray() : Array.Empty<string>();
        foreach (var e in root.GetProperty("entrances").EnumerateArray())
        {
            if (e.TryGetProperty("enabled", out var en) && en.ValueKind == JsonValueKind.False) continue;
            var s = new Spec
            {
                Id = S(e, "id", ""), Name = S(e, "name", ""), Host = S(e, "host", "rampart"), Line = S(e, "line", ""), Layout = S(e, "layout", "L"),
                Flight = S(e, "flight", "right"), Closure = S(e, "closure", "grille"), ClosureSide = S(e, "closureSide", "street"), Head = S(e, "head", "arch"), Frame = S(e, "frame", "bluestone"),
                Survey = e.TryGetProperty("survey", out var sv) ? sv.GetInt32() : 0,
                ConnectArea=S(e,"connectArea",""), ConnectLength=F(e,"connectLength",0),
                LowerSill=e.TryGetProperty("lowerSill",out var ls)&&ls.GetBoolean(),
                Underpass=e.TryGetProperty("underpass",out var under)?ReadUnderpass(under):null,
                Door = new Vector2(e.GetProperty("door")[0].GetSingle(), e.GetProperty("door")[1].GetSingle()),
                Out = new Vector2(e.GetProperty("out")[0].GetSingle(), e.GetProperty("out")[1].GetSingle()).Normalized(),
                Street = F(e, "street", 0), Depth = F(e, "depth", -3.6f), Wall = F(e, "wall", .9f), Width = F(e, "width", 1.3f),
                DoorWidth = F(e, "doorWidth", 1.2f), DoorHeight = F(e, "doorHeight", 2.0f), Post = F(e, "post", .08f), KeepAbove = F(e, "keepAbove", 0),
                Riser = F(e, "riser", .18f), PitchDeg = F(e, "pitchDeg", 35), TopLanding = F(e, "topLanding", 1.5f), BottomLanding = F(e, "bottomLanding", 1.5f),
                Lining = F(e, "lining", .28f), Spring = F(e, "spring", 2.45f), VaultRise = F(e, "vaultRise", .32f),
                Cut = A(e, "cut"), Clear = A(e, "clear"), Foliage = A(e, "foliage"), FoliageMaterials = A(e, "foliageMaterials"),
                Approach = F(e, "approach", 1.6f), OpenDeg = F(e, "openDeg", 86),
                From = e.TryGetProperty("from", out var fr) && fr.ValueKind == JsonValueKind.Array ? fr.EnumerateArray().Select(p => new Vector2(p[0].GetSingle(), p[1].GetSingle())).ToArray() : Array.Empty<Vector2>(),
            };
            Frames(s);
            list.Add(s);
        }
        return list;
    }

    /// <summary>The frames, openings and walking route that follow from an entry's numbers.</summary>
    public static void Frames(Spec s)
    {
        var z = new Vector3(s.Out.X, 0, s.Out.Y).Normalized();
        var x = Vector3.Up.Cross(z);
        s.Local = new Transform3D(new Basis(x, Vector3.Up, z), new Vector3(s.Door.X, s.Street, s.Door.Y));
        Vector3 u, origin;
        if (s.Layout == "I") { u = -Vector3.Back; origin = new Vector3(0, 0, -s.Wall); }
        else { u = s.Flight == "left" ? Vector3.Left : Vector3.Right; origin = -u * (s.TopLanding / 2) + new Vector3(0, 0, -s.Wall - s.Width / 2); }
        var v = u.Cross(Vector3.Up);
        s.Run = new Transform3D(new Basis(u, Vector3.Up, v), origin);
        if (s.House)
        {
            // the vault's back (its crown's extrados) is under the paving and its bed from here on: the house ends here
            float over = s.Spring + s.VaultRise + .22f + RuienStairHouse.Cover;
            s.HouseBack = MathF.Ceiling((s.TopLanding + over / MathF.Tan(Mathf.DegToRad(s.PitchDeg))) * 20) / 20;
        }
        s.StreetSide = v.Dot(Vector3.Back) >= 0 ? 1 : -1;
        float h = s.DoorWidth / 2;
        s.DoorOpening = s.Head == "arch"
            ? new Opening { C = 0, H = h, Floor = 0, Spring = s.FrameTop, Rise = .26f }
            : new Opening { C = 0, H = h, Floor = 0, Spring = s.FrameTop, Rise = 0 };
        // The closure: a round-headed arch 1.2 m wide in the bottom landing's wall: the street side (L), a side (I) or the end.
        float uc = s.TopLanding + s.FlightLength + s.BottomLanding / 2;
        var close = new Opening { H = .6f, Floor = -s.Drop, Spring = -s.Drop + 1.6f, Rise = .6f };
        if (s.ClosureSide == "end")
        {
            // the far end wall: n along +u
            s.ClosureWall = s.Run * new Transform3D(new Basis(Vector3.Forward, Vector3.Up, Vector3.Right), new Vector3(s.RunLength, 0, 0));
            close.C = 0;
        }
        else
        {
            // a side wall: +v or -v of the run (L: the street side is the door wall's side)
            float side = s.ClosureSide == "street" ? s.StreetSide : s.ClosureSide == "back" ? -s.StreetSide : SideSign(s);
            var n = new Vector3(0, 0, side);
            var a = Vector3.Up.Cross(n);
            s.ClosureWall = s.Run * new Transform3D(new Basis(a, Vector3.Up, n), new Vector3(0, 0, side * s.Width / 2));
            close.C = a.X * uc;
            if (s.Layout != "I" && side == s.StreetSide)
            {
                // (layout L, street side: the door wall itself, whose a is local x)
                s.ClosureWall = new Transform3D(Basis.Identity, new Vector3(0, 0, -s.Wall));
                close.C = (s.Run * new Vector3(uc, 0, 0)).X;
            }
        }
        s.ClosureOpening = close;
        // The route: the street before the door, the doorway, the top landing, the flight's head and foot, the landing.
        var route = new List<Vector3> { new(0, 0, s.Approach), new(0, 0, -s.Wall / 2) };
        Vector3 R(float uu, float y) => s.Run * new Vector3(uu, y, 0);
        route.Add(R(s.TopLanding / 2, 0));
        route.Add(R(s.TopLanding - .05f, 0));
        route.Add(R(s.TopLanding + s.FlightLength + .25f, -s.Drop));
        route.Add(R(uc, -s.Drop));
        s.Route = route.ToArray();
    }

    /// <summary>For layout I: "right" is the local +x side (as seen from the street), "left" the other.</summary>
    private static float SideSign(Spec s)
    {
        var v = s.Run.Basis.Z;
        float want = s.ClosureSide == "left" ? -1 : 1;
        return v.Dot(Vector3.Right) * want >= 0 ? 1 : -1;
    }

    /// <summary>The entrance whose tunnel holds a point (its plan box, for keeping the rain out round an eye inside), or null.</summary>
    public static Aabb? Shelter(Vector3 p)
    {
        foreach (var s in All)
        {
            var q = (s.Local * s.Run).AffineInverse() * p;
            if (q.X < -s.Lining || q.X > s.RunLength + s.Lining || MathF.Abs(q.Z) > s.Width / 2 + s.Lining || q.Y < -s.Drop - 1) continue;
            // (a buried stair: only under its own vault, not on the street over its lower end)
            if (q.Y > (s.Buried ? s.Ceiling(q.X) : s.Spring + s.VaultRise + .5f)) continue;
            // (beyond a stair-house's back the stair is under the street: an eye over it is out in the rain)
            if (s.House && q.X > s.HouseBack && q.Y > -.1f) continue;
            return BoxOf(s.Local * s.Run, new Vector3(0, -s.Drop - .5f, -s.Width / 2), new Vector3(s.RunLength, s.Spring + s.VaultRise + .5f, s.Width / 2));
        }
        return null;
    }

    /// <summary>A point inside the entrance's tunnel (its lining's box from the street down to under the landing).</summary>
    public static bool Holds(Spec s, Vector3 p)
    {
        var q = (s.Local * s.Run).AffineInverse() * p;
        return q.X > -s.Lining && q.X < s.RunLength + s.Lining && MathF.Abs(q.Z) < s.Width / 2 + s.Lining && q.Y > -s.Drop - 1 && q.Y < s.Spring + s.VaultRise + .5f;
    }

    /// <summary>The closure's middle in the world, a little in front of it on the landing (for the prompt and the checks).</summary>
    public static Vector3 ClosureFront(Spec s, float stand = .7f)
    {
        var o = s.ClosureOpening;
        return s.World(s.ClosureWall * new Vector3(o.C, o.Floor, -stand));
    }

    // ---------------------------------------------------------------- the cut in the town

    /// <summary>
    /// The town's meshes give way to an entrance (before collision and navigation read them; the installed resources are
    /// untouched): the doorway through the host wall, the floor and anything inside the tunnel's air, plants and climbers in
    /// front of the door, and a gate house's drawn door. Returns one note per entrance.
    /// </summary>
    public static List<string> Cut(Node3D town)
    {
        var notes = new List<string>();
        foreach (var s in All)
        {
            var inv = s.Local.AffineInverse();
            var o = s.DoorOpening;
            // 1. the doorway through the host wall: the opening's outline (its arch too), from just before the face to
            //    the tunnel. The frame and surround cover the cut edge.
            var door = new List<Func<Vector3, float>>
            {
                p => (inv * p).X + o.H + .002f, p => o.H + .002f - (inv * p).X, p => (inv * p).Y - .02f,
                p => (inv * p).Z + s.Wall + .05f, p => .12f - (inv * p).Z,
                p => { var q = inv * p; if (q.Y <= o.Spring) return o.Spring + o.Rise + .002f - q.Y; if (o.Rise <= 0) return o.Spring + .002f - q.Y; float k = q.X / (o.H + .002f), m = (q.Y - o.Spring) / (o.Rise + .002f); return (1 - MathF.Sqrt(k * k + m * m)) * Math.Min(o.H, o.Rise); },
            };
            int wall = s.Cut.Length == 0 ? 0 : QuayNotch.CutRegion(town, mi => s.Cut.Any(c => mi.Name.ToString().StartsWith(c, StringComparison.Ordinal)), Box(s, new Vector3(-o.H - .1f, 0, -s.Wall - .2f), new Vector3(o.H + .1f, o.Top + .1f, .2f)), _ => true, door);
            // 2. the floor under the wall inside the doorway and everything in the tunnel's air (the bank's and the house's
            //    hidden faces): every mesh.
            var airRegions = new List<QuayNotch.Region>();
            var floorLo = new Vector3(-o.H, -.45f, -s.Wall - .01f);
            var floorHi = new Vector3(o.H, .05f, -.01f);
            airRegions.Add(new QuayNotch.Region(Box(s, floorLo, floorHi), Planes(s.Local, floorLo, floorHi)));
            if(s.LowerSill)
            {
                var sl=new Vector3(-o.H+.015f,-.45f,-s.Wall-.02f);var sh=new Vector3(o.H-.015f,.36f,.5f);
                airRegions.Add(new QuayNotch.Region(Box(s,sl,sh),Planes(s.Local,sl,sh)));
            }
            foreach (var (lo, hi, frame) in AirBoxes(s))
                airRegions.Add(new QuayNotch.Region(BoxOf(s.Local * frame, lo, hi), Planes(s.Local * frame, lo, hi)));
            int air = QuayNotch.CutRegions(town, _ => true, _ => true, airRegions);
            // 3. plants and climbers before the door: whole leaves go, none is clipped straight.
            var corridor = new Aabb(new Vector3(-o.H - .55f, -.2f, -.6f), new Vector3(2 * o.H + 1.1f, o.Top + 1.1f, 2.3f));
            int leaves = Drop(town, mi => s.Foliage.Any(c => mi.Name.ToString().StartsWith(c, StringComparison.Ordinal)), s.FoliageMaterials, inv, corridor);
            leaves += HidePlants(town, s, inv, corridor);
            if (s.House)
            {
                // a stair-house: the town's ground, its plants and anything else inside the plinth's outline give way (no
                // ground there: the crowd's walk map leaves the house out, and the street's collision stops at the plinth)
                var (lo, hi) = RuienStairHouse.Outline(s);
                var plinth = new Vector3(.012f, 0, .012f);
                air += QuayNotch.CutRegion(town, _ => true, Box(s, lo + plinth, hi - plinth), _ => true, Planes(s.Local, lo + plinth, hi - plinth));
                leaves += HidePlants(town, s, inv, new Aabb(lo - new Vector3(.25f, 0, .25f), hi - lo + new Vector3(.5f, 0, .5f)));
                foreach(float side in new[]{-1f,1f})
                {
                    float x=side*(RuienStairHouse.Half+.56f),z=-RuienStairHouse.Length(s)+.35f;
                    var gl=new Vector3(x-.145f,-1.02f,z-.14f);var gh=new Vector3(x+.145f,.04f,z+.14f);
                    air+=QuayNotch.CutRegion(town,_=>true,Box(s,gl,gh),_=>true,Planes(s.Local,gl,gh));
                }
            }
            // 4. a gate house's drawn door (frame, leaf and recess) under its hood: whole pieces.
            var drawn = new Aabb(new Vector3(-o.H - .03f, -.1f, -1.7f), new Vector3(2 * o.H + .06f, s.KeepAbove + .1f, 2.1f));
            int cleared = s.Clear.Length == 0 ? 0 : Drop(town, mi => s.Clear.Any(c => mi.Name.ToString().StartsWith(c, StringComparison.Ordinal)), Array.Empty<string>(), inv, drawn, s.KeepAbove);
            notes.Add($"entrance {s.Id}: {wall} wall, {air} inside, {leaves} plant and {cleared} drawn-door triangles cut");
        }
        foreach(var s in All.Where(s=>s.ConnectLength>0))
        {
            var f=LinkFrame(s);var lo=new Vector3(-.6f,-.25f,-.02f);var hi=new Vector3(.6f,2.2f,s.ConnectLength+.02f);
            QuayNotch.CutRegion(town,_=>true,BoxOf(f,lo,hi),_=>true,Planes(f,lo,hi));
        }
        return notes;
    }

    /// <summary>The convex air of the tunnel and the closure's niche, as boxes in their frames (relative to local).</summary>
    private static IEnumerable<(Vector3 lo, Vector3 hi, Transform3D frame)> AirBoxes(Spec s,bool surroundings=true)
    {
        float top = s.Spring + s.VaultRise + .25f;
        float across = s.Width / 2 + s.Lining;
        if (s.House)
        {
            // under the house the tunnel's air; beyond its back only under the paving (the street over the stair stays)
            float back = s.HouseBack + RuienStairHouse.BackWall;
            yield return (new Vector3(-s.Lining, -s.Drop - .45f, -across), new Vector3(back, top, across), s.Run);
            yield return (new Vector3(back - .01f, -s.Drop - .45f, -across), new Vector3(s.RunLength + s.Lining, -.1f, across), s.Run);
        }
        else if (!s.Buried)
            yield return (new Vector3(-s.Lining, -s.Drop - .45f, -across), new Vector3(s.RunLength + s.Lining, top, across), s.Run);
        else
            // (a buried stair: the masonry's own steps down, so the street over its lower end stays whole)
            foreach (var (u0, u1) in Steps(s))
                // Consecutive cuts overlap: a coplanar triangle on their common plane otherwise survives both
                // strict half-space tests as a thin collision sliver across the stair.
                yield return (new Vector3(u0-.003f, -s.Drop - .45f, -across), new Vector3(u1+.003f, s.Ceiling(u0) - .01f, across), s.Run);
        if(!surroundings)yield break;
        // the closure's niche and the stub behind a grille
        var c = s.ClosureOpening;
        yield return (new Vector3(c.C - c.H - s.Lining, c.Floor - .45f, -.05f), new Vector3(c.C + c.H + s.Lining, c.Top + c.Ring + .2f, s.ConnectLength>0?s.ConnectLength+.03f:s.Lining+1.3f), s.ClosureWall);
        // the reveal through the host wall
        var o = s.DoorOpening;
        float m = s.RevealMargin;
        yield return (new Vector3(-o.H - m, -.45f, -s.Wall - .05f), new Vector3(o.H + m, o.Top + o.Ring + Math.Min(.3f, m), -.06f), Transform3D.Identity);
    }

    private static Aabb Box(Spec s, Vector3 lo, Vector3 hi) => BoxOf(s.Local, lo, hi);
    private static Aabb BoxOf(Transform3D xf, Vector3 lo, Vector3 hi)
    {
        var box = new Aabb(xf * lo, Vector3.Zero);
        foreach (float x in new[] { lo.X, hi.X }) foreach (float y in new[] { lo.Y, hi.Y }) foreach (float z in new[] { lo.Z, hi.Z }) box = box.Expand(xf * new Vector3(x, y, z));
        return box;
    }
    /// <summary>A box in a frame as six inside-functions on world points.</summary>
    private static List<Func<Vector3, float>> Planes(Transform3D xf, Vector3 lo, Vector3 hi)
    {
        var inv = xf.AffineInverse();
        return new List<Func<Vector3, float>>
        {
            p => (inv * p).X - lo.X, p => hi.X - (inv * p).X, p => (inv * p).Y - lo.Y, p => hi.Y - (inv * p).Y, p => (inv * p).Z - lo.Z, p => hi.Z - (inv * p).Z,
        };
    }

    /// <summary>
    /// The town's scattered plants (multimesh copies under its `vegetation` group, or named in the entry's foliage) that
    /// stand inside a local box: each copy there is folded to nothing in place. Returns how many.
    /// </summary>
    private static int HidePlants(Node3D town, Spec s, Transform3D inv, Aabb local)
    {
        int hidden = 0;
        foreach (var node in QuayNotch.BatchNodes(town))
        {
            if (node is not MultiMeshInstance3D { Multimesh: { } mm } mmi) continue;
            if (mmi.GetParent()?.Name.ToString() != "vegetation" && !s.Foliage.Any(c => mmi.Name.ToString().StartsWith(c, StringComparison.Ordinal))) continue;
            var xf = Transform3D.Identity;
            for (Node? n = mmi; n is Node3D n3; n = n.GetParent()) xf = n3.Transform * xf;
            var data=MultiMeshData.Read(mm);int stride=MultiMeshData.Stride(mm);bool changed=false;
            for (int i = 0; i < mm.InstanceCount; i++)
            {
                if (!local.HasPoint(inv * (xf * MultiMeshData.Origin(data,i*stride)))) continue;
                MultiMeshData.Collapse(data,i*stride);changed=true;
                hidden++;
            }
            if(changed)MultiMeshData.Write(mm,data);
        }
        return hidden;
    }

    /// <summary>Drop whole triangles (by their middle) of the picked meshes, or of surfaces in the named materials, inside a local box.</summary>
    private static int Drop(Node3D town, Func<MeshInstance3D, bool> pick, string[] materials, Transform3D inv, Aabb local, float keepAbove = 0)
    {
        int dropped = 0;
        foreach (var node in QuayNotch.Candidates(town,new[]{inv.AffineInverse()*local}))
        {
            if (node is not MeshInstance3D { Mesh: ArrayMesh mesh } mi) continue;
            bool byName = pick(mi);
            if (!byName && materials.Length == 0) continue;
            var xf = Transform3D.Identity;
            for (Node? n = mi; n is Node3D n3; n = n.GetParent()) xf = n3.Transform * xf;
            var to = inv * xf;
            var box = to * mesh.GetAabb();
            if (!box.Intersects(local)) continue;
            int here = 0;
            var edits=new Dictionary<int,Godot.Collections.Array>();
            for (int si = 0; si < mesh.GetSurfaceCount(); si++)
            {
                string mat = mesh.SurfaceGetMaterial(si)?.ResourceName ?? "";
                bool take = byName || materials.Any(m => mat.Contains(m, StringComparison.Ordinal));
                if(!take || mesh.SurfaceGetPrimitiveType(si)!=Mesh.PrimitiveType.Triangles)continue;
                var arrays=mesh.SurfaceGetArrays(si);
                int count=RuienPatch.Drop(arrays,c=>{var q=to*c;return local.HasPoint(q)&&(keepAbove<=0||q.Y<keepAbove);});
                if(count>0){here+=count;edits[si]=arrays;}
            }
            if(here==0)continue;
            var cut=new ArrayMesh{ResourceName=mesh.ResourceName};
            for(int si=0;si<mesh.GetSurfaceCount();si++)
            {
                cut.AddSurfaceFromArrays(mesh.SurfaceGetPrimitiveType(si),edits.TryGetValue(si,out var arrays)?arrays:mesh.SurfaceGetArrays(si),null,null,mesh.SurfaceGetFormat(si));
                cut.SurfaceSetMaterial(si,mesh.SurfaceGetMaterial(si));cut.SurfaceSetName(si,mesh.SurfaceGetName(si));
            }
            foreach (var key in mesh.GetMetaList()) cut.SetMeta(key, mesh.GetMeta(key));
            mi.Mesh = cut;
            dropped += here;
        }
        return dropped;
    }

    // ---------------------------------------------------------------- the cover (underground light) and the lights

    /// <summary>
    /// The entrance's footprint for the cover map: the tunnel, the closure's niche and the reveal behind the leaf; each
    /// with the height (world y) up to which it is closed in: every height for a stair in a bank or a gate house, the
    /// masonry's top for a buried one, so the street over its lower end keeps its sky.
    /// </summary>
    public static IEnumerable<(Transform3D frame, Vector2 lo, Vector2 hi, float ceiling)> Footprint(Spec s)
    {
        // (in each frame x and z; the cover is a plan; a stair-house's from its front wall's inner face: its door and
        // surround stay in the open)
        float across = s.Width / 2 + s.Lining, every = float.PositiveInfinity;
        if (s.House)
            yield return (s.Local * s.Run, new Vector2(0, -across), new Vector2(s.RunLength + s.Lining, across), every);
        else if (!s.Buried)
            yield return (s.Local * s.Run, new Vector2(-s.Lining, -across), new Vector2(s.RunLength + s.Lining, across), every);
        else
            foreach (var (u0, u1) in Steps(s))
                yield return (s.Local * s.Run, new Vector2(u0, -across), new Vector2(u1, across), s.Street + s.Ceiling(u0));
        var c = s.ClosureOpening;
        yield return (s.Local * s.ClosureWall, new Vector2(c.C - c.H - s.Lining, 0), new Vector2(c.C + c.H + s.Lining, s.Lining + 1.25f), s.Buried ? s.Street + c.Top + c.Ring + .3f : every);
        var o = s.DoorOpening;
        if (!s.House) yield return (s.Local, new Vector2(-o.H - .2f, -s.Wall - .1f), new Vector2(o.H + .2f, -.45f), s.Buried ? s.Street + s.Top : every);
    }

    /// <summary>A buried stair's pieces along the run (u0, u1): the top landing, the flight in short lengths, the bottom landing; the ends take the lining.</summary>
    public static IEnumerable<(float u0, float u1)> Steps(Spec s, bool lining = true)
    {
        float lt = s.TopLanding, lf = s.FlightLength, L = lining ? s.Lining : 0;
        yield return (-L, lt);
        int n = Math.Max(1, (int)MathF.Ceiling(lf / .2f));
        for (int i = 0; i < n; i++) yield return (lt + lf * i / n, lt + lf * (i + 1) / n);
        yield return (lt + lf, s.RunLength + L);
    }

    /// <summary>The daylight through the open door: an opening in the Ruien's light list (no Godot light).</summary>
    public static RuienData.Source DoorLight(Spec s)
    {
        float h = s.DoorOpening.H - s.Post;
        return new RuienData.Source
        {
            Id = s.LightId, Kind = "door", At = s.World(new Vector3(0, s.DoorHeight / 2, s.LeafFace - .02f)), Dir = -(s.Local.Basis.Z).Normalized(),
            HalfU = h, HalfV = s.DoorHeight / 2, Power = .45f, Range = 6.5f,
        };
    }

    // ---------------------------------------------------------------- the model

    /// <summary>Everything of one entrance, under a node placed at its local frame.</summary>
    public static Node3D Build(Spec s)
    {
        using var trace=Scheldemist.Dev.StartupTiming.Split("ruien.entrance."+s.Id);
        var root = CachedStructure(s);
        trace?.Next("structure");
        var leaf = new RuienEntranceDoor { Spec = s, Name = "door" };
        leaf.PrepareParts();
        root.AddChild(leaf);
        // (far off nothing of it shows: the street sees the door, the rest is behind walls)
        foreach (var mi in root.FindChildren("*", "MeshInstance3D", true, false).OfType<MeshInstance3D>())
        { mi.VisibilityRangeEnd = 90; mi.VisibilityRangeEndMargin = 6; }
        // (a stair-house stands on the square: its shell is seen from as far as the town's houses)
        trace?.Next("door");
        if (s.House && Main.I?.Flag("no-stair-house-shell") != true) root.AddChild(RuienStairHouse.Build(s));
        trace?.Next("house");
        return root;
    }

    internal static Node3D BuildStructure(Spec s)
    {
        var root = new Node3D { Name = "entrance_" + s.Id, Transform = s.Local };
        var k = new Kit(s);
        k.Tunnel();
        k.DoorWall();
        k.Closure();
        k.Commit(root);
        if(s.ConnectLength>0)root.AddChild(BuildLink(s));
        if(s.Underpass!=null)root.AddChild(BuildUnderpass(s));
        return root;
    }

    /// <summary>The pieces of one entrance as they are made: surface tools per family, the trims the walls take.</summary>
    private sealed class Kit
    {
        private readonly Spec s;
        public readonly SurfaceTool Stone = new(), Brick = new(), FreshBrick = new(), Vault = new(), Iron = new();
        /// <summary>A stair-house's door wall and its arch through the wall: seen from the street, so always drawn (the rest of a
        /// stair-house's inside only while it can be seen: RuienEntranceDoor).</summary>
        public readonly SurfaceTool DoorBrick = new(), DoorVault = new();
        /// <summary>The surround on the street face: stone and brick that the rain washes, not the damp and soot inside.</summary>
        public readonly SurfaceTool FaceStone = new(), FaceBrick = new(), FaceVault = new();
        private readonly List<Func<Vector3, float>> trims = new();
        private readonly List<(ArrayMesh mesh, Transform3D at, Vector3 grain, float column)> oak = new();
        public Kit(Spec spec)
        {
            s = spec;
            foreach (var t in new[] { Stone, Brick, FreshBrick, Vault, Iron, FaceStone, FaceBrick, FaceVault, DoorBrick, DoorVault }) t.Begin(Mesh.PrimitiveType.Triangles);
        }

        private Material M(SurfaceTool t) => RuienMaterials.Get(t == Iron ? "ruien_iron" : t == Stone || t == FaceStone ? "ruien_bluestone" : "ruien_brick_stretcher");

        /// <summary>A bevelled box between two corners of a frame (relative to local).</summary>
        public void Box(SurfaceTool t, Transform3D frame, Vector3 lo, Vector3 hi, float bevel)
        {
            var size = (hi - lo).Abs();
            if (size.X < .002f || size.Y < .002f || size.Z < .002f) return;
            t.AppendFrom(BevelMesh.Box(size, Math.Min(bevel, Math.Min(size.X, Math.Min(size.Y, size.Z)) * .3f), M(t)), 0, frame * new Transform3D(Basis.Identity, (lo + hi) / 2));
        }

        private void VaultRing(Transform3D frame, Vector3 a, Vector3 b, Vector3 along, float half, float rise, float thick, SurfaceTool? into = null)
        {
            // (across = up x along keeps the ring's faces facing into the room, as the O2 flight's)
            var tmp = new SurfaceTool(); tmp.Begin(Mesh.PrimitiveType.Triangles);
            RuienStair.Vault(tmp, a, b, Vector3.Up.Cross(along).Normalized(), half, rise, thick);
            (into ?? Vault).AppendFrom(tmp.Commit(), 0, frame);
        }

        /// <summary>
        /// A wall in a frame (a along it, y up, n out of the room; n from n0 to n1) from a0 to a1 and y0 to y1, with its
        /// openings: boxes round them, the arch ring through the wall's depth, and the brick over the ring trimmed to it.
        /// </summary>
        public void Wall(SurfaceTool t, Transform3D frame, float a0, float a1, float y0, float y1, float n0, float n1, IEnumerable<Opening> openings, float bevel = .009f)
        {
            float cursor = a0;
            foreach (var o in openings.OrderBy(o => o.C))
            {
                if (o.C - o.H > cursor + .002f) Box(t, frame, new Vector3(cursor, y0, n0), new Vector3(o.C - o.H, y1, n1), bevel);
                if (o.Floor > y0 + .002f) Box(t, frame, new Vector3(o.C - o.H, y0, n0), new Vector3(o.C + o.H, o.Floor, n1), bevel);
                if (y1 > o.Spring + .002f) Box(t, frame, new Vector3(o.C - o.H, o.Spring, n0), new Vector3(o.C + o.H, y1, n1), bevel);
                cursor = o.C + o.H;
                if (o.Rise > 0)
                {
                    var inv = frame.AffineInverse(); var op = o; float f0 = n0, f1 = n1;
                    trims.Add(p =>
                    {
                        var q = inv * p;
                        if (q.Z < f0 - .3f || q.Z > f1 + .3f || q.Y < op.Spring - .3f || MathF.Abs(q.X - op.C) > op.H + op.Ring + .3f) return -1;
                        float kx = (q.X - op.C) / (op.H + op.Ring), ky = (q.Y - op.Spring) / (op.Rise + op.Ring);
                        float e = (1 - MathF.Sqrt(kx * kx + ky * ky)) * Math.Min(op.H, op.Rise + op.Ring);
                        // Include the box's bottom face at spring height. Leaving air==0 there makes an invisible
                        // flat ceiling across the arch: a centre ray passes, but a person's head hits it.
                        return Math.Min(Math.Min(e, q.Y - op.Spring + .001f), Math.Min(q.Z - f0 + .0005f, f1 + .0005f - q.Z));
                    });
                }
            }
            if (a1 > cursor + .002f) Box(t, frame, new Vector3(cursor, y0, n0), new Vector3(a1, y1, n1), bevel);
        }

        /// <summary>The arch ring of an opening through a wall's depth (n0 to n1).</summary>
        public void Ring(Transform3D frame, Opening o, float n0, float n1, SurfaceTool? into = null)
        {
            if (o.Rise <= 0) return;
            VaultRing(frame, new Vector3(o.C, o.Spring, n0), new Vector3(o.C, o.Spring, n1), Vector3.Back, o.H, o.Rise, o.Ring, into);
        }

        float Top => s.Top;

        /// <summary>
        /// A wall along the run (its frame's a = u * along + a at u 0): whole to Top in a bank; a buried stair's in the
        /// pieces of Steps, each up to the masonry's top there, so none stands above the street outside the building.
        /// The openings go to the piece they stand in.
        /// </summary>
        private void RunWall(SurfaceTool t, Transform3D frame, Func<float, float> aOf, float y0, float n0, float n1, IList<Opening> openings)
        {
            if (!s.Buried)
            {
                float a0 = Math.Min(aOf(0), aOf(s.RunLength)), a1 = Math.Max(aOf(0), aOf(s.RunLength));
                Wall(t, frame, a0, a1, y0, Top, n0, n1, openings);
                return;
            }
            foreach (var (u0, u1) in Steps(s, false))
            {
                float a0 = Math.Min(aOf(u0), aOf(u1)), a1 = Math.Max(aOf(u0), aOf(u1));
                Wall(t, frame, a0, a1, y0, s.Ceiling(u0), n0, n1, openings.Where(o => o.C > a0 - .001f && o.C < a1 + .001f));
            }
        }

        /// <summary>The tunnel: landings and flight in bluestone, brick walls, the barrel vault over all of it, handrails.</summary>
        public void Tunnel()
        {
            var run = s.Run; float w = s.Width, half = w / 2, L = s.Lining, lt = s.TopLanding, lf = s.FlightLength, rl = s.RunLength, drop = s.Drop;
            float y0 = -drop - .4f;
            if (s.House)
            {
                // beyond a stair-house's back wall the lining stops under the paving (the street over it is the town's)
                var into = run.AffineInverse(); float end = s.HouseBack + RuienStairHouse.BackWall;
                trims.Add(p => { var q = into * p; return q.X > end ? q.Y + .12f : -1; });
            }
            // Landings: flags across the tunnel with 3 mm joints, 24 cm thick.
            void Flags(float u0, float u1, float y)
            {
                // (on a lime bed: the joints are open 3 mm, 12 mm deep, nothing shows or falls through them)
                Box(Stone, run, new Vector3(u0, y - .3f, -half), new Vector3(u1, y - .012f, half), .002f);
                int n = Math.Max(1, (int)MathF.Round((u1 - u0) / .62f)); float step = (u1 - u0) / n;
                for (int i = 0; i < n; i++)
                    Box(Stone, run, new Vector3(u0 + i * step + .0015f, y - .24f, -half), new Vector3(u0 + (i + 1) * step - .0015f, y, half), .008f + .002f * MathF.Sin(i * 2.1f + u0));
            }
            Flags(0, lt, 0);
            Flags(lt + lf, rl, -drop);
            // The flight: one solid block of bluestone a step, as the O2 keeper flight.
            for (int i = 0; i < s.Steps; i++)
            {
                float top = -(i + 1) * s.Rise;
                Box(Stone, run, new Vector3(lt + i * s.Going - .003f, -drop - .24f, -half), new Vector3(lt + (i + 1) * s.Going + .003f, top, half), .010f + .002f * MathF.Sin(i * 1.7f));
            }
            // Walls: the far end always; layout L the start end and the back; layout I both sides. The door's side of an L
            // tunnel is the door wall (DoorWall), the closure's side carries its opening.
            var endFar = run * new Transform3D(new Basis(Vector3.Forward, Vector3.Up, Vector3.Right), new Vector3(rl, 0, 0));
            Wall(Brick, endFar, -half - L, half + L, y0, s.Buried ? s.Ceiling(rl) : Top, 0, L, ClosureIn(endFar));
            if (s.Layout != "I")
            {
                var endStart = run * new Transform3D(new Basis(Vector3.Back, Vector3.Up, Vector3.Left), Vector3.Zero);
                Wall(Brick, endStart, -half - L, half + L, y0, Top, 0, L, Array.Empty<Opening>());
            }
            foreach (float side in new[] { -1f, 1f })
            {
                if (s.Layout != "I" && side == s.StreetSide) continue;
                var n = new Vector3(0, 0, side); var a = Vector3.Up.Cross(n);
                var frame = run * new Transform3D(new Basis(a, Vector3.Up, n), new Vector3(0, 0, side * half));
                RunWall(Brick, frame, u => a.X * u, y0, 0, L, ClosureIn(frame).ToList());
            }
            // The barrel vault: level over the landings, inclined over the flight, run into the end walls.
            float sp = s.Spring;
            VaultRing(run, new Vector3(-L / 2, sp, 0), new Vector3(lt, sp, 0), Vector3.Right, half, s.VaultRise, .22f);
            VaultRing(run, new Vector3(lt, sp, 0), new Vector3(lt + lf, sp - drop, 0), Vector3.Right, half, s.VaultRise, .22f);
            VaultRing(run, new Vector3(lt + lf, sp - drop, 0), new Vector3(rl + L / 2, sp - drop, 0), Vector3.Right, half, s.VaultRise, .22f);
            // Handrails: an iron rail on posts each side of the flight (the O2 keeper flight's).
            var tilt = new Basis(Vector3.Back, -MathF.Atan2(drop, lf));
            foreach (float side in new[] { -1f, 1f })
            {
                float v = side * (half - .09f), len = lf * MathF.Sqrt(1 + drop * drop / (lf * lf));
                var mid = new Vector3(lt + lf / 2, -drop / 2 + .93f, v);
                Iron.AppendFrom(BevelMesh.Box(new Vector3(len, .035f, .035f), .003f, M(Iron)), 0, run * new Transform3D(tilt, mid));
                // posts on every fourth tread, from the tread to the rail
                for (int i = 1; i < s.Steps; i += 4)
                {
                    float u = lt + (i + .5f) * s.Going, tread = -(i + 1) * s.Rise, rail = -(u - lt) * drop / lf + .93f;
                    Box(Iron, run, new Vector3(u - .014f, tread, v - .014f), new Vector3(u + .014f, rail, v + .014f), .002f);
                }
            }
        }

        /// <summary>The closure, when it is in this wall (the same plane as the closure's own wall frame).</summary>
        private IEnumerable<Opening> ClosureIn(Transform3D frame) => Same(frame, s.ClosureWall) ? new[] { s.ClosureOpening } : Array.Empty<Opening>();

        private static bool Same(Transform3D a, Transform3D b)
        {
            // same plane: the same normal and the origin of one on the other's plane
            return a.Basis.Z.Dot(b.Basis.Z) > .99f && MathF.Abs((b.Origin - a.Origin).Dot(a.Basis.Z)) < .01f;
        }

        /// <summary>
        /// The door wall (the host wall's back, the tunnel's side or end) with the doorway, the reveal through the host
        /// wall, the surround on the face, the threshold, the frame, the fanlight.
        /// </summary>
        public void DoorWall()
        {
            var o = s.DoorOpening; float L = s.Lining, drop = s.Drop;
            // The door wall's inner face is local z = -Wall; n runs out to the street (+z).
            var frame = new Transform3D(Basis.Identity, new Vector3(0, 0, -s.Wall));
            var openings = new List<Opening> { o };
            bool closureHere = Same(frame, s.ClosureWall);
            if (closureHere) openings.Add(s.ClosureOpening);
            float face = s.Wall - .05f; // (the reveal stops 5 cm behind the face: the surround covers the joint)
            if (s.Layout == "I") Wall(s.House ? DoorBrick : Brick, frame, -s.Width / 2 - L, s.Width / 2 + L, -drop - .4f, Top, 0, L, openings);
            else RunWall(s.House ? DoorBrick : Brick, frame, u => (s.Run * new Vector3(u, 0, 0)).X, -drop - .4f, 0, L, openings);
            // The reveal through the host wall, round the doorway only.
            var reveal = new Opening { C = o.C, H = o.H, Floor = o.Floor, Spring = o.Spring, Rise = o.Rise, Ring = o.Ring };
            float m = s.RevealMargin;
            if (face > L + .02f) Wall(Brick, frame, o.C - o.H - m, o.C + o.H + m, -.45f, o.Top + o.Ring + Math.Min(.35f, m), L, face, new[] { reveal });
            Ring(frame, o, 0, face, s.House ? DoorVault : null);
            // (a flat head: an oak lintel over the frame is the gate house's; the brick over it is the wall's)
            // Threshold: one bluestone sill through the reveal, its top 1 cm above the street.
            Box(FaceStone, Transform3D.Identity, new Vector3(-o.H, -.24f, -s.Wall - .002f), new Vector3(o.H, .01f, .012f), .008f);
            // The surround on the face.
            if (s.Frame == "bluestone")
            {
                // bluestone jambs in the plinth's height (they cover the cut plinth's edge) and a rowlock brick ring
                // (a stair-house's jambs run up to the springing: free-standing, it has no plinth course to stop at)
                float jamb = s.House ? o.Spring : 1.8f;
                foreach (float side in new[] { -1f, 1f })
                {
                    Box(FaceStone, Transform3D.Identity, new Vector3(side < 0 ? -o.H - .26f : o.H, 0, -.05f), new Vector3(side < 0 ? -o.H : o.H + .26f, jamb, .015f), .008f);
                    Box(FaceBrick, Transform3D.Identity, new Vector3(side < 0 ? -o.H - .12f : o.H, jamb, -.05f), new Vector3(side < 0 ? -o.H : o.H + .12f, o.Spring, .004f), .006f);
                }
                if (o.Rise > 0) VaultRing(Transform3D.Identity, new Vector3(0, o.Spring, -.05f), new Vector3(0, o.Spring, .012f), Vector3.Back, o.H, o.Rise, o.Ring, FaceVault);
                OakFrame(o, -.30f, -.18f);
                Fanlight(o);
            }
            else if (s.Frame == "passage")
            {
                // A side door in a gateway's passage: a dressed bluestone frame (two jambs and a lintel with ears), the
                // jambs on low, prouder plinth blocks with a capping course that take the knocks of barrows in the passage.
                const float jamb = .2f, lintel = .3f, ear = .07f;
                float jt = s.FrameTop;
                foreach (float side in new[] { -1f, 1f })
                {
                    float x0 = side < 0 ? -o.H - jamb : o.H, x1 = side < 0 ? -o.H : o.H + jamb;
                    Box(FaceStone, Transform3D.Identity, new Vector3(x0, .32f, -.05f), new Vector3(x1, jt, .035f), .010f);
                    // the plinth block, a little wider and prouder, and its cap
                    float p0 = side < 0 ? -o.H - jamb - .03f : o.H, p1 = side < 0 ? -o.H : o.H + jamb + .03f;
                    Box(FaceStone, Transform3D.Identity, new Vector3(p0, 0, -.05f), new Vector3(p1, .30f, .075f), .012f);
                    Box(FaceStone, Transform3D.Identity, new Vector3(p0 + .01f, .29f, -.05f), new Vector3(p1 - .01f, .33f, .05f), .010f);
                }
                Box(FaceStone, Transform3D.Identity, new Vector3(-o.H - jamb - ear, jt, -.05f), new Vector3(o.H + jamb + ear, jt + lintel, .05f), .012f);
                OakFrame(o, -.30f, -.18f);
            }
            else if (s.Frame == "house")
            {
                // A side door in a house wall: an oak casing round the opening on the face, a bluestone lintel over it and
                // a bluestone doorstep that runs out over the pavement.
                const float casing = .11f;
                float jt = s.FrameTop;
                var mat = RuienMaterials.Get("ruien_oak");
                void Board(Vector3 lo, Vector3 hi, Vector3 grain, float column)
                { var size = hi - lo; oak.Add((BevelMesh.Box(size, .003f, mat), new Transform3D(Basis.Identity, (lo + hi) / 2), grain, column)); }
                Board(new Vector3(-o.H - casing, .02f, -.05f), new Vector3(-o.H, jt, .022f), Vector3.Up, 2.3f);
                Board(new Vector3(o.H, .02f, -.05f), new Vector3(o.H + casing, jt, .022f), Vector3.Up, 2.6f);
                Board(new Vector3(-o.H - casing, jt, -.05f), new Vector3(o.H + casing, jt + casing, .022f), Vector3.Right, 2.9f);
                Box(FaceStone, Transform3D.Identity, new Vector3(-o.H - casing - .06f, jt + casing, -.05f), new Vector3(o.H + casing + .06f, jt + casing + .17f, .045f), .010f);
                Box(FaceStone, Transform3D.Identity, new Vector3(-o.H - .1f, -.2f, -.02f), new Vector3(o.H + .1f, .01f, .17f), .010f);
                OakFrame(o, -.30f, -.18f);
            }
            else if (s.Frame == "existing")
            {
                // Retain the surveyed town surround and fanlight; replace only its recessed oak frame and leaf.
                OakFrame(o, -.30f, -.18f);
                if(s.LowerSill)Box(Stone,Transform3D.Identity,new Vector3(-o.H+.01f,-.2f,-s.Wall-.02f),new Vector3(o.H-.01f,.025f,.5f),.012f);
            }
            else
            {
                // the gate house: an oak frame where the drawn one was, its head an oak lintel up to the hood
                OakFrame(o, -s.FrameDepth, 0f);
            }
        }

        /// <summary>Oak posts and head (transom or lintel) between z0 and z1; the leaf closes against them.</summary>
        private void OakFrame(Opening o, float z0, float z1)
        {
            var mat = RuienMaterials.Get("ruien_oak");
            void Piece(Vector3 lo, Vector3 hi, Vector3 grain, float column)
            { var size = hi - lo; oak.Add((BevelMesh.Box(size, .003f, mat), new Transform3D(Basis.Identity, (lo + hi) / 2), grain, column)); }
            float p = s.Post;
            Piece(new Vector3(-o.H, 0, z0), new Vector3(-o.H + p, s.DoorHeight, z1), Vector3.Up, .1f);
            Piece(new Vector3(o.H - p, 0, z0), new Vector3(o.H, s.DoorHeight, z1), Vector3.Up, .45f);
            Piece(new Vector3(-o.H, s.DoorHeight, z0), new Vector3(o.H, s.FrameTop, z1), Vector3.Right, .8f);
        }

        /// <summary>A fixed wrought-iron fanlight in the arched head over the transom: radiating bars from a half hub.</summary>
        private void Fanlight(Opening o)
        {
            if (o.Rise <= 0) return;
            var frame = Transform3D.Identity; float z = -.24f, hub = .07f;
            var c = new Vector3(0, o.Spring + .01f, z);
            for (int i = 0; i <= 6; i++)
            {
                float t = MathF.PI * (i + .5f) / 7f;
                var dir = new Vector2(MathF.Cos(t) * o.H, MathF.Sin(t) * o.Rise);
                float len = dir.Length() - .03f; var d = dir.Normalized();
                var at = c + new Vector3(d.X, d.Y, 0) * (hub + len) / 2;
                var basis = new Basis(Vector3.Back, MathF.Atan2(d.Y, d.X));
                Iron.AppendFrom(BevelMesh.Box(new Vector3(len - hub, .016f, .016f), .003f, M(Iron)), 0, frame * new Transform3D(basis, at));
            }
            // the hub: a half ring of flat bar
            for (int i = 0; i < 8; i++)
            {
                float t0 = MathF.PI * i / 8f, t1 = MathF.PI * (i + 1) / 8f, tm = (t0 + t1) / 2;
                var at = c + new Vector3(MathF.Cos(tm), MathF.Sin(tm), 0) * hub;
                Iron.AppendFrom(BevelMesh.Box(new Vector3(hub * (t1 - t0) + .004f, .012f, .03f), .002f, M(Iron)), 0, frame * new Transform3D(new Basis(Vector3.Back, tm + MathF.PI / 2), at));
            }
        }

        /// <summary>The closure at the bottom landing: a locked grille before a short niche, or fresh brick in the arch.</summary>
        public void Closure()
        {
            var o = s.ClosureOpening; var w = s.ClosureWall; float L = s.Lining;
            // The opening's ring through the wall's depth, and on into the niche behind a grille.
            float deep = s.Closure == "grille" ? L + 1.0f : L;
            Ring(w, o, -.0f, deep);
            if (s.Closure == "open")
            {
                // Connected area supplies the passage beyond this reveal, including its collision and cover.
                Box(Stone, w, new Vector3(o.C-o.H-.02f,o.Floor-.24f,-.002f), new Vector3(o.C+o.H+.02f,o.Floor,L+.01f),.008f);
                return;
            }
            if (s.Closure == "grille")
            {
                // the niche: its floor, side walls and the temporary brick wall that ends it ("closed for works")
                Box(Stone, w, new Vector3(o.C - o.H - .02f, o.Floor - .24f, -.002f), new Vector3(o.C + o.H + .02f, o.Floor, deep), .008f);
                foreach (float side in new[] { -1f, 1f })
                    Box(Brick, w, new Vector3(side < 0 ? o.C - o.H - L : o.C + o.H, o.Floor - .4f, L), new Vector3(side < 0 ? o.C - o.H : o.C + o.H + L, o.Spring + .02f, deep), .009f);
                // (over the side walls, up to the ring's back)
                foreach (float side in new[] { -1f, 1f })
                    Box(Brick, w, new Vector3(side < 0 ? o.C - o.H - L : o.C + o.H + .2f, o.Spring + .02f, L), new Vector3(side < 0 ? o.C - o.H - .2f : o.C + o.H + L, o.Top + o.Ring + .1f, deep), .009f);
                Box(Brick, w, new Vector3(o.C - o.H - .2f, o.Top + o.Ring - .02f, L), new Vector3(o.C + o.H + .2f, o.Top + o.Ring + .2f, deep), .009f);
                Box(FreshBrick, w, new Vector3(o.C - o.H - L, o.Floor - .4f, deep), new Vector3(o.C + o.H + L, o.Top + o.Ring + .2f, deep + .23f), .006f);
                Grille(w, o);
            }
            else
            {
                // fresh brick set 3.5 cm back in the arch, cut to its curve
                Box(FreshBrick, w, new Vector3(o.C - o.H, o.Floor - .01f, .06f), new Vector3(o.C + o.H, o.Top + .01f, L), .004f);
                var inv = w.AffineInverse(); var op = o;
                freshTrim = p =>
                {
                    var q = inv * p;
                    if (q.Y < op.Spring - .2f || MathF.Abs(q.X - op.C) > op.H + .2f || q.Z < -.2f || q.Z > L + .2f) return -1;
                    float kx = (q.X - op.C) / op.H, ky = (q.Y - op.Spring) / op.Rise;
                    return Math.Min((MathF.Sqrt(kx * kx + ky * ky) - 1) * Math.Min(op.H, op.Rise), q.Y - op.Spring);
                };
            }
        }
        private Func<Vector3, float>? freshTrim;

        /// <summary>A wrought-iron gate in the arch: square bars on flat rails, an arched top rail, pintles, hasp and padlock.</summary>
        private void Grille(Transform3D w, Opening o)
        {
            float z = .07f, x0 = o.C - o.H + .05f, x1 = o.C + o.H - .05f;
            float Crown(float x) { float k = (x - o.C) / o.H; return o.Spring + o.Rise * MathF.Sqrt(Math.Max(0, 1 - k * k)); }
            int bars = (int)MathF.Round((x1 - x0) / .12f);
            for (int i = 0; i <= bars; i++)
            {
                float x = x0 + (x1 - x0) * i / bars;
                Box(Iron, w, new Vector3(x - .011f, o.Floor + .03f, z - .011f), new Vector3(x + .011f, Crown(x) - .035f, z + .011f), .003f);
            }
            foreach (float y in new[] { o.Floor + .14f, o.Floor + 1.0f, o.Spring })
                Box(Iron, w, new Vector3(x0 - .03f, y - .02f, z - .016f), new Vector3(x1 + .03f, y + .02f, z - .006f), .002f);
            // the arched top rail, in short straight lengths
            for (int i = 0; i < 12; i++)
            {
                float t0 = MathF.PI * i / 12f, t1 = MathF.PI * (i + 1) / 12f;
                var a = new Vector3(o.C + MathF.Cos(t0) * (o.H - .05f), o.Spring + MathF.Sin(t0) * (o.Rise - .05f), z - .011f);
                var b = new Vector3(o.C + MathF.Cos(t1) * (o.H - .05f), o.Spring + MathF.Sin(t1) * (o.Rise - .05f), z - .011f);
                var d = b - a;
                Iron.AppendFrom(BevelMesh.Box(new Vector3(d.Length() + .006f, .03f, .01f), .002f, M(Iron)), 0, w * new Transform3D(new Basis(Vector3.Back, MathF.Atan2(d.Y, d.X)), (a + b) / 2));
            }
            // pintles leaded into the left jamb, the hasp and a padlock on the right
            foreach (float y in new[] { o.Floor + .3f, o.Spring - .2f })
            {
                Box(Iron, w, new Vector3(o.C - o.H - .06f, y - .02f, z - .03f), new Vector3(o.C - o.H + .03f, y + .02f, z + .03f), .003f);
                Box(Iron, w, new Vector3(o.C - o.H + .01f, y - .05f, z - .018f), new Vector3(o.C - o.H + .045f, y + .05f, z + .018f), .004f);
            }
            float hy = o.Floor + 1.0f;
            Box(Iron, w, new Vector3(o.C + o.H - .18f, hy - .025f, z - .03f), new Vector3(o.C + o.H + .04f, hy + .025f, z - .018f), .002f);
            Box(Iron, w, new Vector3(o.C + o.H - .155f, hy - .1f, z - .075f), new Vector3(o.C + o.H - .085f, hy - .035f, z - .042f), .006f);
            Box(Iron, w, new Vector3(o.C + o.H - .145f, hy - .04f, z - .062f), new Vector3(o.C + o.H - .095f, hy + .03f, z - .054f), .003f);
            gateCollision = (w, new Vector3(o.C - o.H, o.Floor, z - .03f), new Vector3(o.C + o.H, o.Top, z + .02f));
        }
        private (Transform3D frame, Vector3 lo, Vector3 hi)? gateCollision;

        public void Commit(Node3D root)
        {
            Func<Vector3, float>? trim = trims.Count == 0 ? null : p => { float best = -1e9f; foreach (var t in trims) best = Math.Max(best, t(p)); return best; };
            Func<Vector3,float>? keep=s.Underpass==null?null:p=>UnderpassAir(s,s.World(p));
            Func<Vector3,float>? brickTrim=keep==null?trim:p=>Math.Max(trim?.Invoke(p)??-1e9f,keep(p));
            // (a stair-house's stair under its own node: the door shows or hides it, its collision stays)
            var inside = root;
            if (s.House) { inside = new Node3D { Name = "inside" }; root.AddChild(inside); }
            // (the treads and flags: bluestone worn to a dark grey on top, its own grain over that colour)
            RuienStair.Add(inside, Stone, "ruien_bluestone", true, trim:keep, bake: new Color(.07f, .072f, .075f));
            RuienStair.Add(inside, Brick, "ruien_brick_stretcher", true, trim: brickTrim);
            RuienStair.Add(inside, Vault, "ruien_brick_stretcher", true, trim:keep, barrel: true);
            RuienStair.Add(root, DoorBrick, "ruien_brick_stretcher", true, trim: brickTrim);
            RuienStair.Add(root, DoorVault, "ruien_brick_stretcher", true, trim:keep, barrel: true);
            // (new brick: clean, a lighter and warmer red than the old lining, its mortar still pale)
            RuienStair.Add(inside, FreshBrick, "ruien_brick_stretcher", true, trim: freshTrim, colour: new Color(.06f, .12f, .02f, 0), bake: new Color(.30f, .13f, .075f));
            RuienStair.Add(root, Iron, "ruien_iron", false);
            var washed = new Color(.06f, 0, .05f, 0);
            // (weathered bluestone outdoors goes a light grey: its own grain over that colour)
            RuienStair.Add(root, FaceStone, "ruien_bluestone", true, colour: washed, bake: new Color(.13f, .135f, .14f));
            RuienStair.Add(root, FaceBrick, "ruien_brick_stretcher", true, colour: washed);
            RuienStair.Add(root, FaceVault, "ruien_brick_stretcher", true, barrel: true, colour: washed);
            if (oak.Count > 0) RuienSurround.AddOak(root, oak, Transform3D.Identity, 0, "entrance_frame");
            if (gateCollision is { } g)
            {
                var body = new StaticBody3D { Name = "closure_gate", CollisionLayer = Solid.Layer, CollisionMask = 0, Transform = g.frame * new Transform3D(Basis.Identity, (g.lo + g.hi) / 2) };
                body.AddChild(new CollisionShape3D { Shape = new BoxShape3D { Size = (g.hi - g.lo).Abs() } });
                root.AddChild(body);
            }
        }
    }
}
