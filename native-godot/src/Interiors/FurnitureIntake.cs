using System;
using System.Collections.Generic;
using System.Linq;
using System.IO;
using System.Text.Json;
using System.Text.RegularExpressions;
using Godot;
using Scheldemist.Native.Authoring;
using Scheldemist.World;
namespace Scheldemist.Native.Interiors;

// Explicit one-time authoring command. Never called by game startup.
public partial class FurnitureIntake : Node
{
    private sealed class Piece
    {
        public string Id="",Kind="fitting"; public Vector3 At; public float Yaw;
        public Aabb Region; public readonly List<Vector3> Seats=new(); public float Height=.46f, SeatYaw; public int Table=-1;
        public Vector3 Use, Stand; public readonly List<Part> Parts=new();
    }
    private sealed record Part(MeshInstance3D Source,int Surface,int[] Indices,Transform3D Transform,Aabb Bounds);
    private static string Slug(string value)=>Regex.Replace(value,"[^a-zA-Z0-9_-]","-").ToLowerInvariant();
    public override void _Ready()
    {
        try { if(Scheldemist.Native.Game.NativeArguments.Arg("runtime-map-seeds")=="yes")RuntimeMapSeeds();else if(Scheldemist.Native.Game.NativeArguments.Arg("repair-structures")=="yes")RepairStructures();else Run(); GetTree().Quit(); } catch(Exception e) { GD.PrintErr(e);GetTree().Quit(1); }
    }
    private static void RuntimeMapSeeds()
    {
        foreach(var district in Native.World.NativeDistrictLayouts.Available())
        {
            if(district.EditorScenePath=="")district.EditorScenePath=district.Scene.ResourcePath;
            var seed=Native.World.NativeDistrictLayouts.ReadSeed(district);
            string path=(district.RoomId!=""?Native.World.NativeDistrictLayouts.InteriorDirectory:Native.World.NativeDistrictLayouts.DistrictDirectory)+"/"+district.Id+".objects.tscn";
            district.Scene=SaveNativeScene(seed,path);seed.Free();Must(ResourceSaver.Save(district,district.ResourcePath));
        }
        GD.Print("Runtime object seeds prepared; owner preview paths are strings, not player resource dependencies.");
    }
    private static void RepairStructures()
    {
        const string receipt="res://world/interiors/structure-repair.json";
        if(Godot.FileAccess.FileExists(receipt))throw new InvalidOperationException("Structural repair already exists; preserve the repaired geometry and ids.");
        var notes=new List<object>();
        foreach(var room in Native.World.NativeDistrictLayouts.Available().Where(r=>r.RoomId!=""))
        {
            var seed=Native.World.NativeDistrictLayouts.ReadSeed(room);var structure=room.RetainedStructure!.Instantiate<Node3D>();bool changed=false;
            foreach(var obj in seed.GetChildren().OfType<AuthoredObject>())
            {
                var asset=obj.Asset!;if(!asset.Id.StartsWith(room.Id+"-",StringComparison.Ordinal))continue;
                if(asset.Footprint.X<=4&&asset.Footprint.Z<=4&&asset.Footprint.Y<=3.5f&&asset.FootprintOffset.Y>=-.3f)continue;
                var model=asset.Scene!.Instantiate<FurnitureVisual>();var keep=new List<Part>();var architecture=new List<Part>();
                foreach(var mesh in BakedWorld.All(model).OfType<MeshInstance3D>().Where(m=>m.Mesh is ArrayMesh))
                    for(int surface=0;surface<mesh.Mesh!.GetSurfaceCount();surface++)
                        foreach(var part in Components(mesh,surface,TransformOf(mesh,model)))
                        {
                            var b=part.Bounds;string name=mesh.Mesh.SurfaceGetMaterial(surface)?.ResourceName??"";
                            bool fixedGeometry=Regex.IsMatch(name,"stair|floor|ceil|roof|dado|wainscot|panell?ing|h_beam|cf_beam",RegexOptions.IgnoreCase)
                                ||Math.Max(b.Size.X,b.Size.Z)>8&&b.Size.Y>.25f
                                ||b.Size.X>room.RoomBounds.Size.X*.82f&&b.Size.Z>room.RoomBounds.Size.Y*.82f&&b.Size.Y>.25f
                                ||b.Position.Y<-.3f&&b.Size.Y>2;
                            (fixedGeometry?architecture:keep).Add(part);
                        }
                if(architecture.Count==0){model.Free();continue;}
                foreach(var part in architecture)AddPart(structure,part,obj.Transform);
                var removed=model.GetChildren().Where(n=>n is MeshInstance3D or CollisionObject3D).ToArray();
                foreach(var child in removed)model.RemoveChild(child);
                foreach(var part in keep)AddPart(model,part,Transform3D.Identity);
                if(keep.Count>0)
                {
                    var box=keep.Select(p=>p.Bounds).Aggregate((a,b)=>a.Merge(b));var size=box.Size.Max(new Vector3(.04f,.04f,.04f));
                    model.ModelSize=asset.Footprint=size;model.ModelOffset=asset.FootprintOffset=new(box.GetCenter().X,box.Position.Y,box.GetCenter().Z);
                    var body=new StaticBody3D{Name="Solid",CollisionLayer=2,CollisionMask=0};body.AddChild(new CollisionShape3D{Name="Shape",Shape=new BoxShape3D{Size=size},Position=box.GetCenter()});model.AddChild(body);Batch(model);
                }
                else
                {
                    model.Kind=asset.FurnitureKind="architecture-marker";asset.Footprint=new(.04f,.04f,.04f);asset.FootprintOffset=Vector3.Zero;asset.SeatPoints=Array.Empty<Vector3>();
                    asset.Title="Architecture marker · "+room.RoomId+" · "+obj.ObjectId;
                }
                foreach(var child in removed)child.Free();
                string path=asset.Scene.ResourcePath;asset.Scene=SaveNativeScene(model,path);model.Free();ResourceSaver.Save(asset,asset.ResourcePath);
                notes.Add(new{asset=asset.Id,triangles=architecture.Sum(p=>p.Indices.Length/3),marker=keep.Count==0});changed=true;
            }
            if(changed){Batch(structure);SaveNativeScene(structure,room.RetainedStructure.ResourcePath);}
            structure.Free();seed.Free();GD.Print("structural repair "+room.Id);
        }
        File.WriteAllText(ProjectSettings.GlobalizePath(receipt),JsonSerializer.Serialize(notes,new JsonSerializerOptions{WriteIndented=true})+"\n");
    }
    private static PackedScene SaveNativeScene(Node3D node,string path)
    {
        foreach(var child in BakedWorld.All(node).Where(n=>n!=node))child.Owner=node;
        var scene=new PackedScene();Must(scene.Pack(node));Must(ResourceSaver.Save(scene,path));scene.TakeOverPath(path);return scene;
    }
    private void Run()
    {
        if(Godot.FileAccess.FileExists("res://world/interiors/conversion.json"))
            throw new InvalidOperationException("Room conversion already exists. Repair its referenced asset scenes without regenerating permanent ids.");
        var town=ResourceLoader.Load<PackedScene>("res://world/town/scene.tscn").Instantiate<Node3D>();
        using var places=JsonDocument.Parse(Godot.FileAccess.GetFileAsString("res://assets/places.json"));
        var catalogs=new List<AuthorAsset>(); var report=new List<object>();
        foreach(var room in town.GetChildren().OfType<Node3D>().Where(r=>r.Name.ToString().StartsWith("ROOM_") && (Scheldemist.Native.Game.NativeArguments.Arg("intake-room")=="" || r.Name.ToString()==Scheldemist.Native.Game.NativeArguments.Arg("intake-room"))))
        {
            string roomId=room.GetMeta("extras").AsGodotDictionary()["room"].AsGodotDictionary()["id"].AsString(), id="room-"+Slug(roomId);
            var pieces=new List<Piece>(); Transform3D frame=Transform3D.Identity; Rect2 bounds=default; float top=3;
            var counter=places.RootElement.GetProperty("counters").EnumerateArray().FirstOrDefault(c=>c.GetProperty("id").GetString()==roomId);
            var home=places.RootElement.GetProperty("homes").EnumerateArray().FirstOrDefault(c=>"home:"+c.GetProperty("id").GetString()==roomId);
            if(counter.ValueKind!=JsonValueKind.Undefined)
            {
                float yaw=F(counter,"yaw"), floor=F(counter,"floor_y"); var o=counter.GetProperty("origin");frame=new(Basis.FromEuler(new(0,yaw,0)),new(F(o,"x"),floor,F(o,"z")));
                var r=counter.GetProperty("rect"); bounds=new(F(r,"minX"),F(r,"minZ"),F(r,"maxX")-F(r,"minX"),F(r,"maxZ")-F(r,"minZ"));
                var seats=counter.GetProperty("seats").EnumerateArray().ToArray();
                // A pair of seats on the same narrow taproom bench stays one physical object.
                var used=new HashSet<int>();
                for(int i=0;i<seats.Length;i++)
                {
                    if(used.Contains(i))continue;var s=seats[i];float x=F(s,"x"),z=F(s,"z"),h=F(s,"h"),sy=F(s,"yaw"); int table=s.GetProperty("table").GetInt32();
                    var pair=Enumerable.Range(i+1,seats.Length-i-1).FirstOrDefault(j=>!used.Contains(j)&&seats[j].GetProperty("table").GetInt32()==table&&Math.Abs(F(seats[j],"x")-x)<.02f&&Math.Abs(Math.Abs(F(seats[j],"z")-z)-.84f)<.03f,-1);
                    string kind=h>.6f?"stool":pair>=0?"bench":"chair";float centreZ=pair>=0?(z+F(seats[pair],"z"))/2:z;
                    var p=Anchor(pieces,"seat-"+i,kind,frame,new(x,0,centreZ),new(kind=="bench"?.4f:.5f,1.15f,kind=="bench"?1.8f:.5f));p.Yaw=frame.Basis.GetEuler().Y+sy;p.Height=h;p.SeatYaw=sy;p.Table=table;
                    p.Seats.Add(frame*new Vector3(x,0,z));used.Add(i);if(pair>=0){p.Seats.Add(frame*new Vector3(x,0,F(seats[pair],"z")));used.Add(pair);}
                }
                foreach(var group in seats.Where(s=>s.GetProperty("table").GetInt32()!=9).GroupBy(s=>s.GetProperty("table").GetInt32()))
                {
                    var ss=group.ToArray(); float x=ss.Average(s=>F(s,"x")),z=ss.Average(s=>F(s,"z"));
                    Anchor(pieces,"table-"+group.Key,"table",frame,new(x,0,z),new(.95f,1.5f,1.75f));
                }
                var cp=counter.GetProperty("counter"); var sp=counter.GetProperty("stand");
                float cx=F(cp,"x"),cz=F(cp,"z"),sx=F(sp,"x"),sz=F(sp,"z");
                var c=Anchor(pieces,"counter","counter",frame,new(cx+(cx-sx)*.9f,0,cz),new(1.4f,1.35f,4.1f));
                c.Use=frame*new Vector3(cx,1.2f,cz);c.Stand=frame*new Vector3(sx,0,sz);
            }
            else if(home.ValueKind!=JsonValueKind.Undefined)
            {
                var o=home.GetProperty("origin");var rf=home.GetProperty("room_frame");var d=home.GetProperty("definition");float yaw=F(home,"yaw");
                var basis=Basis.FromEuler(new(0,yaw,0));var origin=new Vector3(F(o,"x"),F(home,"floor_y")+F(rf,"y"),F(o,"z"))+basis*new Vector3(F(rf,"x"),0,F(rf,"z"));
                frame=new(basis * new Basis(Vector3.Right*F(rf,"mirror"),Vector3.Up,Vector3.Back),origin);bounds=new(-F(d,"W")/2,0,F(d,"W"),F(d,"D"));top=F(d,"H");int i=0;
                foreach(var f in d.GetProperty("fixed").EnumerateArray())
                {
                    string kind=f.GetProperty("kind").GetString()!;float w=F(f,"w")*.5f,depth=F(f,"d")*.5f;var at=new Vector3(bounds.Position.X+F(f,"gx")*.5f+w/2,0,F(f,"gz")*.5f+depth/2);
                    var p=Anchor(pieces,"fixed-"+i++,kind.StartsWith("bed")?"bed":kind.StartsWith("chair")?"chair":kind.StartsWith("table")?"table":kind.Contains("stove")||kind is "hearth" or "mantel"?"stove":kind,frame,at,new(w+.12f,top,depth+.12f));
                    p.Use=p.At+Vector3.Up*.5f;p.SeatYaw=f.GetProperty("rot").GetInt32()*MathF.PI/2;p.Yaw=frame.Basis.GetEuler().Y+p.SeatYaw*F(rf,"mirror");
                    if(p.Kind=="chair")p.Seats.Add(p.At);
                }
            }
            // Split material batches into connected primitives, preserving every original vertex attribute.
            var remainder=new Node3D {Name="RetainedStructure"};var hidden=new HashSet<int>();var loose=new List<Part>();
            foreach(var mesh in BakedWorld.All(room).OfType<MeshInstance3D>().Where(m=>m.Mesh is ArrayMesh).ToArray())
            {
                if(mesh.Skin!=null||Ancestors(mesh).Any(n=>n is Skeleton3D)||mesh.Name.ToString().Contains("punch")||Ancestors(mesh).Any(n=>n.Name.ToString().StartsWith("house_")||n.Name.ToString().StartsWith("fires")||n.Name.ToString().StartsWith("hall_sun")))continue;
                var transform=TransformOf(mesh,room);bool modified=false; var retained=new List<Part>();
                for(int s=0;s<mesh.Mesh!.GetSurfaceCount();s++)
                {
                    var material=mesh.Mesh.SurfaceGetMaterial(s);string name=material?.ResourceName??"";
                    foreach(var part in Components(mesh,s,transform))
                    {
                        var localBox=PartBounds(part,frame.AffineInverse()); var centre=localBox.GetCenter(); Piece? owner=null;
                        bool structure=Structural(name)||part.Bounds.Size.X>60||part.Bounds.Size.Z>60;
                        if(bounds.Size!=Vector2.Zero && localBox.Size.Y>top*.8f && (localBox.Size.X>bounds.Size.X*.85f || localBox.Size.Z>bounds.Size.Y*.85f)) structure=true;
                        if(bounds.Size!=Vector2.Zero && localBox.Position.Y > top-.4f && (localBox.Size.X>1 || localBox.Size.Z>1)) structure=true;
                        if(bounds.Size!=Vector2.Zero && localBox.Size.Y<.2f && (localBox.Size.X>bounds.Size.X-.1f || localBox.Size.Z>bounds.Size.Y-.1f)) structure=true;
                        if(bounds.Size!=Vector2.Zero && localBox.Size.Y>1.7f && localBox.Size.X<.15f && (centre.X<bounds.Position.X+.12f || centre.X>bounds.End.X-.12f)) structure=true;
                        if(bounds.Size!=Vector2.Zero && name=="ik_darkoak" && localBox.Position.Y<1.4f && localBox.Size.Y>.25f && (localBox.Size.X<.06f || localBox.Size.Z<.06f) && Math.Max(localBox.Size.X,localBox.Size.Z)>1.2f) structure=true;
                        if(bounds.Size!=Vector2.Zero && name=="ik_darkoak" && localBox.Size.Y<.1f && Math.Min(localBox.Size.X,localBox.Size.Z)<.07f && Math.Max(localBox.Size.X,localBox.Size.Z)>1.8f) structure=true;
                        if(!structure)owner=pieces.Where(p=>p.Region.Grow(.04f).HasPoint(centre)).OrderBy(p=>new Vector2((frame.AffineInverse()*p.At).X,(frame.AffineInverse()*p.At).Z).DistanceSquaredTo(new(centre.X,centre.Z))).FirstOrDefault();
                        if(owner!=null){owner.Parts.Add(part);modified=true;}
                        else if(!structure && name!="" && !name.Contains("glass") && !name.Contains("window") && !name.Contains("sun_") && !name.Contains("floor")) {loose.Add(part);modified=true;}
                        else retained.Add(part);
                    }
                }
                if(modified){hidden.Add(mesh.GetMeta("source_node_index").AsInt32());foreach(var part in retained)AddPart(remainder,part,Transform3D.Identity);}
            }
            // Touching pieces of a shelf, case, lamp or ornament become one editable fitting.
            while(loose.Count>0)
            {
                var group=new List<Part>{loose[0]};loose.RemoveAt(0);var box=group[0].Bounds;bool changed=true;
                while(changed){changed=false;for(int i=loose.Count-1;i>=0;i--)if(group.Any(p=>PartBounds(p,frame.AffineInverse()).Grow(.018f).Intersects(PartBounds(loose[i],frame.AffineInverse())))){var part=loose[i];loose.RemoveAt(i);group.Add(part);box=box.Merge(part.Bounds);changed=true;}}
                string kind=Infer(group,box);var p=new Piece {Id="source-"+group.Min(p=>p.Source.GetMeta("source_node_index").AsInt32())+"-"+pieces.Count,Kind=kind,At=new(box.GetCenter().X,frame.Origin.Y,box.GetCenter().Z),Region=box};p.Parts.AddRange(group);pieces.Add(p);
            }
            pieces.RemoveAll(p=>p.Parts.Count==0);
            if(pieces.Count==0){remainder.Free();continue;}
            if(bounds.Size==Vector2.Zero)
            {
                var boxes=BakedWorld.All(room).OfType<MeshInstance3D>().Where(m=>m.Mesh!=null).Select(m=>TransformOf(m,room)*m.GetAabb()).ToArray();var box=boxes.Aggregate((a,b)=>a.Merge(b));
                frame=new(Basis.Identity,new(0,box.Position.Y,0));bounds=new(box.Position.X,box.Position.Z,box.Size.X,box.Size.Z);top=box.Size.Y;
            }
            var objects=new Node3D{Name="Objects"};var assets=new List<AuthorAsset>();
            foreach(var piece in pieces)
            {
                string assetId=id+"-"+piece.Id;var model=new FurnitureVisual{Name=Slug(piece.Kind),Kind=piece.Kind,ModelYaw=0};var pose=new Transform3D(Basis.FromEuler(new(0,piece.Yaw,0)),piece.At);var inv=pose.AffineInverse();
                foreach(var part in piece.Parts)AddPart(model,part,inv);
                var box=piece.Parts.Select(p=>PartBounds(p,inv)).Aggregate((a,b)=>a.Merge(b));var size=box.Size.Max(new Vector3(.04f,.04f,.04f));
                model.ModelSize=size;model.ModelOffset=new(box.GetCenter().X,box.Position.Y,box.GetCenter().Z);
                var body=new StaticBody3D{Name="Solid",CollisionLayer=2,CollisionMask=0};body.AddChild(new CollisionShape3D{Name="Shape",Shape=new BoxShape3D{Size=size},Position=box.GetCenter()});model.AddChild(body);
                Batch(model);SaveScene(model,"res://assets/props/furniture/"+assetId+".tscn");model.Free();
                var asset=new AuthorAsset{Id=assetId,Title=piece.Kind.Replace('_',' ')+" · "+roomId+" · "+piece.Id,Category="Room originals",Scene=ResourceLoader.Load<PackedScene>("res://assets/props/furniture/"+assetId+".tscn"),Footprint=size,FootprintOffset=new(box.GetCenter().X,box.Position.Y,box.GetCenter().Z),FurnitureKind=piece.Kind,SeatPoints=piece.Seats.Select(v=>inv*v).ToArray(),SeatHeight=piece.Height,SeatYaw=piece.SeatYaw+frame.Basis.GetEuler().Y-piece.Yaw,Table=piece.Table,UsePoint=inv*(piece.Use==Vector3.Zero?piece.At+Vector3.Up*.5f:piece.Use),StandPoint=inv*(piece.Stand==Vector3.Zero?piece.At+Vector3.Back*.6f:piece.Stand)};
                Must(ResourceSaver.Save(asset,"res://assets/library/interiors/"+assetId+".tres",ResourceSaver.SaverFlags.ChangePath));asset.TakeOverPath("res://assets/library/interiors/"+assetId+".tres");assets.Add(asset);
                var authored=new AuthoredObject{Name="object_"+piece.Id,ObjectId=assetId,Asset=asset,Transform=pose};objects.AddChild(authored);
            }
            SaveScene(objects,"res://world/interiors/"+id+".objects.tscn");objects.Free();SaveScene(remainder,"res://world/interiors/"+id+".structure.tscn");remainder.Free();
            var catalog=new AuthorCatalog();foreach(var a in assets)catalog.Assets.Add(a);Must(ResourceSaver.Save(catalog,"res://world/interiors/"+id+".catalog.tres",ResourceSaver.SaverFlags.ChangePath));catalog.TakeOverPath("res://world/interiors/"+id+".catalog.tres");catalogs.AddRange(assets);
            // Workshop loads the actual district shell, then attaches only this room's object seed.
            var district=NearestDistrict(pieces[0].At,room.GetMeta("source_node_index").AsInt32());
            string editorScene=$"[gd_scene load_steps=5 format=3]\n[ext_resource type=\"Script\" path=\"res://src/World/NativeDistrictScene.cs\" id=\"1\"]\n[ext_resource type=\"PackedScene\" path=\"{district.Scene.ResourcePath}\" id=\"2\"]\n[ext_resource type=\"PackedScene\" path=\"res://world/interiors/{id}.structure.tscn\" id=\"3\"]\n[ext_resource type=\"PackedScene\" path=\"res://world/interiors/{id}.objects.tscn\" id=\"4\"]\n[node name=\"Interior\" type=\"Node3D\"]\nscript = ExtResource(\"1\")\n[node name=\"Scenery\" parent=\".\" instance=ExtResource(\"2\")]\n[node name=\"RetainedStructure\" parent=\".\" instance=ExtResource(\"3\")]\n[node name=\"Objects\" parent=\".\" instance=ExtResource(\"4\")]\n";
            File.WriteAllText(ProjectSettings.GlobalizePath("res://world/interiors/"+id+".tscn"),editorScene);
            var roomCentre=frame*new Vector3(bounds.GetCenter().X,0,bounds.GetCenter().Y);var author=new AuthorDistrict{Id=id,Title=roomId,RoomId=roomId,RoomFrame=frame,RoomBounds=bounds,RoomHeight=top,EntryPoints=room.GetMeta("extras").AsGodotDictionary()["room"].AsGodotDictionary()["openings"].AsGodotArray().Select(v=>v.AsGodotDictionary()).Where(o=>o["kind"].AsString()=="door").Select(o=>{var c=o["centre"].AsGodotArray();return new Vector3(c[0].AsSingle(),frame.Origin.Y,c[2].AsSingle());}).ToArray(),ReplacedMeshes=hidden.Order().ToArray(),RetainedStructure=ResourceLoader.Load<PackedScene>("res://world/interiors/"+id+".structure.tscn"),Catalog=catalog,Scene=ResourceLoader.Load<PackedScene>("res://world/interiors/"+id+".tscn"),Bounds=new(roomCentre.X-100,roomCentre.Z-100,200,200),WalkSpawn=roomCentre+Vector3.Up*.02f,FlySpawn=roomCentre+Vector3.Up*1.6f,FlyYaw=frame.Basis.GetEuler().Y,FlyPitch=-.12f};
            Must(ResourceSaver.Save(author,"res://world/interiors/"+id+".tres"));report.Add(new{room=roomId,objects=pieces.Count,hidden=hidden.Order().ToArray()});GD.Print(roomId+": "+pieces.Count+" objects");
        }
        File.WriteAllText(ProjectSettings.GlobalizePath("res://world/interiors/conversion.json"),JsonSerializer.Serialize(report,new JsonSerializerOptions{WriteIndented=true}));
        town.Free();GD.Print("furniture intake: "+report.Count+" rooms, "+catalogs.Count+" objects");
    }
    private static AuthorDistrict NearestDistrict(Vector3 at,int index)=>ResourceLoader.ListDirectory("res://world/districts").Where(f=>f.EndsWith(".tres")).Select(f=>ResourceLoader.Load<AuthorDistrict>("res://world/districts/"+f)).Where(d=>Godot.FileAccess.GetFileAsString(d.Scene.ResourcePath).Contains($"res://world/town/roots/node-{index:D5}.scn",StringComparison.Ordinal)).OrderBy(d=>d.Bounds.HasPoint(new(at.X,at.Z))?0:1).ThenBy(d=>d.Bounds.GetCenter().DistanceSquaredTo(new(at.X,at.Z))).First();
    private static float F(JsonElement j,string key)=>j.GetProperty(key).GetSingle();
    private static Piece Anchor(List<Piece> list,string id,string kind,Transform3D frame,Vector3 at,Vector3 size){var p=new Piece{Id=id,Kind=kind,Yaw=frame.Basis.GetEuler().Y,At=frame*at,Region=new Aabb(at-new Vector3(size.X/2,0,size.Z/2),size)};list.Add(p);return p;}
    private static IEnumerable<Node> Ancestors(Node n){for(var p=n.GetParent();p!=null;p=p.GetParent())yield return p;}
    private static Transform3D TransformOf(Node3D n,Node root){var t=n.Transform;for(var p=n.GetParent();p!=root&&p is Node3D node;p=p.GetParent())t=node.Transform*t;return t;}
    private static bool Structural(string name)=>Regex.IsMatch(name,@"floor|tiles|plaster|lime|sandboards|ceil|wallpaper|h_wall|h_beam|cf_beam|door|reveal|stairs|vault|dome|stone|wash|roof|glass|window|sun_|panel$|marble_[wb]$",RegexOptions.IgnoreCase);
    private static string Infer(List<Part> parts,Aabb b){string names=string.Join(" ",parts.Select(p=>p.Source.Mesh!.SurfaceGetMaterial(p.Surface)?.ResourceName));if(parts.Any(p=>p.Source.Name.ToString().StartsWith("clock_hands"))||names.Contains("clockface")||names.Contains("sh_face"))return "clock";if(names.Contains("barrel")||names.Contains("hoop"))return "cask";if(names.Contains("lampglass"))return "lamp";if(names.Contains("sack"))return "sack";if(names.Contains("iron")&&b.Size.Y>1.5&&b.Size.X<1)return "stove";if(names.Contains("row_"))return "shelf";if(b.Size.Y<1.1f&&b.Size.Y>.6f&&b.Size.X>.65f&&b.Size.Z>.65f&&(names.Contains("oak")||names.Contains("wood")||names.Contains("pine")))return "table";return "fitting";}
    private static readonly Dictionary<(ulong,int),Godot.Collections.Array> cachedArrays=new();
    private static Godot.Collections.Array Arrays(MeshInstance3D mesh,int surface){var key=(mesh.Mesh!.GetInstanceId(),surface);if(!cachedArrays.TryGetValue(key,out var arrays))cachedArrays[key]=arrays=mesh.Mesh.SurfaceGetArrays(surface);return arrays;}
    private static readonly Dictionary<(Part,Transform3D),Aabb> partBoundsCache=new();
    private static readonly Dictionary<(ulong,int),Vector3[]> vertexCache=new();
    private static Aabb PartBounds(Part part,Transform3D xf){var key=(part,xf);if(partBoundsCache.TryGetValue(key,out var cached))return cached;var vk=(part.Source.Mesh!.GetInstanceId(),part.Surface);if(!vertexCache.TryGetValue(vk,out var vertices))vertexCache[vk]=vertices=Arrays(part.Source,part.Surface)[(int)Mesh.ArrayType.Vertex].AsVector3Array();var first=xf*part.Transform*vertices[part.Indices[0]];var box=new Aabb(first,Vector3.Zero);foreach(int i in part.Indices)box=box.Expand(xf*part.Transform*vertices[i]);partBoundsCache[key]=box;return box;}
    private static IEnumerable<Part> Components(MeshInstance3D source,int surface,Transform3D transform)
    {
        var a=Arrays(source,surface);var vertices=a[(int)Mesh.ArrayType.Vertex].AsVector3Array();var indices=a[(int)Mesh.ArrayType.Index].VariantType==Variant.Type.Nil?Enumerable.Range(0,vertices.Length).ToArray():a[(int)Mesh.ArrayType.Index].AsInt32Array();
        if(source.Name.ToString().StartsWith("clock_hands")){yield return new(source,surface,indices,transform,transform*source.GetAabb());yield break;}
        int count=indices.Length/3;var parent=Enumerable.Range(0,count).ToArray();var shared=new Dictionary<string,int>();int Find(int i){while(parent[i]!=i){parent[i]=parent[parent[i]];i=parent[i];}return i;}
        string Key(Vector3 v)=>$"{Math.Round(v.X*10000)},{Math.Round(v.Y*10000)},{Math.Round(v.Z*10000)}";
        for(int t=0;t<count;t++)for(int k=0;k<3;k++){var akey=Key(vertices[indices[t*3+k]]);var bkey=Key(vertices[indices[t*3+(k+1)%3]]);var key=string.CompareOrdinal(akey,bkey)<0?akey+"/"+bkey:bkey+"/"+akey;if(shared.TryGetValue(key,out int old))parent[Find(t)]=Find(old);else shared[key]=t;}
        foreach(var group in Enumerable.Range(0,count).GroupBy(Find)) {var ids=group.SelectMany(t=>indices.Skip(t*3).Take(3)).ToArray();var first=transform*vertices[ids[0]];var box=new Aabb(first,Vector3.Zero);foreach(int i in ids)box=box.Expand(transform*vertices[i]);yield return new(source,surface,ids,transform,box);}
    }
    private static void AddPart(Node3D root,Part part,Transform3D inverse)
    {
        if(part.Source.Name.ToString().StartsWith("clock_hands")){root.AddChild(new MeshInstance3D{Name="clock_hands",Mesh=part.Source.Mesh,Transform=inverse*part.Transform});return;}
        var source=Arrays(part.Source,part.Surface);var srcV=source[(int)Mesh.ArrayType.Vertex].AsVector3Array();var srcN=source[(int)Mesh.ArrayType.Normal].VariantType==Variant.Type.Nil?null:source[(int)Mesh.ArrayType.Normal].AsVector3Array();var srcUV=source[(int)Mesh.ArrayType.TexUV].VariantType==Variant.Type.Nil?null:source[(int)Mesh.ArrayType.TexUV].AsVector2Array();var srcC=source[(int)Mesh.ArrayType.Color].VariantType==Variant.Type.Nil?null:source[(int)Mesh.ArrayType.Color].AsColorArray();
        var xf=inverse*part.Transform;var arrays=new Godot.Collections.Array();arrays.Resize((int)Mesh.ArrayType.Max);arrays[(int)Mesh.ArrayType.Vertex]=part.Indices.Select(i=>xf*srcV[i]).ToArray();if(srcN!=null)arrays[(int)Mesh.ArrayType.Normal]=part.Indices.Select(i=>(xf.Basis.Inverse().Transposed()*srcN[i]).Normalized()).ToArray();if(srcUV!=null)arrays[(int)Mesh.ArrayType.TexUV]=part.Indices.Select(i=>srcUV[i]).ToArray();if(srcC!=null)arrays[(int)Mesh.ArrayType.Color]=part.Indices.Select(i=>srcC[i]).ToArray();
        var mesh=new ArrayMesh();mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,arrays);mesh.SurfaceSetMaterial(0,part.Source.Mesh.SurfaceGetMaterial(part.Surface));
        root.AddChild(new MeshInstance3D{Name=part.Source.Name.ToString().StartsWith("clock_hands")?"clock_hands":"Part",Mesh=mesh,CastShadow=part.Source.CastShadow});
    }
    private static void SaveScene(Node3D node,string path){foreach(var child in BakedWorld.All(node).Where(n=>n!=node))child.Owner=node;var p=new PackedScene();Must(p.Pack(node));Must(ResourceSaver.Save(p,path));}
    private static void Batch(Node3D root)
    {
        foreach(var group in root.GetChildren().OfType<MeshInstance3D>().Where(m=>m.Name!="clock_hands").GroupBy(m=>m.Mesh!.SurfaceGetMaterial(0)))
        {
            var nodes=group.ToArray();if(nodes.Length<2)continue;
            var tool=new SurfaceTool();tool.Begin(Mesh.PrimitiveType.Triangles);tool.SetMaterial(group.Key);
            foreach(var mesh in nodes)tool.AppendFrom(mesh.Mesh,0,mesh.Transform);
            var combined=new MeshInstance3D{Name="Batch",Mesh=tool.Commit()};root.AddChild(combined);
            foreach(var mesh in nodes){root.RemoveChild(mesh);mesh.Free();}
        }
    }
    private static void Must(Error error){if(error!=Error.Ok)throw new IOException(error.ToString());}
}
