using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using Godot;
using Scheldemist.World;
using Scheldemist.Windows;
using Scheldemist.Render;
namespace Scheldemist.Play;
public partial class Emigrants
{
    private readonly List<Rect2> keepouts=new();
    private Node3D notice=null!;
    private Label3D noticeText=null!;
    private bool noticePlaced;
    public Vector3 NoticeAt=>notice.GlobalPosition+Vector3.Up*1.55f;
    public string NoticeText=>noticeText.Text;
    public bool CampClear(float x,float z,float radius=.3f)
    {
        if(z<12)return false;
        foreach(var r in keepouts)if(x>r.Position.X-.4f&&x<r.End.X+.4f&&z>r.Position.Y-.4f&&z<r.End.Y+.4f)return false;
        return town?.Walk?.Free(x,z)==true&&town.Walk.Free(x-radius,z-radius)&&town.Walk.Free(x+radius,z-radius)&&town.Walk.Free(x-radius,z+radius)&&town.Walk.Free(x+radius,z+radius);
    }
    private void PrepareNotice()
    {
        using var plan=JsonDocument.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://assets/indoor-keepouts.json")));
        foreach(var r in plan.RootElement.EnumerateArray()){float x=r.GetProperty("minX").GetSingle(),z=r.GetProperty("minZ").GetSingle();keepouts.Add(new(x,z,r.GetProperty("maxX").GetSingle()-x,r.GetProperty("maxZ").GetSingle()-z));}
        notice=new Node3D{Name="red_star_notice",Position=new(24,0,33),Visible=false};Main.I.View.AddChild(notice);
        notice.AddChild(Part(new BoxMesh{Size=new(.96f,1.16f,.06f)},Goods.I.Plain(0x4a3424),0,1.55f,0));
        var paper=(ShaderMaterial)Goods.I.Plain(0xd9cfae).Duplicate();paper.Shader=Psx.ShaderOf(Psx.KindOf(paper.Shader)!.Value with {Unlit=true});
        notice.AddChild(Part(new BoxMesh{Size=new(.9f,1.1f,.015f)},paper,0,1.55f,.04f));
        foreach(float x in new[]{-.4f,.4f})notice.AddChild(Part(new BoxMesh{Size=new(.08f,2.1f,.08f)},Goods.I.Plain(0x4a3424),x,1.05f,0));
        noticeText=new Label3D{Text="RED STAR LINE\n★\nANTWERP - PHILADELPHIA\nS.S. KEMPENLAND AT ANCHOR\nEMIGRANTS BOARD TODAY\nLIGHTERS FROM THIS QUAY",Font=PaperFonts.Print,FontSize=36,PixelSize=.0014f,Position=new(0,1.56f,.053f),Modulate=new Color(.16f,.12f,.09f),OutlineSize=0};notice.AddChild(noticeText);
    }
    private void UpdateNotice(Scheldemist.Net.EmigrantView view)
    {
        if(!noticePlaced){foreach(var p in new[]{new Vector2(24,33),new Vector2(37.5f,32),new Vector2(24,30.5f),new Vector2(16,30)})if(CampClear(p.X,p.Y,.9f)){notice.Position=new(p.X,0,p.Y);break;}noticePlaced=true;}
        string[] days={"MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY","SUNDAY"};string next=view.Ship.Today&&view.Hour<view.Ship.To?"TODAY":days[((view.Ship.Next-1)%7+7)%7];
        noticeText.Text="RED STAR LINE\n★\nANTWERP - PHILADELPHIA\nS.S. KEMPENLAND AT ANCHOR\nEMIGRANTS BOARD "+next+"\nLIGHTERS FROM THIS QUAY";notice.Visible=true;
    }
}
