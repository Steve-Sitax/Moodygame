using System;
using System.Collections;
using System.Reflection;
using Godot;
using Scheldemist.Native.World;

// Run with --headless res://scripts/tracery-geometry-check.tscn after building.
// Checks generated geometry without loading the town or touching player data.
// This does not replace native contextual visual acceptance.
public partial class TraceryGeometryCheck : Node
{
    public override void _Ready()
    {
        try
        {
            var type = typeof(NativeCathedralTowers);
            const BindingFlags flags = BindingFlags.NonPublic | BindingFlags.Static;
            var openings = (IEnumerable)type.GetMethod("Openings", flags)!.Invoke(null, null)!;
            var builder = type.GetNestedType("Builder", BindingFlags.NonPublic)!;
            int count = 0, triangles = 0;
            float minArea = float.MaxValue;
            float minUvRatio = float.MaxValue, maxUvRatio = 0;
            foreach (var opening in openings)
            {
                var output = Activator.CreateInstance(builder, true)!;
                type.GetMethod("Tracery", flags)!.Invoke(null, new[] { opening, output });
                using var mesh = (ArrayMesh)builder.GetMethod("Commit")!.Invoke(output, new object?[] { null })!;
                var arrays = mesh.SurfaceGetArrays(0);
                var positions = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
                var normals = arrays[(int)Mesh.ArrayType.Normal].AsVector3Array();
                var uv = arrays[(int)Mesh.ArrayType.TexUV].AsVector2Array();
                if (positions.Length == 0 || positions.Length % 3 != 0)
                    throw new Exception("Missing or incomplete tracery triangles");
                for (int i = 0; i < positions.Length; i++)
                    if (!positions[i].IsFinite() || !normals[i].IsFinite() || !uv[i].IsFinite())
                        throw new Exception("Nonfinite position, normal or UV");
                for (int i = 0; i < positions.Length; i += 3)
                {
                    var cross = (positions[i + 1] - positions[i]).Cross(positions[i + 2] - positions[i]);
                    minArea = Math.Min(minArea, cross.Length() / 2);
                    if (cross.Dot(normals[i]) >= 0) throw new Exception("Degenerate or inward-facing triangle");
                    var ua = uv[i + 1] - uv[i]; var ub = uv[i + 2] - uv[i];
                    float uvRatio = Math.Abs(ua.Cross(ub)) / cross.Length();
                    if (!float.IsFinite(uvRatio) || uvRatio < .25f || uvRatio > .75f)
                        throw new Exception($"Collapsed or excessively stretched UV triangle: {uvRatio}; {positions[i]}");
                    minUvRatio = Math.Min(minUvRatio, uvRatio); maxUvRatio = Math.Max(maxUvRatio, uvRatio);
                }
                triangles += positions.Length / 3;
                count++;
            }
            if (count != 30) throw new Exception($"Expected 30 final shell openings, found {count}; review shell/infill fit");
            GD.Print($"TRACERY PASS: openings={count}; triangles={triangles}; minimum area={minArea}; UV area ratios={minUvRatio}..{maxUvRatio}; finite positions/normals/UVs and outward winding");
            GetTree().Quit();
        }
        catch (Exception e)
        {
            GD.PrintErr(e);
            GetTree().Quit(1);
        }
    }
}
