using System;
using System.Collections.Generic;
using Godot;
using Scheldemist.Models;

namespace Scheldemist.World.Ruien;

/// <summary>
/// The Ruien's kit pieces, one shared model each, placed wherever an area needs them (docs/ruien-native.md): the oil
/// safety lamp on its wall bracket, the street grate, the hatch. Until the Blender kit is in (res://world/ruien/kit,
/// one converted scene per piece) each is a plain stand-in built once here and shared by every copy.
/// </summary>
public static class RuienKit
{
    public const string Dir = "res://world/ruien/kit";
    private static readonly Dictionary<string, PackedScene?> Scenes = new();
    private static Mesh? lampBody, lampGlass, lampFlame;

    private static PackedScene? Scene(string piece)
    {
        if (Scenes.TryGetValue(piece, out var s)) return s;
        string path = $"{Dir}/{piece}.scn";
        s = ResourceLoader.Exists(path) ? ResourceLoader.Load<PackedScene>(path) : null;
        Scenes[piece] = s;
        return s;
    }

    private static readonly Dictionary<string, ArrayMesh?> Pieces = new();

    /// <summary>A converted kit piece (res://world/ruien/kit/&lt;piece&gt;.res) placed at its pivot, turned about y; null if not converted.</summary>
    public static Node3D? Piece(string piece, Vector3 at, float yawDeg)
    {
        if (!Pieces.TryGetValue(piece, out var mesh))
        {
            string path = $"{Dir}/{piece}.res";
            mesh = ResourceLoader.Exists(path) ? ResourceLoader.Load<ArrayMesh>(path) : null;
            if (mesh != null)
                for (int s = 0; s < mesh.GetSurfaceCount(); s++) mesh.SurfaceSetMaterial(s, RuienMaterials.Get(mesh.SurfaceGetName(s)));
            Pieces[piece] = mesh;
        }
        if (mesh == null) return null;
        var n = new Node3D { Name = piece, Position = at, Rotation = new Vector3(0, Mathf.DegToRad(yawDeg), 0) };
        n.AddChild(new MeshInstance3D { Mesh = mesh, Layers = Ruien.Layer, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off });
        if(mesh.HasMeta("ruien_solid") && mesh.GetMeta("ruien_solid").AsBool())
        {
            var body=new StaticBody3D { CollisionLayer=Solid.Layer,CollisionMask=0 };
            body.AddChild(new CollisionShape3D { Shape=new ConcavePolygonShape3D { Data=mesh.GetFaces(),BackfaceCollision=true } });
            n.AddChild(body);
        }
        return n;
    }

    private static Mesh? grate;
    private static readonly Dictionary<int, Mesh> Irons = new();

    /// <summary>
    /// Step irons up a channel wall (the stand-in until the kit's own): U-shaped wrought-iron rungs 0.3 m apart, 0.4 m
    /// wide and 0.13 m out from the brick, their edges chamfered, one shared mesh for every copy, turned to the wall.
    /// </summary>
    public static Node3D StepIrons(RuienData.Way w)
    {
        int heightKey = (int)MathF.Round((w.Top.Y - w.Bottom.Y) * 100);
        if (!Irons.TryGetValue(heightKey, out var irons))
        {
            var st = new SurfaceTool();
            st.Begin(Mesh.PrimitiveType.Triangles);
            float h = w.Top.Y - w.Bottom.Y;
            for (float y = 0.35f; y < h - 0.1f; y += 0.3f)
            {
                Bar(st, new Vector3(0, y, 0.13f), new Vector3(0.42f, 0.032f, 0.032f));
                foreach (float x in new[] { -0.195f, 0.195f }) Bar(st, new Vector3(x, y, 0.045f), new Vector3(0.032f, 0.032f, 0.2f));
            }
            // Continuous stiles rise above the coping for a safe final handhold.
            foreach (float x in new[] { -0.24f, 0.24f })
                Bar(st, new Vector3(x, (h + 0.65f) / 2, 0.16f), new Vector3(0.036f, h + 0.65f, 0.036f));
            irons = st.Commit();
            irons.SurfaceSetMaterial(0, RuienMaterials.Get("ruien_iron"));
            Irons[heightKey] = irons;
        }
        var n = new Node3D { Name = "irons_" + w.Id, Position = new Vector3(w.Wall.X, w.Bottom.Y, w.Wall.Y), Rotation = new Vector3(0, MathF.Atan2(w.Out.X, w.Out.Y), 0) };
        n.AddChild(new MeshInstance3D { Mesh = irons, Layers = Ruien.Layer, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off });
        return n;
    }

