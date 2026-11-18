using System;
using System.Collections.Generic;
using System.Linq;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.World;
using Scheldemist.Play;
using Scheldemist.Movers;
using Scheldemist.Net;
namespace Scheldemist.Player;
public static class RiverTraversalProof
{
 public static async Task Run(Main game,string output){Directory.CreateDirectory(output);var checks=new List<object>();var notes=new List<object>();bool failed=false;
 void Check(string name,bool ok){checks.Add(new{name,ok});GD.Print("river proof: "+name+" "+ok);if(!ok)failed=true;}
 async Task Frames(int n=1){for(int i=0;i<n;i++)await game.ToSignal(game.GetTree(),SceneTree.SignalName.ProcessFrame);}
 async Task Shot(string name){await Frames(8);await game.ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);using var im=game.GetViewport().GetTexture().GetImage();im.SavePng(Path.Combine(output,name+".png"));}
 try{
 Check("isolated save",Paths.Database.Contains(".scratch"));await ServerLink.I!.Api!.Post<OkReply>("api/arrival/ashore");var j=Jef.I; j.TestInput=true;if(j.Fly)j.ToggleFly();j.Place(-118,36,0);await Frames(60);
 await Dev.Kit.I.Light(13,"clear");
 var sw=ShipWalk.I;
 if(!game.Flag("river-visual-only")){
 var kinds=new[]{"rowboat","punt","shipsboat","workboat","brig","steamer_line","schooner","lighter"};
 foreach(string kind in kinds){var d=sw.Decks.FirstOrDefault(d=>d.Kind==kind&&d.Visible()&&Water.In(d.World().Origin.X,d.World().Origin.Z));if(d==null){notes.Add(new{kind,skipped="no visible vessel within playable water"});continue;}
 var p=d.Mesh.Nearest(Vector2.Zero);var at=d.At(p);sw.Clear();j.Drive=null;j.ClearKeys();Solid.I.Ensure(at,16);j.Carry(at+Vector3.Up*2);j.Knock(Vector2.Zero,.01f,0);j.SetKey(Key.Space,true);
 var trace=new List<object>();string state="";for(int f=0;f<100;f++){await Frames();string now=$"{j.Grounded}/{j.Swimming}/{sw.On?.Kind}/{d.Visible()}";if(now!=state){state=now;trace.Add(new{frame=f,state,x=j.X,y=j.Y,z=j.Z,floor=d.At(p).Y,world=d.World().Origin.ToString(),water=j.LastWater});}}
 notes.Add(new{kind,swimming=j.Swimming,on=sw.On?.Kind,feet=j.Y,floor=d.At(p).Y,trace});Check("drop lands dry without repeated jumps on "+kind,!j.Swimming&&sw.On!=null);j.ClearKeys();await Frames(2);
 if(kind=="rowboat"||kind=="steamer_line")await Shot("aboard-"+kind);
 var water=sw.WaterBeside(d);Check("safe water outside "+kind,water!=null&&j.SwimFree(water.Value.X,water.Value.Z));
 if(sw.ExitBeside(d)==null){sw.Leave();await Frames(10);Check("leaving "+kind+" enters water outside hull",j.Swimming&&j.SwimFree(j.X,j.Z));}
 else if(kind=="rowboat") {var exit=sw.ExitBeside(d)!;sw.Leave();Check("nearby shore exit starts climb",j.Climbing&&!j.Swimming);for(int f=0;f<300&&j.Climbing;f++)await Frames();Check("boat exit reaches ladder or stairs",!j.Swimming&&!j.Climbing&&new Vector2(j.X-exit.Tx,j.Z-exit.Tz).Length()<1.2f);await Shot("shore-exit");}
 var hull=Boats.I.HullOf(kind)!;var xf=d.World();int samples=0,blocked=0,under=0;
 for(int z=2;z<hull.Nz-2;z+=Math.Max(1,hull.Nz/5))for(int x=2;x<hull.Nx-2;x+=Math.Max(1,hull.Nx/5)){
 if(!hull.Has(x,z))continue;int i=z*hull.Nx+x;float y=Math.Min(hull.Hi[i]-.05f,0);if(y<=hull.Lo[i])continue;
 var inside=xf*new Vector3(hull.MinX+(x+.5f)*Boats.HullMap.Cell,y,hull.MinZ+(z+.5f)*Boats.HullMap.Cell);
 samples++;if(Boats.I.Hits(kind,xf,inside.X,inside.Z,.2f,inside.Y-.2f,inside.Y+.2f))blocked++;
 var below=xf*new Vector3(hull.MinX+(x+.5f)*Boats.HullMap.Cell,hull.Bottom-.9f,hull.MinZ+(z+.5f)*Boats.HullMap.Cell);
 if(!Boats.I.Hits(kind,xf,below.X,below.Z,.2f,below.Y-.2f,below.Y+.2f))under++;
 }
 Check("sealed hull with keel clearance: "+kind,samples>0&&blocked==samples&&under==samples);
 }
 // Push up against a real moored hull, sampling every frame for penetration.
 var diveDeck=sw.Decks.First(d=>d.Kind=="brig"&&d.Visible());var diveMap=Boats.I.HullOf(diveDeck.Kind)!;var diveWater=sw.WaterBeside(diveDeck);
 sw.Clear();j.ClearKeys();j.DropFromBoat(diveWater!.Value);await Frames(80);j.SetKey(Key.C,true);await Frames(6);j.ClearKeys();Check("C starts dive",j.Diving);
 var diveStart=diveDeck.World()*new Vector3(0,diveMap.Bottom-.65f,0);Check("room beneath keel",j.DiveFree(diveStart));j.X=diveStart.X;j.Y=diveStart.Y-Jef.Eye;j.Z=diveStart.Z;j.Body.GlobalPosition=new(j.X,j.Y,j.Z);
 int penetrations=0;float rise0=j.Y,maxEye=j.Y+Jef.Eye;j.SetKey(Key.Space,true);
 for(int f=0;f<160;f++){await Frames();var eye=new Vector3(j.X,j.Y+Jef.Eye,j.Z);maxEye=Math.Max(maxEye,eye.Y);if(Boats.I.Hits(diveDeck.Kind,diveDeck.World(),eye.X,eye.Z,Jef.DiveR*.8f,eye.Y-Jef.DiveR*.8f,eye.Y+Jef.DiveR*.8f))penetrations++;}
 j.ClearKeys();notes.Add(new{penetrations,maxEye,below=diveStart.ToString(),diving=j.Diving});Check("swimming up cannot enter hull",penetrations==0&&j.Diving&&maxEye>rise0+Jef.Eye+.1f);await Shot("under-hull");
 // The controllable rowing copy has its own hull and must use the same safe exit selection.
 var row=Rowing.I;var berth=row.Data.Landings[0];sw.Clear();j.Place(berth.Landing[0],berth.Landing[1],0);await Frames(15);await row.Hire(berth);await Frames(4);Check("hired rowing boat is seated",row.Boat!=null);row.Apply(row.Data);Check("rowing boat remains visible after server refresh",row.Boat?.Root.IsVisibleInTree()==true);
 if(row.Boat!=null){Check("rowing berth offers shore exit",row.ExitHere()!=null);await row.Leave(row.ExitHere());for(int f=0;f<300&&j.Climbing;f++)await Frames();Check("rowing exit reaches shore",row.Boat==null&&!j.Swimming&&!j.Climbing);}
 j.Place(berth.Landing[0],berth.Landing[1],0);await Frames(10);await row.Hire(berth);await Frames(4);
 if(row.Boat!=null){row.Rower.X=-160;row.Rower.Z=-120;row.Rower.Y=Water.Level(-160,-120);row.Rower.Speed=row.Rower.Turn=0;await Frames(8);row.Apply(row.Data);await Frames(2);notes.Add(new{rowing=true,boat=row.Boat?.Key,visible=row.Boat?.Root.IsVisibleInTree(),position=row.Boat?.Root.GlobalPosition.ToString(),x=row.Rower.X,z=row.Rower.Z});Check("rowed copy blocks surface swimming",!j.SwimFree(row.Rower.X,row.Rower.Z));await row.Leave(null);await Frames(20);Check("rowing exit in open river clears hull",row.Boat==null&&j.Swimming&&j.SwimFree(j.X,j.Z));}else Check("second rowing hire succeeds",false);

 // Real keys: a short tap beside a crate jumps instead of pulling Jef into a canned climb.
 sw.Clear();j.Drive=null;j.Place(-118,36,0);await Frames(45);float start=j.Y;j.SetKey(Key.Space,true);await Frames(2);Check("jump starts immediately",!j.Grounded&&!j.Climbing&&j.Y>start);j.ClearKeys();await Frames(70);Check("jump returns to ground",j.Grounded&&!j.Swimming);
 // A reachable 1 m ledge: hold forward and jump; record continuity and time under assisted control.
 var obstacle=new StaticBody3D{Position=new(-118, .5f,34.5f),CollisionLayer=Solid.Layer,CollisionMask=0};obstacle.AddChild(new CollisionShape3D{Shape=new BoxShape3D{Size=new(2,1,1)}});obstacle.AddChild(new MeshInstance3D{Mesh=new BoxMesh{Size=new(2,1,1)}});game.View.AddChild(obstacle);await Frames(4);using(var query=PhysicsRayQueryParameters3D.Create(new(-118,2,34.5f),new(-118,.5f,34.5f),Solid.Layer)){var hit=game.View.FindWorld3D().DirectSpaceState.IntersectRay(query);Check("ledge fixture has live collision",hit.Count>0&&hit["position"].AsVector3().Y>.9f);}
 j.Place(-118,36,0);await Frames(30);j.SetKey(Key.W,true);j.SetKey(Key.Space,true);float maxStep=0;Vector3 last=new(j.X,j.Y,j.Z);int assisted=0;float assistTime=0;
 for(int i=0;i<90;i++){await Frames();var now=new Vector3(j.X,j.Y,j.Z);maxStep=Math.Max(maxStep,now.DistanceTo(last));last=now;if(j.Climbing){assisted++;assistTime+=j.FrameDt;}if(j.Z<33.7f)break;}
 j.ClearKeys();notes.Add(new{maxStep,assisted,assistTime,z=j.Z,y=j.Y});Check("ledge traversal clears obstacle",j.Z<34.6f&&j.Y>.8f||j.Z<33.9f);Check("ledge movement has no teleport",maxStep<.4f);Check("ledge assistance stays brief",assistTime<1.3f);await Shot("ledge");obstacle.QueueFree();
 }
 // Full river bed at both the old map edge and the far water extent.
 var space=game.View.FindWorld3D().DirectSpaceState;int beds=0;
 foreach(float x in new[]{-650f,-400,-150,100,440})foreach(float z in new[]{-90f,-140,-180,-220,-250}){using var q=PhysicsRayQueryParameters3D.Create(new(x,2,z),new(x,-20,z),Solid.Layer);var hit=space.IntersectRay(q);if(hit.Count>0){float y=hit["position"].AsVector3().Y;if(y<0&&y>-15.2f&&(z != -140 && z != -180 || y < -13.8f))beds++;}}
 Check("continuous riverbed with deep channel and bank transitions",beds==25);
 var scenery=game.View.GetNode<Node3D>("scheldt_scenery");var treeGroups=scenery.GetChildren().OfType<MultiMeshInstance3D>().ToArray();
 Check("all distant trees have saved placements",treeGroups.Sum(t=>t.Multimesh.InstanceCount)==136&&treeGroups.All(t=>t.Multimesh.Buffer.Length==t.Multimesh.InstanceCount*12&&t.Multimesh.GetInstanceTransform(0).Origin.Z < -300));
 var houses=scenery.GetChildren().OfType<Node3D>().Where(h=>h.Name.ToString().StartsWith("bank_house_")).ToArray();int conflicts=0;
 foreach(var trees in treeGroups)for(int i=0;i<trees.Multimesh.InstanceCount;i++)foreach(var house in houses){var at=house.Transform.AffineInverse()*trees.Multimesh.GetInstanceTransform(i).Origin;var box=house.GetChild<MeshInstance3D>(0).Mesh.GetAabb().Grow(1.8f);if(at.X>box.Position.X&&at.X<box.End.X&&at.Z>box.Position.Z&&at.Z<box.End.Z)conflicts++;}
 Check("trees clear houses and roof edges",conflicts==0);Check("scenery uses one static collision body",scenery.GetChildren().OfType<StaticBody3D>().Count()==1);
 j.Frozen=true;var cam=new Camera3D{Current=true,Fov=62,Near=.03f,CullMask=0xFFFFF&~Arms.BodyLayer&~Mirrors.NoMirror};game.View.AddChild(cam);cam.MakeCurrent();game.Ui.Visible=false;
 foreach(var (label,hour,weather) in new[]{("day",13d,"clear"),("rain",13d,"rain"),("night",23d,"clear")}){await Dev.Kit.I.Light(hour,weather);await Frames(50);
 foreach(var (name,eye,target) in new[]{("opposite-bank",new Vector3(-118,3,-25),new Vector3(-118,4,-420)),("bank-close",new Vector3(-500,14,-335),new Vector3(-500,5,-410)),("house-front",new Vector3(-510,2.5f,-371),new Vector3(-519,3,-380)),("house-back-low",new Vector3(-529,1.2f,-387),new Vector3(-519,3,-380)),("bed",new Vector3(-160,-12,-140),new Vector3(-135,-14.4f,-165))}){cam.GlobalPosition=eye;cam.LookAt(target);await Shot(label+"-"+name);}}
 cam.QueueFree();File.WriteAllText(Path.Combine(output,"result.json"),JsonSerializer.Serialize(new{passed=!failed,checks,notes},new JsonSerializerOptions{WriteIndented=true}));game.GetTree().Quit(failed?1:0);
 }catch(Exception e){File.WriteAllText(Path.Combine(output,"result.json"),JsonSerializer.Serialize(new{passed=false,checks,notes,error=e.ToString()},new JsonSerializerOptions{WriteIndented=true}));GD.PushError(e.ToString());game.GetTree().Quit(1);}
 }
}

