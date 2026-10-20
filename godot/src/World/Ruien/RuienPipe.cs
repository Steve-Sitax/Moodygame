using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using Godot;
using Scheldemist.Models;

namespace Scheldemist.World.Ruien;

/// <summary>
/// A cast-iron outfall pipe let into a brick wall, one reusable kit piece: spigot barrel and beaded socket with a
/// caulked lead ring, a real bore that darkens with depth and holds silt, and a rough mortar fillet at the wall.
/// <see cref="Front"/> is the socket's front face centre, <see cref="Axis"/> points into the wall.
/// </summary>
public static class RuienPipe
{
    public readonly record struct Spec(Vector3 Front,Vector3 Axis);
    public const float Proud=.21f,Outer=.150f,Bore=.118f,Walk=-3.6f;

    public static List<Spec> Read(JsonElement area)
    {
        var list=new List<Spec>();
        if(!area.TryGetProperty("pipes",out var pipes))return list;
        foreach(var p in pipes.EnumerateArray())
        {
            var f=p.GetProperty("front");var a=p.GetProperty("axis");
            list.Add(new Spec(new Vector3(f[0].GetSingle(),f[1].GetSingle(),f[2].GetSingle()),new Vector3(a[0].GetSingle(),0,a[2].GetSingle()).Normalized()));
        }
        return list;
    }
    public static List<Spec> Read(JsonNode area)=>Read(JsonDocument.Parse(area.ToJsonString()).RootElement);

    /// <summary>Wall face point of the pipe's axis.</summary>
    public static Vector3 Wall(Spec s)=>s.Front+s.Axis*Proud;

    /// <summary>Offline: the exported closed outlet (shell, dark disc, smooth collar) is replaced by this piece.</summary>
    public static bool Retire(Godot.Collections.Array arrays,string family,IReadOnlyList<Spec> pipes)
    {
        float reach=family switch{"ruien_iron"=>.25f,"ruien_misc_Soot_black"=>.16f,"ruien_misc_Mortar_header"=>.30f,"ruien_misc_Water_film"=>0,_=>0};
        if(reach<=0||pipes.Count==0)return false;
        return RuienPatch.Drop(arrays,c=>pipes.Any(s=>
        {
            var d=c-s.Front;float along=d.Dot(s.Axis);var radial=d-s.Axis*along;
            return along>-.06f&&along<.85f&&radial.Length()<reach;
        }))>0;
    }

    /// <summary>Offline: a brick backing ring just behind the wall face closes the exported square hole round the pipe.</summary>
    public static RuienPatch.Tris Backing(Spec s)
    {
        var t=new RuienPatch.Tris();var (lat,up)=Frame(s);var c=Wall(s)+s.Axis*.014f;const int n=48;
        for(int i=0;i<n;i++)
        {
            float a0=i*Mathf.Tau/n,a1=(i+1)*Mathf.Tau/n;
            Vector3 P(float a,float r)=>c+(lat*MathF.Cos(a)+up*MathF.Sin(a))*r;
            foreach(var (r0,r1) in new[]{(.12f,.24f),(.24f,.38f)})
            {
                t.Tri(P(a0,r0),P(a1,r0),P(a1,r1),-s.Axis,new Color(.45f,.04f,.3f,0),.8f);
                t.Tri(P(a0,r0),P(a1,r1),P(a0,r1),-s.Axis,new Color(.45f,.04f,.3f,0),.8f);
            }
        }
        return t;
    }

    private static (Vector3 lat,Vector3 up) Frame(Spec s){var lat=Vector3.Up.Cross(s.Axis).Normalized();return (lat,Vector3.Up);}

    private sealed class Part
    {
        public readonly SurfaceTool St=new();public readonly string Family;public readonly float Tile;
        public Part(string family,float tile){Family=family;Tile=tile;St.Begin(Mesh.PrimitiveType.Triangles);St.SetCustomFormat(0,SurfaceTool.CustomFormat.Rgba8Unorm);}
        public void V(Vector3 p,Vector3 n,Vector2 uvMetres,Color weather,float ao)
        {St.SetNormal(n);St.SetUV(uvMetres/Tile);St.SetColor(weather);St.SetCustom(0,new Color(0,0,0,Math.Clamp(ao,.02f,1)));St.AddVertex(p);}
    }

