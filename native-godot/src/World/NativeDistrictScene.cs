using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using Godot;
using Scheldemist.Native.Authoring;
using Scheldemist.Native.Game;

namespace Scheldemist.Native.World;

/// <summary>Native previews provide physical ground in both the editor and the workshop.</summary>
[Tool]
public partial class NativeDistrictScene : Node3D
{
    public override void _Ready()
    {
        NativeGlobals.Ensure();
#if DEBUG
        if (GetParent() is WorkshopSession session && session.District.RoomId != "")
            NativeDistrictLayouts.HideRecovered(this, session.District);
#endif
        var shapes = new Dictionary<ulong, ConcavePolygonShape3D>();
        int count = Build(this, false, shapes);
        SetMeta("native_workshop_collision_count", count);
    }
    private static readonly HashSet<string> Movers = new(StringComparer.OrdinalIgnoreCase)
    {
        "river_traffic", "boats", "boat_lamps", "boat_lines", "rowing", "opening_bridges", "traffic", "omnibuses", "goods_drays", "railway",
        "horses", "emigrants", "player_figure", "park_wildlife", "wall_guards", "ambient", "cloud_sky", "litter", "posters", "fires", "funnel_smoke", "gas_lamp_halos"
    };
    private static int Build(Node node, bool skipped, Dictionary<ulong, ConcavePolygonShape3D> shapes)
    {
        string name = node.HasMeta("source_name") ? node.GetMeta("source_name").AsString() : node.Name.ToString();
        string plain = name.TrimEnd('0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '_');
        skipped |= node is AuthoredObject or Skeleton3D || node.HasMeta("mover") || Movers.Contains(plain) || name.StartsWith("alive_", StringComparison.OrdinalIgnoreCase)
            || node is Node3D { Visible: false };
        if (node.HasMeta("extras"))
        {
            var extras = node.GetMeta("extras").AsGodotDictionary();
            skipped |= extras.TryGetValue("ro", out var order) && order.AsDouble() != 0
                || extras.TryGetValue("hidden", out var hidden) && hidden.AsBool();
        }
        if (skipped) return 0;
        int count = 0;
        if (node is MeshInstance3D { Mesh: not null, Skin: null } mesh && !Regex.IsMatch(name, "^inst\\d+_") && mesh.GetNodeOrNull("NativeWorkshopSolid") == null)
            count += Add(mesh, mesh.Mesh, Transform3D.Identity, "NativeWorkshopSolid", shapes);
        if (node is MultiMeshInstance3D { Multimesh: not null } copies && copies.Multimesh.Mesh is { } copyMesh && Regex.IsMatch(name, "^inst\\d+_(tree[a-z]*bark|goods[a-z]*)_mm$"))
            for (int i = 0; i < copies.Multimesh.InstanceCount; i++)
                if (copies.GetNodeOrNull("NativeWorkshopSolid" + i) == null) count += Add(copies, copyMesh, copies.Multimesh.GetInstanceTransform(i), "NativeWorkshopSolid" + i, shapes);
        // Generated bodies have no owner: opening the scene cannot turn preview physics into an authored edit.
        foreach (var child in node.GetChildren()) if (child is not StaticBody3D) count += Build(child, false, shapes);
        return count;
    }
    private static int Add(Node parent, Mesh mesh, Transform3D transform, string name, Dictionary<ulong, ConcavePolygonShape3D> shapes)
    {
        if (mesh.GetSurfaceCount() == 0) return 0;
        bool solid=false;
        for(int i=0;i<mesh.GetSurfaceCount();i++)
        {
            var material=mesh.SurfaceGetMaterial(i);
            if(material==null || !(material.HasMeta("legacy_no_collision")&&material.GetMeta("legacy_no_collision").AsBool()) && !(material.HasMeta("legacy_hidden")&&material.GetMeta("legacy_hidden").AsBool())){solid=true;break;}
        }
        if(!solid)return 0;
        if (!shapes.TryGetValue(mesh.GetInstanceId(), out var shape))
        {
            var source = mesh.GetFaces(); var faces = new List<Vector3>(source.Length);
            for (int i = 0; i + 2 < source.Length; i += 3)
            {
                var a = source[i]; var b = source[i+1]; var c = source[i+2];
                if (!a.IsFinite() || !b.IsFinite() || !c.IsFinite() || (b-a).Cross(c-a).LengthSquared() < 1e-12f) continue;
                faces.Add(a); faces.Add(b); faces.Add(c);
            }
            if (faces.Count == 0) return 0;
            shape = new ConcavePolygonShape3D(); shape.SetFaces(faces.ToArray()); shape.BackfaceCollision = true; shapes.Add(mesh.GetInstanceId(), shape);
        }
        var body = new StaticBody3D { Name = name, Transform = transform, CollisionLayer = 3, CollisionMask = 0 };
        body.AddChild(new CollisionShape3D { Name = "Shape", Shape = shape }); parent.AddChild(body);
        return 1;
    }
}
