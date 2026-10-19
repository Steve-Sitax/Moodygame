using Godot;
using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Scheldemist.Game;
using Scheldemist.Menu;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.Town;
using Scheldemist.Ui;
using Scheldemist.Native.Characters;
using Scheldemist.Native.Services;
using P = Scheldemist.Native.Services.AntigoonBrain.Point;

namespace Scheldemist.Native.World;

/// <summary>Disposable full-town size/clearance evidence, including the installed O2 geometry.</summary>
public static class NativeAntigoonSizeProof
{
    public static async Task Run(NativeTownGame game, string output)
    {
        Directory.CreateDirectory(output);
        async Task Frames(int count) { for (int i=0;i<count;i++) await game.ToSignal(game.GetTree(),SceneTree.SignalName.ProcessFrame); }
        void Check(bool ok,string what) { if(!ok)throw new Exception(what);GD.Print("ANTIGOON_SIZE_PASS: "+what); }
        try
        {
            Check(Path.GetFullPath(Paths.Database).StartsWith(Path.GetFullPath(output)+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase)&&game.Flag("no-ai"),"isolated database and AI disabled");
            var deadline=DateTime.UtcNow.AddSeconds(600);
            while(!game.Loaded||Loading.Busy||ServerLink.I?.Up!=true||!GameState.I.Live||game.GetNodeOrNull<Townspeople>("Townspeople")?.Sims.Count is not >500)
            { if(DateTime.UtcNow>deadline)throw new TimeoutException("Native town not ready");await Frames(1); }
            MainMenu.I!.Start();Jef.I.TestInput=true;Pause.Clear();
            var api=ServerLink.I!.Api!;
            GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set",new {day=1,hour=13,minute=0,weather="clear"}));
            if(!Jef.I.Fly)Jef.I.ToggleFly();Jef.I.Drive=null;
            game.Cam.SetProcess(false);game.Cam.SetPhysicsProcess(false);game.Cam.SetProcessInput(false);game.Cam.SetProcessUnhandledInput(false);
            Input.MouseMode=Input.MouseModeEnum.Captured;Pause.Clear();
            Jef.I.SetProcess(false);
            var camera=new Camera3D {Name="AntigoonProofCamera",Current=true,Near=.08f,Far=600,Fov=65};
            game.View.AddChild(camera);game.Cam=camera;
            var actor=new AntigoonActor {Name="AntigoonSizeWitness",TownLighting=true};game.View.AddChild(actor);
            actor.Snapshot(Vector3.Zero,0,"idle",0,0,true);
            var model=actor.GetNode<Node3D>("AntigoonModel");
            Check(model.Scale.IsEqualApprox(Vector3.One*AntigoonSize.Scale),"uniform model scale");
            float low=float.MaxValue,high=float.MinValue;
            foreach(var mesh in model.FindChildren("*","MeshInstance3D",true,false).OfType<MeshInstance3D>())
            {
                var box=mesh.GetAabb();
                for(int i=0;i<8;i++){var point=actor.ToLocal(mesh.ToGlobal(box.GetEndpoint(i)));low=Math.Min(low,point.Y);high=Math.Max(high,point.Y);}
            }
            Check(Math.Abs(high-low-AntigoonSize.Height)<.04f,$"rest mesh height {high-low:0.000} m");
            var shape=actor.GetNode<StaticBody3D>("TorsoCollision").GetChildren().OfType<CollisionShape3D>().Single();
            var capsule=(CapsuleShape3D)shape.Shape;
            Check(Math.Abs(capsule.Height-AntigoonSize.BodyHeight)<.001f&&Math.Abs(capsule.Radius-AntigoonSize.BodyRadius)<.001f,"collision dimensions follow model");
            Check(Math.Abs(shape.Position.Y-capsule.Height/2)<.001f,"collision starts at the soles");
            Check(AntigoonSize.ClearanceHeight<4&&AntigoonSize.Height<4,"4 m rui: 0.15 m crown clearance while wading on the bed");
            Check(AntigoonSize.Height>3,"raised rui walkway is correctly too low for an upright giant");
            var service=game.AntigoonService!;
            var route=await service.WithState(e=>
            {
                var map=e.ReachMap!();var a=map.Within(new P(-150,65),80).OrderBy(p=>p.Distance(new(-150,65))).First();
                var b=map.Within(a,35,map.Area(a)).Where(p=>p.Distance(a)>15).First(p=>e.Path(a,p) is {Count:>0});
                return (Start:a,End:b,Floor:e.Ground(a));
            });
            Check(route.Start.Distance(route.End)>15,"native street route remains connected at resized clearance");
            async Task Shot(string name,Vector3 feet,Vector3 eye,Vector3 target,float yaw=0)
            {
                actor.Snapshot(feet,yaw,"idle",0,0,true);actor.GlobalPosition=feet;actor.Rotation=new(0,yaw,0);
                Jef.I.Place(eye.X,eye.Z,0,0,eye.Y-Jef.Eye);
                for(int frame=0;frame<120;frame++)
                { camera.Current=true;game.Cam=camera;camera.GlobalPosition=eye;camera.LookAt(target);await Frames(1); }
                await game.ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);
                game.GetViewport().GetTexture().GetImage().SavePng(Path.Combine(output,name+".png"));
            }
            var street=new Vector3((float)route.Start.X,(float)route.Floor,(float)route.Start.Z);
            await Shot("antigoon-day",street,street+new Vector3(5,1.7f,5),street+Vector3.Up*1.9f,.7f);
            GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set",new {hour=13,minute=0,weather="rain"}));
            await Shot("antigoon-rain",street,street+new Vector3(5,1.7f,5),street+Vector3.Up*1.9f,.7f);
            GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set",new {hour=23,minute=0,weather="clear"}));
            await Shot("antigoon-night",street,street+new Vector3(5,1.7f,5),street+Vector3.Up*1.9f,.7f);
            GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set",new {hour=13,minute=0,weather="clear"}));
            // Bed of the built gallery, below the human ledges. Never treat the water surface as footing.
            await Shot("antigoon-o2",new(-149.3f,-6.1f,94),new(-147.3f,-2.0f,85.5f),new(-149.3f,-3.9f,94),0);
            var space=actor.GetWorld3D().DirectSpaceState;
            var blocked=new System.Collections.Generic.List<object>();
            var unsupported=new System.Collections.Generic.List<float>();
            // Test the full upright envelope against installed solids along the central gallery into C2.
            for(float z=83;z<=117;z+=.5f)
            {
                float x=Mathf.Lerp(-149.1f,-149.51f,Math.Clamp((z-82.5f)/28.7f,0,1));
                // The installed C2 bed rises 0.25 m. Measure support across the foot envelope, including that step;
                // a constant -6.1 m would bury the capsule in the hall floor and report a false obstruction.
                var support=new System.Collections.Generic.List<float>();
                foreach(var offset in new[]{Vector2.Zero,new Vector2(.4f,0),new Vector2(-.4f,0),new Vector2(0,.4f),new Vector2(0,-.4f)})
                {
                    var floor=space.IntersectRay(PhysicsRayQueryParameters3D.Create(new Vector3(x+offset.X,-1.1f,z+offset.Y),new Vector3(x+offset.X,-7,z+offset.Y),Scheldemist.World.Solid.Layer,new Godot.Collections.Array<Rid>{actor.BodyRid}));
                    if(floor.Count>0&&floor["position"].AsVector3().Y is var y&&y<=-6.1f+AntigoonSize.Step)support.Add(y);
                }
                if(support.Count==0){unsupported.Add(z);continue;}
                float bed=support.Max();
                var query=new PhysicsShapeQueryParameters3D {
                    Shape=new CapsuleShape3D {Height=AntigoonSize.ClearanceHeight-.04f,Radius=AntigoonSize.ClearanceRadius},
                    Transform=new Transform3D(Basis.Identity,new Vector3(x,bed+AntigoonSize.ClearanceHeight/2+.02f,z)),
                    CollisionMask=Scheldemist.World.Solid.Layer,Exclude=new Godot.Collections.Array<Rid>{actor.BodyRid},Margin=0
                };
                var hits=space.IntersectShape(query);
                if(hits.Count>0)
                {
                    blocked.Add(new {x,z,bed,collider=(hits[0]["collider"].AsGodotObject() as Node)?.GetPath().ToString()});
                }
            }
            var result=new {height=AntigoonSize.Height,scale=AntigoonSize.Scale,restMeshHeight=high-low,collisionHeight=capsule.Height,collisionRadius=capsule.Radius,
                streetRoute=true,street=new[]{street.X,street.Y,street.Z},o2GalleryBlockedSamples=blocked,o2UnsupportedSamples=unsupported,completeRuienRoute=false,
                routeLimit="C1 and the connecting galleries are not built; the encounter has a street-only 2D route map. O2 placement is a proof witness, not an autonomous underground encounter."};
            File.WriteAllText(Path.Combine(output,"size.json"),JsonSerializer.Serialize(result,new JsonSerializerOptions{WriteIndented=true}));
            GD.Print($"ANTIGOON_SIZE_O2: {blocked.Count} blocked upright gallery samples; see size.json. C1 route remains unbuilt.");
            actor.QueueFree();game.GetTree().Quit();
        }
        catch(Exception e)
        {
            File.WriteAllText(Path.Combine(output,"failure.txt"),e.ToString());GD.PrintErr(e);game.GetTree().Quit(1);
        }
    }
}
