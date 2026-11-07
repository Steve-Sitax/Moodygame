using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Nodes;
using Godot;
using Scheldemist.Native.Authoring;
using Scheldemist.Native.Game;
using Scheldemist.Render;
using Scheldemist.World;

namespace Scheldemist.Native.World;

/// <summary>The whole town loaded from native scenes. Original source files are never consulted.</summary>
public partial class NativeTown : BakedWorld
{
    private const string Root = "res://world/town";
    private Node3D town = null!;
    private JsonDocument lights = null!;
    private Scheldemist.Town.WalkMap? walk;
    private JsonArray attributes = null!;
    public NativeDistrictLayouts.Result Layouts { get; private set; } = null!;
    public override IReadOnlySet<string>? NativeFurnitureRooms => Layouts.Districts.Where(d=>d.District.RoomId!="").Select(d=>d.District.RoomId).ToHashSet(StringComparer.Ordinal);
    private IReadOnlyList<InteriorFurniture>? furniture;
    private Dictionary<string,InteriorFurniture>? furnitureById;
    public override IReadOnlyList<InteriorFurniture>? NativeFurniture => furniture??=Layouts.Districts.Where(d=>d.District.RoomId!="").SelectMany(d=>d.Objects.GetChildren().OfType<AuthoredObject>().Where(o=>!o.GetChildren().OfType<Scheldemist.Native.Interiors.FurnitureVisual>().Any(v=>v.ResidentSnapshot)).Select(o=>
        new InteriorFurniture(d.District.RoomId,o.ObjectId,o.Asset!.FurnitureKind,o,o.Asset.SeatPoints,o.Asset.SeatHeight,o.Asset.SeatYaw,o.Asset.Table,o.Asset.UsePoint,o.Asset.StandPoint,o.Asset.Footprint,o.Asset.FootprintOffset,o.Asset.KeeperPoint==Vector3.Zero?o.Asset.StandPoint:o.Asset.KeeperPoint))).ToArray();
    public override (Transform3D Frame, Rect2 Bounds)? NativeRoom(string id)
    {var room=Layouts.Districts.FirstOrDefault(d=>d.District.RoomId==id);return room==null?null:(room.District.RoomFrame,room.District.RoomBounds);}
    public override Node3D? CreateNativeFurniture(string kind)
    {
        string path="res://assets/props/furniture-"+kind+".tscn";
        if(!ResourceLoader.Exists(path))return null;
        var model=ResourceLoader.Load<PackedScene>(path).Instantiate<Node3D>();
        model.SetMeta("native_furniture_scene",true);
        foreach(var body in All(model).OfType<CollisionObject3D>()){body.CollisionLayer=0;body.CollisionMask=0;}
        return model;
    }
    public JsonArray LampFacts { get; private set; } = new();
    public override JsonDocument? NativeLights => lights;
    private List<QuayExits.Ladder>? quayLadders;
    private NativeRazedHouses.Result razed = new(0, 0, 0, Array.Empty<string>());
    private NativeSquareDressing.Plan? squarePlan;
    public override IReadOnlyList<QuayExits.Ladder>? NativeQuayLadders => quayLadders;
    /// <summary>The walk map is made (by the Lights part, after Solid): the game rules may start on it.</summary>
    public bool WalkBuilt => walk != null;
    public override Scheldemist.Town.WalkMap? NativeWalk
    {
        get
        {
            if (walk == null)
            {
                walk = NativeWorldNavigation.Build(town, new Rect2(-480, -80, 820, 560));
                using (Scheldemist.Dev.StartupTiming.Measure("navigation.ways")) Ways.InstallNative(walk, null, Ways.ReadHouseFootprints(Paths.Shared("city_build.json")));
            }
            return walk;
        }
    }
    private static string SourceOf(Node n) => n.HasMeta("source_name") ? n.GetMeta("source_name").AsString() : "";
    private static int IndexOf(Node n) => n.HasMeta("source_node_index") ? n.GetMeta("source_node_index").AsInt32() : -1;
    private sealed record SeatBinding(string Room,string Id,float[] Original,float[] Local,float Height,float Yaw);
    private SeatBinding[] seatBindings=Array.Empty<SeatBinding>();
    public override int ResolveNativeSeat(string room,Vector3 original,out Vector3 at,out float height,out float yaw)
    {
        at=original;height=0;yaw=0;
        SeatBinding? binding=null;
        foreach(var candidate in seatBindings)
            if(candidate.Room==room&&LayoutDocument.Vector(candidate.Original).DistanceSquaredTo(original)<.0004f){binding=candidate;break;}
        if(binding==null)return 0;
        furnitureById??=NativeFurniture!.ToDictionary(p=>p.Id,StringComparer.Ordinal);
        if(!furnitureById.TryGetValue(binding.Id,out var piece))return -1;
        var node=piece.Node;
        at=node.ToGlobal(LayoutDocument.Vector(binding.Local));height=binding.Height*node.Scale.Y;yaw=node.GlobalRotation.Y+binding.Yaw;return 1;
    }
    /// <summary>
    /// The bake's frozen event and crowd pictures that nothing at run time draws or moves (found by the leftover scan, godot/src/Play/LeftoverScan.cs;
    /// issues 111, 80 and the scan of 2026-10-13). Each is matched by the bake's own node number, so a scene that is re-baked or edited shows them again
    /// rather than hiding something else. Not in the list, on purpose: the Steen's fisher, children and sailor and the net-mender at the trades (steenlife.ts, permanent
    /// street scenery), the goods and traffic rigs (their movers claim them), and everything the runtime parts hide themselves (the fire's crowd, the market).
    /// </summary>
    /// <summary>A node's place in the town scene's own frame (the scene is not yet in the tree while it loads).</summary>
    private static Transform3D InTown(Node node, Node town)
    {
        var xf = Transform3D.Identity;
        for (Node? n = node; n != null && n != town; n = n.GetParent()) if (n is Node3D n3) xf = n3.Transform * xf;
        return xf;
    }
    private static readonly (string What, Func<Node3D, bool> Match)[] LeftoverSnapshots =
    {
        ("soot sheet", n => n.Name == "soot" || SourceOf(n) == "soot"),
        // the fire hose of the Poesje's fire, laid from the pump snapshot to the door (the live pump has its own hose)
        ("fire hose", n => IndexOf(n) == 13830 && n.Name == "Mesh2948"),
        // the carts of the crowd that stood in the street when the bake was taken (their carters are hidden by Townspeople): the fish market's three and the one at the fire
        ("crowd cart", n => SourceOf(n) == "pushcart" && (IndexOf(n) is 8454 or 8464 or 8474 or 13561)),
        // Issue 122: unowned quay dressing has no cargo interactions, driver or horse gait. Live transport owns the usable carts and drays.
        ("quay handcart", n => IndexOf(n) == 4854 && SourceOf(n) == "handcart_loaded"),
        ("quay horse dray", n => IndexOf(n) == 4867 && SourceOf(n) == "dray_horse"),
        // the prison yard's ring of walkers, eight of ten frozen mid-stride (PrisonPeople walks its own at the exercise hour)
        ("prison ring figure", n => IndexOf(n) is 12420 or 12438 or 12456 or 12474 or 12492 or 12510 or 12528 or 12546),
    };
    public override Error Load(string unused)
    {
        var startupClock = System.Diagnostics.Stopwatch.StartNew();
        void Timing(string stage) => GD.Print($"startup: {stage}: {startupClock.ElapsedMilliseconds} ms");
        Stage = "read";
        Facts = JsonDocument.Parse(Godot.FileAccess.GetFileAsString(Root + "/facts.json"));
        attributes = JsonNode.Parse(Godot.FileAccess.GetFileAsString(Root + "/attributes.json"))!.AsArray();
        var intake = JsonNode.Parse(Godot.FileAccess.GetFileAsString(Root + "/intake.json"))!;
        foreach (var note in intake["unported"]!.AsArray()) Unported.Add(note!.GetValue<string>());
        // Load shared dependencies once before the districts request them: overlapping
        // resource loads can race inside Godot (including invalid resource handles).
        string scene = Root + "/scene.tscn";
        // The town's meshes, materials and pictures first, on the loader's worker threads at once (dev: --serial-town
        // reads them one after another inside the town's own request, as before)
        // (dev: --serial-districts leaves the districts' models to their own reading, after the town's)
        var held = Scheldemist.Main.I.Flag("serial-town") ? new List<Resource>()
            : NativeTownPrefetch.Run(Scheldemist.Main.I.Flag("serial-districts") ? Array.Empty<string>() : NativeDistrictLayouts.DescriptorPaths());
        Timing("town prefetch");
        bool sceneLoading = ResourceLoader.LoadThreadedRequest(scene) == Error.Ok;
        Psx.LoadShared(Path.Combine(Scheldemist.Paths.NativeDataRoot!, "maps"));
        Timing("shared textures");
        Stage = "build";
        var packedTown = sceneLoading ? (PackedScene)ResourceLoader.LoadThreadedGet(scene) : ResourceLoader.Load<PackedScene>(scene);
        Timing("town resources");
        var districts = NativeDistrictLayouts.Prepare();
        // (held until the game is up, for the parts that load the declared files later; the wrappers are shared, so
        // never disposed here)
        Scheldemist.World.StartupResources.Hold(held);
        Timing("district resources");
        town = packedTown.Instantiate<Node3D>();
        Timing("town scene instantiated");
        Layouts = NativeDistrictLayouts.Attach(town, districts);
        Timing("districts attached");
        using var loadTrace = Scheldemist.Dev.StartupTiming.Split("native.load");
        if(Godot.FileAccess.FileExists("res://world/interiors/seat-bindings.json"))
            seatBindings=JsonSerializer.Deserialize<SeatBinding[]>(Godot.FileAccess.GetFileAsString("res://world/interiors/seat-bindings.json"),new JsonSerializerOptions{PropertyNameCaseInsensitive=true})!;
        int eventSnapshots = 0;
        foreach (var snapshot in town.GetChildren().OfType<Node3D>().Where(n => n.HasMeta("source_name") && n.GetMeta("source_name").AsString() == "fire_pump"
            && n.HasMeta("source_node_index") && n.GetMeta("source_node_index").AsInt32() == 13360).ToArray())
        {
            snapshot.Visible = false;
            foreach (var child in All(snapshot)) child.SetMeta("native_replaced_event_snapshot", true);
            eventSnapshots++;
        }
        // Active fires construct their own moving pump. Keep the one-time scene snapshot intact on disk.
        if (eventSnapshots > 0) Unported.Remove("Node1476/Mesh2924");
        // The bake is a picture of one instant, and a few things in it belong to events and crowds that the game now draws and moves
        // itself. They stay in the scene on disk, but never show: the town's own soot (TownLife.Fire) draws a burned front after a real
        // fire, the live pump brings its own hose, the prison's rounds (PrisonPeople) walk their own ring, the street crowd its own carts.
        // (dev: --keep-leftovers leaves all of them as the bake has them, for a before-and-after; --keep-soot only the soot sheet)
        var leftoverCounts = new SortedDictionary<string, int>();
        if (!Scheldemist.Main.I.Flag("keep-leftovers"))
            foreach (var snapshot in town.GetChildren().OfType<Node3D>().ToArray())
                foreach (var (what, match) in LeftoverSnapshots)
                {
                    if (!match(snapshot) || what == "soot sheet" && Scheldemist.Main.I.Flag("keep-soot")) continue;
                    snapshot.Visible = false;
                    foreach (var child in All(snapshot)) child.SetMeta("native_replaced_event_snapshot", true);
                    leftoverCounts[what] = leftoverCounts.GetValueOrDefault(what) + 1;
                    break;
                }
        int sootSnapshots = leftoverCounts.GetValueOrDefault("soot sheet");
        // The bake also kept the horse model parts the pool's copies were made from (second "horses" group: whole mesh parts at the
        // origin, legs hanging below the quay). The pool draws its own copies; the template stays on disk but never shows.
        int horseTemplates = 0;
        foreach (var template in town.GetChildren().OfType<Node3D>().Where(n => n.HasMeta("source_name") && n.GetMeta("source_name").AsString() == "horses"
            && n.GetChildren().OfType<MeshInstance3D>().Any(m => m.Name == "horse_body")).ToArray())
        {
            template.Visible = false;
            foreach (var child in All(template)) child.SetMeta("native_replaced_event_snapshot", true);
            horseTemplates++;
        }
        // The Werf's ground chunk hangs a kerb and an apron out over the water, over the inner treads of its stone flight (issue 68).
        // Its footprint is cut out of the mesh, so what is drawn, what is walked on and what is solid agree with the steps.
        // (dev: --no-werf-cut leaves the ground as the bake has it, for a before-and-after)
        // The Ruien's gates (docs/ruien-native.md): each area's outlet is cut through its quay wall here, before collision
        // and navigation read the meshes. (dev: --no-ruien-gates leaves the walls whole, for a before-and-after)
        loadTrace?.Next("snapshots");
        int werfCut = NativeCutCache.Run(town, !Scheldemist.Main.I.Flag("no-werf-cut"), !Scheldemist.Main.I.Flag("no-ruien-gates"), note => GD.Print("ruien: " + note));
        // (the Ruien's own pieces need nothing more of the town: they are built beside the rest of it from here)
        Scheldemist.Main.I.StreetCutsDone();
        // Issue #176: the shutters, copies of one model per kind where the bake's flat boards stood (before the razed houses' cut, which takes theirs)
        loadTrace?.Next("street-cuts");
        Report["shutterCopies"] = NativeShutters.Install(town, Scheldemist.Main.I.Arg("shutters-file") is { Length: > 0 } shutterFile ? shutterFile : null);
        // Houses pulled down after the bake (city_build.json "razed"): cut out before collision and navigation read the meshes.
        // (dev: --keep-razed leaves them standing, for a before-and-after; those the razed bake took out of the resources stay gone, #230)
        if (Scheldemist.Main.I.Flag("keep-razed") && Godot.FileAccess.FileExists(NativeRazedHouses.BakedFile)) GD.Print("razed houses: --keep-razed: the houses in razed-baked.json are baked out of the resources and stay gone");
        loadTrace?.Next("shutters");
        razed = Scheldemist.Main.I.Flag("keep-razed") ? new NativeRazedHouses.Result(0, 0, 0, Array.Empty<string>()) : NativeRazedHouses.Cut(town, Scheldemist.Paths.Shared("city_build.json"));
        foreach (var note in razed.Notes) GD.Print("razed houses: " + note);
        // (their roofs gone from the sky map too: the cleared ground is no longer in their shadow)
        loadTrace?.Next("razed");
        int roofPixels = 0;
        foreach (var outline in razed.Razed)
        {
            var lo = outline.Aggregate((a, b) => new Vector2(Math.Min(a.X, b.X), Math.Min(a.Y, b.Y))); var hi = outline.Aggregate((a, b) => new Vector2(Math.Max(a.X, b.X), Math.Max(a.Y, b.Y)));
            roofPixels += Psx.ClearRoofs(new Rect2(lo, hi - lo).Grow(1.2f), p => razed.Owned(p.X, p.Y));
        }
        Report["razedRoofPixels"] = roofPixels;
        // Issue #174: the shop fronts, the shop windows with their goods, the front doors (none on a razed house)
        loadTrace?.Next("roofs");
        Report["shopFronts"] = NativeShopFronts.Install(town, razed, Scheldemist.Main.I.Arg("shopfronts-file") is { Length: > 0 } shopFile ? shopFile : null);
        // The corner they leave gets a lime and a bench (only when the cut happened, so a re-baked town shows no tree in a house).
        loadTrace?.Next("shop-fronts");
        var dressing = razed.Houses > 0 ? NativeRazedHouses.Dress(town) : Array.Empty<string>();
        // The squares the razing opened, made to read as 1873 ground with its houses just gone: the mud mask redrawn on the
        // plots, the neighbours' bared walls (brick, the ghost of the house, its anchors), the pump, guard stones and the
        // things that need no pack (art-source/square-mood-20261027). (dev: --no-square-dressing, for a before-and-after)
        loadTrace?.Next("razed-dress");
        if (razed.Houses > 0 && !Scheldemist.Main.I.Flag("no-square-dressing") && NativeSquareDressing.Read() is { } squares)
        {
            var squareClock = System.Diagnostics.Stopwatch.StartNew();
            squarePlan = squares;
            Report["squareGroundPixels"] = NativeSquareDressing.Ground(squares, razed, Path.Combine(Scheldemist.Paths.NativeDataRoot!, "maps"));
            using var squareTrace=Scheldemist.Dev.StartupTiming.Split("native.square");
            var (bared, bricked, ghostDecals, anchors) = NativeSquareDressing.Walls(town, NativeSquareDressing.Bared(razed, Scheldemist.Paths.Shared("city_build.json")));
            Report["squareBaredWalls"] = bared; Report["squareBrickedTriangles"] = bricked; Report["squareGhostDecals"] = ghostDecals; Report["squareAnchors"] = anchors;
            squareTrace?.Next("walls");
            Report["squareThingsInstalled"] = NativeSquareDressing.Install(town, squares);
            squareTrace?.Next("install");
            GD.Print($"square dressing: {bared} bared walls, {bricked} wall triangles bricked, {ghostDecals} ghost decals, {anchors} anchors in {squareClock.ElapsedMilliseconds} ms");
        }
        // St James's churchyard made larger over the razed plots east of it: its graves, vaults, railing and walks; the old
        // plots' dividing rail and the ground over the vault stair cut away (before collision and the walk map read the town)
        // (dev: --no-churchyard leaves the yard as baked, for a before-and-after)
        loadTrace?.Next("square");
        if (razed.Houses > 0 && !Scheldemist.Main.I.Flag("no-churchyard"))
        {
            var churchyard = NativeChurchyard.Install(town);
            foreach (var note in churchyard.Notes) GD.Print("churchyard: " + note);
            Report["churchyardItems"] = churchyard.Items; Report["churchyardBoxes"] = churchyard.Boxes;
            Report["churchyardRailTriangles"] = churchyard.RailTriangles; Report["churchyardGroundCut"] = churchyard.GroundTriangles; Report["churchyardStreetCleared"] = churchyard.Cleared;
        }
        // #224 #227: the churches' model faults dressing cannot hide: Sint-Paulus' flat north door, Sint-Jacob's sharp wall top
        // (dev: --no-church-repairs leaves them as baked)
        loadTrace?.Next("churchyard");
        if (!Scheldemist.Main.I.Flag("no-church-repairs"))
        {
            var (repairDoors, repairCopings) = NativeChurchRepairs.Install(town);
            Report["churchRepairDoors"] = repairDoors; Report["churchRepairCopings"] = repairCopings;
            GD.Print($"church repairs: {repairDoors} door, {repairCopings} coping stones");
        }
        // #260: the cathedral towers' tall openings filled as the real towers' are: gratings with a stone wall and small windows
        // behind on the lower stages, oak louvre boards on the bell stage and the clock octagon (dev: --open-cathedral-towers
        // leaves them open, as baked)
        loadTrace?.Next("church-repairs");
        if (!Scheldemist.Main.I.Flag("open-cathedral-towers"))
        {
            var towers = NativeCathedralTowers.Install(town);
            Report["cathedralTowerGratings"] = towers.Gratings; Report["cathedralTowerLouvres"] = towers.Louvres;
            Report["cathedralTowerLeadRemoved"] = towers.LeadRemoved; Report["cathedralTowerTriangles"] = towers.Triangles;
            GD.Print($"cathedral towers: {towers.Gratings} gratings, {towers.Louvres} louvred openings, {towers.LeadRemoved} lead louvre triangles out, {towers.Triangles} triangles");
        }
        // #244: the planted beds' and the liberty tree's bare earth in the tree pits' soil (dev: --keep-old-dirt leaves them)
        loadTrace?.Next("towers");
        if (Scheldemist.Main.I?.Flag("keep-old-dirt") != true) Report["dirtBeds"] = NativeDirt.Lay(town);
        // #218: the last eight bare downpipe feet get a blue-stone channel stone to the kerb (dev: --no-pipe-ends leaves them bare)
        if (Scheldemist.Main.I?.Flag("no-pipe-ends") != true) Report["pipeEnds"] = NativePipeEnds.Lay(town);
        // (the street's ground drawn under the joins' new gutters and the pits' sunken earth, in one pass: NativePlanCut)
        loadTrace?.Next("dirt-pipes");
        Report["groundPlanCut"] = NativePlanCut.CutQueuedGround(town);
        // The bake's plain benches give way to the new bench models, turned and placed as they stood (#165).
        // (dev: --keep-old-benches leaves them, for a before-and-after)
        loadTrace?.Next("plan-cut");
        if (!Scheldemist.Main.I.Flag("keep-old-benches"))
        {
            var benchClock = System.Diagnostics.Stopwatch.StartNew();
            var benches = NativeBenches.Swap(town, System.IO.Path.Combine(Scheldemist.Paths.NativeDataRoot ?? "", "services", "native-rules.json"));
            foreach (var note in benches.Notes) GD.Print("benches: " + note);
            GD.Print($"benches: swapped in {benchClock.ElapsedMilliseconds} ms");
            Report["benchesSwapped"] = benches.Swapped; Report["benchTrianglesCut"] = benches.Triangles;
        }
        // #149 #160: the kit's cast-iron pumps and cellar hatches where the bake's old ones stood (their old boxes are gone from the
        // street-life meshes); the courts' old pump copies hidden. (dev: --street-furniture-file <plan>)
        loadTrace?.Next("benches");
        var furniture = NativeStreetFurniture.Install(town, Scheldemist.Main.I.Arg("street-furniture-file") is { Length: > 0 } furnitureFile ? furnitureFile : null);
        Report["streetPumps"] = furniture.Pumps; Report["cellarHatches"] = furniture.Hatches; Report["oldCourtPumpsHidden"] = furniture.OldCourtPumps;
        // The bake's plain hiring board gives way to the authored one, where the notes hang (#153).
        loadTrace?.Next("furniture");
        Report["oldHiringBoards"] = NativeWorkBoard.Retire(town);
        // The baked quay ladders ran through the coping and into the stone (issue 85): the native ladder replaces them.
        loadTrace?.Next("work-board");
        var ladders = Scheldemist.Native.World.NativeQuayLadders.Install(town);
        quayLadders = ladders.Ladders;
        foreach (var note in ladders.Notes) GD.Print("quay ladders: " + note);
        loadTrace?.Next("ladders");
        AddChild(town);
        // Static room portraits are source snapshots, never a second resident model. The Vleeshuis's
        // recovered figures (old kit, #178) give way to its live hall workers (HallPeople, people2).
        loadTrace?.Next("add-town");
        int roomPeople=0;
        foreach(var skeleton in All(town).OfType<Skeleton3D>())
        {
            bool room=false;for(Node? n=skeleton.GetParent();n!=null;n=n.GetParent())
                if(n.Name.ToString().StartsWith("ROOM_tavern_")||n.Name.ToString().StartsWith("ROOM_shop_")||n.Name.ToString()=="ROOM_vleeshuis"){room=true;break;}
            if(!room||skeleton.GetParent() is not Node3D model)continue;
            model.Visible=false;roomPeople++;
            foreach(var player in All(model).OfType<AnimationPlayer>()){player.Autoplay="";player.Stop();}
            foreach(var mesh in All(model).OfType<GeometryInstance3D>())mesh.Visible=false;
            foreach(var n in All(model)){n.SetMeta("native_replaced_event_snapshot",true);if(n is CollisionObject3D body){body.CollisionLayer=0;body.CollisionMask=0;}}
        }
        loadTrace?.Next("room-people");
        Report["hiddenRoomPeopleSnapshots"]=roomPeople;
        // #187: a bake figure sat on or stood at a bench (the Steen's sailor) stays there frozen while the town's live people sit
        // and sleep on the new benches: it goes. (The bus stops' waiters are the movers' own, live_waiters, and not baked.)
        var benchSpots=All(town).OfType<Node3D>().Where(n=>n.HasMeta(NativeBenches.SleepMeta)).Select(n=>InTown(n,town).Origin).ToArray();
        int benchPeople=0;
        foreach(var skeleton in All(town).OfType<Skeleton3D>().ToArray())
        {
            if(skeleton.GetParent() is not Node3D model||!model.Visible||model.HasMeta("native_replaced_event_snapshot"))continue;
            var at=InTown(model,town).Origin;
            if(!benchSpots.Any(b=>new Vector2(b.X-at.X,b.Z-at.Z).Length()<1.2f&&Math.Abs(b.Y-at.Y)<1.5f))continue;
            model.Visible=false;benchPeople++;
            foreach(var n in All(model)){n.SetMeta("native_replaced_event_snapshot",true);if(n is CollisionObject3D body){body.CollisionLayer=0;body.CollisionMask=0;}}
        }
        loadTrace?.Next("bench-people");
        Report["hiddenBenchPeopleSnapshots"]=benchPeople;

        Report["werfStepsCutTriangles"] = werfCut;
        Report["razedHouses"] = razed.Houses;
        Report["razedTriangles"] = razed.Triangles;
        Report["razedWindowGlows"] = razed.WindowGlows;
        Report["razedCornerDressing"] = string.Join(", ", dressing);
        Report["source"] = "complete native Godot town";
        Report["quayLadders"] = ladders.Ladders.Count;
        Report["quayLadderMeshes"] = ladders.Meshes;
        Report["quayLadderOldTriangles"] = ladders.RemovedTriangles;
        Report["quayLadderMs"] = ladders.Ms;
        Report["sourceSha256"] = intake["sourceSha256"]!.GetValue<string>();
        Report["authoredObjects"] = Layouts.ObjectCount;
        Report["districts"] = Layouts.Districts.Count;
        Report["replacedEventSnapshots"] = eventSnapshots;
        Report["hiddenHorseTemplates"] = horseTemplates;
        Report["hiddenSootSnapshots"] = sootSnapshots;
        Report["hiddenLeftoverSnapshots"] = leftoverCounts.Values.Sum();
        Report["hiddenLeftoverSnapshotKinds"] = string.Join(", ", leftoverCounts.Select(c => c.Value + " " + c.Key));
        Timing("world geometry ready");
        if (Scheldemist.Main.I.Flag("startup-proof")) GD.Print("town digest: " + Digest(town));
        Stage = "done";
        return Error.Ok;
    }
    /// <summary>
    /// The cuts made before the razed houses' (the Werf's notch, the Ruien gates); the razed promote (scripts/RazedPromote.cs)
    /// runs them too, to leave the meshes they change for the start. Returns the Werf's triangles cut.
    /// </summary>
    internal static int CutBeforeRazing(Node3D town, bool werf, bool gates, Action<string> note)
    {
        int werfCut = werf ? QuayNotch.Cut(town, "city_-4_0_3", QuayExits.WerfFrame, QuayExits.WerfNotchS0, QuayExits.WerfNotchS1, QuayExits.WerfNotchU0, QuayExits.WerfNotchU1) : 0;
        if (gates) foreach (var line in Scheldemist.World.Ruien.RuienGates.Cut(town)) note(line);
        return werfCut;
    }
    /// <summary>The proof's digest of the built town: every node's path, kind and place, each mesh's surfaces and bounds,
    /// each copy set's count and bounds (automatic node names left out).</summary>
    private static string Digest(Node3D town)
    {
        using var hash = System.Security.Cryptography.IncrementalHash.CreateHash(System.Security.Cryptography.HashAlgorithmName.SHA256);
        int nodes = 0;
        foreach (var n in All(town))
        {
            nodes++;
            string line = System.Text.RegularExpressions.Regex.Replace(town.GetPathTo(n).ToString(), @"@(\w+)@\d+", "@$1@") + " " + n.GetClass();
            if (n is Node3D n3) line += " " + n3.Transform + (n3.Visible ? "" : " hidden");
            if (n is MeshInstance3D { Mesh: { } m }) line += " " + m.GetSurfaceCount() + " " + m.GetAabb();
            if (n is MultiMeshInstance3D { Multimesh: { } mm }) line += " " + mm.InstanceCount + " " + mm.GetAabb() + " " + (mm.Mesh?.GetAabb().ToString() ?? "");
            hash.AppendData(System.Text.Encoding.UTF8.GetBytes(line + "|"));
        }
        return $"{nodes} nodes, {Convert.ToHexString(hash.GetHashAndReset())[..16]}";
    }