    /// <summary>A bar along its longest side, its long edges chamfered 3 mm (an octagon swept, capped; AGENTS.md cast and wrought edges).</summary>
    private static void Bar(SurfaceTool st, Vector3 c, Vector3 size)
    {
        int ax = size.X >= size.Y && size.X >= size.Z ? 0 : size.Z >= size.Y ? 2 : 1;
        Vector3 along = ax == 0 ? Vector3.Right : ax == 2 ? Vector3.Back : Vector3.Up;
        Vector3 u = ax == 1 ? Vector3.Right : Vector3.Up, v = along.Cross(u);
        float len = size[ax] / 2, hu = size[ax == 1 ? 0 : 1] / 2, hv = size[ax == 2 ? 0 : 2] / 2, ch = Math.Min(0.003f, Math.Min(hu, hv) * 0.4f);
        var ring = new List<Vector2> { new(hu, hv - ch), new(hu - ch, hv), new(-hu + ch, hv), new(-hu, hv - ch), new(-hu, -hv + ch), new(-hu + ch, -hv), new(hu - ch, -hv), new(hu, -hv + ch) };
        Vector3 P(Vector2 r, float t) => c + u * r.X + v * r.Y + along * t;
        void Tri(Vector3 a, Vector3 b, Vector3 d, Vector3 nn)
        {
            if ((b - a).Cross(d - a).Dot(nn) > 0) (b, d) = (d, b);
            foreach (var vtx in new[] { a, b, d })
            {
                // (no weather but a little damp and grime, and the rust picture boxed on in metres)
                st.SetColor(new Color(0.35f, 0, 0.15f, 0));
                st.SetUV(MathF.Abs(nn.Y) > 0.7f ? new Vector2(vtx.X, vtx.Z) / 0.9f : MathF.Abs(nn.X) > 0.7f ? new Vector2(vtx.Z, vtx.Y) / 0.9f : new Vector2(vtx.X, vtx.Y) / 0.9f);
                st.SetNormal(nn);
                st.AddVertex(vtx);
            }
        }
        for (int i = 0; i < ring.Count; i++)
        {
            var a = ring[i]; var b = ring[(i + 1) % ring.Count];
            var nn = (u * (a.X + b.X) + v * (a.Y + b.Y)).Normalized();
            Tri(P(a, -len), P(a, len), P(b, len), nn);
            Tri(P(a, -len), P(b, len), P(b, -len), nn);
        }
        foreach (float e in new[] { -1f, 1f })
            for (int i = 1; i + 1 < ring.Count; i++) Tri(P(ring[0], len * e), P(ring[i], len * e), P(ring[i + 1], len * e), along * e);
    }

    /// <summary>
    /// A street grate over a shaft (its kit model, or the stand-in: a cast-iron frame with bars both ways, their edges
    /// rounded by a bevel ring of faces, set 1 cm proud of the paving), one shared mesh for every copy.
    /// </summary>
    public static Node3D Grate(RuienData.Way w)
    {
        if(w.Round)return RoundGrate(w);
        if (Scene("street_grate") is { } scene)
        {
            var n = scene.Instantiate<Node3D>();
            n.Name = "grate_" + w.Id;
            n.Position = w.Top;
            return n;
        }
        if (grate == null)
        {
            var st = new SurfaceTool();
            st.Begin(Mesh.PrimitiveType.Triangles);
            void Bar(Vector3 c, Vector3 size) => RuienKit.Bar(st, c, size);
            float s = w.Hole.Size.X, half = s / 2;
            // the frame (5 cm wide, 4 cm deep) round the hole, and the bars: 5 across, 2 along
            foreach (float k in new[] { -1f, 1f })
            {
                Bar(new Vector3(k * (half + 0.025f), -0.01f, 0), new Vector3(0.05f, 0.05f, s + 0.1f));
                Bar(new Vector3(0, -0.01f, k * (half + 0.025f)), new Vector3(s + 0.1f, 0.05f, 0.05f));
            }
            for (int i = 1; i <= 5; i++) Bar(new Vector3(-half + i * s / 6, -0.02f, 0), new Vector3(0.025f, 0.05f, s));
            foreach (float k in new[] { -1f / 3, 1f / 3 }) Bar(new Vector3(0, -0.035f, k * half), new Vector3(s, 0.03f, 0.03f));
            grate = GrateMesh(st);
        }
        var root = new Node3D { Name = "grate_" + w.Id, Position = w.Top + new Vector3(0, 0.02f, 0) };
        root.AddChild(new MeshInstance3D { Mesh = grate, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off });
        return root;
    }

