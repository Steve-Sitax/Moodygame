using System;
using System.Collections.Generic;
using System.Linq;
using Godot;

namespace Scheldemist.World.Ruien;

/// <summary>Offline host repairs: precise drain cuts and runoff in the masonry's own vertex data.</summary>
public static class RuienSurfaceRepair
{
    /// <summary>
    /// Calcite crusts: every groin and rib carried the same bright ribbon with a cut-off end. Each crust piece now
    /// differs (clean white, grey with soot, or dark and wet, by a hash of where it is) and its ends fade into the
    /// masonry's tone instead of stopping square. Geometry is untouched (the ridges still close the groins).
    /// </summary>
    public static bool Calcite(Godot.Collections.Array arrays)
    {
        var p=arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();if(p.Length==0)return false;
        var ix=arrays[(int)Mesh.ArrayType.Index].VariantType==Variant.Type.Nil?Enumerable.Range(0,p.Length).ToArray():arrays[(int)Mesh.ArrayType.Index].AsInt32Array();
        var colors=arrays[(int)Mesh.ArrayType.Color].VariantType==Variant.Type.Nil?p.Select(_=>new Color(0,0,0,0)).ToArray():arrays[(int)Mesh.ArrayType.Color].AsColorArray();
        // Pieces: vertices joined by triangles or by sharing a position.
        var parent=Enumerable.Range(0,p.Length).ToArray();
        int Find(int x){while(parent[x]!=x){parent[x]=parent[parent[x]];x=parent[x];}return x;}
        void Join(int a,int b){a=Find(a);b=Find(b);if(a!=b)parent[b]=a;}
        var weld=new Dictionary<(int,int,int),int>();
        for(int i=0;i<p.Length;i++){var k=((int)MathF.Round(p[i].X*500),(int)MathF.Round(p[i].Y*500),(int)MathF.Round(p[i].Z*500));if(weld.TryGetValue(k,out int j))Join(j,i);else weld[k]=i;}
        for(int i=0;i<ix.Length;i+=3){Join(ix[i],ix[i+1]);Join(ix[i],ix[i+2]);}
        foreach(var piece in Enumerable.Range(0,p.Length).GroupBy(Find))
        {
            var members=piece.ToArray();
            var c=members.Aggregate(Vector3.Zero,(s,i)=>s+p[i])/members.Length;
            // Long axis: the farthest pair through the centre (cheap and stable for ribbons and curtains).
            var far=members.OrderByDescending(i=>p[i].DistanceSquaredTo(c)).First();var axis=(p[far]-c).Normalized();
            float lo=members.Min(i=>(p[i]-c).Dot(axis)),hi=members.Max(i=>(p[i]-c).Dot(axis));float span=Math.Max(hi-lo,1e-3f);
            uint h=(uint)(MathF.Round(c.X*7)*73856093)^(uint)(MathF.Round(c.Y*7)*19349663)^(uint)(MathF.Round(c.Z*7)*83492791);
            int kind=(int)(h%20);
            float soot=kind<8?.05f:kind<15?.45f:.7f,wet=kind<15?.2f:.85f;
            foreach(int i in members)
            {
                float t=((p[i]-c).Dot(axis)-lo)/span;
                float end=span>.6f?1-Math.Clamp(MathF.Min(t,1-t)/.22f,0,1):0;
                var col=colors[i];
                col.B=Math.Max(col.B,soot+.55f*end);col.R=Math.Max(col.R,wet*(1-.5f*end)+.3f*end);
                colors[i]=col;
            }
        }
        arrays[(int)Mesh.ArrayType.Color]=colors;
        return true;
    }

    private static float Hash(int x,int y,int z){uint h=(uint)(x*73856093)^(uint)(y*19349663)^(uint)(z*83492791);h^=h>>13;h*=0x5bd1e995;h^=h>>15;return (h&0xffffff)/16777215f;}
    /// <summary>Smooth value noise in [0,1] at a world point (cell size 1/frequency).</summary>
    public static float Noise(Vector3 p)
    {
        int x=(int)MathF.Floor(p.X),y=(int)MathF.Floor(p.Y),z=(int)MathF.Floor(p.Z);var f=p-new Vector3(x,y,z);
        f=f*f*(new Vector3(3,3,3)-2*f);
        float L(float a,float b,float t)=>a+(b-a)*t;
        return L(L(L(Hash(x,y,z),Hash(x+1,y,z),f.X),L(Hash(x,y+1,z),Hash(x+1,y+1,z),f.X),f.Y),
                 L(L(Hash(x,y,z+1),Hash(x+1,y,z+1),f.X),L(Hash(x,y+1,z+1),Hash(x+1,y+1,z+1),f.X),f.Y),f.Z);
    }

