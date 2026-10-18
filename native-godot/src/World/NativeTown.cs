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
    public override IReadOnlyList<QuayExits.Ladder>? NativeQuayLadders => quayLadders;
    public override Scheldemist.Town.WalkMap? NativeWalk
    {
        get
        {
            if (walk == null) { walk = NativeWorldNavigation.Build(town, new Rect2(-480, -80, 820, 560)); Ways.InstallNative(walk, null, Ways.ReadHouseFootprints(Paths.Shared("city_build.json"))); }
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
        Stage = "read";
        Facts = JsonDocument.Parse(Godot.FileAccess.GetFileAsString(Root + "/facts.json"));
        attributes = JsonNode.Parse(Godot.FileAccess.GetFileAsString(Root + "/attributes.json"))!.AsArray();
        var intake = JsonNode.Parse(Godot.FileAccess.GetFileAsString(Root + "/intake.json"))!;
        foreach (var note in intake["unported"]!.AsArray()) Unported.Add(note!.GetValue<string>());
        Psx.LoadShared(Path.Combine(Scheldemist.Paths.NativeDataRoot!, "maps"));
        Stage = "build";
        town = ResourceLoader.Load<PackedScene>(Root + "/scene.tscn").Instantiate<Node3D>();
        Layouts = NativeDistrictLayouts.Apply(town);
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
        int werfCut = Scheldemist.Main.I.Flag("no-werf-cut") ? 0 : QuayNotch.Cut(town, "city_-4_0_3", QuayExits.WerfFrame, QuayExits.WerfNotchS0, QuayExits.WerfNotchS1, QuayExits.WerfNotchU0, QuayExits.WerfNotchU1);
        // Houses pulled down after the bake (city_build.json "razed"): cut out before collision and navigation read the meshes.
        // (dev: --keep-razed leaves them standing, for a before-and-after)
        razed = Scheldemist.Main.I.Flag("keep-razed") ? new NativeRazedHouses.Result(0, 0, 0, Array.Empty<string>()) : NativeRazedHouses.Cut(town, Scheldemist.Paths.Shared("city_build.json"));
        foreach (var note in razed.Notes) GD.Print("razed houses: " + note);
        // The corner they leave gets a lime and a bench (only when the cut happened, so a re-baked town shows no tree in a house).
        var dressing = razed.Houses > 0 ? NativeRazedHouses.Dress(town) : Array.Empty<string>();
        // The bake's plain benches give way to the new bench models, turned and placed as they stood (#165).
        // (dev: --keep-old-benches leaves them, for a before-and-after)
        if (!Scheldemist.Main.I.Flag("keep-old-benches"))
        {
            var benchClock = System.Diagnostics.Stopwatch.StartNew();
            var benches = NativeBenches.Swap(town, System.IO.Path.Combine(Scheldemist.Paths.NativeDataRoot ?? "", "services", "native-rules.json"));
            foreach (var note in benches.Notes) GD.Print("benches: " + note);
            GD.Print($"benches: swapped in {benchClock.ElapsedMilliseconds} ms");
            Report["benchesSwapped"] = benches.Swapped; Report["benchTrianglesCut"] = benches.Triangles;
        }
        // The baked quay ladders ran through the coping and into the stone (issue 85): the native ladder replaces them.
        var ladders = Scheldemist.Native.World.NativeQuayLadders.Install(town);
        quayLadders = ladders.Ladders;
        foreach (var note in ladders.Notes) GD.Print("quay ladders: " + note);
        AddChild(town);
        // Static room portraits are source snapshots, never a second resident model. The Vleeshuis's
        // recovered figures (old kit, #178) give way to its live hall workers (HallPeople, people2).
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
        Report["hiddenRoomPeopleSnapshots"]=roomPeople;

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
        Stage = "done";
        return Error.Ok;
    }
    public override void _Ready()
    {
        // Authored objects arrive with editor materials, which the game's fog and light never reach (issue 79).
        var authoredMaterials = new NativeTownMaterials(); authoredMaterials.Apply(town);
        Report["authoredMaterialsSwapped"] = authoredMaterials.Swapped; Report["authoredMaterialsLeft"] = authoredMaterials.Left;
        // The baked wall lamps are marked hidden at source; nothing else draws them, so the wall lights floated without lamps.
        if (town.GetNodeOrNull<Node3D>("wall_lamps") is { } wallLamps)
            foreach (var wallLamp in wallLamps.GetChildren().OfType<Node3D>()) wallLamp.Visible = true;
        var wallChunks = new NativeWallChunks { Name = "wall_chunk_culling" }; wallChunks.Collect(All(town)); AddChild(wallChunks);
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
        Solid.Leave.Add(n => n.HasMeta("native_author_district"));
        Solid.Leave.Add(n => n.HasMeta("native_replaced_event_snapshot"));
        Solid.Leave.Add(n => n.HasMeta(Scheldemist.Native.World.NativeQuayLadders.LeaveMeta));
        Solid.Leave.Add(n => n.HasMeta(NativeRazedHouses.DressingMeta));
        Solid.Leave.Add(n => n.HasMeta(NativeBenches.SwapMeta));
        Report["benches"] = NativeBenches.Index(town);
        BuildLights();
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
