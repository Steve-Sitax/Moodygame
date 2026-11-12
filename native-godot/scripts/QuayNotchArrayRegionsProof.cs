using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text.Json;
using Godot;
using Scheldemist.World;

public partial class QuayNotchArrayRegionsProof : Node
{
    public override void _Ready()
    {
        try
        {
            var args=OS.GetCmdlineUserArgs();string output=args[Array.IndexOf(args,"--out")+1];var reports=new List<object>();int failures=0;
            foreach(bool indexed in new[]{true,false})
            {
                var p=new List<Vector3>();var ix=new List<int>();
                for(int y=0;y<=20;y++)for(int x=0;x<=100;x++)p.Add(new Vector3(x*.13f-6.5f,y*.13f-1.3f,.02f*MathF.Sin(x*.13f)));
                for(int y=0;y<20;y++)for(int x=0;x<100;x++){int a=y*101+x;ix.AddRange(new[]{a,a+1,a+102,a,a+102,a+101});}
                ix.AddRange(ix.Take(6).ToArray());
                var vertices=indexed?p.ToArray():ix.Select(i=>p[i]).ToArray();
                using var source=new Godot.Collections.Array();source.Resize((int)Mesh.ArrayType.Max);
                source[(int)Mesh.ArrayType.Vertex]=vertices;
                source[(int)Mesh.ArrayType.Normal]=vertices.Select(v=>new Vector3(v.X*.01f,.03f,1).Normalized()).ToArray();
                source[(int)Mesh.ArrayType.TexUV]=vertices.Select(v=>new Vector2(v.X/4.8f,v.Y/2.4f)).ToArray();
                source[(int)Mesh.ArrayType.Color]=vertices.Select(v=>new Color(.3f+.02f*v.X,.11f,.4f,.17f)).ToArray();
                source[(int)Mesh.ArrayType.Custom0]=Enumerable.Range(0,vertices.Length*4).Select(i=>(byte)(i*31%256)).ToArray();
                if(indexed)source[(int)Mesh.ArrayType.Index]=ix.ToArray();
                var regions=new List<QuayNotch.Region>();
                for(int i=0;i<29;i++)
                {
                    float x=-3+i*.19f,y=.24f*MathF.Sin(i*.7f),angle=i*.21f;
                    var inv=new Transform3D(new Basis(Vector3.Back,angle),new Vector3(x,y,0)).AffineInverse();
                    var planes=new List<Func<Vector3,float>>{v=>(inv*v).Z+.3f,v=>.3f-(inv*v).Z};
                    for(int k=0;k<17;k++){float a=k*Mathf.Tau/17;var n=new Vector2(MathF.Cos(a),MathF.Sin(a));planes.Add(v=>.28f-new Vector2((inv*v).X,(inv*v).Y).Dot(n));}
                    regions.Add(new(new Aabb(new Vector3(x-.5f,y-.5f,-.4f),new Vector3(1,1,.8f)),planes));
                }
                using var reference=source.Duplicate(true);using var fast=source.Duplicate(true);
                int expected=0;var clock=System.Diagnostics.Stopwatch.StartNew();
                foreach(var r in regions)expected+=QuayNotch.CutSurfaceWith(reference,Transform3D.Identity,t=>new Aabb(t.Item1,Vector3.Zero).Expand(t.Item2).Expand(t.Item3).Intersects(r.Box),r.Inside);
                double oldMs=clock.Elapsed.TotalMilliseconds;clock.Restart();int actual=QuayNotch.CutSurfaceRegions(fast,Transform3D.Identity,regions);double newMs=clock.Elapsed.TotalMilliseconds;
                var differences=new List<int>();for(int k=0;k<fast.Count;k++)if(!GD.VarToBytes(reference[k]).SequenceEqual(GD.VarToBytes(fast[k])))differences.Add(k);
                if(differences.Count>0||actual!=expected)failures++;
                reports.Add(new{indexed,expected,actual,differences,oldMs,newMs,digest=Convert.ToHexString(SHA256.HashData(GD.VarToBytes(fast)))});
            }
            File.WriteAllText(output,JsonSerializer.Serialize(new{failures,reports},new JsonSerializerOptions{WriteIndented=true}));
            GD.Print("CUT ARRAY REGIONS PROOF: "+failures+" differences");GetTree().Quit(failures==0?0:1);
        }
        catch(Exception e){GD.PrintErr(e);GetTree().Quit(1);}
    }
}
