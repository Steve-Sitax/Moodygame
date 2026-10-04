using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Audio;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.Windows;
using Scheldemist.World;

namespace Scheldemist.Play;

/// <summary>The Poesje's engine-written play, timed captions, rods and moving baked curtains.</summary>
[GamePart(362)]
public partial class Poesje : Node
{
    public static Poesje I { get; private set; }=null!;
    public PoesjeTicket? Ticket { get; private set; }
    public PoesjePlay? Play { get; private set; }
    public int Spoken { get; private set; }
    public bool Inside { get; private set; }
    private sealed class Puppet {public Node3D Group=new(),Body=new(),Arm=new();public Vector3 Home;public string Role="";}
    private readonly List<Puppet> puppets=new();
    private readonly List<(Node3D Node,Vector3 At,int Sign)> curtains=new();
    private Vector3 origin;
    private float yaw,minX,maxX,minZ,maxZ,foot,floor,cx,bz,feet;
    private int paidDay=-1,index=-1,stage,generation;
    private bool busy,dead,wasInside;
    private string thirdRole="other";
    public int CurtainCount=>curtains.Count;
    private double clock,time,curtain;
    private Label caption=null!;
    public Vector3 ViewAt=>World(cx,bz-2.1f,floor);
    public Vector3 StageAt=>World(cx,bz,feet+.3f);
    private static MeshInstance3D Part(PrimitiveMesh mesh,uint color,Vector3 pos)=>new(){Mesh=mesh,MaterialOverride=Goods.I.Plain(color),Position=pos};
    private Vector3 World(float x,float z,float y)=>origin+new Vector3(x*MathF.Cos(yaw)+z*MathF.Sin(yaw),y,-x*MathF.Sin(yaw)+z*MathF.Cos(yaw));
    public override void _Ready()
    {
        I=this;using var data=JsonDocument.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://assets/places.json")));var c=data.RootElement.GetProperty("cellar");var o=c.GetProperty("origin");origin=new(o.GetProperty("x").GetSingle(),0,o.GetProperty("z").GetSingle());yaw=c.GetProperty("yaw").GetSingle();floor=c.GetProperty("floor_y").GetSingle();foot=c.GetProperty("foot").GetSingle();var r=c.GetProperty("rect");minX=r.GetProperty("minX").GetSingle();maxX=r.GetProperty("maxX").GetSingle();minZ=r.GetProperty("minZ").GetSingle();maxZ=r.GetProperty("maxZ").GetSingle();var s=c.GetProperty("stage");cx=s.GetProperty("x").GetSingle();bz=s.GetProperty("z").GetSingle();feet=s.GetProperty("feet_y").GetSingle();
        Make("neus",cx-.62f,bz+.55f,0x7a1c14,2.6f);Make("schele",cx+.62f,bz+.55f,0x2c4a2a,1.1f);
        // Third-role variants share the source's load-time material palette.
        Make("agent",cx,bz+.85f,0x1c2436,1);Make("thief",cx,bz+.85f,0x151515,1.2f);Make("woman",cx,bz+.85f,0x3a2a3a,.8f);Make("jef",cx,bz+.85f,0x5a4430,1);Make("sailor",cx,bz+.85f,0x1a2a3a,1.1f);Make("other",cx,bz+.85f,0x4a4a44,1.1f);
        foreach(var n in BakedWorld.All(Main.I.World)) if(n.Name=="ROOM_poesje") foreach(var mesh in BakedWorld.All(n)) if(mesh is MeshInstance3D m && m.Mesh is {} mm && mm.GetSurfaceCount()>0 && mm.SurfaceGetMaterial(0)?.ResourceName=="curtain")curtains.Add((m,m.Position,m.Position.X<cx?-1:1));
        caption=new Label{Visible=false,MouseFilter=Control.MouseFilterEnum.Ignore,AutowrapMode=TextServer.AutowrapMode.WordSmart,Size=new Vector2(800,100),LabelSettings=new LabelSettings{Font=PaperFonts.Hand,FontSize=24,FontColor=Css.Ink,OutlineColor=Css.Hex("e3d4ad"),OutlineSize=5}};Main.I.Ui.AddChild(caption);
        if(Scheldemist.Menu.MainMenu.I is {} menu)menu.WorldReplaced+=Reset;
    }
    private void Make(string role,float x,float z,uint coat,float nose)
    {
        const float S=.78f;var p=new Puppet{Role=role,Home=World(x,z,feet)};p.Group.Position=p.Home;p.Group.Rotation=new(0,yaw,0);p.Group.AddChild(p.Body);Main.I.View.AddChild(p.Group);p.Group.Visible=false;
        p.Body.AddChild(Part(new CylinderMesh{TopRadius=.075f*S,BottomRadius=.1f*S,Height=.3f*S,RadialSegments=7},coat,new(0,.37f*S,0)));
        p.Body.AddChild(Part(new SphereMesh{Radius=.075f*S,Height=.168f*S,RadialSegments=6,Rings=3},0xd0a080,new(0,.6f*S,0)));
        var beak=Part(new CylinderMesh{TopRadius=0,BottomRadius=.022f*S*Math.Min(1.6f,nose),Height=.06f*S*nose,RadialSegments=6},nose>2?0xc0402au:0xc88a6au,new(0,.595f*S,-.075f*S-.03f*S*nose));beak.Rotation=new(-MathF.PI/2,0,0);p.Body.AddChild(beak);
        for(int sign=-1;sign<=1;sign+=2){p.Body.AddChild(Part(new SphereMesh{Radius=.014f*S,Height=.028f*S,RadialSegments=5,Rings=3},0xf0ece0,new(sign*.028f*S,.62f*S,-.066f*S)));p.Body.AddChild(Part(new SphereMesh{Radius=.008f*S,Height=.016f*S,RadialSegments=4,Rings=2},0x111111,new(sign*.028f*S+(role=="schele"?-sign*.008f*S:0),.62f*S,-.078f*S)));p.Body.AddChild(Part(new CylinderMesh{TopRadius=.024f*S,BottomRadius=.022f*S,Height=.22f*S,RadialSegments=5},0x3a3228,new(sign*.045f*S,.12f*S,0)));}
        p.Body.AddChild(Part(new CylinderMesh{TopRadius=.07f*S,BottomRadius=.085f*S,Height=.06f*S,RadialSegments=7},role=="neus"?0xa01c14u:0x1a1612u,new(0,.7f*S,0)));
        p.Arm.Position=new(.09f*S,.5f*S,0);p.Arm.AddChild(Part(new CylinderMesh{TopRadius=.02f*S,BottomRadius=.018f*S,Height=.2f*S,RadialSegments=5},coat,new(0,-.1f*S,0)));p.Body.AddChild(p.Arm);
        p.Group.AddChild(Part(new CylinderMesh{TopRadius=.004f,BottomRadius=.004f,Height=1.8f,RadialSegments=4},0x222222,new(0,1.35f,0)));puppets.Add(p);
    }
    private void Reset(string how,ClientState? state){generation++;wasInside=false;Inside=false;busy=false;paidDay=-1;Play=null;Ticket=null;Spoken=0;stage=0;caption.Visible=false;foreach(var p in puppets)p.Group.Visible=false;}
    public override void _Process(double dt)
    {
        using var frameCost = Scheldemist.Dev.FrameCost.Track("Play.Poesje");
        float dx=Jef.I.X-origin.X,dz=Jef.I.Z-origin.Z,x=dx*MathF.Cos(yaw)-dz*MathF.Sin(yaw),z=dx*MathF.Sin(yaw)+dz*MathF.Cos(yaw);Inside=x>minX&&x<maxX&&z>foot&&z<maxZ&&MathF.Abs(Jef.I.Y-floor)<.6f;
        if(Inside&&!wasInside){if(paidDay!=GameState.I.Day)_ = Enter();else Start();}wasInside=Inside;clock+=dt;
        float wanted=Inside&&stage is >=1 and <=3?1:0;curtain+=(wanted-curtain)*Math.Min(1,dt*4);foreach(var c in curtains)Scheldemist.Render.NodeUpdates.Position(c.Node,c.At+Vector3.Right*(float)curtain*1.05f*c.Sign);
        if(!Inside){caption.Visible=false;foreach(var p in puppets)p.Group.Visible=false;return;}
        if(Play?.Lines==null||stage==0)return;
        foreach(var p in puppets){bool third=p.Role==thirdRole;p.Group.Visible=p.Role is "neus" or "schele"||third;if(p.Group.Visible){bool speaking=index>=0&&index<Play.Lines.Count&&(Play.Lines[index].Who==p.Role||Play.Lines[index].Who=="third"&&third);p.Body.Position=Vector3.Up*(speaking?(float)Math.Abs(Math.Sin(clock*8))*.025f:0);p.Arm.Rotation=new((float)Math.Sin(clock*7)*(speaking?.5f:.05f),0,.25f);}}
        if((time-=dt)>0)return;
        if(stage==1){caption.Text="Tonight: "+Play.Title;ShowCaption();stage=2;time=3.2;return;}
        if(stage==2){stage=3;index=-1;}
        if(stage==3){if(++index>=Play.Lines.Count){caption.Visible=false;stage=4;time=2;return;}var l=Play.Lines[index];string name=l.Who=="neus"?"Neus":l.Who=="schele"?"Schele":Play.Third??"The other";caption.Text=name+": "+l.Text;ShowCaption();time=Math.Min(5.5,2.6+l.Text.Length/38.0);Soundscape.I?.Speech(StageAt.X,StageAt.Z,new("m",45),Math.Min(time-.4,4));Spoken++;return;}
        if(stage==4){GameState.I.Say("The curtain drops. The children stamp and cheer; a docker whistles through his fingers.");stage=5;time=25;return;}
        if(stage==5){if(GameState.I.HourF>=22.5||GameState.I.HourF<6){stage=0;foreach(var p in puppets)p.Group.Visible=false;return;}Start();}
    }
    private void ShowCaption(){caption.Visible=true;caption.Position=new((GetViewport().GetVisibleRect().Size.X-caption.Size.X)/2,110);}
    private static string ThirdRole(string name)=>Regex.IsMatch(name,"agent|police|constable|officer",RegexOptions.IgnoreCase)?"agent":Regex.IsMatch(name,"thief|pickpocket|rogue|robber",RegexOptions.IgnoreCase)?"thief":Regex.IsMatch(name,"bride|wife|widow|woman|fishwife|maid|girl",RegexOptions.IgnoreCase)?"woman":Regex.IsMatch(name,"jef|farm|boy|lad",RegexOptions.IgnoreCase)?"jef":Regex.IsMatch(name,"skipper|sailor|captain",RegexOptions.IgnoreCase)?"sailor":"other";
    private void Start(){if(Play?.Lines==null)return;stage=1;index=-1;time=5.6;Spoken=0;}
    public async Task Enter()
    {
        if(busy||dead||ServerLink.I?.Api is not {} api)return;busy=true;int g=generation;
        try{var info=await api.Poesje();var ticket=await api.PoesjeEnter();if(dead||g!=generation)return;Ticket=ticket;GameState.I.Apply(ticket);GameState.I.Say(ticket.Line);paidDay=GameState.I.Day;var play=info.Play.State=="ready"?info.Play:await api.PoesjePlay();if(dead||g!=generation)return;Play=play;thirdRole=ThirdRole(play.Third??"");Start();}
        catch(ApiException e){if(dead||g!=generation)return;GameState.I.Say(e.Message);var at=World(0,minZ+.8f,.18f);Jef.I.Place(at.X,at.Z,yaw+MathF.PI,near:.18f);}finally{busy=false;}
    }
    public override void _ExitTree(){dead=true;generation++;caption.QueueFree();foreach(var p in puppets)p.Group.QueueFree();if(Scheldemist.Menu.MainMenu.I is {} menu)menu.WorldReplaced-=Reset;}
}