    /// <summary>
    /// The study baked the same pale lime runs onto every rib and groin. Vary them from bay to bay (about 3 m):
    /// where the noise says so, the baked lime is drawn back towards the brick's own damp tone and the lime mask eases.
    /// </summary>
    public static bool VaryLime(Godot.Collections.Array arrays)
    {
        var p=arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
        if(arrays[(int)Mesh.ArrayType.Custom0].VariantType!=Variant.Type.PackedByteArray)return false;
        var baked=arrays[(int)Mesh.ArrayType.Custom0].AsByteArray();if(baked.Length!=p.Length*4)return false;
        var colors=arrays[(int)Mesh.ArrayType.Color].VariantType==Variant.Type.Nil?null:arrays[(int)Mesh.ArrayType.Color].AsColorArray();
        bool changed=false;
        for(int i=0;i<p.Length;i++)
        {
            if(baked[i*4]+baked[i*4+1]+baked[i*4+2]==0)continue;
            var c=new Vector3(baked[i*4],baked[i*4+1],baked[i*4+2])/255f;c*=c;
            float lum=(c.X+c.Y+c.Z)/3,sat=(MathF.Max(c.X,MathF.Max(c.Y,c.Z))-MathF.Min(c.X,MathF.Min(c.Y,c.Z)))/MathF.Max(lum,1e-3f);
            float pale=Math.Clamp((lum-.05f)/.12f,0,1)*Math.Clamp(1-sat*.9f,0,1);
            if(pale<=0)continue;
            float k=Math.Clamp((Noise(p[i]*.34f+new Vector3(3.1f,7.7f,1.9f))-.38f)/.3f,0,1)*.8f*pale;
            if(k<=0)continue;
            var brick=new Vector3(.075f,.032f,.02f);var v=c.Lerp(brick+c*.25f,k);
            for(int j=0;j<3;j++)baked[i*4+j]=(byte)Math.Clamp(MathF.Round(MathF.Sqrt(v[j])*255),1,255);
            if(colors!=null){var w=colors[i];w.G*=1-k*.8f;w.R=Math.Max(w.R,.35f*k);colors[i]=w;}
            changed=true;
        }
        arrays[(int)Mesh.ArrayType.Custom0]=baked;if(colors!=null)arrays[(int)Mesh.ArrayType.Color]=colors;
        return changed;
    }

    public static bool Apply(Godot.Collections.Array arrays,string family,RuienData.Zone zone,IReadOnlyList<RuienPipe.Spec> pipes)
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
            foreach(var pipe in pipes)
            {
                // The host opens to the pipe barrel only; the pipe's fillet and its brick backing close the rest.
                var wall=RuienPipe.Wall(pipe);var lat=Vector3.Up.Cross(pipe.Axis).Normalized();
                var planes=new List<Func<Vector3,float>>{p=>(p-wall).Dot(pipe.Axis)+.25f,p=>.55f-(p-wall).Dot(pipe.Axis)};
                for(int k=0;k<48;k++)
                {
                    float angle=k*Mathf.Tau/48;var n=new Vector2(MathF.Cos(angle),MathF.Sin(angle));
                    planes.Add(p=>RuienPipe.Outer-.012f-n.Dot(new Vector2((p-wall).Dot(lat),p.Y-wall.Y)));
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
            foreach(var pipe in pipes)
            {
                // Local frame: along the wall, depth into it (0 at the face, negative over the walk), fall below the lip.
                var wall=RuienPipe.Wall(pipe);var lat=Vector3.Up.Cross(pipe.Axis).Normalized();
                var p=vertices[i];var d=p-wall;
                float along=d.Dot(lat),depth=d.Dot(pipe.Axis),fall=wall.Y-RuienPipe.Outer-p.Y;
                bool floor=p.Y> -3.64f && p.Y< -3.54f;
                // The coping's arris and face below the walk carry the run-off on into the channel.
                bool coping=!floor&&p.Y> -3.95f&&p.Y<= -3.54f&&depth< -1.3f;
                if(fall< -.02f || depth>.2f || depth< -1.8f)continue;
                if(!floor&&!coping&&depth< -.25f)continue;
                float wiggle=.015f*MathF.Sin(p.Y*32+wall.Z)+.02f*MathF.Sin(depth*7.3f);
                // A narrow streak down the wall; on the walk it fans out towards the channel.
                float spread=Math.Clamp(-depth/1.5f,0,1);
                float width=floor||coping?.10f+.36f*spread:.11f+.03f*fall;
                float mask=Math.Clamp(1-MathF.Abs(along-wiggle)/width,0,1);
                mask=MathF.Pow(mask,floor||coping?.45f:.7f)*(floor||coping?1-.3f*spread:1);
                if(mask<=0)continue;
                mask*=.82f+.18f*MathF.Sin(p.Y*51+along*73)*MathF.Sin(depth*43);
                // (the setts already carry damp .4-.6 and joint dirt up to .34: the run-off must clearly exceed both)
                var c=colors[i];c.R=Math.Max(c.R,Math.Min(1,mask*(floor||coping?1.2f:1f)));c.B=Math.Max(c.B,Math.Min(1,mask*(floor||coping?1.25f:.32f)));
                // Lime rims follow the damp streak, while iron-rich water leaves its rust-coloured centre.
                c.G=Math.Max(c.G,mask*(MathF.Abs(along)>.07f?.24f:.02f));
                // Slime takes hold along the edges of the wet fan on the walk.
                if(floor||coping)c.A=Math.Max(c.A,mask*.35f*Math.Clamp((MathF.Abs(along)/width-.35f)*3,0,1));
                colors[i]=c;
                if(baked.Length==vertices.Length*4 && baked[i*4]+baked[i*4+1]+baked[i*4+2]>0)
                {
                    var rust=new Vector3(.105f,.037f,.012f);
                    for(int k=0;k<3;k++)
                    {
                        float old=baked[i*4+k]/255f;old*=old;
                        float v=Mathf.Lerp(old*.42f,rust[k],.5f);
                        baked[i*4+k]=(byte)Math.Clamp(MathF.Sqrt(Mathf.Lerp(old,v,mask*.9f))*255,0,255);
                    }
                }
                changed=true;
            }
        arrays[(int)Mesh.ArrayType.Color]=colors;
        if(baked.Length>0)arrays[(int)Mesh.ArrayType.Custom0]=baked;
        return changed;
    }
}
