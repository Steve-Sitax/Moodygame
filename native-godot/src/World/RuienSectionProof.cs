using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.World.Ruien;

namespace Scheldemist.Native.World;

/// <summary>Headless section/repair contracts; no installed resources are written.</summary>
public static class RuienSectionProof
{
    public static void Run(string output)
    {
        int checks=0;
        void Check(bool ok,string name){if(!ok)throw new InvalidOperationException(name);checks++;}
        bool Near(float a,float b)=>MathF.Abs(a-b)<.00001f;
        var data=RuienData.Load();var g=data.Classes["G"];var m=data.Classes["M"];
        Check(Near(m.Spring,-2.7f)&&Near(m.Channel,2.8f)&&Near(m.LedgeY,-3.9f)&&Near(m.Water,-4.4f),"M kit dimensions");
        Check(Near(g.Spring,-3.1f)&&Near(g.LedgeY,-3.6f)&&g.WalkwaySide==0,"G unchanged");
        RuienData.Zone Zone(string id,RuienData.Section s,float x=0)=>new(){Id=id,S=s,Path=new[]{new Vector2(x,0),new Vector2(x,10)},Along=new[]{0f,10f}};
        foreach(int side in new[]{-1,1})
        {
            var s=m with {WalkwaySide=side};var z=Zone("m",s);
            Check(Near(s.ChannelHigh-s.ChannelLow,2.8f),"asymmetric channel width");
            Check(Near(s.Shell(s.Spring),1.8f)&&Near(s.Shell(s.Crown),0),"semicircular shell");
            var area=new RuienData.Area();area.Zones.Add(z);RuienPaving.Layout(area);
            Check(RuienPaving.Floor(new Vector3(side*1.4f,-3.9f,5)) is float y&&Near(y,-3.9f),"walk supported");
            Check(RuienPaving.Floor(new Vector3(-side*1.4f,-3.9f,5))==null,"no opposite ledge");
            Check(RuienPaving.Floor(new Vector3(side*1.4f,-3.6f,5))==null,"no G height on M");
            var st=new SurfaceTool();st.Begin(Mesh.PrimitiveType.Triangles);
            var arrays=new Godot.Collections.Array();arrays.Resize((int)Mesh.ArrayType.Max);
            arrays[(int)Mesh.ArrayType.Vertex]=new[]{new Vector3(side*1.2f,-3.9f,5),new Vector3(side*1.6f,-3.9f,5),new Vector3(side*1.4f,-3.9f,5.3f)};
            arrays[(int)Mesh.ArrayType.Index]=new[]{0,1,2};
            Check(RuienPaving.Extract(arrays,st,.075f),"M brick walk extracted");
            var paved=st.Commit().GetFaces();Check(paved.All(p=>p.Y>=-3.90001f&&p.Y<=-3.8839f),"setts relief on M walk");
            var impact=RuienDrain.SpoutImpact(z,5,side);
            Check(Near(impact.Y,s.Water)&&MathF.Abs(impact.X)<1,"spill reaches M channel water");
            var cut=RuienDrain.GutterCut(z,5,side);
            Check(cut.All(f=>f(new Vector3(side*1.4f,-4,5))>0),"M gutter cut");
            using var spec=JsonDocument.Parse("{\"pipes\":[{\"zone\":\"m\",\"front\":[1.59,-3.1,5],\"axis\":[1,0,0]}]}");
            var pipe=RuienPipe.Read(spec.RootElement,area).Single();
            Check(Near(pipe.Walk,-3.9f)&&Near(pipe.Ledge,.8f),"pipe uses zone walk");
            var pipeNode=RuienPipe.Build(pipe,0);
            var film=pipeNode.GetChildren().OfType<MeshInstance3D>().First().Mesh.GetFaces();
            Check(film.All(p=>Near(p.Y,-3.9f+.0175f)),"pipe film geometry on M walk");pipeNode.Free();
            var drainNode=RuienDrain.Build(z,5,side);
            var spout=drainNode.GetNode<MeshInstance3D>("spout").Mesh.GetFaces();
            Check(spout.Max(p=>p.Y)<-4 && spout.Min(p=>p.Y)<-4.4f,"drain spout geometry reaches water");drainNode.Free();
        }
        var a2=new RuienData.Area();var first=Zone("first",g,40);var second=Zone("second",m);
        a2.Zones.Add(first);a2.Zones.Add(second);
        Check(a2.StairZone(new(){Zone="second"})==second,"keeper second zone");
        Check(a2.StairZone(new())==first,"keeper legacy fallback");
        bool rejected=false;try{a2.StairZone(new(){Zone="missing"});}catch(InvalidOperationException){rejected=true;}
        Check(rejected,"unknown keeper zone rejected");
        var keeper=new RuienData.Way { Zone="second",Top=new(-3,0,1),Bottom=new(-3,-3.9f,5),LandingPath=new[]{new Vector2(-3,5.6f),new Vector2(-1,5.6f)} };
        var sample=new Vector3(-1.8f,-3,5);
        Check(RuienStair.ArrisCut(keeper,a2.StairZone(keeper))!(sample)>-1 && RuienStair.ArrisCut(keeper,first)!(sample)==-100,"arris uses second gallery geometry");
        Directory.CreateDirectory(output);File.WriteAllText(Path.Combine(output,"sections.json"),JsonSerializer.Serialize(new{checks,passed=true},new JsonSerializerOptions{WriteIndented=true}));
        GD.Print($"Ruien section proof: {checks} passed");
    }
}
