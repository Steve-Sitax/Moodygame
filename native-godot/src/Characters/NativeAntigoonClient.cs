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
    public override void _Ready()
    {
        StartStreetEvent();
        hint = new Label { Position = new Vector2(24, 150), MouseFilter = Control.MouseFilterEnum.Ignore };
        hint.AddThemeColorOverride("font_color",new Color(.82f,.79f,.68f));
        Main.I.Ui.AddChild(hint);
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
            hint.Text = "Stay in the light. Dodge his kick.\nLeft mouse · strike when within reach";
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
        if(visible&&!warned&&Jef.I?.Body!=null&&Jef.I.Body.GlobalPosition.DistanceTo(actor.GlobalPosition)<20){warned=true;Hud.I?.Say("Heavy footsteps. Stay near a burning lamp.");}
        if(v["health"]?.GetValue<int>()==0) hint.Text="Antigoon has fallen.";
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
    public override void _ExitTree(){StopStreetEvent();if(IsInstanceValid(actor))actor!.QueueFree();if(IsInstanceValid(hint))hint.QueueFree();if(IsInstanceValid(developmentPointer))developmentPointer.QueueFree();}
}