    private static readonly Dictionary<int,Mesh> RoundGrates=new();
    private static ArrayMesh GrateMesh(SurfaceTool tool)
    {
        var arrays=tool.Commit().SurfaceGetArrays(0);
        RuienUv.Repair(arrays,"ruien_iron");
        var mesh=new ArrayMesh();mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,arrays);
        mesh.SurfaceSetName(0,"ruien_iron");mesh.SurfaceSetMaterial(0,RuienMaterials.Get("ruien_iron"));
        return mesh;
    }
    private static Node3D RoundGrate(RuienData.Way w)
    {
        int key=(int)MathF.Round(w.Hole.Size.X*1000);
        if(!RoundGrates.TryGetValue(key,out var mesh))
        {
            var st=new SurfaceTool();st.Begin(Mesh.PrimitiveType.Triangles);
            float r=w.Hole.Size.X/2;
            // Continuous cast frame: twelve-point rounded rectangular section swept around the aperture.
            var profile=new[]{new Vector2(r-.005f,-.05f),new Vector2(r-.005f,-.007f),new Vector2(r+.002f,0),new Vector2(r+.073f,0),new Vector2(r+.08f,-.007f),new Vector2(r+.08f,-.05f),new Vector2(r+.073f,-.057f),new Vector2(r+.002f,-.057f)};
            for(int i=0;i<128;i++)for(int j=0;j<profile.Length;j++)
            {
                Vector3 P(int k,int l){var q=profile[l%profile.Length];float a=k*Mathf.Tau/128;return new(q.X*MathF.Cos(a),q.Y,q.X*MathF.Sin(a));}
                var a=P(i,j);var b=P(i+1,j);var c=P(i+1,j+1);var d=P(i,j+1);
                var n=(b-a).Cross(c-a).Normalized();
                // Unwrap around the casting and across its section: projecting X/Z collapses the vertical rim.
                float v=0;for(int k=0;k<j;k++)v+=profile[k].DistanceTo(profile[(k+1)%profile.Length]);
                float dv=profile[j].DistanceTo(profile[(j+1)%profile.Length]);
                float du=Mathf.Tau/128*(profile[j].X+profile[(j+1)%profile.Length].X)/2,u=i*du;
                foreach(var (p,uv) in new[]{(a,new Vector2(u,v)),(b,new Vector2(u+du,v)),(c,new Vector2(u+du,v+dv)),
                    (a,new Vector2(u,v)),(c,new Vector2(u+du,v+dv)),(d,new Vector2(u,v+dv))})
                {st.SetNormal(n);st.SetUV(uv/.9f);st.SetColor(new Color(.15f,0,.12f,0));st.AddVertex(p);}
            }
            for(float offset=-r+.055f;offset<r-.035f;offset+=.085f)
            {
                float length=2*MathF.Sqrt(r*r-offset*offset);
                Bar(st,new Vector3(offset,-.023f,0),new Vector3(.019f,.042f,length));
                Bar(st,new Vector3(0,-.025f,offset),new Vector3(length,.038f,.019f));
            }
            mesh=GrateMesh(st);RoundGrates[key]=mesh;
        }
        var root=new Node3D{Name="round_grate_"+w.Id,Position=w.Top+Vector3.Up*.037f};
        root.AddChild(new MeshInstance3D{Mesh=mesh,Layers=Ruien.Layer,CastShadow=GeometryInstance3D.ShadowCastingSetting.Off});
        return root;
    }

    /// <summary>
    /// The brick collar where a round shaft meets the vault crown (D1): a soffit ring of radial headers set 18 mm
    /// proud on a mortar bed, rounded into the shaft at its rim, laid over the trimmed crown so the export's
    /// decimated flare never shows. <paramref name="rim"/> is the crown height at the shaft, <paramref name="outer"/>
    /// the collar's outer radius.
    /// </summary>
    public static Node3D Collar(Vector3 centre,float radius,float outer,float rim)
    {
        var root=new Node3D{Name="ruien_collar"};
        var st=new SurfaceTool();st.Begin(Mesh.PrimitiveType.Triangles);st.SetCustomFormat(0,SurfaceTool.CustomFormat.Rgba8Unorm);
        var bed=new SurfaceTool();bed.Begin(Mesh.PrimitiveType.Triangles);
        float soffit=rim-.006f;
        void Brick(Vector3 c,Basis b,Vector3 size,Color w,float ao)
        {
            var a=BevelMesh.Box(size,.008f,null!).SurfaceGetArrays(0);
            var p=a[(int)Mesh.ArrayType.Vertex].AsVector3Array();var n=a[(int)Mesh.ArrayType.Normal].AsVector3Array();var uv=a[(int)Mesh.ArrayType.TexUV].AsVector2Array();
            for(int i=0;i<p.Length;i++){st.SetNormal(b*n[i]);st.SetUV(uv[i]);st.SetColor(w);st.SetCustom(0,new Color(0,0,0,ao));st.AddVertex(c+b*p[i]);}
        }
        // Two rowlock rings: headers radial, their ends seen from below; the outer ring has more bricks.
        // Rowlock rings out to the outer stretcher course; the last one narrows to meet it.
        var inner=new List<float>();var span=new List<float>();
        for(float r=radius+.004f;r<outer-.096f;r+=.114f){inner.Add(r);span.Add(Math.Min(.108f,outer-.094f-r));}
        for(int ring=0;ring<inner.Count;ring++)
        {
            float r0=inner[ring],r1=r0+span[ring];int count=(int)MathF.Round(Mathf.Tau*(r0+.054f)/.072f);
            for(int k=0;k<count;k++)
            {
                float a=(k+.5f)*Mathf.Tau/count;var dir=new Vector3(MathF.Cos(a),0,MathF.Sin(a));
                float width=Mathf.Tau*r0/count-.007f;var tan=Vector3.Up.Cross(dir).Normalized();
                var basis=new Basis(tan,Vector3.Up,dir);
                // Damp and sooted nearest the opening, lime bloom on a few, as the shaft drips onto them.
                float wet=ring==0?.7f:.45f;var w=new Color(wet,(k*7)%5==0?.35f:.06f,.35f+.15f*Math.Max(0,1-ring),0);
                float depth=.09f-.006f*((k*5)%3);
                Brick(centre+dir*(r0+span[ring]/2)+Vector3.Up*(soffit-.018f+depth/2),basis,new Vector3(width,depth,span[ring]-.004f),w,ring==0?.7f:.85f);
            }
        }
        // Mortar bed flush with the crown, from the shaft rim to the collar's edge, lapping the trimmed vault.
        const int seg=96;
        for(int i=0;i<seg;i++)
        {
            float a0=i*Mathf.Tau/seg,a1=(i+1)*Mathf.Tau/seg;
            Vector3 P(float a,float r)=>centre+new Vector3(MathF.Cos(a)*r,soffit+.012f,MathF.Sin(a)*r);
            var p0=P(a0,radius-.004f);var p1=P(a1,radius-.004f);var p2=P(a1,outer);var p3=P(a0,outer);
            foreach(var p in new[]{p0,p1,p2,p0,p2,p3}){bed.SetNormal(Vector3.Down);bed.SetColor(new Color(.3f,.04f,.12f,0));bed.SetUV(new Vector2(p.X,p.Z));bed.AddVertex(p);}
        }
        // Outer edge of the collar: a ring of stretchers on the flat, bonding it into the crown's courses.
        int outerCount=(int)MathF.Round(Mathf.Tau*(outer-.046f)/.225f);
        for(int k=0;k<outerCount;k++)
        {
            float a=(k+.5f)*Mathf.Tau/outerCount;var dir=new Vector3(MathF.Cos(a),0,MathF.Sin(a));var tan=Vector3.Up.Cross(dir).Normalized();
            float len=Mathf.Tau*(outer-.046f)/outerCount-.008f;
            Brick(centre+dir*(outer-.046f)+Vector3.Up*(soffit+.007f),new Basis(tan,Vector3.Up,dir),new Vector3(len,.05f,.088f),new Color(.35f,.08f,.3f,0),.9f);
        }
        RuienStair.Add(root,st,"ruien_brick_header",true);
        var mortar=bed.Commit();var ma=mortar.SurfaceGetArrays(0);
        var pa=ma[(int)Mesh.ArrayType.Vertex].AsVector3Array();
        for(int i=0;i<pa.Length;i+=3)if((pa[i+1]-pa[i]).Cross(pa[i+2]-pa[i]).Dot(Vector3.Down)>0)(pa[i+1],pa[i+2])=(pa[i+2],pa[i+1]);
        ma[(int)Mesh.ArrayType.Vertex]=pa;
        var done=new ArrayMesh();done.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,ma);done.SurfaceSetName(0,"ruien_misc_Mortar_header");
        done.SurfaceSetMaterial(0,RuienMaterials.Get("ruien_misc_Mortar_header"));
        root.AddChild(new MeshInstance3D{Mesh=done,Layers=Ruien.Layer,CastShadow=GeometryInstance3D.ShadowCastingSetting.Off});
        return root;
    }

    /// <summary>A lamp at a light source: its kit model (or the stand-in), facing out of the wall it hangs on.</summary>
    public static Node3D Lamp(RuienData.Source s)
    {
        if (Scene("oil_lamp") is { } scene)
        {
            var n = scene.Instantiate<Node3D>();
            n.Name = "lamp_" + s.Id;
            n.Position = s.At;
            return n;
        }
        if (lampBody == null)
        {
            // brass pot and cap round a glass, the gauze inside: about 0.32 m tall
            var pot = new CylinderMesh { TopRadius = 0.07f, BottomRadius = 0.075f, Height = 0.07f, RadialSegments = 16 };
            var body = new ArrayMesh();
            var st = new SurfaceTool();
            st.Begin(Mesh.PrimitiveType.Triangles);
            st.AppendFrom(pot, 0, Transform3D.Identity.Translated(new Vector3(0, -0.12f, 0)));
            st.AppendFrom(new CylinderMesh { TopRadius = 0.02f, BottomRadius = 0.075f, Height = 0.06f, RadialSegments = 16 }, 0, Transform3D.Identity.Translated(new Vector3(0, 0.12f, 0)));
            st.AppendFrom(new BoxMesh { Size = new Vector3(0.02f, 0.02f, 0.32f) }, 0, Transform3D.Identity.Translated(new Vector3(0, 0.16f, -0.16f)));
            body = st.Commit();
            body.SurfaceSetMaterial(0, RuienMaterials.Get("ruien_misc_Brass_lamp"));
            lampBody = body;
            lampGlass = new CylinderMesh { TopRadius = 0.06f, BottomRadius = 0.06f, Height = 0.17f, RadialSegments = 16, Material = RuienMaterials.Get("ruien_misc_Lamp_glass") };
            lampFlame = new SphereMesh { Radius = 0.016f, Height = 0.045f, RadialSegments = 8, Rings = 4, Material = RuienMaterials.Get("ruien_misc_Lamp_flame") };
        }
        var root = new Node3D { Name = "lamp_" + s.Id, Position = s.At };
        root.AddChild(new MeshInstance3D { Mesh = lampBody, Layers = Ruien.Layer, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off });
        root.AddChild(new MeshInstance3D { Mesh = lampGlass, Layers = Ruien.Layer, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off });
        root.AddChild(new MeshInstance3D { Mesh = lampFlame, Layers = Ruien.Layer, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off, Position = new Vector3(0, -0.02f, 0) });
        // (turned so the bracket runs back to the wall: the wall is where the light's dir points away from)
        var back = new Vector2(-s.Dir.X, -s.Dir.Z);
        if (back.LengthSquared() > 0.01f) root.Rotation = new Vector3(0, MathF.Atan2(back.X, back.Y), 0);
        return root;
    }
}
