using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.People;
using Scheldemist.Player;
using Scheldemist.Windows;
namespace Scheldemist.Play;

/// <summary>The cathedral's row-end chairs and the curate's private paper.</summary>
[GamePart(912)]
public partial class CathedralComfort : Node
{
    public static CathedralComfort I {get;private set;}=null!;
    public sealed record Chair(Vector3 At,float Yaw,float Height);
    public readonly List<Chair> Chairs=new();
    private readonly List<Interact.Entry> prompts=new();
    public Chair? Sitting {get;private set;}
    private bool kneeling,busy,dead;
    private int generation;
    private Vector3 returnAt,eye;
    private float yaw,pitch;
    private Window paper=null!;
    private LineEdit input=null!;
    private readonly List<string> lines=new();
    public bool CanType=>!Main.I.Flag("no-ai") && Scheldemist.Menu.AiSheet.Mode!="walk";
    public ConfessionReply? LastReply {get;private set;}
    public PlacesReply? ChairReply {get;private set;}
    public override void _Ready()
    {
        I=this;
        ProcessPriority=20; // the seated/kneeling view owns the camera after Jef's walking step
        input=new LineEdit{MaxLength=300,PlaceholderText="Say it in your own words, then Enter",ContextMenuEnabled=false};
        input.AddThemeColorOverride("font_color",Css.Ink);input.AddThemeColorOverride("font_placeholder_color",new Color(Css.Ink,.6f));
        input.AddThemeStyleboxOverride("normal",new StyleBoxFlat{BgColor=Css.Hex("e6ddc6")});
        input.AddThemeFontOverride("font",PaperFonts.Print);input.AddThemeFontSizeOverride("font_size",20);
        paper=new Window("confessional",Write,OnKey);
        using var doc=JsonDocument.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://assets/places.json")));
        var origin=LandmarkLife.I.LocalPoint("cathedral",0,0);var one=LandmarkLife.I.LocalPoint("cathedral",0,1)-origin;float turn=MathF.Atan2(one.X,one.Z);
        foreach(var s in doc.RootElement.GetProperty("cathedralSeats").EnumerateArray())
        {
            var chair=new Chair(LandmarkLife.I.LocalPoint("cathedral",s.GetProperty("x").GetSingle(),s.GetProperty("z").GetSingle()),turn+s.GetProperty("yaw").GetSingle(),s.GetProperty("h").GetSingle());Chairs.Add(chair);
            prompts.Add(Interact.I.Add(chair.At+Vector3.Up*.46f,.9f,()=>Sitting==null&&!kneeling&&LandmarkLife.I.Here=="cathedral"&&!Occupied(chair)?"sit down":null,()=>Sit(chair)));
        }
        var pen=LandmarkLife.I.Point("cathedral","penitent");
        prompts.Add(Interact.I.Add(pen+Vector3.Up*.9f,1,()=>!kneeling&&LandmarkLife.I.Here=="cathedral"?LandmarkLife.I.ConfessionOpen?"kneel at the confessional":"look at the confessional":null,()=>_ = Begin()));
        Interact.I.AddProvider((_,_)=>Sitting!=null&&!kneeling?new Offers{Only=new(){Act.Me(Key.E,"stand up",Stand)}}:null);
        if(Scheldemist.Menu.MainMenu.I is {} menu)menu.WorldReplaced+=Reset;
    }
    private bool Occupied(Chair c)
    {
        if(HallPeople.I==null)return false;
        foreach(var h in HallPeople.I.Halls)if(h.Id=="cathedral")foreach(var f in h.Figures.Values)if(f.Target.DistanceTo(c.At)<.3f)return true;
        return false;
    }
    public void Sit(Chair chair)
    {
        if(Sitting!=null||kneeling||Occupied(chair))return;
        returnAt=new(Jef.I.X,Jef.I.Y,Jef.I.Z);Sitting=chair;eye=chair.At+Vector3.Up*(chair.Height+.72f);yaw=chair.Yaw+MathF.PI;pitch=.05f;Jef.I.X=chair.At.X;Jef.I.Z=chair.At.Z;Jef.I.Frozen=true;_ = PayChair();
    }
    private async Task PayChair(){int g=generation;try{var r=await ServerLink.I!.Api!.LandmarkChair();if(dead||g!=generation)return;ChairReply=r;GameState.I.Apply(r);GameState.I.Say(r.Text);}catch(ApiException e){if(!dead&&g==generation)GameState.I.Say(e.Message);}}
    public void Stand(){if(Sitting==null&&!kneeling)return;Sitting=null;kneeling=false;Jef.I.Frozen=false;Jef.I.Place(returnAt.X,returnAt.Z,yaw,pitch,returnAt.Y);}
    private void Reset(string how,ClientState? state){generation++;paper.Close();Stand();LastReply=null;ChairReply=null;lines.Clear();}
    public override void _Process(double dt){if(Sitting!=null||kneeling){Jef.I.Frozen=true;Main.I.Cam.GlobalPosition=eye;Main.I.Cam.GlobalRotation=new(pitch,yaw,0);}}
    public override void _Input(InputEvent e){if(Sitting!=null && Dialogs.I?.Top==null && e is InputEventMouseMotion m){yaw-=m.Relative.X*Jef.TurnSens*Jef.I.LookSens;pitch=Math.Clamp(pitch-m.Relative.Y*Jef.TurnSens*Jef.I.LookSens*(Jef.I.InvertY?-1:1),-1.35f,1.35f);}}
    private Sheet? Write()
    {
        if(input.GetParent() is {} parent)parent.RemoveChild(input);
        var sh=new Sheet(Dialogs.I!.Ui,560,Css.Hex("e3d4ad"),(26,18,26,14),maxHeight:GetViewport().GetVisibleRect().Size.Y*.85f){Where=Window.Middle};
        sh.Text("The confessional, behind the grille",Face.Print,23,bottom:12);
        foreach(var line in lines)sh.Text(Css.Esc(line),Face.Print,16,lineHeight:1.45f);
        sh.Keys(busy?"The curate is listening…":CanType?"Say it, then Enter · E finish · Esc step away":"Own words need AI · E finish · Esc step away",Face.Hand);
        if(CanType&&!busy){sh.Add(sh.Margin(input,6,4));input.CallDeferred(Control.MethodName.GrabFocus);}return sh;
    }
    public async Task Begin()
    {
        if(busy||kneeling)return;
        if(!LandmarkLife.I.ConfessionOpen){GameState.I.Say("The little door is shut. The curate hears confession in the morning and afternoon, when there is no mass.");return;}
        busy=true;int g=generation;
        try{var r=await ServerLink.I!.Api!.ConfessionBegin();if(dead||g!=generation)return;Stand();returnAt=new(Jef.I.X,Jef.I.Y,Jef.I.Z);var pen=LandmarkLife.I.Point("cathedral","penitent");var priest=LandmarkLife.I.Point("cathedral","confessor");kneeling=true;eye=pen+Vector3.Up*.98f;Jef.I.X=pen.X;Jef.I.Z=pen.Z;Jef.I.Frozen=true;yaw=MathF.Atan2(-(priest.X-pen.X),-(priest.Z-pen.Z));pitch=.05f;lines.Clear();lines.Add(r.Line);LastReply=null;paper.Open();}
        catch(ApiException e){GameState.I.Say(e.Message);}finally{busy=false;paper.Render();}
    }
    private void OnKey(string code,string key){if(code=="Escape"){paper.Close();Stand();}else if(code=="KeyE"&&!busy)_ = End();else if(code=="Enter"&&CanType&&!busy){string text=input.Text.Trim();input.Text="";if(text.Length>0)_ = Say(text);}}
    public async Task Say(string text)
    {
        if(!CanType||busy||!kneeling)return;busy=true;int g=generation;lines.Add("You: "+text);paper.Render();
        try{var r=await ServerLink.I!.Api!.Confess(text);if(dead||g!=generation)return;LastReply=r;lines.Add(r.Line.Length>0?"The priest: "+r.Line:r.Gated=="too fast"?"Catch your breath first.":"The curate waits.");if(r.Penance!=null)lines.Add(r.Penance);}
        catch(ApiException e){if(!dead&&g==generation)lines.Add(e.Message);}finally{busy=false;if(!dead&&g==generation)paper.Render();}
    }
    private async Task End(){busy=true;int g=generation;try{var r=await ServerLink.I!.Api!.ConfessionEnd();if(dead||g!=generation)return;GameState.I.Say(r.Line);paper.Close();Stand();}catch(ApiException e){GameState.I.Say(e.Message);}finally{busy=false;}}
    public override void _ExitTree(){dead=true;generation++;Stand();paper.Close();foreach(var p in prompts)p.Dispose();if(IsInstanceValid(input)&&input.GetParent()==null)input.Free();if(Scheldemist.Menu.MainMenu.I is {} menu)menu.WorldReplaced-=Reset;}
}
