using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.Render;

namespace Scheldemist.World;

/// <summary>
/// The churches' stained glass (Steve, 2026-10-27: "glitches, weird artifacts or contours of other buildings behind it
/// when seeing through it ... you could not make out what is on the other side"). Each church room carries its windows
/// twice on the same faces: a street layer (<c>&lt;id&gt;_street_glass</c>, <c>&lt;id&gt;_x_street_glass</c>, the
/// cathedral's <c>..._glass_out</c>) seen from outside, and a room layer (<c>&lt;id&gt;_hall_glass</c>,
/// <c>&lt;id&gt;_x_room_glass</c>, the cathedral's <c>cathedral_stained_glass</c>, <c>cathedral_clear_glass</c>) seen
/// from inside. The bake had both see-through (alpha 0.4 to 0.9, no depth), and three's back side of the parish
/// churches' room layers was lost in the conversion (BakedWorld reads only a two-sided side), so:
/// - from inside Sint-Paulus, Sint-Jacob and Sint-Carolus there was no glass at all: the street showed through;
/// - from outside both layers were drawn over each other, sorted by the same box, with the room (or, beyond the room's
///   reach, the empty church and the houses behind it) showing through them, and the cathedral's far windows seen
///   through its near ones;
/// - the glass kept its midday brightness all night.
/// Here, once: each layer becomes solid (the same unlit kind without the blend, a kind the town already draws: no new
/// shader), a room layer that faces out is turned to face in, a parish church's two layers both take the bright picture of
/// its lit glass, and the street layer leaves the room's node, so it still closes the windows when the room is hidden far
/// off (on the town's own layer: the river's mirrors see it). Every frame (when it changes): the street layer takes the
/// day's light on its face, dark with a hint of colour, and after dark the church's lamps shining through it in its own
/// colours (the window light 3 cm out, the leads' grid, weaker); the room layer shows the daylight coming through, by day
/// bright, in rain less, at night only a little of the moon.
/// </summary>
[GamePart(52)]
public partial class ChurchGlass : Node
{
    private static readonly string[] Churches = { "stpaul", "stjacob", "carolus" };
    private readonly List<(ShaderMaterial m, Color base_)> street = new(), room = new();
    private Vector3 last = new(-1, -1, -1);

    /// <summary>For a check: street layers and room layers made solid, room layers turned to face in, street layers kept outside the room.</summary>
    public static (int street, int room, int turned, int kept) Info { get; private set; }

    public override void _Ready()
    {
        var meshes = BakedWorld.All(Main.I.World).OfType<MeshInstance3D>().Where(m => m.Mesh != null && m.Mesh.GetSurfaceCount() == 1).ToList();
        // the town's own unlit, solid kinds: the glass's kind without the blend is drawn already (no new shader)
        var solid = new Dictionary<Psx.Kind, Shader>();
        foreach (var m in meshes)
            if (m.Mesh!.SurfaceGetMaterial(0) is ShaderMaterial sm && Psx.KindOf(sm.Shader) is { Unlit: true, Blend: false, Add: false } k) solid.TryAdd(k, sm.Shader);
        var byName = new Dictionary<string, MeshInstance3D>();
        foreach (var m in meshes)
            if (m.Mesh!.SurfaceGetMaterial(0) is ShaderMaterial sm && sm.ResourceName.Length > 0) byName.TryAdd(sm.ResourceName, m);

        var streetNames = Churches.SelectMany(c => new[] { c + "_street_glass", c + "_x_street_glass" }).Concat(new[] { "cathedral_stained_glass_out", "cathedral_clear_glass_out" });
        var roomNames = Churches.SelectMany(c => new[] { c + "_hall_glass", c + "_x_room_glass" }).Concat(new[] { "cathedral_stained_glass", "cathedral_clear_glass" });
        int s = 0, r = 0, turned = 0, kept = 0;
        foreach (var name in streetNames)
        {
            if (!byName.TryGetValue(name, out var mi) || Solid(mi, solid) is not { } mat) continue;
            Bright(mat, name, byName);
            street.Add((mat, Tint(mat)));
            s++;
            // (out of the room: a room far off is hidden, and its windows were open holes into the empty church)
            if (RoomOf(mi)?.GetParent() is Node3D outside)
            {
                mi.Reparent(outside, true);
                kept++;
            }
            mi.Layers = 1;
        }
        foreach (var name in roomNames)
        {
            if (!byName.TryGetValue(name, out var mi) || Solid(mi, solid) is not { } mat) continue;
            Bright(mat, name, byName);
            if (FacesOut(mi.Mesh!))
            {
                mi.Mesh = Turned(mi.Mesh!, mat);
                turned++;
            }
            room.Add((mat, Tint(mat)));
            r++;
        }
        // the churches' window light at night (the lead's grid in lamplight, 3 cm out of the glass) weaker: the glass itself
        // now glows in its own colours over it
        var weakened = new HashSet<ShaderMaterial>();
        if (Lights.I != null)
            foreach (var m in meshes)
                if (m.Mesh!.SurfaceGetMaterial(0) is ShaderMaterial wm && wm.ResourceName == "landmark_window_light" && weakened.Add(wm)
                    && (m.Name.ToString().StartsWith("church_", StringComparison.Ordinal) || m.Name.ToString().StartsWith("landmark_cathedral_lit_glass", StringComparison.Ordinal)))
                    Lights.I.LandmarkGain[wm] = (Lights.I.LandmarkGain.TryGetValue(wm, out var g) ? g : 1) * WindowLightGain;
        // (the cathedral's added amber over its whole glass at night hid the colours: its street layer glows itself now)
        if (s > 0 && byName.TryGetValue("cathedral_window_glow", out var glow)) glow.Visible = false;
        Info = (s, r, turned, kept);
        GD.Print($"church glass: {s} street layers and {r} room layers solid, {turned} room layers turned to face in, {kept} street layers kept outside their room");
        if (s + r == 0) SetProcess(false);
    }

