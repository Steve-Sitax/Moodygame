using Godot;
using System;
using System.Linq;
using System.IO;
using Scheldemist.Native.Services;
using P = Scheldemist.Native.Services.AntigoonBrain.Point;

namespace Scheldemist.Native.Characters;

/// <summary>Isolated character acceptance/play scene. Does not load or modify a town save.</summary>
public partial class AntigoonArena : Node3D
{
    private AntigoonActor giant=null!;
    private AntigoonBrain brain=null!;
    private CharacterBody3D player=null!;
    private Camera3D camera=null!;
    private Label hud=null!;
    private OmniLight3D lamp=null!;
    private MeshInstance3D refuge=null!;
    private DirectionalLight3D sun=null!;
    private int health=10;
    private bool night=true,lit=true,proof;
    private double elapsed,expression;
    private string? preview;
    private string output="";
    private bool faceShot;
    public override void _Ready()
    {
        var args=OS.GetCmdlineUserArgs();proof=args.Contains("--antigoon-proof");faceShot=args.Contains("--antigoon-face");
        int ix=Array.IndexOf(args,"--antigoon-shot");if(ix>=0&&ix+1<args.Length)output=args[ix+1];
        var environment=new Godot.Environment { BackgroundMode=Godot.Environment.BGMode.Color, BackgroundColor=new Color(.025f,.035f,.047f), AmbientLightSource=Godot.Environment.AmbientSource.Color, AmbientLightColor=new Color(.52f,.61f,.74f), AmbientLightEnergy=.6f, TonemapMode=Godot.Environment.ToneMapper.Filmic };
        AddChild(new WorldEnvironment { Environment=environment });
        sun=new DirectionalLight3D { RotationDegrees=new Vector3(-55,-25,0),LightColor=new Color(.62f,.72f,1),LightEnergy=.8f,ShadowEnabled=true };AddChild(sun);
        Box("Floor",new Vector3(0,-.3f,0),new Vector3(46,.6f,46),new Color(.13f,.15f,.16f));
        Box("North",new Vector3(0,2,-23),new Vector3(46,4,.4f),new Color(.2f,.22f,.24f));
        Box("South",new Vector3(0,2,23),new Vector3(46,4,.4f),new Color(.2f,.22f,.24f));
        Box("East",new Vector3(23,2,0),new Vector3(.4f,4,46),new Color(.2f,.22f,.24f));
        Box("West",new Vector3(-23,2,0),new Vector3(.4f,4,46),new Color(.2f,.22f,.24f));
        // The flat disc is a test overlay marking the exact authoritative light boundary.
        refuge=new MeshInstance3D {Position=new Vector3(-8,.012f,5),Mesh=new CylinderMesh {TopRadius=4,BottomRadius=4,Height=.015f},MaterialOverride=new StandardMaterial3D {AlbedoColor=new Color(.3f,.24f,.1f),Roughness=1}};AddChild(refuge);
        lamp=new OmniLight3D {Position=new Vector3(-8,4,5),LightColor=new Color(1,.69f,.3f),LightEnergy=5,OmniRange=11,ShadowEnabled=true};AddChild(lamp);
        player=new CharacterBody3D {Name="Player",Position=new Vector3(0,.1f,12),CollisionLayer=2,CollisionMask=1};AddChild(player);
        player.AddChild(new CollisionShape3D {Position=new Vector3(0,.875f,0),Shape=new CapsuleShape3D {Radius=.32f,Height=1.75f}});
        camera=new Camera3D {Position=new Vector3(0,1.65f,0),Current=true,Fov=75,Far=150};player.AddChild(camera);
        giant=new AntigoonActor {Name="Antigoon"};AddChild(giant);
        var canvas=new CanvasLayer();AddChild(canvas);hud=new Label {Position=new Vector2(24,24)};hud.AddThemeFontSizeOverride("font_size",20);canvas.AddChild(hud);
        Reset();
        if(!proof&&output=="")Input.MouseMode=Input.MouseModeEnum.Captured;
        if(output!="") {player.Position=new Vector3(4,0,.5f);camera.GlobalPosition=new Vector3(4,3.1f,.5f);camera.Fov=43;camera.LookAt(new Vector3(0,2.7f,-8));hud.Visible=false;
            AddChild(new OmniLight3D {Position=new Vector3(2,5,-3),LightColor=new Color(1,.88f,.73f),LightEnergy=4,OmniRange=13});
            if(faceShot){camera.GlobalPosition=new Vector3(.6f,5.05f,-5.6f);camera.Fov=32;camera.LookAt(new Vector3(0,4.96f,-8));}
        }
    }
    private void Box(string name,Vector3 at,Vector3 size,Color color)
    {
        var block=new StaticBody3D {Name=name,Position=at};AddChild(block);
        block.AddChild(new MeshInstance3D {Mesh=new BoxMesh {Size=size},MaterialOverride=new StandardMaterial3D {AlbedoColor=color,Roughness=.9f}});
        block.AddChild(new CollisionShape3D {Shape=new BoxShape3D {Size=size}});
    }
    private void Reset()
    {
        health=10;night=true;lit=true;expression=0;preview=null;
        brain=new(new P(0,-8)) { Clear=p=>Math.Abs(p.X)<22&&Math.Abs(p.Z)<22,Light=p=>lit&&p.Distance(new(-8,5))<=4?1:0,HurtPlayer=(_,damage)=>health=Math.Max(0,health-damage)};
        brain.Patrol.AddRange(new[]{new P(-10,-8),new P(8,-12),new P(6,5),brain.Home});brain.Reveal();
        player.Position=new Vector3(0,.1f,12);player.Rotation=Vector3.Zero;camera.Rotation=Vector3.Zero;
    }
    public override void _PhysicsProcess(double delta)
    {
        elapsed+=delta;
        if(output!="")
        {
            giant.Snapshot(new Vector3(0,0,-8),.15f,faceShot?"laugh":"smirk",0,0,true);
            if(elapsed>2) {SetPhysicsProcess(false);_ = Shot();}return;
        }
        if(proof)
        {
            if(elapsed>.5)
            {
                string[] clips={"idle","walk","run","attack","throw","hit","recoil_light","death","roar","smirk","laugh","angry"};
                foreach(string clip in clips)if(!giant.Animations.HasAnimation(clip))throw new Exception("Missing clip "+clip);
                if(giant.Skeleton.GetBoneCount()!=46)throw new Exception("Missing bones");
                foreach(string clip in clips)
                {
                    giant.SetState(clip);giant.Animations.Advance(.35);
                    for(int i=0;i<46;i++)if(!giant.Skeleton.GetBoneGlobalPose(i).Origin.IsFinite())throw new Exception("Invalid pose "+clip);
                }
                if(giant.LodCount<1)throw new Exception("Distance LODs missing");
                GD.Print($"ANTIGOON_SCENE_PASS: 46 bones, 12 clips, {giant.LodCount} surface LODs, collision, finite animated poses, same gameplay brain.");SetPhysicsProcess(false);_ = ProveService();
            }
            return;
        }
        bool captured=Input.MouseMode==Input.MouseModeEnum.Captured;
        if(captured&&health>0)
        {
            var move=new Vector3((Input.IsPhysicalKeyPressed(Key.D)?1:0)-(Input.IsPhysicalKeyPressed(Key.A)?1:0),0,(Input.IsPhysicalKeyPressed(Key.S)?1:0)-(Input.IsPhysicalKeyPressed(Key.W)?1:0));
            move=player.Basis*move.Normalized()*(Input.IsPhysicalKeyPressed(Key.Shift)?3.4f:1.55f);
            player.Velocity=new Vector3(move.X,player.IsOnFloor()?-.1f:player.Velocity.Y-(float)delta*15,move.Z);player.MoveAndSlide();
            if(expression<=0)brain.Step(delta,night,new[]{new AntigoonBrain.Player(1,new P(player.Position.X,player.Position.Z),health>0)});
        }
        expression-=delta;
        giant.Snapshot(new Vector3((float)brain.Position.X,0,(float)brain.Position.Z),(float)brain.Yaw,expression>0?preview!:brain.State,brain.StateTime,brain.AttackSerial,brain.State!="hidden");
        giant.Pause(!captured);
        lamp.Visible=lit;refuge.Visible=lit;sun.LightEnergy=night?.8f:2.5f;
        hud.Text=$"ANTIGOON · CHARACTER TEST\nHealth {health}/10     Antigoon {brain.Health}/120 · {brain.State}\nWASD move · Shift run · Mouse look · Left click strike\nL light refuge · T day/night · R reset · Esc release mouse\n1 smirk · 2 laugh · 3 angry\n\nThe amber circle is safe while lit. Your strike reaches 2.5 m.\nHis kick lands after 0.62 s; step away or reach the light."+(health==0?"\n\nYou fell. Press R to try again.":brain.Health==0?"\n\nAntigoon defeated. Press R to reset.":"");
    }
    private async System.Threading.Tasks.Task Shot()
    {
        await ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);
        GetViewport().GetTexture().GetImage().SavePng(output);GD.Print("ANTIGOON_SHOT "+output);GetTree().Quit();
    }
    private async System.Threading.Tasks.Task ProveService()
    {
        try {await AntigoonServiceProof.Run();GetTree().Quit();}
        catch(Exception error){GD.PrintErr(error);GetTree().Quit(1);}
    }
    public override void _UnhandledInput(InputEvent e)
    {
        if(e is InputEventMouseMotion motion&&Input.MouseMode==Input.MouseModeEnum.Captured)
        {player.RotateY(-motion.Relative.X*.0025f);camera.Rotation=new Vector3(Mathf.Clamp(camera.Rotation.X-motion.Relative.Y*.0025f,-1.35f,1.35f),0,0);}
        if(e is InputEventMouseButton {Pressed:true,ButtonIndex:MouseButton.Left})
        {
            if(Input.MouseMode!=Input.MouseModeEnum.Captured){Input.MouseMode=Input.MouseModeEnum.Captured;return;}
            var dir=new Vector3((float)brain.Position.X,0,(float)brain.Position.Z)-player.Position;dir.Y=0;
            if(dir.Normalized().Dot(-player.Basis.Z)>.4f)brain.Strike(new(1,new(player.Position.X,player.Position.Z),health>0));
        }
        if(e is InputEventKey {Pressed:true,Echo:false} key)
        {
            if(key.Keycode==Key.Escape)Input.MouseMode=Input.MouseModeEnum.Visible;
            if(key.Keycode==Key.R)Reset();if(key.Keycode==Key.L)lit=!lit;if(key.Keycode==Key.T)night=!night;
            if(key.Keycode is Key.Key1 or Key.Key2 or Key.Key3){preview=key.Keycode==Key.Key1?"smirk":key.Keycode==Key.Key2?"laugh":"angry";expression=4;}
        }
    }
}
