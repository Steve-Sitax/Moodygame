using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Menu;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.World;

namespace Scheldemist.Native.World;

public static class NativeNetRackProof
{
    public static async Task Run(NativeTownGame game,string output)
    {
        var checks=new List<object>();var pictures=new List<object>();
        void Check(string name,bool passed){checks.Add(new{name,passed});if(!passed)throw new InvalidOperationException(name);GD.Print("net proof: "+name);}
        async Task Frames(int n){for(int i=0;i<n;i++)await game.ToSignal(game.GetTree(),SceneTree.SignalName.ProcessFrame);}
        async Task Until(Func<bool> ready,int seconds=45){var end=DateTime.UtcNow.AddSeconds(seconds);while(!ready()){if(DateTime.UtcNow>end)throw new TimeoutException("Net proof wait expired");await Frames(1);}}
        try
        {
            Directory.CreateDirectory(output);string work=Path.GetFullPath(Path.Combine(output,".."));
            Check("isolated save",Path.GetFullPath(Paths.Database).StartsWith(work+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase));
            await Until(()=>game.Loaded&&!Loading.Busy&&GameState.I.Live,600);MainMenu.I!.Start();var j=Jef.I;
            await ServerLink.I!.Api!.Post<OkReply>("api/arrival/ashore");j.Place(-153.5f,67,0);await Until(()=>!j.Riding);
            j.TestInput=true;if(j.Fly)j.ToggleFly();j.Place(-153.5f,67,0);await Frames(60);Check("quay remains walkable",j.Grounded&&!j.Swimming);
            MeshInstance3D Find(string name)=>BakedWorld.All(game.World).OfType<MeshInstance3D>().Single(n=>n.Name==name);
            var solid=Find("nets_trades_solid");var net=Find("nets_trades_decal");var drying=Find("vliet_drying_net");var frame=Find("quayfurniture_-3,1,0");
            var oldSolid=ResourceLoader.Load<ArrayMesh>(Path.Combine(work,"originals/r001552.res"));var oldNet=ResourceLoader.Load<ArrayMesh>(Path.Combine(work,"originals/r001553.res"));
            var oldRoot=ResourceLoader.Load<PackedScene>(Path.Combine(work,"originals/node-07947.scn")).Instantiate<Node3D>();var oldDry=oldRoot.GetNode<MeshInstance3D>("vliet_drying_net").Mesh!;var oldFrame=oldRoot.GetNode<MeshInstance3D>("quayfurniture_-3,1,0").Mesh!;
            Check("mender collision remains exactly 420 coarse triangles",solid.Mesh.GetMeta("native_solid_stand_in").AsVector3Array().SequenceEqual(global::NetRackGeometry.Faces(oldSolid)));
            Check("decorative hanging nets have no collision triangles",net.Mesh.HasMeta("native_solid_skip")&&!net.Mesh.HasMeta("native_solid_stand_in"));
            int oldTriangles=global::NetRackGeometry.Faces((ArrayMesh)oldDry).Length/3,newTriangles=drying.Mesh.GetMeta("native_solid_stand_in").AsVector3Array().Length/3;
            Check("drying net collision stays below 100 triangles",newTriangles<100&&newTriangles<oldTriangles/100);
            Check("unrelated quay furniture collision retained",frame.Mesh.GetMeta("native_solid_stand_in").AsVector3Array().SequenceEqual(global::NetRackGeometry.Faces((ArrayMesh)oldFrame)));
            await game.ToSignal(game.GetTree(),SceneTree.SignalName.PhysicsFrame);
            string Hit(Node3D node,Vector3 a,Vector3 b)=>Solid.I.NameAt(node.GlobalTransform*a,node.GlobalTransform*b);
            Check("mender pole blocks a ray",Hit(solid,new(-2.6f,1,-.3f),new(-2.6f,1,.3f)).Contains("nets_trades_solid"));
            Check("mender cloth does not add an invisible wall",!Hit(net,new(-1.8f,1,-.3f),new(-1.8f,1,.3f)).Contains("nets_trades"));
            Check("drying curtain still blocks at working height",Hit(drying,new(0,-1,-.35f),new(0,-1,.35f)).Contains("vliet_drying_net"));
            Check("space below drying curtain remains open",!Hit(drying,new(0,-2.2f,-.35f),new(0,-2.2f,.35f)).Contains("vliet_drying_net"));
            Check("drying support post remains solid",Hit(drying,new(-1.5f,-1.3f,-.3f),new(-1.5f,-1.3f,.3f)).Contains("quayfurniture"));
            var current=new[]{solid.Mesh,net.Mesh,drying.Mesh,frame.Mesh};var before=new[]{(Mesh)oldSolid,oldNet,oldDry,oldFrame};var nodes=new[]{solid,net,drying,frame};
            j.Frozen=true;var camera=new Camera3D{Current=true,Fov=58,Near=.025f};game.View.AddChild(camera);camera.MakeCurrent();
            var views=new[]{("menders-front",new Vector3(-147,1.6f,67),new Vector3(-151,1.15f,67)),("menders-close",new Vector3(-149,1.3f,65.4f),new Vector3(-151,1.2f,65.4f)),("menders-back-low",new Vector3(-153.7f,.35f,67.5f),new Vector3(-151.4f,1.1f,67)),("menders-top",new Vector3(-151.6f,3,68),new Vector3(-151.8f,.5f,67)),("vliet-front",new Vector3(-145,1.6f,82),new Vector3(-146.3f,1.5f,77.4f)),("vliet-back-low",new Vector3(-147.3f,.4f,75.8f),new Vector3(-146.3f,1.6f,77.4f))};
            foreach(var (light,hour,weather) in new[]{("day",13d,"clear"),("rain",13d,"rain"),("night",23d,"clear")})
            {
                await Scheldemist.Dev.Kit.I.Light(hour,weather);await Frames(90);
                foreach(var (view,eye,at) in views)
                {
                    camera.GlobalPosition=eye;camera.LookAt(at);
                    foreach(string phase in view is "menders-front" or "menders-close" or "vliet-front"?new[]{"before","after"}:new[]{"after"})
                    {
                        for(int i=0;i<nodes.Length;i++)nodes[i].Mesh=phase=="before"?before[i]:current[i];await Frames(8);await game.ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);
                        string name=light+"-"+view+"-"+phase+".png";using var shot=game.GetViewport().GetTexture().GetImage();if(shot.SavePng(Path.Combine(output,name))!=Error.Ok)throw new IOException(name);pictures.Add(new{name,hour,weather});
                    }
                }
            }
            oldRoot.Free();File.WriteAllText(Path.Combine(output,"result.json"),JsonSerializer.Serialize(new{passed=true,checks,pictures,collision=new{oldTriangles,newTriangles},report=game.World.Report},new JsonSerializerOptions{WriteIndented=true}));
            GD.Print("NET_RACK_GAMEPLAY_PASS: "+checks.Count+" checks");game.GetTree().Quit();
        }
        catch(Exception e){File.WriteAllText(Path.Combine(output,"result.json"),JsonSerializer.Serialize(new{passed=false,checks,error=e.ToString()}));GD.PushError(e.ToString());game.GetTree().Quit(1);}
    }
}
