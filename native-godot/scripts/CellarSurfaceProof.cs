using System;
using System.IO;
using System.Threading.Tasks;
using Godot;
using Scheldemist;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.Play;
using Scheldemist.World;

/// <summary>Inspect cellar openings from above and below; writes only isolated proof captures.</summary>
public partial class CellarSurfaceProof : Node
{
    private async Task Frames(int count) { for(int i=0;i<count;i++)await ToSignal(GetTree(),SceneTree.SignalName.ProcessFrame); }
    public override async void _Ready()
    {
        try
        {
            while(Main.I==null || !Main.I.Loaded || ServerLink.I?.Up!=true || !GameState.I.Live)await Frames(1);
            string output=Path.GetFullPath(Main.I.Arg("cellar-record")); Directory.CreateDirectory(output);
            Engine.MaxFps=30; Jef.I.TestInput=true;
            Doors.I.Held=true; var door=Doors.I.Get("poesje")??throw new Exception("Poesje door missing"); Doors.I.Force(door,true);
            await ServerLink.I!.Api!.Post<OkReply>("api/arrival/ashore");
            Jef.I.Place(-119.8f,82,0); if(!Jef.I.Fly)Jef.I.ToggleFly();
            var previousCamera=Main.I.Cam;
            var camera=new Camera3D{Fov=70,Near=.025f,CullMask=previousCamera.CullMask&~Arms.BodyLayer,Environment=previousCamera.Environment};
            Main.I.View.AddChild(camera);camera.MakeCurrent();Main.I.Cam=camera;
            var views=new (string Name,Vector3 Eye,Vector3 Target)[] {
                ("street",new(-119.8f,1.6f,81.5f),new(-119.8f,-.4f,78)),
                ("top",new(-119.8f,1.2f,79),new(-119.8f,-1.8f,76)),
                ("low",new(-119.8f,-.65f,75.3f),new(-119.8f,.08f,78.2f)),
                ("side",new(-120.05f,-.25f,77),new(-119.4f,-.25f,77.8f)) };
            foreach(string weather in new[]{"day","rain","night"})
            {
                int hour=weather=="night"?22:13;
                GameState.I.Apply(await ServerLink.I.Api!.Post<JobsPayload>("api/dev/set",new{day=1,hour,minute=0,weather=weather=="rain"?"rain":"clear"}));
                Daylight.I.SetTime(hour); Daylight.I.Settle(); await Frames(60);
                foreach(var view in views)
                {
                    camera.GlobalPosition=view.Eye; camera.LookAt(view.Target);
                    await Frames(15);
                    await ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);
                    Main.I.View.GetTexture().GetImage().SavePng(Path.Combine(output,$"{weather}-{view.Name}.png"));
                }
            }
            Main.I.Cam=previousCamera;previousCamera.MakeCurrent(); if(Jef.I.Fly)Jef.I.ToggleFly();
            var walk=new HomeDoorTest(); AddChild(walk);
            await walk.RunWalkProof(output,"poesje:-2.2");
            GD.Print("CELLAR_SURFACE_CAPTURES: 12 day/rain/night views"); GetTree().Quit();
        }
        catch(Exception e){GD.PrintErr(e);GetTree().Quit(1);}
    }
}