    public override void _Ready()
    {
        using var readyTrace=Scheldemist.Dev.StartupTiming.Split("native.ready");
        // #160 #164: the horse troughs and the washing on its lines and poles (the pack's materials are made on this thread)
        var washing = NativeStreetFurniture.Dress(town, Scheldemist.Main.I.Arg("street-furniture-file") is { Length: > 0 } washingFile ? washingFile : null);
        Report["troughs"] = washing.Troughs; Report["washingLines"] = washing.Lines; Report["washingPieces"] = washing.Pieces; Report["washingPegs"] = washing.Pegs; Report["washPoles"] = washing.Poles;
        readyTrace?.Next("washing");
        if (squarePlan != null) Report["squareThingsDressed"] = NativeSquareDressing.Dress(town, squarePlan);
        readyTrace?.Next("square-dress");
        if(!Scheldemist.Main.I.Flag("no-ruien-entrances")) Report["entrancePlantsClearedAfterDressing"] = Scheldemist.World.Ruien.RuienEntrance.ClearPlants(town);
        // Authored objects arrive with editor materials, which the game's fog and light never reach (issue 79).
        readyTrace?.Next("entrance-plants");
        var authoredMaterials = new NativeTownMaterials(); authoredMaterials.Apply(town);
        Report["authoredMaterialsSwapped"] = authoredMaterials.Swapped; Report["authoredMaterialsLeft"] = authoredMaterials.Left;
        readyTrace?.Next("materials");
        // The baked wall lamps are marked hidden at source; nothing else draws them, so the wall lights floated without lamps.
        if (town.GetNodeOrNull<Node3D>("wall_lamps") is { } wallLamps)
            foreach (var wallLamp in wallLamps.GetChildren().OfType<Node3D>()) wallLamp.Visible = true;
        var wallChunks = new NativeWallChunks { Name = "wall_chunk_culling" }; wallChunks.Collect(All(town)); AddChild(wallChunks);
        // Issue #188: every block's near-only detail, within its near range (dev: --no-near-detail keeps the bake's state)
        if (!Scheldemist.Main.I.Flag("no-near-detail"))
        {
            var (detailMeshes, detailHidden, detailSolid, detailHigh) = NativeNearDetail.Apply(All(town));
            Report["nearDetailMeshes"] = detailMeshes; Report["nearDetailWereHidden"] = detailHidden;
            Report["nearDetailSolidTriangles"] = detailSolid; Report["nearDetailOutOfReachTriangles"] = detailHigh;
        }
        readyTrace?.Next("near-detail");
        var registered = new HashSet<ulong>();
        foreach (var node in All(town))
        {
            if (node is StaticBody3D body) { body.CollisionLayer = node.HasMeta("native_replaced_event_snapshot") || node.HasMeta("native_replaced_visual") ? 0 : Solid.Layer; body.CollisionMask = 0; }
            if (node is CollisionShape3D shape && node.HasMeta("native_replaced_event_snapshot")) shape.Disabled = true;
            if (node is AuthoredObject authored) authored.SetMeta("native_collision", true);
            if (node is WorkshopLamp lamp)
            {
                lamp.SetNight(true);
                if (lamp.GetNodeOrNull<OmniLight3D>("Light") is { } light) { light.Visible = false; light.SetMeta("native_preview_only", true); }
            }
            // Each editable lamp must own its changing glass/flame material, even when all copies share a mesh.
            if (node is AuthoredObject lampObject)
                foreach (var mesh in All(lampObject).OfType<MeshInstance3D>().Where(m => m.Mesh != null))
                    for (int surface = 0; surface < mesh.Mesh!.GetSurfaceCount(); surface++)
                        if (mesh.GetActiveMaterial(surface) is ShaderMaterial material && material.ResourceName is "glass" or "flame")
                            mesh.SetSurfaceOverrideMaterial(surface, (Material)material.Duplicate());
            var nativeMesh = (node as MeshInstance3D)?.Mesh ?? (node as MultiMeshInstance3D)?.Multimesh?.Mesh;
            if (nativeMesh == null) continue;
            if (nativeMesh.GetSurfaceCount() == 0 && node is GeometryInstance3D empty) empty.Visible = false;
            for (int i = 0; i < nativeMesh.GetSurfaceCount(); i++)
            {
                if (nativeMesh.SurfaceGetMaterial(i) is not ShaderMaterial material) continue;
                var shader = material.Shader;
                if (shader.HasMeta("native_psx_kind") && registered.Add(shader.GetInstanceId()))
                    Psx.RegisterNative(shader, JsonSerializer.Deserialize<Psx.Kind>(shader.GetMeta("native_psx_kind").AsString()));
            }
        }
        readyTrace?.Next("register-materials-collision");
        Solid.Leave.Add(n => n.HasMeta("native_author_district"));
        Solid.Leave.Add(n => n.HasMeta("native_replaced_event_snapshot"));
        Solid.Leave.Add(n => n.HasMeta(Scheldemist.Native.World.NativeQuayLadders.LeaveMeta));
        Solid.Leave.Add(n => n.HasMeta(NativeRazedHouses.DressingMeta));
        Solid.Leave.Add(n => n.HasMeta(NativeChurchyard.Meta));
        Solid.Leave.Add(n => n.HasMeta(NativeNearDetail.NoCollision));
        Solid.Leave.Add(n => n.HasMeta(NativeBenches.SwapMeta));
        Solid.Leave.Add(n => n.HasMeta(NativeStreetFurniture.Meta));
        Solid.Leave.Add(n => n.HasMeta(NativeSquareDressing.Meta));
        Solid.Leave.Add(n => n.HasMeta(NativeChurchRepairs.Meta));
        Solid.Leave.Add(n => n.HasMeta(NativeCathedralTowers.Meta));
        Report["benches"] = NativeBenches.Index(town);
        readyTrace?.Next("bench-index");
        BuildLights();
        readyTrace?.Next("lights");
    }
    private void BuildLights()
    {
        var data = JsonNode.Parse(Godot.FileAccess.GetFileAsString(Root + "/lights.json"))!;
        var (razedSpill, razedPanes) = NativeRazedHouses.DropLights(razed, data.AsObject());
        Report["razedLightSpill"] = razedSpill; Report["razedLitPanes"] = razedPanes;
        var spill = data["spill"]!.AsArray();
        var template = spill.First(s => s!["kind"]!.GetValue<string>() == "lamp")!.DeepClone();
        var review = Layouts.Districts.Single(d => d.District.Id == NativeDistrictLayouts.ReviewedDistrict);
        var bounds = review.District.Bounds;
        // The six source lamps in this reviewed patch were replaced by the authored complete layout.
        data["spill"] = new JsonArray(spill.Where(s => s!["kind"]!.GetValue<string>() != "lamp" || !bounds.HasPoint(new Vector2(s["at"]![0]!.GetValue<float>(), s["at"]![2]!.GetValue<float>()))).Select(s => s!.DeepClone()).ToArray());
        foreach (var district in Layouts.Districts)
            foreach (var authored in district.Objects.GetChildren().OfType<AuthoredObject>())
                if (All(authored).OfType<WorkshopLamp>().FirstOrDefault()?.GetNodeOrNull<OmniLight3D>("Light") is { } light)
                {
                    var source = template.DeepClone(); var p = light.GlobalPosition;
                    source["at"] = new JsonArray(p.X, p.Y, p.Z);
                    source["id"] = "authored:" + district.District.Id + "/" + authored.ObjectId;
                    source["label"] = "authored gas lamp " + district.District.Id + "/" + authored.ObjectId;
                    data["spill"]!.AsArray().Add(source);
                }
        LampFacts = new JsonArray(data["spill"]!.AsArray().Where(s => s!["kind"]!.GetValue<string>() == "lamp")
            .Select(s => {
                string label = s!["label"]!.GetValue<string>();
                string id = s["id"]?.GetValue<string>() ?? (label.StartsWith("gas lamp ", StringComparison.Ordinal) ? label[9..] : "");
                return new JsonObject { ["id"] = id, ["x"] = s["at"]![0]!.DeepClone(), ["y"] = s["at"]![1]!.DeepClone(), ["z"] = s["at"]![2]!.DeepClone(), ["hung"] = s["power"]!.GetValue<double>() <= 9 };
            }).Where(l => l["id"]!.GetValue<string>() != "").Select(l => (JsonNode)l).ToArray());
        lights = JsonDocument.Parse(data.ToJsonString());
    }
    public override float[]? Attribute(string name, string attr, int nth = 0)
    {
        var row = attributes.FirstOrDefault(n => n!["node"]!.GetValue<string>() == name && n["attribute"]!.GetValue<string>() == attr && n["nth"]!.GetValue<int>() == nth);
        if (row == null) return null;
        var bytes = Godot.FileAccess.GetFileAsBytes(row["path"]!.GetValue<string>());
        var floats = new float[bytes.Length / 4]; Buffer.BlockCopy(bytes, 0, floats, 0, bytes.Length); return floats;
    }
}
