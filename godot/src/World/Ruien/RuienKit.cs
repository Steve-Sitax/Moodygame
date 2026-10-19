using System;
using System.Collections.Generic;
using Godot;

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
            grate = st.Commit();
            grate.SurfaceSetMaterial(0, RuienMaterials.Get("ruien_iron"));
        }
        var root = new Node3D { Name = "grate_" + w.Id, Position = w.Top + new Vector3(0, 0.01f, 0) };
        root.AddChild(new MeshInstance3D { Mesh = grate, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off });
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