    /// <summary>A parish church's glass, both layers, takes the bright picture of its lit glass (the street layer's own was
    /// darkened for the day, and Sint-Carolus's room layer had it too): the light sets how bright it shows.</summary>
    private static void Bright(ShaderMaterial mat, string name, Dictionary<string, MeshInstance3D> byName)
    {
        if (byName.TryGetValue(name.Split('_')[0] + "_street_lit_glass", out var lit) && lit.Mesh!.SurfaceGetMaterial(0) is ShaderMaterial lm)
            mat.SetShaderParameter("tex", lm.GetShaderParameter("tex"));
    }

    /// <summary>The glass's own tint, at full strength (the cathedral's street layer was dimmed to 0.22 in its albedo).</summary>
    private static Color Tint(ShaderMaterial mat)
    {
        var a = mat.GetShaderParameter("albedo").AsColor();
        float top = Math.Max(a.R, Math.Max(a.G, a.B));
        return top > 0 ? new Color(a.R / top, a.G / top, a.B / top, 1) : new Color(1, 1, 1, 1);
    }

    /// <summary>The room node a mesh stands in (ROOM_&lt;id&gt;), or null.</summary>
    private static Node? RoomOf(Node n)
    {
        for (var q = n.GetParent(); q != null; q = q.GetParent()) if (q.Name.ToString().StartsWith("ROOM_", StringComparison.Ordinal)) return q;
        return null;
    }

    /// <summary>The glass's own material made solid: the same kind without the blend, as the town already draws it.</summary>
    private static ShaderMaterial? Solid(MeshInstance3D mi, Dictionary<Psx.Kind, Shader> solid)
    {
        if (mi.Mesh!.SurfaceGetMaterial(0) is not ShaderMaterial m || Psx.KindOf(m.Shader) is not { Unlit: true, Blend: true, Add: false } k) return null;
        if (!solid.TryGetValue(k with { Blend = false }, out var shader))
        {
            GD.PushWarning($"church glass: no solid kind like {m.ResourceName}'s in the town; left as it was");
            return null;
        }
        var made = (ShaderMaterial)m.Duplicate();
        made.Shader = shader;
        var a = made.GetShaderParameter("albedo").AsColor();
        made.SetShaderParameter("albedo", new Color(a.R, a.G, a.B, 1));
        mi.Mesh.SurfaceSetMaterial(0, made);
        return made;
    }

