using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.People;
using Scheldemist.Player;
using Scheldemist.Play;
using Scheldemist.Talks;
using Scheldemist.Town;
using Scheldemist.World;

namespace Scheldemist.Native.World;
public static class NativeConversationProof
{
    public static async Task Run(NativeTownGame game,string output)
    {
        Directory.CreateDirectory(output);var checks=new List<object>();var rooms=new List<object>();string? error=null;
        void Check(bool pass,string name){checks.Add(new{name,pass});GD.Print($"conversation: {(pass?"PASS":"FAIL")} {name}");}
        async Task Frames(int n){for(int i=0;i<n;i++)await game.ToSignal(game.GetTree(),SceneTree.SignalName.ProcessFrame);}
        async Task Wait(Func<bool> ok,int seconds=15){var until=DateTime.UtcNow.AddSeconds(seconds);while(!ok()){if(DateTime.UtcNow>until)throw new TimeoutException("conversation wait");await Frames(1);}}
        async Task Shot(string name,Vector3 eye,Vector3 target){if(!Jef.I.Fly)Jef.I.ToggleFly();game.Cam.GlobalPosition=eye;var q=new Transform3D(Basis.Identity,eye).LookingAt(target).Basis.GetRotationQuaternion();if(game.Cam is FlyCam fly)fly.Face(q);else game.Cam.Quaternion=q;await Frames(20);await game.ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);using var image=game.GetViewport().GetTexture().GetImage();image.SavePng(Path.Combine(output,name+".png"));}
        try
        {
            Engine.MaxFps=30;await Wait(()=>game.Loaded&&ServerLink.I?.Up==true&&GameState.I.Live&&!Scheldemist.Menu.Loading.Busy,160);
            Jef.I.TestInput=true;var api=ServerLink.I!.Api!;var people=game.GetNode<Townspeople>("Townspeople");await Wait(()=>people.Data!=null,60);
            var indoors=people.Indoors!;
            Doors.I.Held=true;foreach(var d in Doors.I.All)Doors.I.Force(d,true);await Frames(6);
            foreach(var h in indoors.Houses)
            {
                var spots=indoors.StandingSpots(h);bool lane=h.EntryLane.Count>1;bool clear=spots.All(p=>!indoors.InEntryLane(h,p));
                Check(lane,h.Id+" connected door-to-counter lane");Check(clear,h.Id+" every patron spot outside entrance lane");Check(spots.Count>0,h.Id+" usable room spots");
                var samples=new List<Pt>();
                for(int i=0;i<h.EntryLane.Count;i++)
                {
                    var to=h.EntryLane[i];var from=i==0?to:h.EntryLane[i-1];
                    int steps=Math.Max(1,(int)Math.Ceiling(Whereabouts.Hypot(to.X-from.X,to.Z-from.Z)/.15));
                    for(int k=1;k<=steps;k++)samples.Add(new(from.X+(to.X-from.X)*k/steps,from.Z+(to.Z-from.Z)*k/steps));
                }
                var blocked=new List<object>();
                using(var capsule=new CapsuleShape3D{Radius=Jef.Radius,Height=1.5f})
                using(var query=new PhysicsShapeQueryParameters3D{Shape=capsule,CollisionMask=Solid.Layer,Margin=.001f,Exclude=new Godot.Collections.Array<Rid>{Jef.I.Body.GetRid()}})
                {foreach(var point in samples){var floor=game.World.NativeRoom(h.Id)!.Value.Frame.Origin.Y;query.Transform=new(Basis.Identity,new((float)point.X,floor+.85f,(float)point.Z));var hits=game.World.GetWorld3D().DirectSpaceState.IntersectShape(query,8);if(hits.Count>0)blocked.Add(new{at=new[]{point.X,point.Z},objects=hits.Select(hit=>(hit["collider"].AsGodotObject() as Node)?.GetPath().ToString()).ToArray()});}}
                Check(blocked.Count==0,h.Id+" real physics capsule reaches counter");
                float floorY=game.World.NativeRoom(h.Id)!.Value.Frame.Origin.Y;
                Check(samples.All(p=>Jef.I.StandFree((float)p.X,(float)p.Z,floorY)),h.Id+" actual player body and floor support fit every route point");
                rooms.Add(new{id=h.Id,samples=samples.Count,blocked,spots=spots.Select(p=>new[]{p.X,p.Z}),lane=h.EntryLane.Select(p=>new[]{p.X,p.Z}),outward=new[]{h.Out.X,h.Out.Z}});
            }
            File.WriteAllText(Path.Combine(output,"rooms.json"),JsonSerializer.Serialize(rooms,new JsonSerializerOptions{WriteIndented=true}));
            var cafe=indoors.Houses.Single(h=>h.Id=="tavern:vliet");
            var doorMeshes=BakedWorld.All(game.View).OfType<MeshInstance3D>().Where(m=>m.Mesh!=null&&m.IsVisibleInTree()).Select(m=>new{m,box=m.GlobalTransform*m.GetAabb()}).Where(p=>new Vector2(p.box.GetCenter().X-(float)cafe.Door.X,p.box.GetCenter().Z-(float)cafe.Door.Z).Length()<4).Select(p=>new{path=p.m.GetPath().ToString(),name=p.m.Name.ToString(),min=new[]{p.box.Position.X,p.box.Position.Y,p.box.Position.Z},size=new[]{p.box.Size.X,p.box.Size.Y,p.box.Size.Z}}).ToArray();
            File.WriteAllText(Path.Combine(output,"door-meshes.json"),JsonSerializer.Serialize(doorMeshes,new JsonSerializerOptions{WriteIndented=true}));
            foreach(int hour in new[]{13,20})
            {
                GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set",new{day=1,hour,minute=0,weather="clear"}));Daylight.I.Settle();
                var door=new Vector3((float)cafe.Door.X,.18f,(float)cafe.Door.Z);var outward=new Vector3((float)cafe.Out.X,0,(float)cafe.Out.Z);
                Jef.I.Place(door.X+outward.X*2,door.Z+outward.Z*2,0,0,.18f);await Frames(60);
                await Shot("cafe-"+hour+"-door",door+outward*2.6f+Vector3.Up*1.6f,door-outward*4+Vector3.Up*1.1f);
                await Shot("cafe-"+hour+"-inside",door-outward*.9f+Vector3.Up*1.65f,door-outward*6+Vector3.Up*.9f);
                Check(indoors.Models(cafe).Any(),"cafe has actual patrons at "+hour);
                Check(indoors.Models(cafe).All(h=>h.IsPeople2),"cafe patrons use people2 at "+hour);
                Check(indoors.Groups.All(g=>!g.GetChildren().OfType<StaticBody3D>().Any()),"indoor people have no solid cylinder at "+hour);
            }
            // Traverse the cafe entrance and serving lane with Jef's real movement/collision.
            if(Jef.I.Fly)Jef.I.ToggleFly();
            Jef.I.Place((float)(cafe.Door.X+cafe.Out.X*1.2),(float)(cafe.Door.Z+cafe.Out.Z*1.2),0,0,.18f);
            var walkingTrail=new List<object>();bool walked=true;Jef.I.SetKey(Key.W,true);
            foreach(var point in cafe.EntryLane)
            {
                var limit=DateTime.UtcNow.AddSeconds(4);
                while(new Vector2(Jef.I.X-(float)point.X,Jef.I.Z-(float)point.Z).Length()>.18f)
                {if(DateTime.UtcNow>limit){walked=false;break;}Jef.I.Yaw=MathF.Atan2(Jef.I.X-(float)point.X,Jef.I.Z-(float)point.Z);await Frames(1);}
                walkingTrail.Add(new{target=new[]{point.X,point.Z},actual=new[]{Jef.I.X,Jef.I.Y,Jef.I.Z},pass=walked});if(!walked)break;
            }
            File.WriteAllText(Path.Combine(output,"cafe-walk.json"),JsonSerializer.Serialize(walkingTrail,new JsonSerializerOptions{WriteIndented=true}));
            Jef.I.ClearKeys();Check(walked,"Jef physically walks from street through cafe door to counter");
            var frozenNodes=new List<object>();
            bool ShopOrTavern(Node node){for(Node? n=node;n!=null;n=n.GetParent())if(n.Name.ToString().StartsWith("ROOM_tavern_")||n.Name.ToString().StartsWith("ROOM_shop_"))return true;return false;}
            var frozen=BakedWorld.All(game.World).OfType<Skeleton3D>().Where(ShopOrTavern).Where(s=>{var model=s.GetParent();bool visible=BakedWorld.All(model).OfType<GeometryInstance3D>().Any(m=>m.IsVisibleInTree());if(visible)frozenNodes.Add(new{path=model.GetPath().ToString()});return visible;}).Count();
            File.WriteAllText(Path.Combine(output,"frozen-keepers.json"),JsonSerializer.Serialize(frozenNodes));
            Check(frozen==0,"no recovered person remains visible in any tavern or shop");
            Check(game.World.NativeFurniture!.All(f=>f.Id!="room-tavern-vliet-source-11830-63"),"retired keeper does not reserve semantic room/navigation cells");
            var snapshots=BakedWorld.All(game.World).OfType<Scheldemist.Native.Interiors.FurnitureVisual>().Where(f=>f.ResidentSnapshot).ToArray();
            Check(snapshots.Length==1&&snapshots.All(f=>!f.Visible&&BakedWorld.All(f).OfType<CollisionObject3D>().All(b=>b.CollisionLayer==0)),"converted keeper snapshot retains its id with no rendering or collision");
            GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set",new{day=1,hour=13,minute=0,weather="clear"}));Daylight.I.Settle();
            // A real visible walker, stopped through the same dialog hooks as E.
            var eye=new Vector3(-52,1.7f,38);Jef.I.Place(eye.X,eye.Z,0);game.Cam.GlobalPosition=eye;await Frames(90);
            var walker=people.Sims.FirstOrDefault(s=>s.P is {Remote:false} p && people.Crowd!.PuppetBusy(p)&&!s.ActionHeld);
            if(walker==null)throw new Exception("No live walker for talk proof");
            var p=walker.P!;var originalGoal=walker.Goal;Jef.I.Place((float)p.X+1.5f,(float)p.Z+1,0);await Frames(2);
            int minuteBefore=GameState.I.Hour*60+GameState.I.Minute;var start=new Vector2((float)p.X,(float)p.Z);int movedOutBefore=people.Crowd!.MoveOutLog.Count;Talk.I!.Open(walker.R.Id,walker.R.Name);
            // Every frame of the held talk: where the talker is, who is near, and anything that set a body aside (#185).
            var talkTrail=new List<object>();
            for(int f=0;f<60;f++)
            {
                await Frames(1);
                var near=people.Sims.Where(s=>s.P is {} q&&q!=p&&Whereabouts.Hypot(q.X-p.X,q.Z-p.Z)<1.2).Select(s=>new{id=s.R.Id,puppet=s.P!.Id,state=s.P.State,distance=Math.Round(Whereabouts.Hypot(s.P.X-p.X,s.P.Z-p.Z),3)}).ToArray();
                talkTrail.Add(new{frame=f,x=Math.Round(p.X,3),z=Math.Round(p.Z,3),moved=Math.Round(start.DistanceTo(new((float)p.X,(float)p.Z)),3),state=p.State,conversing=p.Conversing,jef=Math.Round(Whereabouts.Hypot(Jef.I.X-p.X,Jef.I.Z-p.Z),3),near});
            }
            File.WriteAllText(Path.Combine(output,"talk-trail.json"),JsonSerializer.Serialize(new{walker=walker.R.Id,puppet=p.Id,start=new[]{start.X,start.Y},movedOut=people.Crowd.MoveOutLog.Skip(movedOutBefore).ToArray(),trail=talkTrail},new JsonSerializerOptions{WriteIndented=true}));
            Check(Talk.I.IsOpen&&ConversationHold.I!.Held(walker.R.Id),"talk opens a server lease");Check(start.DistanceTo(new((float)p.X,(float)p.Z))<.25f,"walker stops while clock continues");Check(p.Human.Motion=="talk","walker plays talk pose");Check(ReferenceEquals(originalGoal,walker.Goal),"talk preserves schedule goal");
            // #185: a passer-by sent straight through the held talker walks round him (or is eased aside), never shoves him off his spot
            var passer=people.Sims.FirstOrDefault(s=>s!=walker&&s.P is {Remote:false,NetworkVehicle:0,Pushes:false,Conversing:false} q&&people.Crowd!.PuppetBusy(q)&&!s.ActionHeld);
            if(passer?.P is {} by)
            {
                var held=new Vector2((float)p.X,(float)p.Z);var across=new Vector2(MathF.Cos(.7f),MathF.Sin(.7f));
                // (he starts at the talker's shoulder, in body contact, and is sent through him to the far side)
                Vector2? from=null;foreach(float turn in new[]{0f,1.57f,3.14f,4.71f}){var d=across.Rotated(turn);var a=held+d*.45f;var b=held-d*2.2f;if(people.Walk!.Free(a.X,a.Y)&&people.Walk.Free(b.X,b.Y)&&people.Walk.Free(held.X,held.Y)){from=a;across=d;break;}}
                if(from is {} start2)
                {
                    by.X=start2.X;by.Z=start2.Y;people.Crowd!.PuppetGo(by,held.X-across.X*2.2,held.Y-across.Y*2.2,1.3);
                    double closest=99;var shoved=0f;for(int f=0;f<90;f++){await Frames(1);closest=Math.Min(closest,Whereabouts.Hypot(by.X-p.X,by.Z-p.Z));shoved=MathF.Max(shoved,held.DistanceTo(new((float)p.X,(float)p.Z)));}
                    File.WriteAllText(Path.Combine(output,"talk-passer.json"),JsonSerializer.Serialize(new{passer=passer.R.Id,closest,shoved,talker=new[]{p.X,p.Z},movedOut=people.Crowd.MoveOutLog.Skip(movedOutBefore).ToArray()}));
                    Check(shoved<.02f&&closest<.6,"a passer-by walking through a held talker does not shove him");
                }
            }
            GameState.I.Apply(await api.Post<JobsPayload>("api/dev/advance",new{minutes=5}));await Frames(3);
            Check(GameState.I.Hour*60+GameState.I.Minute>minuteBefore&&ConversationHold.I!.Held(walker.R.Id),"authoritative clock advances during a held talk");
            Jef.I.Place((float)p.X-1.5f,(float)p.Z+1,0);await Frames(45);double facing=Math.Atan2(Jef.I.X-p.X,Jef.I.Z-p.Z);Check(Math.Abs(Math.Atan2(Math.Sin(p.Yaw-facing),Math.Cos(p.Yaw-facing)))<.15,"person tracks a small player move");
            GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set",new{day=1,hour=13,minute=0,weather="clear"}));Daylight.I.Settle();
            await Shot("street-talk",new Vector3((float)p.X-1.4f,p.Group.Position.Y+1.6f,(float)p.Z+2),(p.Group.Position+Vector3.Up*1.2f));
            Talk.I.Close();await Frames(60);Check(!ConversationHold.I!.Held(walker.R.Id)&&!p.Conversing,"close releases conversation");
            Talk.I.Open(walker.R.Id,walker.R.Name);await Frames(20);Jef.I.Place((float)p.X+6,(float)p.Z,0);await Frames(30);Check(!Talk.I.IsOpen&&!ConversationHold.I!.Held(walker.R.Id),"walking over four metres ends talk");
            // The native rider/cart components must stop their wheels and horse as well as their person.
            var fixture=new object();people.ActionHold(walker,fixture);
            foreach(int kind in new[]{1,2,3})
            {
                people.Crowd!.PuppetVehicle(p,kind,2,5);people.Crowd.PuppetGo(p,p.X,p.Z+10,1.3);await Frames(20);
                Jef.I.Place((float)p.X+1.5f,(float)p.Z,0);Talk.I.Open(walker.R.Id,walker.R.Name);await Frames(30);
                var stopped=new Vector2((float)p.X,(float)p.Z);double distance=people.Crowd.PuppetVehicleDistance(p);double yaw=p.Yaw;
                await Frames(45);
                Check(stopped.DistanceTo(new((float)p.X,(float)p.Z))<.03f,"vehicle "+kind+" person stops");
                Check(Math.Abs(people.Crowd.PuppetVehicleDistance(p)-distance)<.03,"vehicle "+kind+" wheels and horse stop");
                Check(Math.Abs(p.Yaw-yaw)<.03,"vehicle "+kind+" keeps vehicle heading while speaker turns");
                await Shot("talk-vehicle-"+kind,p.Group.Position+new Vector3(kind==3?3:-3,1.7f,2.5f),p.Group.Position+Vector3.Up*.9f);
                Talk.I.Close();await Frames(40);Check(!p.Conversing,"vehicle "+kind+" released");
            }
            people.Crowd!.PuppetVehicle(p,0);people.ActionRelease(walker,fixture);
            var posted=PostedPeople.I!.List.FirstOrDefault(n=>n.Present&&n.Human!=null);
            Check(posted!=null,"a working employer is available");
            if(posted!=null){Jef.I.Place((float)posted.X+1.3f,(float)posted.Z+1,0);Talk.I.Open(posted.Id,posted.Name);var at=new Vector2((float)posted.X,(float)posted.Z);await Frames(45);Check(at.DistanceTo(new((float)posted.X,(float)posted.Z))<.03f&&posted.Human!.Motion=="talk","working employer stays at the post and talks");Talk.I.Close();}
            var roomFloor=game.World.NativeRoom(cafe.Id)!.Value.Frame.Origin.Y;
            Jef.I.Place((float)(cafe.Door.X-cafe.Out.X*2),(float)(cafe.Door.Z-cafe.Out.Z*2),0,0,roomFloor);game.Cam.GlobalPosition=new(Jef.I.X,roomFloor+1.6f,Jef.I.Z);await Frames(45);
            var outfitAt=indoors.StandingSpots(cafe).Where(p=>!indoors.Groups.Any(g=>new Vector2(g.Position.X-(float)p.X,g.Position.Z-(float)p.Z).Length()<.9f)).OrderBy(p=>Whereabouts.Hypot(p.X-cafe.Door.X,p.Z-cafe.Door.Z)).First();
            var towardDoor=new Vector3((float)(cafe.Door.X-outfitAt.X),0,(float)(cafe.Door.Z-outfitAt.Z)).Normalized();
            var outfitEye=new Vector3((float)outfitAt.X,roomFloor+1.65f,(float)outfitAt.Z)+towardDoor*2.6f;
            foreach(string kind in new[]{"carter","porter"})
            {
                var human=Humans.Make(kind)!;human.SetIndoor(true);human.SetIdentity("room-proof-"+kind);game.View.AddChild(human.Root);
                human.Root.Position=new((float)outfitAt.X,roomFloor,(float)outfitAt.Z);human.Root.Rotation=new(0,MathF.Atan2(outfitEye.X-human.Root.Position.X,outfitEye.Z-human.Root.Position.Z),0);human.Start();human.Play("talk",0);
                Jef.I.Place((float)outfitAt.X+1,(float)outfitAt.Z+1,0,0,roomFloor);
                for(int frame=0;frame<30;frame++){human.Update(1f/30);await Frames(1);}
                Check(human.IsPeople2&&human.AnimationState.Clip is {} clip&&!clip.StartsWith("cart_")&&!clip.StartsWith("truck_"),kind+" keeps street clothes and uses a natural room talk pose");
                await Shot("indoor-"+kind,outfitEye,human.Root.Position+Vector3.Up);
                human.Dispose();await Frames(2);
            }


        }
        catch(Exception e){error=e.ToString();GD.PrintErr(error);}
        File.WriteAllText(Path.Combine(output,"conversation.json"),JsonSerializer.Serialize(new{checks,rooms=rooms.Count,error},new JsonSerializerOptions{WriteIndented=true}));
        game.GetTree().Quit(error==null&&checks.All(c=>(bool)c.GetType().GetProperty("pass")!.GetValue(c)!)?0:1);
    }
}
