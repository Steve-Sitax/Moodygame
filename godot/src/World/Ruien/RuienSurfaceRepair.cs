using System;
using System.Collections.Generic;
using System.Linq;
using Godot;

namespace Scheldemist.World.Ruien;

/// <summary>Offline host repairs: precise drain cuts and runoff in the masonry's own vertex data.</summary>
public static class RuienSurfaceRepair
{
    private static readonly (float u,int side,float y)[] Pipes={(12.6f,1,-3.05f),(28.4f,-1,-3.15f),(20.3f,1,-3.2f)};
    public static bool Apply(Godot.Collections.Array arrays,string family,RuienData.Zone zone)
    {
        bool changed=false;
        if(family=="ruien_brick_stretcher")
            foreach(var (u,side) in RuienDrain.Mouths)
            {
                var (centre,tangent)=zone.Frame(u);var normal=new Vector2(tangent.Y,-tangent.X)*side;
                float Along(Vector3 p)=>(new Vector2(p.X,p.Z)-centre).Dot(tangent);
                float Across(Vector3 p)=>(new Vector2(p.X,p.Z)-centre).Dot(normal);
                var outline=new List<Vector2>();
                float W(float h)=>h>=1.1f?MathF.Sqrt(Math.Max(0,.25f-(h-1.1f)*(h-1.1f))):.5f*MathF.Pow(Math.Max(0,1-MathF.Pow((1.1f-h)/1.1f,2)),.425f);
                for(int k=0;k<=40;k++){float h=k*1.6f/40;outline.Add(new(W(h),h-3.35f));}
                for(int k=39;k>0;k--){float h=k*1.6f/40;outline.Add(new(-W(h),h-3.35f));}
                // Remove the host behind the unchanged headers too: their mortar bed must be visible in the joints.
                var inner=outline.ToArray();
                for(int k=0;k<outline.Count;k++)
                {
                    var tangent2=(inner[(k+1)%inner.Length]-inner[(k+inner.Length-1)%inner.Length]).Normalized();
                    outline[k]+=new Vector2(tangent2.Y,-tangent2.X)*.202f;
                }
                var planes=new List<Func<Vector3,float>>{p=>Across(p)-1.75f,p=>4.8f-Across(p)};
                for(int k=0;k<outline.Count;k++)
                {
                    var a=outline[k];var b=outline[(k+1)%outline.Count];var d=b-a;
                    planes.Add(p=>d.Cross(new Vector2(Along(p),p.Y)-a));
                }
                changed|=QuayNotch.CutSurfaceWith(arrays,Transform3D.Identity,_=>true,planes)>0;
            }
        if(family=="ruien_brick_stretcher")
            foreach(var (u,side,y) in Pipes)
            {
                var (centre,tangent)=zone.Frame(u);var normal=new Vector2(tangent.Y,-tangent.X)*side;
                float Across(Vector3 p)=>(new Vector2(p.X,p.Z)-centre).Dot(normal);
                var planes=new List<Func<Vector3,float>>{p=>Across(p)-2.85f,p=>3.7f-Across(p)};
                for(int k=0;k<48;k++)
                {
                    float angle=k*Mathf.Tau/48;var n=new Vector2(MathF.Cos(angle),MathF.Sin(angle));
                    planes.Add(p=>.109f-n.Dot(new Vector2((new Vector2(p.X,p.Z)-centre).Dot(tangent),p.Y-y+.02f)));
                }
                changed|=QuayNotch.CutSurfaceWith(arrays,Transform3D.Identity,_=>true,planes)>0;
            }
        if(!family.StartsWith("ruien_brick") && family!="ruien_setts" && family!="ruien_bluestone")return changed;
        foreach(var(u,side) in RuienDrain.Mouths)
            changed|=QuayNotch.CutSurfaceWith(arrays,Transform3D.Identity,_=>true,RuienDrain.GutterCut(zone,u,side))>0;
        var vertices=arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
        var colors=arrays[(int)Mesh.ArrayType.Color].VariantType==Variant.Type.Nil?vertices.Select(_=>new Color(0,0,0,0)).ToArray():arrays[(int)Mesh.ArrayType.Color].AsColorArray();
        var baked=arrays[(int)Mesh.ArrayType.Custom0].VariantType==Variant.Type.Nil?Array.Empty<byte>():arrays[(int)Mesh.ArrayType.Custom0].AsByteArray();
        for(int i=0;i<vertices.Length;i++)
            foreach(var (u,side,y) in Pipes)
            {
                var (centre,tangent)=zone.Frame(u);var normal=new Vector2(tangent.Y,-tangent.X)*side;
                var p=vertices[i];var rel=new Vector2(p.X,p.Z)-centre;
                float along=rel.Dot(tangent),across=rel.Dot(normal),fall=y-.09f-p.Y;
                bool floor=p.Y> -3.64f && p.Y< -3.54f;
                if(fall<0 || fall>.85f || across<1.5f || across>3.15f)continue;
                float width=floor?.30f:.13f+.035f*fall;
                float wiggle=.015f*MathF.Sin(p.Y*32+u);
                float mask=Math.Clamp(1-MathF.Abs(along-wiggle)/width,0,1);
                mask*=floor?Math.Clamp((across-1.7f)/.7f,0,1):Math.Clamp((across-2.70f)/.18f,0,1);
                if(mask<=0)continue;
                mask*=.75f+.25f*MathF.Sin(p.Y*51+along*73)*MathF.Sin(across*43);
                var c=colors[i];c.R=Math.Max(c.R,mask*.95f);c.B=Math.Max(c.B,mask*.27f);
                // Lime rims follow the damp streak, while iron-rich water leaves its rust-coloured centre.
                c.G=Math.Max(c.G,mask*(MathF.Abs(along)>.065f?.22f:.025f));colors[i]=c;
                if(baked.Length==vertices.Length*4 && baked[i*4]+baked[i*4+1]+baked[i*4+2]>0)
                {
                    var rust=new Vector3(.105f,.037f,.012f);
                    for(int k=0;k<3;k++)
                    {
                        float old=baked[i*4+k]/255f;old*=old;
                        float v=Mathf.Lerp(old*.48f,rust[k],.5f);
                        baked[i*4+k]=(byte)Math.Clamp(MathF.Sqrt(Mathf.Lerp(old,v,mask*.85f))*255,0,255);
                    }
                }
                changed=true;
            }
        arrays[(int)Mesh.ArrayType.Color]=colors;
        if(baked.Length>0)arrays[(int)Mesh.ArrayType.Custom0]=baked;
        return changed;
    }
}
