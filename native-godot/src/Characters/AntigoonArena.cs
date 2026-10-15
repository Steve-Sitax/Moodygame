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
    private string shotPose="smirk";
    private double shotTime=-1;
    private string filmDir="";
    private int filmFrame;
    private float shotYaw=.15f;
    public override void _Ready()
    {
        var args=OS.GetCmdlineUserArgs();proof=args.Contains("--antigoon-proof");faceShot=args.Contains("--antigoon-face");
        int ix=Array.IndexOf(args,"--antigoon-shot");if(ix>=0&&ix+1<args.Length)output=args[ix+1];
        int pose=Array.IndexOf(args,"--antigoon-pose");if(pose>=0&&pose+1<args.Length)shotPose=args[pose+1];
        // A frozen moment of a clip, seen from any side: --antigoon-time 0.62 --antigoon-yaw -1.57
        int film=Array.IndexOf(args,"--antigoon-film");if(film>=0&&film+1<args.Length)filmDir=args[film+1];
        int at=Array.IndexOf(args,"--antigoon-time");if(at>=0&&at+1<args.Length)shotTime=double.Parse(args[at+1],System.Globalization.CultureInfo.InvariantCulture);
        int yaw=Array.IndexOf(args,"--antigoon-yaw");if(yaw>=0&&yaw+1<args.Length)shotYaw=float.Parse(args[yaw+1],System.Globalization.CultureInfo.InvariantCulture);
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
        if(proof)Box("UnevenBootSupport",new Vector3(.52f,.06f,-.19f),new Vector3(.45f,.12f,.8f),new Color(.2f,.22f,.24f));
        var canvas=new CanvasLayer();AddChild(canvas);hud=new Label {Position=new Vector2(24,24)};hud.AddThemeFontSizeOverride("font_size",20);canvas.AddChild(hud);
        Reset();
        if(!proof&&output==""&&filmDir=="")Input.MouseMode=Input.MouseModeEnum.Captured;
        if(filmDir!=""){hud.Visible=false;System.IO.Directory.CreateDirectory(filmDir);AddChild(new OmniLight3D {Position=new Vector3(6,6,-6),LightColor=new Color(1,.88f,.73f),LightEnergy=4,OmniRange=30});}
        if(output!="") {player.Position=new Vector3(4,0,.5f);camera.GlobalPosition=new Vector3(4,3.1f,.5f);camera.Fov=43;camera.LookAt(new Vector3(0,2.7f,-8));hud.Visible=false;
            AddChild(new OmniLight3D {Position=new Vector3(2,5,-3),LightColor=new Color(1,.88f,.73f),LightEnergy=4,OmniRange=13});
            // A man's-eye camera from the side, with a 1.3 m chest-height post beside the giant as a ruler.
            if(Array.IndexOf(OS.GetCmdlineUserArgs(),"--antigoon-low")>=0)
            {camera.GlobalPosition=new Vector3(9,1.3f,-8);camera.Fov=60;camera.LookAt(new Vector3(0,2.2f,-8));Box("ChestPost",new Vector3(0,.65f,-5.6f),new Vector3(.12f,1.3f,.12f),new Color(.8f,.2f,.1f));}
            if(faceShot){camera.GlobalPosition=new Vector3(.6f,5.05f,-5.6f);camera.Fov=32;camera.LookAt(new Vector3(0,4.96f,-8));}
        }
    }
    // Ragdoll proof: a real dressed docker hangs by the neck 4.3 m up, is flung 7 m/s at a wall 6 m away, and comes to
    // rest. Every joint is then measured against its limit.
    private Scheldemist.People.Human? body;private HumanRagdoll? ragdoll;private bool flung;private double still;
    private void Ragdoll()
    {
        if(body==null)
        {
            Scheldemist.Native.Game.NativeGlobals.Ensure();Scheldemist.Native.World.NativeData.Initialize();
            Scheldemist.Models.ModelLibrary.NativeScene=name=>ResourceLoader.Load<PackedScene>("res://assets/game-models/"+name+".scn").Instantiate<Node3D>();
            body=Scheldemist.People.Humans.Make("docker_a")??throw new Exception("No people2 docker");AddChild(body.Root);
            var skeleton=body.Root.FindChildren("*","Skeleton3D",true,false).OfType<Skeleton3D>().First();
            ragdoll=HumanRagdoll.Attach(skeleton,HumanRagdoll.People2,72,1);
            Box("ThrowWall",new Vector3(0,2,6.2f),new Vector3(8,4,.4f),new Color(.3f,.26f,.22f));
            // Out of the way: his torso capsule is solid even when he is hidden.
            giant.Visible=false;giant.GlobalPosition=new Vector3(0,0,-40);
        }
        var neck=body.Root.FindChildren("*","Skeleton3D",true,false).OfType<Skeleton3D>().First();
        double t=elapsed;
        // Lifted by the neck to 4.3 m over 0.6 s and held, hanging by its own weight, then thrown.
        if(t<1.6){if(!ragdoll!.Active)ragdoll.Hang("neck",()=>new Vector3(0,Mathf.Lerp(1.45f,4.3f,Mathf.Clamp((float)(elapsed-.1)/.6f,0,1)),0));}
        else if(!flung){flung=true;ragdoll!.Fling(new Vector3(0,1.7f,7),new Vector3(2,0,1));}
        camera.GlobalPosition=new Vector3(9,2.2f,3);camera.Fov=60;camera.LookAt(new Vector3(0,1.5f,3));
        if(t>.3&&(++filmFrame)%3==0)GetViewport().GetTexture().GetImage().SavePng(System.IO.Path.Combine(filmDir,$"ragdoll-{filmFrame/3:000}.png"));
        if(flung&&ragdoll!.Settled)still+=1/60.0;else still=0;
        if(t>9||still>1)
        {
            GD.Print($"RAGDOLL at rest after {t:0.0} s, hips {ragdoll!.Centre}");
            foreach(var part in HumanRagdoll.People2)
            {
                int b=neck.FindBone(part.Bone),parent=neck.GetBoneParent(b);if(b<0||parent<0||part.Swing==0)continue;
                // Joint turn relative to rest, measured on the physics bodies themselves (the bone pose omits the ragdoll).
                string up=neck.GetBoneName(parent);while(ragdoll.Body(up)==null&&neck.GetBoneParent(neck.FindBone(up)) is var q&&q>=0)up=neck.GetBoneName(q);
                var keeper=neck.GetNode<RagdollShape>("RagdollShape");
                if(!keeper.Final.TryGetValue(b,out var mine)||!keeper.Final.TryGetValue(neck.FindBone(up),out var theirs))continue;
                var restLocal=(neck.GetBoneGlobalRest(neck.FindBone(up)).Basis.Inverse()*neck.GetBoneGlobalRest(b).Basis).GetRotationQuaternion();
                var pose=(theirs.Basis.Inverse()*mine.Basis).GetRotationQuaternion();
                float stretch=Math.Abs(mine.Origin.DistanceTo(theirs.Origin)-neck.GetBoneGlobalRest(b).Origin.DistanceTo(neck.GetBoneGlobalRest(neck.FindBone(up)).Origin));
                var turn=restLocal.Inverse()*pose;float angle=Mathf.RadToDeg(turn.GetAngle());var axis=turn.GetAxis();
                string fold="";
                if(part.Joint==HumanRagdoll.Kind.Hinge&&angle>10)
                {
                    // A knee folds the foot back, an elbow folds the hand forward (the way the toes point at rest).
                    int toe=neck.FindBone(part.Bone.EndsWith("L")?"toeL":"toeR"),foot=neck.FindBone(part.Bone.EndsWith("L")?"footL":"footR");
                    var forward=neck.GetBoneGlobalRest(neck.FindBone(up)).Basis.Inverse()*(neck.GetBoneGlobalRest(toe).Origin-neck.GetBoneGlobalRest(foot).Origin);
                    var end=keeper.Final.TryGetValue(neck.FindBone(part.Child),out var c)?c.Origin:mine.Origin;var reach=theirs.Basis.Inverse()*(end-mine.Origin);
                    bool back=reach.Dot(forward)<0;bool ok=part.Bone.StartsWith("legLow")?back:!back;
                    fold=ok?" folds the natural way":" FOLDS THE WRONG WAY";
                }
                if(angle>180)angle=360-angle;
                GD.Print($"RAGDOLL_JOINT {part.Bone} {angle:0} deg (limit {Math.Abs(part.Swing)}) stretch {stretch*100:0.0} cm{fold}");
            }
            SetPhysicsProcess(false);GetTree().Quit();
        }
    }
    // Film stand-in prey: a man-sized capsule 2.1 m before him, seized by the neck, held up, thrown.
    private MeshInstance3D? prey;private Vector3 preyVelocity;private bool preyFlying;
    private void Prey()
    {
        if(prey==null)
        {
            prey=new MeshInstance3D{Mesh=new CapsuleMesh{Radius=.25f,Height=1.75f},MaterialOverride=new StandardMaterial3D{AlbedoColor=new Color(.55f,.42f,.3f)},Position=new Vector3(0,.875f,-14+2.1f)};AddChild(prey);
            giant.PreyNeck=()=>prey.GlobalPosition+Vector3.Up*.62f;
        }
        double t=elapsed-.4;
        if(t>=AntigoonActor.GrabSeize&&t<AntigoonActor.GrabRelease){prey.GlobalPosition=giant.Fist()-Vector3.Up*.62f;preyVelocity=Vector3.Zero;}
        else if(t>=AntigoonActor.GrabRelease)
        {
            if(!preyFlying){preyFlying=true;preyVelocity=giant.GlobalBasis.Z*7f+Vector3.Up*1.5f;}
            preyVelocity+=Vector3.Down*9.8f/60f;prey.GlobalPosition+=preyVelocity/60f;
            if(prey.GlobalPosition.Y<.25f){prey.GlobalPosition=new(prey.GlobalPosition.X,.25f,prey.GlobalPosition.Z);preyVelocity*=.6f;prey.Rotation=new Vector3(Mathf.Pi/2,0,0);}
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
        if(filmDir!=""&&shotPose=="ragdoll"){Ragdoll();return;}
        if(filmDir!="")
        {
            // Scripted move: walk/run past, turn to face the camera's side, notice (look at the camera), or kick.
            float speed=shotPose=="run"?(float)AntigoonBrain.RunSpeed:shotPose=="walk"?(float)AntigoonBrain.WalkSpeed:0;
            var at=new Vector3(0,0,-14+speed*(float)elapsed);
            string state=shotPose is "turn"?"idle":shotPose;
            // "mix": walk, break into a run, pull up and stand: every change must blend.
            if(shotPose=="mix")
            {
                double e=elapsed;state=e<1.4?"walk":e<2.8?"run":"idle";
                float z=-14+(float)(Math.Min(e,1.4)*AntigoonBrain.WalkSpeed+Math.Clamp(e-1.4,0,1.4)*AntigoonBrain.RunSpeed);at=new Vector3(0,0,z);
            }float yaw=shotPose is "turn" or "notice"&&elapsed>.4?Mathf.Pi*.5f:0;
            if(shotPose=="grab")Prey();
            giant.Snapshot(at,yaw,state,shotPose is "attack" or "grab"?Math.Max(0,elapsed-.4):elapsed,shotPose is "attack" or "grab"&&elapsed>.4?1:0,true);
            giant.Pose.LookAt=shotPose=="notice"?camera.GlobalPosition:null;
            camera.GlobalPosition=new Vector3(shotPose=="grab"?-10:10,1.6f,giant.GlobalPosition.Z+(shotPose=="grab"?3:0));camera.Fov=shotPose=="grab"?65:55;camera.LookAt(giant.GlobalPosition+Vector3.Up*2.5f+(shotPose=="grab"?Vector3.Back*3:Vector3.Zero));
            if(elapsed>.3&&(++filmFrame)%3==0)GetViewport().GetTexture().GetImage().SavePng(System.IO.Path.Combine(filmDir,$"{shotPose}-{filmFrame/3:000}.png"));
            if(elapsed>(shotPose=="run"?3:shotPose=="grab"?5.6:4.2)){SetPhysicsProcess(false);GetTree().Quit();}
            return;
        }
        if(output!="")
        {
            giant.Snapshot(new Vector3(0,0,-8),shotYaw,faceShot?"laugh":shotPose,shotTime>=0?shotTime:elapsed,0,true);
            if(shotTime>=0)giant.Animations.Seek(shotTime,true);
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
                var gait=ProveGait();
                if(gait!=""){GD.PrintErr(gait);SetPhysicsProcess(false);GetTree().Quit(1);return;}
                giant.SetState("shield");giant.Animations.Advance(.25);giant.Pose.ApplyPose(.01);
                for(int settle=0;settle<30;settle++){giant.Animations.Advance(1/60.0);giant.Pose.ApplyPose(1/60.0);}
                foreach(string hand in new[]{"hand.L","hand.R"})if(giant.Skeleton.GetBoneGlobalPose(giant.Skeleton.FindBone(hand)).Origin.Y is var y&&y<4.6f)throw new Exception($"Shielding hand {hand} at {y:0.00} m does not protect the head (head {giant.Skeleton.GetBoneGlobalPose(giant.Skeleton.FindBone("head")).Origin})");
                GD.Print("ANTIGOON_POSE_PASS: world-locked boots, stepping turns, upright trunk, planar kick, hands shielding the head.");
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
    /// <summary>
    /// Drive the real pose frame by frame: walking, running, a turn on the spot and a kick. Boots must hold their
    /// ground while planted, reach their holds, step in turn; the trunk must not lean back; the knee must fold only forward.
    /// </summary>
    private string ProveGait()
    {
        const float dt=1/60f;giant.Pose.GroundAt=_=>0f;
        string Run(string state,float speed,float seconds,float turnTo,out int steps,out float worstLean)
        {
            steps=0;worstLean=0;giant.GlobalPosition=new Vector3(0,0,-14);giant.Rotation=Vector3.Zero;giant.SetState(state);
            giant.Pose.ApplyPose(dt);var held=new Vector3[2];var was=new bool[2];
            for(int f=0;f<seconds/dt;f++)
            {
                giant.GlobalPosition+=new Vector3(0,0,speed*dt);
                if(turnTo!=0)giant.Rotation=new Vector3(0,Mathf.MoveToward(giant.Rotation.Y,turnTo,1.4f*dt),0);
                giant.Animations.Advance(dt);giant.Pose.ApplyPose(dt);
                for(int i=0;i<2;i++)
                {
                    var (at,planted)=giant.Pose.Boots(i);
                    if(planted&&was[i]&&at.DistanceTo(held[i])>.002f)return $"{state}: boot {i} slid {at.DistanceTo(held[i]):0.000} m while standing";
                    if(planted&&f>5&&giant.Pose.BootError(i)>.04f)return $"{state}: boot {i} misses its hold by {giant.Pose.BootError(i):0.000} m at frame {f}: {giant.Pose.Reach(i)}";
                    if(!planted&&was[i])steps++;
                    held[i]=at;was[i]=planted;
                }
                if(f>30)worstLean=Math.Min(worstLean,giant.Pose.Lean());
            }
            return "";
        }
        foreach(var (state,speed) in new[]{("walk",(float)AntigoonBrain.WalkSpeed),("run",(float)AntigoonBrain.RunSpeed)})
        {
            string error=Run(state,speed,4,0,out int steps,out float lean);if(error!="")return error;
            if(steps<(state=="walk"?4:6))return $"{state}: only {steps} steps in 4 s";
            if(lean<-.02f)return $"{state}: trunk leans back {-lean:0.000} rad";
            GD.Print($"ANTIGOON_GAIT {state}: {steps} steps in 4 s, boots held while standing, trunk never behind the hips");
        }
        {
            string error=Run("idle",0,2.6f,Mathf.Pi*.5f,out int steps,out _);if(error!="")return error;
            if(steps<2)return $"turn: he turned a quarter without stepping ({steps} steps)";
            GD.Print($"ANTIGOON_GAIT turn: a quarter turn on the spot in {steps} steps");
        }
        giant.Rotation=Vector3.Zero;giant.SetState("attack");float lowest=1;
        for(double t=0;t<=1.35;t+=1/60.0){giant.Animations.Seek(t,true);giant.Pose.ApplyPose(dt);lowest=Math.Min(lowest,giant.Pose.KickKnee());}
        if(lowest<-.02f)return $"kick: the knee bends backwards by {-lowest:0.000} rad";
        giant.Animations.Seek(.62,true);giant.Pose.ApplyPose(dt);
        var boot=giant.ToLocal(giant.Skeleton.GlobalTransform*giant.Skeleton.GetBoneGlobalPose(giant.Skeleton.FindBone("foot.R")).Origin);
        if(boot.Y<.85f||boot.Y>1.6f||boot.Z<1.3f)return $"kick: the boot meets {boot} instead of a man's chest ahead";
        GD.Print($"ANTIGOON_GAIT kick: knee folds only forward; boot at {boot.Y:0.00} m high and {boot.Z:0.00} m ahead at contact");
        giant.Pose.GroundAt=null!;return "";
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