    /// <summary>Whether most of a layer's faces are turned away from its own middle (the church's inside).</summary>
    private static bool FacesOut(Mesh mesh)
    {
        var arrays = mesh.SurfaceGetArrays(0);
        var v = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
        var idx = arrays[(int)Mesh.ArrayType.Index].VariantType == Variant.Type.Nil ? Array.Empty<int>() : arrays[(int)Mesh.ArrayType.Index].AsInt32Array();
        var mid = mesh.GetAabb().GetCenter();
        int count = idx.Length > 0 ? idx.Length / 3 : v.Length / 3, outward = 0;
        for (int t = 0; t < count; t++)
        {
            Vector3 a = v[idx.Length > 0 ? idx[t * 3] : t * 3], b = v[idx.Length > 0 ? idx[t * 3 + 1] : t * 3 + 1], c = v[idx.Length > 0 ? idx[t * 3 + 2] : t * 3 + 2];
            // (Godot's front face winds clockwise: its normal is (c - a) x (b - a))
            var n = (c - a).Cross(b - a);
            var at = (a + b + c) / 3 - mid;
            if (n.X * at.X + n.Z * at.Z > 0) outward++;
        }
        return outward * 2 > count;
    }

    /// <summary>The same faces turned round: each triangle's corners the other way, the normals reversed.</summary>
    private static ArrayMesh Turned(Mesh mesh, Material material)
    {
        var arrays = mesh.SurfaceGetArrays(0);
        var v = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
        var idx = arrays[(int)Mesh.ArrayType.Index].VariantType == Variant.Type.Nil ? Enumerable.Range(0, v.Length).ToArray() : arrays[(int)Mesh.ArrayType.Index].AsInt32Array();
        for (int i = 0; i + 2 < idx.Length; i += 3) (idx[i + 1], idx[i + 2]) = (idx[i + 2], idx[i + 1]);
        arrays[(int)Mesh.ArrayType.Index] = idx;
        if (arrays[(int)Mesh.ArrayType.Normal].VariantType != Variant.Type.Nil)
            arrays[(int)Mesh.ArrayType.Normal] = arrays[(int)Mesh.ArrayType.Normal].AsVector3Array().Select(n => -n).ToArray();
        var made = new ArrayMesh { ResourceName = mesh.ResourceName };
        made.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays);
        made.SurfaceSetMaterial(0, material);
        return made;
    }

    /// <summary>The churches' window light (its grid of leads in lamplight) at this share of its strength.</summary>
    private const float WindowLightGain = 0.45f;
    /// <summary>The candles' and lamps' light inside, through the glass after dark (the lit glass's colour).</summary>
    private static readonly Vector3 Lamplight = new(1.0f, 0.74f, 0.46f);

    /// <summary>The glass's light now: the street layer's face (the day's light on it), the room layer's (the daylight
    /// through it) and how lit the church is inside after dark (the landmarks' clock, Lights.cs: lit from 18:30 to 6:30).</summary>
    public static Vector3 Levels(Daylight day)
    {
        float daylight = 1 - day.Night;
        float sun = Mathf.Clamp(day.SunIntensity / 4.2f, 0, 1);
        float h = day.Hour;
        float dayK = Mathf.Clamp(h < 12 ? (h - 6.5f) / 3 : (18.5f - h) / 3, 0, 1);
        float lit = Mathf.Clamp((0.5f - dayK) / 0.3f, 0, 1);
        return new Vector3(daylight * (0.2f + 0.14f * sun) + 0.012f, daylight * (0.62f + 0.6f * sun) + 0.03f, lit);
    }

    public override void _Process(double delta)
    {
        if (Daylight.I is not { } day) return;
        var k = Levels(day);
        if (MathF.Abs(k.X - last.X) < 0.003f && MathF.Abs(k.Y - last.Y) < 0.003f && MathF.Abs(k.Z - last.Z) < 0.003f) return;
        last = k;
        // from the street: the day's light on the glass, and after dark the lamps inside shining through it
        var face = Vector3.One * k.X + Lamplight * (StreetGlow * k.Z);
        foreach (var (m, b) in street) UniformUpdates.Material(m, "albedo", new Color(b.R * face.X, b.G * face.Y, b.B * face.Z, 1));
        // from inside: the daylight through it; at night the little light left is the moon's, a cold blue
        float moon = Mathf.Clamp(1 - (k.Y - 0.03f) / 0.3f, 0, 1);
        foreach (var (m, b) in room) UniformUpdates.Material(m, "albedo", new Color(b.R * k.Y * (1 - 0.35f * moon), b.G * k.Y * (1 - 0.15f * moon), b.B * k.Y, 1));
    }
    /// <summary>How bright the lit glass shows from the street after dark (its own picture, in lamplight).</summary>
    private const float StreetGlow = 0.85f;
}
