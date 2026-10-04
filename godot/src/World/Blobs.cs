using System;
using System.Collections.Generic;
using Godot;

namespace Scheldemist.World;

/// <summary>
/// Soft shadows on the ground (the browser's world/blobs.ts): under every walker, cart and dray near the eye a dark
/// soft patch, as the sky's light is kept off the stones under anything that stands on them, in any weather. One
/// MultiMesh, one draw, only within 45 m of the eye; a little stronger by day.
///
/// The parts that move things hand in their spots once a frame (the people part, the carts):
///   Blobs.I.Set("people", spots)     a list of (x, z, ground y, half width); Set(key, null) takes them away
/// </summary>
[GamePart(37)]
public partial class Blobs : Node
{
    public static Blobs? I { get; private set; }

    /// <summary>A spot: where (x, z), the ground under it (a walker's feet), its half width (m).</summary>
    public readonly record struct Spot(float X, float Z, float Y, float R);

    private const int Max = 192;
    private const float Reach = 45;
    private readonly Dictionary<string, IReadOnlyList<Spot>> lists = new();
    private MultiMesh mm = null!;
    private ShaderMaterial mat = null!;
    private readonly bool test = Main.I.Arg("blobtest") != "";

    private MultiMeshInstance3D node = null!;

    /// <summary>Dev: draw them or not (a before-and-after picture).</summary>
    public bool Shown { get => node.Visible; set => node.Visible = value; }

    /// <summary>How many are drawn now (a check).</summary>
    public int Count => mm.VisibleInstanceCount;

    private const string Code = @"
shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, fog_disabled;
uniform float opacity = 0.3;
void vertex() {
	// (three's polygon offset: pulled a little toward the eye, never fights the ground)
	vec4 v = MODELVIEW_MATRIX * vec4(VERTEX, 1.0);
	v.xyz *= 0.999;
	POSITION = PROJECTION_MATRIX * v;
}
void fragment() {
	// the browser's picture: a radial fall from black, 0.75 at 0.45 of the radius, to nothing at the edge
	float r = clamp(length(UV - 0.5) * 2.0, 0.0, 1.0);
	float a = r < 0.45 ? mix(1.0, 0.75, r / 0.45) : mix(0.75, 0.0, (r - 0.45) / 0.55);
	ALBEDO = vec3(0.0);
	ALPHA = a * opacity;
}
";

    public override void _Ready()
    {
        I = this;
        ProcessPriority = 60; // after the people moved
        mat = new ShaderMaterial { Shader = new Shader { Code = Code } };
        // (the material's render priority: drawn after the ground, before the other see-through things)
        mat.RenderPriority = 1;
        var quad = new PlaneMesh { Size = new Vector2(2, 2), Material = mat };
        mm = new MultiMesh { TransformFormat = MultiMesh.TransformFormatEnum.Transform3D, Mesh = quad, InstanceCount = Max, VisibleInstanceCount = 0 };
        // (they move with the people: never culled by an old box)
        mm.CustomAabb = new Aabb(new Vector3(-2000, -50, -2000), new Vector3(4000, 200, 4000));
        Main.I.View.AddChild(node = new MultiMeshInstance3D { Name = "ground_blobs", Multimesh = mm, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off });
    }

    public override void _ExitTree()
    {
        if (I == this) I = null;
    }

    /// <summary>One part's spots for this frame (kept until it sets them again); null takes them away.</summary>
    public void Set(string key, IReadOnlyList<Spot>? spots)
    {
        if (spots == null) lists.Remove(key);
        else lists[key] = spots;
    }

    public override void _Process(double delta)
    {
        using var frameCost = Scheldemist.Dev.FrameCost.Track("Blobs");
        var cam = Main.I.View.GetCamera3D();
        if (cam == null || Daylight.I == null) return;
        var eye = cam.GlobalPosition;
        if (test)
        {
            // (dev, --blobtest: a row of spots 3 to 9 m ahead of the eye, on the ground under it)
            var f = -cam.GlobalTransform.Basis.Z;
            f = new Vector3(f.X, 0, f.Z).Normalized();
            var row = new List<Spot>();
            for (int i = 0; i < 4; i++) row.Add(new Spot(eye.X + f.X * (3 + 2 * i) + f.Z * (i - 1.5f), eye.Z + f.Z * (3 + 2 * i) - f.X * (i - 1.5f), eye.Y - 1.62f, i % 2 == 0 ? 0.35f : 0.9f));
            lists["test"] = row;
        }
        int n = 0;
        foreach (var list in lists.Values)
            foreach (var s in list)
            {
                if (n >= Max) break;
                if (MathF.Abs(s.X - eye.X) > Reach || MathF.Abs(s.Z - eye.Z) > Reach) continue;
                mm.SetInstanceTransform(n++, new Transform3D(Basis.Identity.Scaled(new Vector3(s.R, 1, s.R)), new Vector3(s.X, s.Y + 0.03f, s.Z)));
            }
        mm.VisibleInstanceCount = n;
        float h = Daylight.I.Hour;
        float day = h > 8 && h < 17 ? 1 : h > 6.5f && h < 18.5f ? 0.5f : 0;
        Scheldemist.Render.UniformUpdates.Material(mat, "opacity", 0.28f + 0.2f * day);
    }
}
