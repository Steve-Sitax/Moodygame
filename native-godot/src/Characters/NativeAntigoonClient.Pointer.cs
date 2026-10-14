using Godot;
using System;
using Scheldemist.Game;
using Scheldemist.Menu;
using Tick = Scheldemist.Play.Tick;
using Scheldemist.Player;
using Scheldemist.Windows;

namespace Scheldemist.Native.Characters;

public partial class NativeAntigoonClient
{
    private Control developmentPointer=null!;
    private Tick developmentArrow=null!;
    private Label developmentDistance=null!;
    private Control? pointerClock;
    private bool developmentSpawn;
    private void BuildDevelopmentPointer()
    {
        developmentPointer=new Control { Name="AntigoonDevPointer",MouseFilter=Control.MouseFilterEnum.Ignore,Visible=false };
        developmentPointer.SetAnchorsPreset(Control.LayoutPreset.FullRect);
        Main.I.Ui.AddChild(developmentPointer);
        developmentArrow=new Tick { Name="Arrow",Ink=new Color("ef4949"),MouseFilter=Control.MouseFilterEnum.Ignore };
        developmentDistance=new Label {
            Name="Distance",MouseFilter=Control.MouseFilterEnum.Ignore,HorizontalAlignment=HorizontalAlignment.Center,
            LabelSettings=new LabelSettings { Font=Fonts.Hand,FontColor=new Color("ff7770"),ShadowColor=new Color(0,0,0,.85f),ShadowOffset=Vector2.Zero }
        };
        developmentPointer.AddChild(developmentArrow);developmentPointer.AddChild(developmentDistance);
    }
    private void UpdateDevelopmentPointer(bool playing)
    {
        var jef=Jef.I;
        // Only explicit developer spawns may reveal the giant's location. Normal encounters omit this flag.
        developmentPointer.Visible=playing&&Prefs.DevMode&&developmentSpawn&&actor is {Visible:true}&&jef!=null;
        if(!developmentPointer.Visible)return;
        var target=actor!.GlobalPosition;var win=GetViewport().GetVisibleRect().Size;float scale=Css.Ui(win.X);
        developmentArrow.Size=new Vector2(34,22)*scale;developmentDistance.Size=new Vector2(180,18)*scale;
        developmentDistance.LabelSettings.FontSize=Mathf.RoundToInt(14*scale);developmentDistance.LabelSettings.ShadowSize=Mathf.RoundToInt(4*scale);
        float bearing=MathF.Atan2(target.X-jef!.X,target.Z-jef.Z)-MathF.Atan2(-MathF.Sin(jef.Yaw),-MathF.Cos(jef.Yaw));
        float angle=MathF.Atan2(MathF.Sin(bearing),MathF.Cos(bearing));
        float left=win.X*(.5f+Math.Clamp(-angle/(MathF.PI/2),-1,1)*.42f);
        if(!IsInstanceValid(pointerClock))pointerClock=Main.I.Ui.GetNodeOrNull<Control>("Hud")?.GetChildOrNull<Control>(0);
        float paperRight=IsInstanceValid(pointerClock)?pointerClock!.Position.X+pointerClock.Size.X:0;
        left=Math.Clamp(left,Math.Min(win.X/2,paperRight+developmentDistance.Size.X/2+12*scale),win.X*.92f);
        // A separate row keeps a followed quest's pointer legible as well.
        float top=48*scale;
        developmentArrow.Position=new(left-developmentArrow.Size.X/2,top);
        developmentArrow.Turn=MathF.Abs(angle)>MathF.PI/2?(angle>0?90:-90):0;
        developmentDistance.Position=new(left-developmentDistance.Size.X/2,top+developmentArrow.Size.Y-2*scale);
        int metres=Mathf.RoundToInt(new Vector2(target.X-jef.X,target.Z-jef.Z).Length());
        string text=$"Antigoon · {metres} m";
        if(developmentDistance.Text!=text)developmentDistance.Text=text;
    }
}
