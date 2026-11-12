using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;
using Godot;
using Scheldemist.World.Ruien;

// Compare the actual charts, heights, normals and weather of generated paving with the original searches.
public partial class RuienPavingSearchProof : Node
{
    public override void _Ready()
    {
        try
        {
            var args=OS.GetCmdlineUserArgs();string output=args[Array.IndexOf(args,"--out")+1];
            var data=RuienData.Load();var rng=new Random(14719);var reports=new List<object>();
            int mismatches=0;
            foreach(string cls in new[]{"M","G"})
            foreach(int side in cls=="M"?new[]{-1,1}:new[]{0})
            {
                var section=data.Classes[cls] with{WalkwaySide=side};
                var path=new List<Vector2>();
                // Closely sampled bends, negative coordinates and long straight stretches.
                for(int i=0;i<=800;i++){float u=i*.2f;path.Add(new Vector2(-310+u*.72f,137+8*MathF.Sin(u*.05f)));}
                var zone=new RuienData.Zone{Id="query_fixture",S=section,Path=path.ToArray(),Along=new float[path.Count]};
                for(int i=1;i<path.Count;i++)zone.Along[i]=zone.Along[i-1]+path[i].DistanceTo(path[i-1]);
                var area=new RuienData.Area{Id=cls+side};area.Zones.Add(zone);
                var samples=new Vector3[12000];
                for(int i=0;i<samples.Length;i++)
                {
                    var f=zone.Frame((float)rng.NextDouble()*zone.Length);
                    var q=f.at+new Vector2(f.tan.Y,-f.tan.X)*(float)(rng.NextDouble()*30-15);
                    samples[i]=new Vector3(q.X,section.LedgeY+(i%3-1)*.02f,q.Y);
                }
                (Vector2 uv,float? floor)[] Query(bool full,out double ms)
                {
                    RuienPaving.FullSearchProof=full;RuienPaving.Layout(area);var time=Stopwatch.StartNew();
                    var rows=samples.Select(p=>(RuienPaving.Coordinates(p),RuienPaving.Floor(p))).ToArray();
                    ms=time.Elapsed.TotalMilliseconds;return rows;
                }
                var reference=Query(true,out double before);var actual=Query(false,out double after);
                bool Same(float a,float b)=>BitConverter.SingleToInt32Bits(a)==BitConverter.SingleToInt32Bits(b);
                int errors=0;
                for(int i=0;i<samples.Length;i++)
                    if(!Same(reference[i].uv.X,actual[i].uv.X)||!Same(reference[i].uv.Y,actual[i].uv.Y)||
                       reference[i].floor.HasValue!=actual[i].floor.HasValue||reference[i].floor is float x && !Same(x,actual[i].floor!.Value))errors++;
                string Geometry(bool full)
                {
                    RuienPaving.FullSearchProof=full;RuienPaving.Layout(area);
                    using var tool=new SurfaceTool();tool.Begin(Mesh.PrimitiveType.Triangles);
                    for(int i=0;i<8;i++)
                    {
                        var f=zone.Frame(8+i*9);var t=new Vector3(f.tan.X,0,f.tan.Y);var n=new Vector3(f.tan.Y,0,-f.tan.X);
                        float lateral=(section.Width/2-section.Ledge/2)*(side==0?1:side);
                        var c=new Vector3(f.at.X,section.LedgeY,f.at.Y)+n*lateral;
                        var a=c-t*.3f-n*.23f;var b=c+t*.3f-n*.23f;var d=c-t*.3f+n*.23f;var e=c+t*.3f+n*.23f;
                        RuienPaving.Triangle(tool,a,b,e);RuienPaving.Triangle(tool,a,e,d);
                    }
                    using var mesh=tool.Commit();using var arrays=mesh.SurfaceGetArrays(0);
                    return Convert.ToHexString(SHA256.HashData(GD.VarToBytes(arrays)));
                }
                string oldDigest=Geometry(true),newDigest=Geometry(false);
                if(oldDigest!=newDigest)errors++;
                mismatches+=errors;reports.Add(new{cls,side,samples=samples.Length,mismatches=errors,fullSearchMs=before,indexedMs=after,geometryDigest=newDigest});
            }
            RuienPaving.FullSearchProof=false;
            File.WriteAllText(output,JsonSerializer.Serialize(new{mismatches,cases=reports},new JsonSerializerOptions{WriteIndented=true}));
            GD.Print($"PAVING SEARCH PROOF {(mismatches==0?"PASS":"FAIL")}: {mismatches} differences");GetTree().Quit(mismatches==0?0:1);
        }
        catch(Exception e){GD.PrintErr(e);GetTree().Quit(1);}
    }
}