    public static Node3D Build(Spec s,int index)
    {
        var root=new Node3D{Name="ruien_pipe_"+index};
        var (lat,up)=Frame(s);var wall=Wall(s);
        var iron=new Part("ruien_iron",.9f);var mortar=new Part("ruien_sandstone",1.6f);var silt=new Part("ruien_silt",4);
        // Profile (radius, height out of the wall face), drawn from deep in the bore round the lip to inside the wall.
        // Bands carry their own normal sense: +1 faces away from the axis or towards the gallery.
        var profile=new List<Vector2>{
            new(Bore,-.48f),new(Bore,.16f),new(.124f,.17f),new(.128f,.172f),new(.128f,.196f),new(.131f,.205f),
            new(.140f,.21f),new(.176f,.21f),new(.185f,.207f),new(.192f,.2f),new(.197f,.192f),new(.197f,.182f),
            new(.190f,.176f),new(.186f,.168f),new(.186f,.128f),new(.182f,.12f),new(.172f,.112f),new(.158f,.104f),
            new(Outer,.098f),new(Outer,.06f),new(.155f,.054f),new(.155f,.046f),new(Outer,.04f),new(Outer,-.03f)};
        const int seg=64;
        float Weather(float a)=>MathF.Max(0,-MathF.Sin(a)); // 1 at the underside, where water leaves the lip
        float arc=0;
        for(int j=0;j+1<profile.Count;j++)
        {
            var q0=profile[j];var q1=profile[j+1];float len=q0.DistanceTo(q1);
            for(int i=0;i<seg;i++)
            {
                float a0=i*Mathf.Tau/seg,a1=(i+1)*Mathf.Tau/seg;
                Vector3 P(Vector2 q,float a)=>wall-s.Axis*q.Y+(lat*MathF.Cos(a)+up*MathF.Sin(a))*q.X;
                // Outward normal of this band from the profile tangent (radial and axial parts).
                var tan=(q1-q0).Normalized();var n2=new Vector2(-tan.Y,tan.X);
                Vector3 N(float a)=>((lat*MathF.Cos(a)+up*MathF.Sin(a))*n2.X-s.Axis*n2.Y).Normalized();
                // The bore faces its axis: depth darkens it (occlusion), the throat is wet and sooted.
                float Ao(Vector2 q)=>q.X<=.129f?Math.Clamp(.12f+(q.Y+.05f)/.26f*.8f,.03f,.92f)*(q.Y< -.2f?.4f:1):q.Y<.02f?.55f:1;
                Color W(Vector2 q,float a)=>q.X<=.129f?new Color(.9f,.02f,.55f,0):new Color(.25f+.55f*Weather(a),.18f*Weather(a),.22f,0);
                var corners=new[]{(q0,a0),(q1,a0),(q1,a1),(q0,a0),(q1,a1),(q0,a1)};
                var tri0=P(q0,a0);var tri1=P(q1,a0);var tri2=P(q1,a1);
                bool flip=(tri1-tri0).Cross(tri2-tri0).Dot(N(a0))>0;
                if(flip)corners=new[]{(q0,a0),(q1,a1),(q1,a0),(q0,a0),(q0,a1),(q1,a1)};
                foreach(var (q,a) in corners)
                    iron.V(P(q,a),N(a),new Vector2(a*q.X,arc+(q==q1?len:0)),W(q,a),Ao(q));
            }
            arc+=len;
        }
        // Closed back of the bore (beyond sight in the dark), so no void shows past the silt.
        for(int i=0;i<seg;i++)
        {
            float a0=i*Mathf.Tau/seg,a1=(i+1)*Mathf.Tau/seg;var back=wall+s.Axis*.48f;
            Vector3 P(float a)=>back+(lat*MathF.Cos(a)+up*MathF.Sin(a))*Bore;
            var tri=new[]{back,P(a0),P(a1)};if((tri[1]-tri[0]).Cross(tri[2]-tri[0]).Dot(-s.Axis)>0)tri=new[]{back,P(a1),P(a0)};
            foreach(var p in tri)iron.V(p,-s.Axis,new Vector2((p-back).Dot(lat),(p-back).Y),new Color(.9f,0,.7f,0),.03f);
        }
        // Silt bank along the invert of the bore, thinning to the lip.
        for(int k=0;k<12;k++)
        {
            float z0=.15f-k*.055f,z1=z0-.055f;
            float H(float z)=>.022f+.03f*Math.Clamp((.15f-z)/.4f,0,1);
            Vector3 Row(float z,float side){float h=H(z);float half=MathF.Sqrt(MathF.Max(0,Bore*Bore-(Bore-h)*(Bore-h)))*.98f;
                return wall-s.Axis*z+up*(-Bore+h)+lat*half*side+up*(.004f*MathF.Sin(z*90+side*3));}
            float A(float z)=>Math.Clamp(.12f+(z+.05f)/.26f*.8f,.03f,.9f);
            var a=Row(z0,-1);var b=Row(z0,1);var c=Row(z1,1);var d=Row(z1,-1);
            foreach(var (p,z) in new[]{(a,z0),(c,z1),(b,z0),(a,z0),(d,z1),(c,z1)})
                silt.V(p,Vector3.Up,new Vector2(p.Dot(lat),p.Dot(s.Axis)),new Color(.8f,0,.4f,.3f),A(z));
        }
        // Rough mortar fillet where the pipe enters the brick: irregular, set slightly proud of the face.
        const int ms=72;
        for(int i=0;i<ms;i++)
        {
            float a0=i*Mathf.Tau/ms,a1=(i+1)*Mathf.Tau/ms;
            float R(float a,int ring)=>ring==0?Outer-.004f:ring==1?.172f+.008f*MathF.Sin(a*5+1)*MathF.Sin(a*3):.204f+.014f*MathF.Sin(a*7)+.008f*MathF.Sin(a*13+2);
            float Z(float a,int ring)=>ring==0?.028f:ring==1?.022f+.006f*MathF.Sin(a*9):-.004f;
            Vector3 P(float a,int ring)=>wall-s.Axis*Z(a,ring)+(lat*MathF.Cos(a)+up*MathF.Sin(a))*R(a,ring);
            for(int ring=0;ring<2;ring++)
            {
                var p0=P(a0,ring);var p1=P(a1,ring);var p2=P(a1,ring+1);var p3=P(a0,ring+1);
                var n=(p1-p0).Cross(p3-p0).Normalized();if(n.Dot(-s.Axis)<0)n=-n;
                var tri=new[]{p0,p1,p2,p0,p2,p3};if((p1-p0).Cross(p2-p0).Dot(n)>0)tri=new[]{p0,p2,p1,p0,p3,p2};
                foreach(var p in tri)mortar.V(p,n,new Vector2(p.Dot(lat),p.Y),new Color(.6f+.35f*Weather(a0),.08f,.42f,.1f),.75f);
            }
        }
        // The run-off spreading from the wall foot over the setts to the coping: a thin wet film that pools in the
        // joints and fans out (same water kind as the walls' films), over the vertex stain the repair laid there.
        var film=new SurfaceTool();film.Begin(Mesh.PrimitiveType.Triangles);
        var foot=new Vector3(wall.X,Walk+.0175f,wall.Z);
        Vector3 Film(float d,float side){float w=.07f+.2f*d/1.45f+.02f*MathF.Sin(d*9);return foot-s.Axis*d+lat*(side*w+.04f*MathF.Sin(d*4.3f));}
        for(int i=0;i<12;i++)
        {
            float d0=.01f+i*1.44f/12,d1=d0+1.44f/12;
            foreach(var p in new[]{Film(d0,-1),Film(d1,1),Film(d1,-1),Film(d0,-1),Film(d0,1),Film(d1,1)})
            {film.SetNormal(Vector3.Up);film.SetUV(new Vector2(p.X,p.Z));film.AddVertex(p);}
        }
        var filmMesh=film.Commit();filmMesh.SurfaceSetMaterial(0,RuienMaterials.Get("ruien_misc_Water_film"));
        root.AddChild(new MeshInstance3D{Mesh=filmMesh,Layers=Ruien.Layer,CastShadow=GeometryInstance3D.ShadowCastingSetting.Off});
        foreach(var part in new[]{iron,silt,mortar})
        {
            var mesh=part.St.Commit();mesh.SurfaceSetName(0,part.Family);mesh.SurfaceSetMaterial(0,RuienMaterials.Get(part.Family));
            root.AddChild(new MeshInstance3D{Mesh=mesh,Layers=Ruien.Layer,CastShadow=GeometryInstance3D.ShadowCastingSetting.Off});
            if(part==iron)
            {
                var body=new StaticBody3D{CollisionLayer=Solid.Layer,CollisionMask=0};
                body.AddChild(new CollisionShape3D{Shape=new ConcavePolygonShape3D{Data=mesh.GetFaces(),BackfaceCollision=true}});root.AddChild(body);
            }
        }
        return root;
    }
}
