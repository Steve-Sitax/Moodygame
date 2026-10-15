using Godot;
using System;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Player;

namespace Scheldemist.Native.Characters;

public partial class NativeAntigoonClient : Node
{
    private AntigoonActor? actor;
    private Label hint = null!;
    private double poll;
    private bool busy, warned, stopped;
    private int kicked = -1;
    /// <summary>Kicks this client has thrown Jef back for.</summary>
    public int KicksFelt { get; private set; }
    private ColorRect flash = null!;
    private AudioStreamPlayer blow = null!;
    public override void _Ready()
    {
        StartStreetEvent();
        hint = new Label { Position = new Vector2(24, 150), MouseFilter = Control.MouseFilterEnum.Ignore };
        hint.AddThemeColorOverride("font_color",new Color(.82f,.79f,.68f));
        Main.I.Ui.AddChild(hint);
        flash = new ColorRect { Name="AntigoonKickFlash", Color=new Color(.35f,0,0,0), MouseFilter=Control.MouseFilterEnum.Ignore };
        flash.SetAnchorsPreset(Control.LayoutPreset.FullRect); Main.I.Ui.AddChild(flash);
        blow = new AudioStreamPlayer { Stream=ResourceLoader.Load<AudioStream>("res://world/data/public/audio/kenney-impact/impactWood_heavy_001.ogg"), PitchScale=.55f, VolumeDb=-1 };
        AddChild(blow);
        BuildDevelopmentPointer();
    }
    public override void _Process(double delta)
    {
        bool playing = GameState.I.Live && GameState.I.Playing && ServerLink.I?.Up == true && !ServerLink.I.Paused;
        actor?.Pause(!playing);
        hint.Visible = playing;
        UpdateDevelopmentPointer(playing);
        if (!playing || busy) return;
        poll += delta;
        if (poll >= .1) { poll = 0; _ = Refresh(); }
        hint.Text = "";
        if (actor is { Visible: true } && Jef.I?.Body != null && Jef.I.Body.GlobalPosition.DistanceTo(actor.GlobalPosition)<7)
            hint.Text = "Stay in the light, or slip into a lane too narrow for him.\nDodge his kick. Left mouse · strike when within reach";
    }
    private async Task Refresh()
    {
        busy = true;
        try { Apply(JsonNode.Parse(await ServerLink.I!.Api!.PostJson("api/antigoon/observe",ObserveStreet()))!.AsObject()); }
        catch (Exception e) { if(!stopped){GD.PushWarning("Antigoon: " + e.Message);stopped=true;} poll=-2; }
        finally { busy = false; }
    }
    private void Apply(JsonObject v)
    {
        if(!IsInsideTree())return;
        ApplyStreetEvent(v);
        bool visible = v["active"]?.GetValue<bool>()==true;
        developmentSpawn=v["development_spawn"]?.GetValue<bool>()==true&&visible&&v["health"]?.GetValue<int>()>0;
        if (!visible && actor == null) return;
        if(actor==null){actor=new AntigoonActor { Name="Antigoon", TownLighting=true };Main.I.View.AddChild(actor);}
        if(v["x"]==null){actor.Snapshot(actor.GlobalPosition,actor.Rotation.Y,"hidden",0,0,false);return;}
        static double N(JsonNode? n)=>n?.GetValue<double>()??0;
        actor.Snapshot(new Vector3((float)N(v["x"]),(float)N(v["y"]),(float)N(v["z"])),(float)N(v["yaw"]),v["state"]!.GetValue<string>(),N(v["state_time"]),(int)N(v["attack_serial"]),visible);
        // He looks at whoever he is after; the host names a player target with a positive id, a resident with a negative one.
        int target=(int)N(v["target"]),you=(int)N(v["you"]);
        actor.Pose.LookAt=target==you&&target>0&&Jef.I?.Body is {} me&&me.GlobalPosition.DistanceTo(actor.GlobalPosition)<30?Jef.I.Cam.GlobalPosition:null;
        actor.PreyNeck=target==you&&target>0?()=>Jef.I?.Cam is {} cam?cam.GlobalPosition-Vector3.Up*.15f:null:target<0?()=>ResidentNeck(target):null;
        // The throw first (it takes Jef out of the fist itself), then whether he is held now.
        if(v["throw"] is JsonObject t&&(int)N(t["serial"]) is var serial&&serial!=lastThrow){bool old=lastThrow<0;lastThrow=serial;if(!old&&(int)N(t["victim"])==you)Flung(t);}
        else if(v["throw"]==null&&lastThrow<0)lastThrow=0;
        Held(you>0&&(int)N(v["held"])==you);
        if(visible&&!warned&&Jef.I?.Body!=null&&Jef.I.Body.GlobalPosition.DistanceTo(actor.GlobalPosition)<20){warned=true;Hud.I?.Say("Heavy footsteps. Stay near a burning lamp.");}
        if(v["health"]?.GetValue<int>()==0) hint.Text="Antigoon has fallen.";
        int kicks=(int)N(v["kicked"]);
        if(kicked>=0&&kicks>kicked)Kicked();
        kicked=kicks;
    }
    private int lastThrow=-1;
    private bool carried;
    private double carriedFor;
    /// <summary>The host says Jef is in his fist: the view hangs at his fist, before his face, until the throw.</summary>
    private void Held(bool held)
    {
        if(held==carried||Jef.I==null||actor==null)return;
        carried=held;carriedFor=0;
        if(!held){if(Jef.I.Drive==carry)Jef.I.Drive=null;return;}
        flash.Color=new Color(.25f,0,0,.45f);CreateTween().TweenProperty(flash,"color:a",.12f,.6);
        Hud.I?.Say("His hand closes round your neck. He lifts you to his face.");
        carryFrom=new Vector3(Jef.I.X,Jef.I.Y,Jef.I.Z);
        carry??=Carry;Jef.I.Drive=carry;
    }
    private Vector3 carryFrom;
    private Func<float,bool>? carry;
    private bool Carry(float dt)
    {
            if(actor==null||Jef.I==null)return false;carriedFor+=dt;
            // His fist closes round the back of Jef's neck: Jef's eyes are just in front of it, facing his face.
            var toFace=actor.GlobalPosition-actor.Fist();toFace.Y=0;toFace=toFace.LengthSquared()>1e-4f?toFace.Normalized():-actor.GlobalBasis.Z;
            var eye=actor.Fist()+toFace*.28f+Vector3.Up*.08f;var feet=eye-Vector3.Up*Jef.Eye;
            var at=carryFrom.Lerp(feet,Mathf.Clamp((float)carriedFor/.25f,0,1));
            Jef.I.X=at.X;Jef.I.Y=at.Y;Jef.I.Z=at.Z;Jef.I.DrivenEye=Jef.Eye;Jef.I.DrivenRoll=.05f*Mathf.Sin((float)carriedFor*7);
            if(carriedFor<.6){var face=actor.HoldPoint()+actor.GlobalBasis.Z*-1.0f+Vector3.Up*.4f;var look=face-eye;Jef.I.Yaw=Mathf.Atan2(-look.X,-look.Z);Jef.I.Pitch=Mathf.Atan2(look.Y,new Vector2(look.X,look.Z).Length());}
            return true;
    }
    /// <summary>The host threw this player: out of the fist along the host's flight, landing hard about 6 m away.</summary>
    private void Flung(JsonObject t)
    {
        static double N(JsonNode? n)=>n?.GetValue<double>()??0;
        carried=false;if(Jef.I==null)return;Jef.I.Drive=null;
        float time=(float)Services.AntigoonNightEvent.FlightTime;
        var to=new Vector2((float)N(t["tx"]),(float)N(t["tz"]));var from=new Vector2(Jef.I.X,Jef.I.Z);
        float height=Jef.I.Y-(Jef.I.GroundAt(to.X,to.Y,Jef.I.Y) is var g&&float.IsFinite(g)?g:Jef.I.Y-4);
        // Leave the fist at the speed that lands at the host's spot: across in `time`, falling from the fist's height.
        float lift=(-height+.5f*Jef.Gravity*time*time)/time;
        Jef.I.Knock((to-from)/time,lift,1.4f,thrown:true);Jef.I.Jolt(1.1f,4f);
        blow.Play();flash.Color=new Color(.4f,0,0,.7f);CreateTween().TweenProperty(flash,"color:a",0f,1.4).SetEase(Tween.EaseType.Out);
        Hud.I?.Say(N(t["wall"])>0||t["wall"]?.GetValue<bool>()==true?"He hurls you against the wall.":"He hurls you across the street.");
    }
    /// <summary>The host says his boot landed on this player: throw Jef back from the giant, black out red, shake the street.</summary>
    private void Kicked()
    {
        if(actor==null||Jef.I?.Body==null)return;
        var away=Jef.I.Body.GlobalPosition-actor.GlobalPosition;away.Y=0;
        away=away.LengthSquared()<1e-4f?-actor.GlobalBasis.Z:away.Normalized();
        Jef.I.Knock(new Vector2(away.X,away.Z)*6.5f,3.4f,.75f);KicksFelt++;
        blow.Play();
        flash.Color=new Color(.35f,0,0,.62f);
        CreateTween().TweenProperty(flash,"color:a",0f,.9).SetEase(Tween.EaseType.Out).SetTrans(Tween.TransitionType.Quad);
        Hud.I?.Say("His boot throws you across the stones. Get into the light!");
    }
    public override void _UnhandledInput(InputEvent e)
    {
        if(!GameState.I.Playing||ServerLink.I?.Paused!=false||busy)return;
        if(e is InputEventMouseButton { Pressed:true,ButtonIndex:MouseButton.Left } && actor is { Visible:true } && Jef.I?.Body!=null)
        {
            var direction=actor.GlobalPosition-Jef.I.Body.GlobalPosition;
            var forward=-Main.I.Cam.GlobalBasis.Z;direction.Y=0;forward.Y=0;
            if(direction.Length()<2.8f&&direction.Normalized().Dot(forward.Normalized())>.4f)
            {GetViewport().SetInputAsHandled();_ = Act("strike");}
        }
    }
    private async Task Act(string action)
    {
        busy=true;
        try
        {
            var result=JsonNode.Parse(await ServerLink.I!.Api!.PostJson("api/antigoon/"+action,new {}))!.AsObject();Apply(result);
            Hud.I?.Say(result["hit"]?.GetValue<bool>()==true ? "Your strike connects." : "Out of reach. Watch his feet.");
        }
        catch(Exception e){Hud.I?.Say(e.Message);}
        finally{busy=false;}
    }
    public override void _ExitTree(){StopStreetEvent();if(IsInstanceValid(actor))actor!.QueueFree();if(IsInstanceValid(hint))hint.QueueFree();if(IsInstanceValid(flash))flash.QueueFree();if(IsInstanceValid(developmentPointer))developmentPointer.QueueFree();}
}
