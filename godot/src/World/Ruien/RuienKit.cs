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

    private static Mesh? grate;

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
            void Bar(Vector3 c, Vector3 size)
            {
                // a bar with its long edges chamfered 3 mm (an octagon swept along it, capped), so its top catches the
                // light as cast iron does (AGENTS.md: cast edges 1-4 mm)
                int ax = size.X >= size.Y && size.X >= size.Z ? 0 : size.Z >= size.Y ? 2 : 1;
                Vector3 along = ax == 0 ? Vector3.Right : ax == 2 ? Vector3.Back : Vector3.Up;
                Vector3 u = ax == 1 ? Vector3.Right : Vector3.Up, v = along.Cross(u);
                float len = size[ax] / 2, hu = size[ax == 1 ? 0 : 1] / 2, hv = size[ax == 2 ? 0 : 2] / 2, ch = Math.Min(0.003f, Math.Min(hu, hv) * 0.4f);
                var ring = new List<Vector2> { new(hu, hv - ch), new(hu - ch, hv), new(-hu + ch, hv), new(-hu, hv - ch), new(-hu, -hv + ch), new(-hu + ch, -hv), new(hu - ch, -hv), new(hu, -hv + ch) };
                Vector3 P(Vector2 r, float t) => c + u * r.X + v * r.Y + along * t;
                // (Godot's front faces turn clockwise: a face whose corners turn the other way is turned round)
                void Tri(Vector3 a, Vector3 b, Vector3 d, Vector3 n)
                {
                    if ((b - a).Cross(d - a).Dot(n) > 0) (b, d) = (d, b);
                    foreach (var vtx in new[] { a, b, d }) { st.SetNormal(n); st.AddVertex(vtx); }
                }
                for (int i = 0; i < ring.Count; i++)
                {
                    var a = ring[i]; var b = ring[(i + 1) % ring.Count];
                    var n = (u * (a.X + b.X) + v * (a.Y + b.Y)).Normalized();
                    Tri(P(a, -len), P(a, len), P(b, len), n);
                    Tri(P(a, -len), P(b, len), P(b, -len), n);
                }
                foreach (float e in new[] { -1f, 1f })
                    for (int i = 1; i + 1 < ring.Count; i++) Tri(P(ring[0], len * e), P(ring[i], len * e), P(ring[i + 1], len * e), along * e);
            }
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
