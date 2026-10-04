using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using Godot;
using Scheldemist.Movers;
using Scheldemist.World;

namespace Scheldemist.Play;

/// <summary>Browser velocipedes.ts: ground triangles, rail heads and baked road ruts, indexed once.</summary>
public sealed class VeloGround
{
    public readonly record struct Ground(string Kind,Vector2 Rail,bool Rut);
    private readonly record struct Tri(Vector2 A,Vector2 B,Vector2 C,string Kind);
    private readonly record struct Rail(Vector2 A,Vector2 B,Vector2 Unit,float Len,float Offset);
    private readonly Dictionary<long,List<Tri>> cells=new();
    private readonly List<Rail> rails=new();
    private readonly HashSet<long> ruts=new();
    private static long Key(int x,int z)=>((long)x<<32)^(uint)z;
    private static bool Inside(Vector2 p,Tri t)
    {float a=(p-t.B).Cross(t.A-t.B),b=(p-t.C).Cross(t.B-t.C),c=(p-t.A).Cross(t.C-t.A);return !((a<0||b<0||c<0)&&(a>0||b>0||c>0));}
    private void Add(Vector2 a,Vector2 b,float off)
    {float len=a.DistanceTo(b);if(len>.001f)rails.Add(new(a,b,(b-a)/len,len,off));}
    public VeloGround()
    {
        using var doc=JsonDocument.Parse(File.ReadAllText(Water.CityJson()));var city=doc.RootElement;
        if(city.TryGetProperty("ground",out var ground))foreach(string kind in new[]{"earth","flags"})
            if(ground.TryGetProperty(kind,out var tris))foreach(var v in tris.EnumerateArray())
            {
                var t=new Tri(new(v[0].GetSingle(),v[1].GetSingle()),new(v[2].GetSingle(),v[3].GetSingle()),new(v[4].GetSingle(),v[5].GetSingle()),kind);
                for(int x=(int)Math.Floor(Math.Min(t.A.X,Math.Min(t.B.X,t.C.X))/4);x<=Math.Floor(Math.Max(t.A.X,Math.Max(t.B.X,t.C.X))/4);x++)
                    for(int z=(int)Math.Floor(Math.Min(t.A.Y,Math.Min(t.B.Y,t.C.Y))/4);z<=Math.Floor(Math.Max(t.A.Y,Math.Max(t.B.Y,t.C.Y))/4);z++)
                    {long k=Key(x,z);if(!cells.TryGetValue(k,out var list))cells[k]=list=new();list.Add(t);}
            }
        var decor=city.GetProperty("decor");foreach(var track in decor.GetProperty("tracks").EnumerateArray())
        {var line=Railway.RiderRailLine(track);for(int i=1;i<line.Count;i++)Add(new(line[i-1].X,line[i-1].Z),new(line[i].X,line[i].Z),1.435f/2);}
        foreach(var r in decor.GetProperty("crane_rails").EnumerateArray())Add(new(r[0].GetSingle(),r[1].GetSingle()),new(r[2].GetSingle(),r[3].GetSingle()),0);
        foreach(var n in BakedWorld.All(Main.I.World))if(n is MeshInstance3D m&&m.Name.ToString().Contains("ruts")&&m.Mesh!=null)
        {
            var faces=m.Mesh.GetFaces();for(int i=0;i+2<faces.Length;i+=3)
            {var a=m.GlobalTransform*faces[i];var b=m.GlobalTransform*faces[i+1];var c=m.GlobalTransform*faces[i+2];var t=new Tri(new(a.X,a.Z),new(b.X,b.Z),new(c.X,c.Z),"");
                for(int x=(int)Math.Floor(Math.Min(a.X,Math.Min(b.X,c.X)));x<=Math.Floor(Math.Max(a.X,Math.Max(b.X,c.X)));x++)
                for(int z=(int)Math.Floor(Math.Min(a.Z,Math.Min(b.Z,c.Z)));z<=Math.Floor(Math.Max(a.Z,Math.Max(b.Z,c.Z)));z++)if(Inside(new(x+.5f,z+.5f),t))ruts.Add(Key(x,z));}
        }
    }
    public Ground At(float x,float z)
    {
        string kind="cobble";var p=new Vector2(x,z);
        if(cells.TryGetValue(Key((int)Math.Floor(x/4),(int)Math.Floor(z/4)),out var list))foreach(var t in list)if(Inside(p,t)){kind=t.Kind;break;}
        if(x>5&&x<9&&z>-12&&z<0)kind="wood";
        Vector2 rail=Vector2.Zero;
        foreach(var r in rails)
        {if(x<Math.Min(r.A.X,r.B.X)-2||x>Math.Max(r.A.X,r.B.X)+2||z<Math.Min(r.A.Y,r.B.Y)-2||z>Math.Max(r.A.Y,r.B.Y)+2)continue;float t=(p-r.A).Dot(r.Unit);if(t<-.05f||t>r.Len+.05f)continue;float d=Math.Abs((p-r.A).Dot(new(-r.Unit.Y,r.Unit.X)));if(Math.Abs(d-r.Offset)<.09f){rail=r.Unit;break;}}
        return new(kind,rail,ruts.Contains(Key((int)Math.Floor(x),(int)Math.Floor(z))));
    }
}
