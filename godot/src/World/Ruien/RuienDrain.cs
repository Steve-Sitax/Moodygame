using System;
using System.Collections.Generic;
using Godot;
using Scheldemist.Models;

namespace Scheldemist.World.Ruien;

/// <summary>B2's reusable sill and grated gutter; all clear widths stay walkable.</summary>
public static class RuienDrain
{
    public static readonly (float u,int side)[] Mouths={(16.6f,1),(23.8f,-1),(33f,1)};
    public static List<Func<Vector3,float>> GutterCut(RuienData.Zone zone,float u,int side)
    {
        var(c,t)=zone.Frame(u);var n=new Vector2(t.Y,-t.X)*side;
        float A(Vector3 p)=>(new Vector2(p.X,p.Z)-c).Dot(t);
        float S(Vector3 p)=>(new Vector2(p.X,p.Z)-c).Dot(n);
        return new(){p=>A(p)+.17f,p=>.17f-A(p),p=>S(p)-1.43f,p=>3.10f-S(p),p=>p.Y+3.82f,p=>-3.3f-p.Y};
    }
    public static Node3D Build(RuienData.Zone zone,float u,int side)
    {
        var(c,t)=zone.Frame(u);var n=new Vector2(t.Y,-t.X)*side;
        Vector3 P(float along,float y,float across)=>new(c.X+t.X*along+n.X*across,y,c.Y+t.Y*along+n.Y*across);
        var basis=new Basis(new Vector3(t.X,0,t.Y),Vector3.Up,new Vector3(-t.Y,0,t.X));
        var root=new Node3D{Name=$"drain_B2_{u}_{side}"};
        var stone=new SurfaceTool();var iron=new SurfaceTool();var water=new SurfaceTool();
        foreach(var tool in new[]{stone,iron,water})tool.Begin(Mesh.PrimitiveType.Triangles);
        void Box(SurfaceTool tool,float along,float y,float across,Vector3 size,float radius)
            =>tool.AppendFrom(BevelMesh.Box(size,radius,RuienMaterials.Get(tool==iron?"ruien_iron":"ruien_bluestone")),0,new Transform3D(basis,P(along,y,across)));
        // Thick sill with a central runnel, and a lined trough recessed below the walking surface.
        foreach(float sign in new[]{-1f,1f})Box(stone,sign*.30f,-3.40f,2.97f,new Vector3(.48f,.18f,.37f),.011f);
        Box(stone,0,-3.50f,2.97f,new Vector3(1.13f,.10f,.37f),.008f);
        Box(stone,0,-3.80f,2.23f,new Vector3(.34f,.10f,1.62f),.007f);
        foreach(float sign in new[]{-1f,1f})
        {
            Box(stone,sign*.18f,-3.69f,2.23f,new Vector3(.08f,.22f,1.62f),.007f);
            Box(iron,sign*.15f,-3.597f,2.23f,new Vector3(.026f,.045f,1.62f),.002f);
        }
        for(float s=1.46f;s<3.04f;s+=.075f)Box(iron,0,-3.597f,s,new Vector3(.31f,.045f,.021f),.002f);
        // Wet flow stays below the bars. The visible drop connects sill, gutter and channel water.
        Box(water,0,-3.747f,2.24f,new Vector3(.085f,.013f,1.58f),.004f);
        Box(water,0,-3.61f,2.87f,new Vector3(.025f,.27f,.018f),.006f);
        Box(water,0,-4.17f,1.44f,new Vector3(.022f,.86f,.018f),.006f);
        RuienStair.Add(root,stone,"ruien_bluestone",true);RuienStair.Add(root,iron,"ruien_iron",true);
        var flow=water.Commit();flow.SurfaceSetMaterial(0,RuienMaterials.Get("ruien_misc_Water_film"));
        root.AddChild(new MeshInstance3D{Mesh=flow,Layers=Ruien.Layer,CastShadow=GeometryInstance3D.ShadowCastingSetting.Off});
        return root;
    }
}
