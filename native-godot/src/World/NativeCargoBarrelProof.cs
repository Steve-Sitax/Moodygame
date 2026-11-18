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
using Scheldemist.Play;
using Scheldemist.Player;
using Scheldemist.World;

namespace Scheldemist.Native.World;

/// <summary>Opt-in inspection of the installed barrel, including authoritative lift/put and live physics.</summary>
public static class NativeCargoBarrelProof
{
    public static async Task Run(NativeTownGame game,string output)
    {
        var checks=new List<object>();var pictures=new List<object>();
        void Check(string name,bool passed){checks.Add(new{name,passed});if(!passed)throw new InvalidOperationException(name);GD.Print("barrel proof: "+name);}
        async Task Frames(int n){for(int i=0;i<n;i++)await game.ToSignal(game.GetTree(),SceneTree.SignalName.ProcessFrame);}
        async Task Until(Func<bool> ready,int seconds=60){var end=DateTime.UtcNow.AddSeconds(seconds);while(!ready()){if(DateTime.UtcNow>end)throw new TimeoutException("Barrel proof wait expired");await Frames(1);}}
        IEnumerable<Node> All(Node root){yield return root;foreach(var child in root.GetChildren())foreach(var n in All(child))yield return n;}
        try
        {
            Directory.CreateDirectory(output);
            Check("isolated proof database",Path.GetFullPath(Paths.Database).StartsWith(Path.GetFullPath(Path.Combine(output,".."))+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase));
            await Until(()=>game.Loaded&&!Loading.Busy&&GameState.I.Live&&Goods.I?.Loaded==true,600);
            MainMenu.I!.Start();var j=Jef.I;var goods=Goods.I;
            await ServerLink.I!.Api!.Post<OkReply>("api/arrival/ashore");j.Place(10,12,0);await Until(()=>!j.Riding,20);
            var item=goods.Items.Where(i=>i.S.Look=="cask"&&i.Obj!=null&&!i.Heavy&&!i.CartOnly&&i.Y<.1f&&!GoodsRules.HasAbove(goods.All.Values.Select(v=>v.S),i.Id)).OrderBy(i=>Math.Abs(i.X-27)+Math.Abs(i.Z-17)).First();
            string id=item.Id;var origin=new Vector3(item.X,item.Y,item.Z);float h=(float)GoodsRules.HeightOf(item.S);
            var mesh=All(item.Obj!).OfType<MeshInstance3D>().First(m=>m.Mesh?.ResourcePath.EndsWith("cargo-barrel-20261117/barrel-mesh.res")==true);
            Check("live item uses installed barrel",mesh.Mesh!.GetSurfaceCount()==2);
            var shape=All(item.Obj!).OfType<CollisionShape3D>().Single();
            Check("one primitive collider and no triangle collision",All(item.Obj!).OfType<CollisionShape3D>().Count()==1&&shape.Shape is BoxShape3D);
            Check("original collision dimensions retained",((BoxShape3D)shape.Shape).Size.DistanceTo(new(.66f,h,.66f))<.00001f);
            void RayCheck(string label)
            {
                using var q=PhysicsRayQueryParameters3D.Create(new(item.X,item.Y+h+.2f,item.Z),new(item.X,item.Y-.1f,item.Z),Solid.Layer);
                var hit=game.View.FindWorld3D().DirectSpaceState.IntersectRay(q);
                Check(label,hit.Count>0&&hit["collider"].AsGodotObject()==shape.GetParent()&&Math.Abs(hit["position"].AsVector3().Y-item.Y-h)<.002f);
            }
            await game.ToSignal(game.GetTree(),SceneTree.SignalName.PhysicsFrame);RayCheck("live ray hits barrel top");
            j.TestInput=true;if(j.Fly)j.ToggleFly();j.Place(item.X,item.Z+1.1f,0,0,0);await Frames(120);
            GoodsReply? answer=null;void Answer(object ask,GoodsReply reply){if(JsonSerializer.SerializeToElement(ask).TryGetProperty("id",out var askedId)&&askedId.GetString()==id)answer=reply;}
            goods.Answered+=Answer;
            try
            {
                goods.Lift(item);await Until(()=>answer!=null);await Frames(3);
                Check("server accepts barrel pickup",answer!.Ok&&goods.Carried?.Id==id&&item.S.ByPlayer==goods.Me);
                Check("carried barrel collision disabled",shape.Disabled&&((CollisionObject3D)shape.GetParent()).CollisionLayer==0);
                answer=null;Check("barrel can be placed",goods.PutDown(origin.X,origin.Z)!=null);await Until(()=>answer!=null);await Frames(3);
                Check("server accepts placement with stable ID",answer!.Ok&&goods.Carried==null&&goods.All[id].S.Lies&&goods.All[id].S.N>0);
                Check("placed barrel collision restored",!shape.Disabled&&((CollisionObject3D)shape.GetParent()).CollisionLayer==Solid.Layer);
                await game.ToSignal(game.GetTree(),SceneTree.SignalName.PhysicsFrame);RayCheck("placed barrel supports physics ray");
            }
            finally{goods.Answered-=Answer;}
            j.Frozen=true;
            var camera=new Camera3D{Fov=55,Near=.025f,Current=true};game.View.AddChild(camera);camera.MakeCurrent();
            foreach(var (light,hour,weather) in new[]{("day",13d,"clear"),("rain",13d,"rain"),("night",23d,"clear")})
            {
                await Scheldemist.Dev.Kit.I.Light(hour,weather);await Frames(120);
                foreach(var (angle,offset) in new[]{("front",new Vector3(.85f,.65f,1.1f)),("top",new Vector3(.65f,1.4f,.65f)),("back-low",new Vector3(-.8f,.13f,-.95f))})
                {
                    camera.GlobalPosition=origin+offset;camera.LookAt(origin+new Vector3(0,.48f,0));await Frames(12);
                    await game.ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);
                    string name=light+"-"+angle+".png";using var shot=game.GetViewport().GetTexture().GetImage();Check("saved "+name,shot.SavePng(Path.Combine(output,name))==Error.Ok);pictures.Add(new{name,hour,weather});
                }
            }
            File.WriteAllText(Path.Combine(output,"result.json"),JsonSerializer.Serialize(new{passed=true,id,position=origin.ToString(),checks,pictures},new JsonSerializerOptions{WriteIndented=true}));
            GD.Print($"CARGO_BARREL_GAMEPLAY_PASS: {checks.Count} checks");game.GetTree().Quit();
        }
        catch(Exception e){File.WriteAllText(Path.Combine(output,"result.json"),JsonSerializer.Serialize(new{passed=false,checks,error=e.ToString()}));GD.PushError(e.ToString());game.GetTree().Quit(1);}
    }
}
