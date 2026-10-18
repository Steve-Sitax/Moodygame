using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Native.Authoring;
namespace Scheldemist.Native.Interiors;

public static class FurnitureWorkshopProof
{
    public static async Task Run(WorkshopSession s,string output,string stage)
    {
        Directory.CreateDirectory(output);var rows=new List<object>();string? error=null;
        void Check(bool pass,string name){rows.Add(new{name,pass});if(!pass)throw new InvalidOperationException(name);}
        async Task Frames(int n=3){for(int i=0;i<n;i++)await s.ToSignal(s.GetTree(),SceneTree.SignalName.PhysicsFrame);}
        async Task Shot(string name)
        {
            var r=s.District;var rect=r.RoomBounds;var local=new Vector3(rect.Position.X+.7f,1.5f,rect.Position.Y+.7f);var eye=r.RoomFrame*local;var target=r.RoomFrame*new Vector3(rect.GetCenter().X,.65f,rect.GetCenter().Y);
            s.Camera.Position=eye-s.Camera.Eye.Position;s.Camera.Eye.LookAt(target);await Frames(6);
            await s.ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);using var picture=s.GetViewport().GetTexture().GetImage();Check(picture.SavePng(Path.Combine(output,name+".png"))==Error.Ok,name+" picture");
        }
        bool PlaceClear(string asset,string? move=null)
        {
            var rect=s.District.RoomBounds;var rotation=move==null?new Vector3(0,s.District.FlyYaw,0):s.Instances[move].Rotation;
            var original=move==null?Vector3.Zero:s.Instances[move].Position;
            foreach(float yaw in new[]{rotation.Y,rotation.Y+Mathf.Pi/2})
                for(float z=rect.Position.Y+.65f;z<rect.End.Y-.4f;z+=.5f)for(float x=rect.Position.X+.65f;x<rect.End.X-.4f;x+=.5f)
                {
                    var position=s.District.RoomFrame*new Vector3(x,0,z);if(move!=null&&position.DistanceTo(original)<.5f)continue;
                    var p=new Placement{Id=move??"probe",Asset=asset,Position=LayoutDocument.Floats(position),Rotation=new[]{0f,yaw,0f},Scale=new[]{1f,1f,1f}};
                    if(s.Clear(p,out _)&&s.Place(asset,position,new(0,yaw,0),Vector3.One,move))return true;
                }
            return false;
        }
        try
        {
            if(stage=="floor-probe")
            {
                await Frames(5);var space=s.GetWorld3D().DirectSpaceState;
                var at=s.District.RoomId=="townhall"?new Vector3(-257,0,58):s.District.RoomId=="prison"?new Vector3(-355,0,200):s.District.WalkSpawn;
                var hits=new List<object>();float top=40;
                using var shape=new BoxShape3D{Size=new(.3f,1.15f,.3f)};
                for(int i=0;i<80;i++)
                {
                    using var ray=PhysicsRayQueryParameters3D.Create(new(at.X,top,at.Z),new(at.X,-5,at.Z),1);
                    var hit=space.IntersectRay(ray);if(hit.Count==0)break;
                    var p=hit["position"].AsVector3();top=p.Y-.06f;
                    using var query=new PhysicsShapeQueryParameters3D{Shape=shape,CollisionMask=3,Transform=new(Basis.Identity,p+Vector3.Up*.8f)};
                    var colliders=space.IntersectShape(query,8);
                    hits.Add(new{at=LayoutDocument.Floats(p),normal=LayoutDocument.Floats(hit["normal"].AsVector3()),source=(hit["collider"].AsGodotObject() as Node)?.GetPath().ToString(),blocked=colliders.Select(h=>(h["collider"].AsGodotObject() as Node)?.GetPath().ToString()).ToArray()});
                }
                File.WriteAllText(Path.Combine(output,"floor-probe.json"),JsonSerializer.Serialize(hits,new JsonSerializerOptions{WriteIndented=true}));s.GetTree().Quit();return;
            }
            if(stage=="shots")
            {
                // dev: pictures from given points in the opened room (--proof-shots "x,y,z,tx,ty,tz;...", world metres)
                await Frames(10);int n=0;
                foreach(var spec in Scheldemist.Native.Game.NativeArguments.Arg("proof-shots").Split(';',StringSplitOptions.RemoveEmptyEntries))
                {
                    var v=spec.Split(',').Select(t=>float.Parse(t,System.Globalization.CultureInfo.InvariantCulture)).ToArray();var eye=new Vector3(v[0],v[1],v[2]);
                    s.Camera.Position=eye-s.Camera.Eye.Position;s.Camera.Eye.LookAt(new Vector3(v[3],v[4],v[5]));await Frames(6);
                    await s.ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);using var picture=s.GetViewport().GetTexture().GetImage();picture.SavePng(Path.Combine(output,$"shot-{n++}.png"));
                }
                s.GetTree().Quit();return;
            }
            if(stage=="routes")
            {
                foreach(var room in World.NativeDistrictLayouts.Available().Where(r=>r.RoomId!=""&&(Scheldemist.Native.Game.NativeArguments.Arg("proof-room")==""||Scheldemist.Native.Game.NativeArguments.Arg("proof-room").Split(',').Contains(r.Id))))
                {
                    s.EnterRoom(room.Id);await Frames();
                    string why="Room could not be opened";
                    bool pass=s.DistrictId==room.Id&&InteriorRoutes.Check(s,s.Document,out why);
                    rows.Add(new{name=room.Id,pass,reason=pass?"":why,diagnostic=InteriorRoutes.Diagnostics});
                    if(!pass&&s.DistrictId==room.Id)File.WriteAllText(Path.Combine(output,room.Id+".map.txt"),InteriorRoutes.Dump(s,InteriorRoutes.Unreachable));
                    File.WriteAllText(Path.Combine(output,"room-routes.json"),JsonSerializer.Serialize(rows,new JsonSerializerOptions{WriteIndented=true}));
                    GD.Print("room route "+room.Id+": "+pass);
                }
                File.WriteAllText(Path.Combine(output,"room-routes.json"),JsonSerializer.Serialize(rows,new JsonSerializerOptions{WriteIndented=true}));
                s.GetTree().Quit();return;
            }
            foreach(string room in new[]{"room-tavern-ankere","room-home-widow","room-shop-bakery_rijn"})
            {
                s.EnterRoom(room);await Frames();Check(s.DistrictId==room,"enter "+room+" in its shell");
                Check(s.Assets.ContainsKey("furniture-chair"),room+" furniture category");
                string expected=Path.Combine(output,room+".expected.json");
                if(stage=="reload")
                {
                    Check(s.Document.Encode()==File.ReadAllText(expected),room+" ids and edits survive a separate process");
                    Check(InteriorRoutes.Check(s,s.Document,out var why),room+" routes: "+why);await Shot(room+"-restart");continue;
                }
                await Shot(room+"-before");var initial=s.Document.Encode();
                Check(PlaceClear("furniture-chair"),room+" add chair");string chair=s.SelectedId!;await Frames();
                s.Undo();Check(s.Document.Encode()==initial,room+" undo add");s.Redo();Check(s.SelectedId==null||s.Instances.ContainsKey(chair),room+" redo keeps chair id");await Frames();
                s.Select(chair);Check(PlaceClear("furniture-chair",chair),room+" move the new chair");await Frames();
                var table=s.Instances.Values.FirstOrDefault(o=>o.Asset!.FurnitureKind=="table");
                if(table==null){Check(PlaceClear("furniture-table"),room+" add table");table=s.Instances[s.SelectedId!];await Frames();}
                string tableId=table.ObjectId;s.Select(tableId);Check(PlaceClear(table.Asset!.Id,tableId),room+" move table");await Frames();
                var stool=s.Instances.Values.FirstOrDefault(o=>o.Asset!.FurnitureKind=="stool");
                if(stool==null){Check(PlaceClear("furniture-stool"),room+" add stool");stool=s.Instances[s.SelectedId!];await Frames();}
                string stoolId=stool.ObjectId;s.Select(stoolId);var beforeDelete=s.Document.Encode();s.DeleteSelected();Check(!s.Instances.ContainsKey(stoolId),room+" delete stool");s.Undo();Check(s.Document.Encode()==beforeDelete,room+" undo deletion exactly");await Frames();
                if(room=="room-home-widow")
                {
                    var bed=s.Instances.Values.First(o=>o.Asset!.FurnitureKind=="bed");s.Select(bed.ObjectId);Check(PlaceClear(bed.Asset!.Id,bed.ObjectId),"move the real home bed");await Frames();
                }
                s.Select(chair);s.DuplicateSelected();Check(s.HasPreview,room+" copy starts placement");s.CancelPreview();
                var invalid=s.District.RoomFrame*new Vector3(s.District.RoomBounds.End.X+.5f,0,s.District.RoomBounds.GetCenter().Y);
                Check(!s.Place("furniture-chair",invalid,Vector3.Zero,Vector3.One),room+" refuses outside and through wall");
                Check(InteriorRoutes.Check(s,s.Document,out var why2),room+" paths to furniture: "+why2);
                File.WriteAllText(expected,s.Document.Encode());await Shot(room+"-after");
                string promoted=Path.Combine(output,room+".promoted.tscn");MapPromotion.Write(s.District,s.Document,s.Assets,promoted);
                var promotedObjects=ResourceLoader.Load<PackedScene>(promoted).Instantiate<Node3D>();
                Check(World.NativeDistrictLayouts.Capture(s.District,promotedObjects).Encode()==s.Document.Encode(),room+" promotion retains every id and transform in the native map scene");promotedObjects.Free();
            }
            Check(s.Save(),"save all changed rooms atomically with per-layout backups");
            s.EnterRoom("room-tavern-ankere");await Frames();Check(s.Document.Encode()==File.ReadAllText(Path.Combine(output,"room-tavern-ankere.expected.json")),"room switching retains unsaved work and undo history");
        }
        catch(Exception e){error=e.ToString();GD.PrintErr(error);}
        File.WriteAllText(Path.Combine(output,"workshop-"+stage+".json"),JsonSerializer.Serialize(new{rows,error},new JsonSerializerOptions{WriteIndented=true}));s.GetTree().Quit(error==null?0:1);
    }
}
