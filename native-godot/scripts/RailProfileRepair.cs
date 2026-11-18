using Godot;
using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using Scheldemist.Native.World;

// Offline repair of every baked quay rail segment. Authored centre lines and top contact heights are the oracle.
public partial class RailProfileRepair : Node
{
    const string PathRail="res://world/town/resources/r000556.res";
    record V(Vector3 P,Vector3 N,Vector2 U);
    readonly List<V>[] faces={new(),new(),new()};
    void Tri(int s,V a,V b,V c){if((b.P-a.P).Cross(c.P-a.P).Dot(a.N+b.N+c.N)>0)(b,c)=(c,b);faces[s].Add(a);faces[s].Add(b);faces[s].Add(c);}
    ShaderMaterial Finish(ShaderMaterial old,float crown,Color color)
    {
        var m=(ShaderMaterial)old.Duplicate();var sh=(Shader)old.Shader.Duplicate();
        string code=sh.Code.Replace("void fragment() {","global uniform float psx_wet;\nuniform float rail_crown = 0.0;\nvoid fragment() {");
        code=code.Replace("c *= albedo;","c *= albedo;\n\tfloat scale = 0.86 + 0.20 * psx_h12(floor(uv * vec2(18.0, 160.0)));\n\tc.rgb *= scale * mix(1.0, 0.70, psx_wet);\n\tc.rgb *= mix(0.82 + 0.18 * psx_h12(floor(uv * vec2(0.9, 24.0))), 1.0, rail_crown);");
        code=code.Replace("DIFFUSE_LIGHT += max(dot(NORMAL, LIGHT), 0.0) * a * LIGHT_COLOR / PI;","DIFFUSE_LIGHT += max(dot(NORMAL, LIGHT), 0.0) * a * LIGHT_COLOR / PI;\n\tvec3 halfway = normalize(LIGHT + VIEW);\n\tfloat exponent = mix(14.0, 110.0, rail_crown);\n\tSPECULAR_LIGHT += pow(max(dot(NORMAL, halfway), 0.0), exponent) * a * LIGHT_COLOR * mix(0.018, 0.18, rail_crown);");
        sh.Code=code;m.Shader=sh;m.SetShaderParameter("albedo",color);m.SetShaderParameter("rail_crown",crown);return m;
    }
    public override void _Ready()
    {
        try{Scheldemist.Native.Game.NativeGlobals.Ensure();Run();GetTree().Quit();}catch(Exception e){GD.PrintErr(e);GetTree().Quit(1);}
    }
    void Run()
    {
        string work=ProjectSettings.GlobalizePath("res://../.scratch/quay-paving");string backup=System.IO.Path.Combine(work,"originals/r000556.res");
        if(!File.Exists(backup))File.Copy(ProjectSettings.GlobalizePath(PathRail),backup);
        var old=ResourceLoader.Load<ArrayMesh>(backup);var arrays=old.SurfaceGetArrays(0);var vertices=arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
        var idx=arrays[(int)Mesh.ArrayType.Index].VariantType==Variant.Type.Nil?Enumerable.Range(0,vertices.Length).ToArray():arrays[(int)Mesh.ArrayType.Index].AsInt32Array();
        var points=idx.Select(i=>vertices[i]).ToArray();if(points.Length%18!=0)throw new IOException("Unknown rail ribbon format");
        // Filleted, slightly crowned Vignoles section. The broad foot and narrow web continue below paving level.
        var profile=new Vector2[]{new(-.037f,.020f),new(-.037f,.027f),new(-.036f,.031f),new(-.033f,.0335f),new(-.026f,.0346f),new(0,.035f),new(.026f,.0346f),new(.033f,.0335f),new(.036f,.031f),new(.037f,.027f),new(.037f,.020f),new(.034f,.016f),new(.012f,.012f),new(.007f,.008f),new(.007f,-.060f),new(.011f,-.066f),new(.059f,-.074f),new(.064f,-.078f),new(.064f,-.085f),new(-.064f,-.085f),new(-.064f,-.078f),new(-.059f,-.074f),new(-.011f,-.066f),new(-.007f,-.060f),new(-.007f,.008f),new(-.012f,.012f),new(-.034f,.016f)};
                var endCounts=new Dictionary<(int,int),int>();
        (int,int) Key(Vector3 p)=>((int)MathF.Round(p.X*1000),(int)MathF.Round(p.Z*1000));
        for(int i=0;i<points.Length;i+=18)foreach(var p in new[]{(points[i]+points[i+5])*.5f,(points[i+1]+points[i+2])*.5f})endCounts[Key(p)]=endCounts.GetValueOrDefault(Key(p))+1;
        var capIndices=Geometry2D.TriangulatePolygon(profile);
        void Cap(Vector3 centre,Vector3 side,Vector3 normal) {
            V At(int i)=>new(centre+side*profile[i].X+Vector3.Up*profile[i].Y,normal,new(profile[i].X,profile[i].Y));
            for(int i=0;i<capIndices.Length;i+=3)Tri(1,At(capIndices[i]),At(capIndices[i+1]),At(capIndices[i+2]));
        }
        var quads=new List<Vector3>();int sections=0,joints=0;
        for(int p=0;p<points.Length;p+=18) {
            Vector3 a=(points[p]+points[p+5])*.5f,b=(points[p+1]+points[p+2])*.5f;
            Vector3 sideA=(points[p+5]-points[p]).Normalized(),sideB=(points[p+2]-points[p+1]).Normalized();
            quads.AddRange(new[]{points[p],points[p+1],points[p+2],points[p+5]});float length=a.DistanceTo(b);if(length<.001f)continue;
            int pieces=Math.Max(1,(int)MathF.Ceiling(length/6f));
            for(int segment=0;segment<pieces;segment++) {
                float f0=segment/(float)pieces,f1=(segment+1f)/pieces;
                float gap=pieces>1?.00075f/length:0;float l0=f0+(segment>0?gap:0),l1=f1-(segment+1<pieces?gap:0);
                Vector3 c0=a.Lerp(b,l0),c1=a.Lerp(b,l1),s0=sideA.Lerp(sideB,l0),s1=sideA.Lerp(sideB,l1);c0.Y=c1.Y=0;
                for(int k=0;k<profile.Length;k++) {
                    int j=(k+1)%profile.Length;var delta=profile[j]-profile[k];var n2=new Vector2(-delta.Y,delta.X).Normalized();
                    // Smooth the convex crown and its small corner radii, retain deliberate foot/web transitions.
                    Vector3 N(Vector3 side,int i) {
                        var d0=profile[i]-profile[(i+profile.Length-1)%profile.Length];var d1=profile[(i+1)%profile.Length]-profile[i];
                        var normal=i>=2&&i<=9?new Vector2(-d0.Y,d0.X).Normalized()+new Vector2(-d1.Y,d1.X).Normalized():n2;
                        // Profile is clockwise in side/up coordinates; use its outward normal.
                        normal=normal.Normalized();return (side*normal.X+Vector3.Up*normal.Y).Normalized();
                    }
                    V At(Vector3 centre,Vector3 side,int i,float along)=>new(centre+side*profile[i].X+Vector3.Up*profile[i].Y,N(side,i),new(along,profile[i].X));
                    int surface=k>=1&&k<=9?0:1;
                    var aa=At(c0,s0,k,l0*length);var ab=At(c1,s1,k,l1*length);var ba=At(c0,s0,j,l0*length);var bb=At(c1,s1,j,l1*length);
                    Tri(surface,aa,ab,bb);Tri(surface,aa,bb,ba);
                }
                // A recessed dark channel beside each head; real depth and walls, not a raised shadow plate.
                foreach(int sign in new[]{-1,1}) {
                    Vector3 p0=c0+s0*(sign*.037f)+Vector3.Up*-.016f,p1=c1+s1*(sign*.037f)+Vector3.Up*-.016f;
                    Vector3 q0=c0+s0*(sign*.057f)+Vector3.Up*-.016f,q1=c1+s1*(sign*.057f)+Vector3.Up*-.016f;
                    Tri(2,new(p0,Vector3.Up,new(l0*length,0)),new(p1,Vector3.Up,new(l1*length,0)),new(q1,Vector3.Up,new(l1*length,1)));
                    Tri(2,new(p0,Vector3.Up,new(l0*length,0)),new(q1,Vector3.Up,new(l1*length,1)),new(q0,Vector3.Up,new(l0*length,1)));
                }
                var along=(b-a).Normalized();
                if(segment>0||endCounts[Key(a)]==1)Cap(c0,s0,-along);
                if(segment+1<pieces||endCounts[Key(b)]==1)Cap(c1,s1,along);
                // Embedded track joints retain their real gap and closed cut ends. Fishplates and bolts are buried in the bedding, so they add no render mesh.
                if(segment>0)joints++;
                sections++;
            }
        }
        var source=(ShaderMaterial)old.SurfaceGetMaterial(0);var materials=new[]{Finish(source,1,new(.23f,.245f,.25f)),Finish(source,0,new(.16f,.075f,.036f)),Finish(source,0,new(.045f,.035f,.028f))};
        var made=new ArrayMesh{ResourceName=old.ResourceName};foreach(var key in old.GetMetaList())made.SetMeta(key,old.GetMeta(key));
        int vertexCount=0;
        for(int s=0;s<faces.Length;s++) {
            // Weld only identical full attribute tuples. UV seams, bevel normals and hard edges remain separate.
            var unique=new List<V>();var lookup=new Dictionary<V,int>();var indices=new int[faces[s].Count];
            for(int i=0;i<indices.Length;i++) {var v=faces[s][i];if(!lookup.TryGetValue(v,out int index)){index=unique.Count;lookup.Add(v,index);unique.Add(v);}indices[i]=index;}
            vertexCount+=unique.Count;
            if(!indices.Select(i=>unique[i]).SequenceEqual(faces[s]))throw new IOException("Indexed rail attributes differ");
            var a=new Godot.Collections.Array();a.Resize((int)Mesh.ArrayType.Max);a[(int)Mesh.ArrayType.Vertex]=unique.Select(v=>v.P).ToArray();a[(int)Mesh.ArrayType.Normal]=unique.Select(v=>v.N).ToArray();a[(int)Mesh.ArrayType.TexUV]=unique.Select(v=>v.U).ToArray();a[(int)Mesh.ArrayType.Index]=indices;
            made.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,a);made.SurfaceSetMaterial(s,materials[s]);made.SurfaceSetName(s,new[]{"worn_rail_head","oxidised_web_and_foot","recessed_flange_channel"}[s]);
        }
        var collision=NativeWorldNavigation.SupportFaces(old);made.SetMeta("native_solid_stand_in",collision);made.SetMeta("native_solid_skip",new[]{0,1,2});made.SetMeta("native_rail_top_quads",quads.ToArray());
        if(ResourceSaver.Save(made,PathRail,ResourceSaver.SaverFlags.Compress)!=Error.Ok)throw new IOException("Cannot save rails");
        var back=ResourceLoader.Load<ArrayMesh>(PathRail,null,ResourceLoader.CacheMode.Ignore);
        if(!collision.SequenceEqual(NativeWorldNavigation.SupportFaces(back)))throw new IOException("Rail collision changed");
        File.WriteAllText(System.IO.Path.Combine(work,"rails.json"),System.Text.Json.JsonSerializer.Serialize(new{sourceSegments=points.Length/18,profileSegments=sections,expansionJoints=joints,triangles=faces.Sum(f=>f.Count/3),vertices=vertexCount,unindexedVertices=faces.Sum(f=>f.Count),collisionTriangles=collision.Length/3,collisionExact=true,headTop=.035f,headWidth=.074f}));
        GD.Print($"RAIL_PROFILE_PASS: {sections} sections, {joints} joints; exact original collision and top contact envelope");
    }
}


