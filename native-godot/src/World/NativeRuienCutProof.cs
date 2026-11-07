using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.World;

namespace Scheldemist.Native.World;

/// <summary>Headless regression for entrance cuts: misses, interpolated channels and collision-only changes.</summary>
public partial class NativeRuienCutProof : Node
{
    public override void _Ready()
    {
        try
        {
            var planes = new List<Func<Vector3, float>> { p => p.X };
            foreach (bool indexed in new[] { false, true })
            {
                var arrays = Triangle(indexed);
                Require(QuayNotch.CutSurfaceWith(arrays, Transform3D.Identity, _ => false, planes) == 0, "distant triangle retained");
                Require(arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array().Length == 3, "miss does not rewrite arrays");
                Require(QuayNotch.CutSurfaceWith(arrays, Transform3D.Identity, _ => true, planes) == 1, "crossing triangle clipped");
                var vertices = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
                var uv = arrays[(int)Mesh.ArrayType.TexUV].AsVector2Array();
                foreach (int i in arrays[(int)Mesh.ArrayType.Index].AsInt32Array())
                {
                    Require(vertices[i].X <= 0, "cut half removed");
                    Require(uv[i].IsEqualApprox(new Vector2(vertices[i].X, vertices[i].Z)), "UV interpolation preserved");
                }
            }
            var town = new Node3D();
            var mesh = new ArrayMesh();
            var drawn = Triangle(true);
            drawn[(int)Mesh.ArrayType.Vertex] = new[] { new Vector3(-3, 0, -1), new Vector3(-1, 0, -1), new Vector3(-3, 0, 1) };
            mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, drawn);
            mesh.SetMeta("permanent_test_id", "entrance-fixture");
            var instance = new MeshInstance3D { Mesh = mesh };
            town.AddChild(instance);
            var box = new Aabb(new Vector3(-4, -1, -2), new Vector3(8, 2, 4));
            Require(QuayNotch.CutRegion(town, _ => true, box, _ => true, planes) == 0, "region miss");
            Require(instance.Mesh == mesh, "miss keeps original resource");
            mesh.SetMeta("native_solid_stand_in", Triangle(false)[(int)Mesh.ArrayType.Vertex]);
            Require(QuayNotch.CutRegion(town, _ => true, box, _ => true, planes) == 1, "collision-only cut counted");
            Require(instance.Mesh != mesh, "collision-only change produces replacement");
            Require(instance.Mesh.GetMeta("permanent_test_id").AsString() == "entrance-fixture", "metadata retained");
            Require(instance.Mesh.GetMeta("native_solid_stand_in").AsVector3Array().All(p => p.X <= 0), "collision follows opening");
            Require(mesh.GetMeta("native_solid_stand_in").AsVector3Array().Any(p => p.X > 0), "source resource unchanged");
            var rear=Fixture(false);
            var rearInstance=rear.GetChild<MeshInstance3D>(0);
            var rearMesh=(ArrayMesh)rearInstance.Mesh!;
            var rearDrawn=rearMesh.SurfaceGetArrays(0);
            rearDrawn[(int)Mesh.ArrayType.Vertex]=new[]{new Vector3(-4,0,-1),new Vector3(-3,0,-1),new Vector3(-4,0,1)};
            var thin=new ArrayMesh();thin.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,rearDrawn);
            thin.SetMeta("native_solid_stand_in",Triangle(false)[(int)Mesh.ArrayType.Vertex]);rearInstance.Mesh=thin;
            var rearBox=new Aabb(new Vector3(.2f,-1,-2),new Vector3(2,2,4));
            Require(QuayNotch.CutRegion(rear,_=>true,rearBox,_=>true,new(){p=>p.X-.2f})>0,"collision beyond the drawn bounds is cut");
            Require(rearInstance.Mesh!.SurfaceGetArrays(0)[(int)Mesh.ArrayType.Vertex].AsVector3Array().SequenceEqual(rearDrawn[(int)Mesh.ArrayType.Vertex].AsVector3Array()),"collision-only rear cut preserves visible geometry");
            Require(rearInstance.Mesh.GetMeta("native_solid_stand_in").AsVector3Array().All(p=>p.X<=.20001f),"rear collision follows the opening");
            Require(thin.GetMeta("native_solid_stand_in").AsVector3Array().Any(p=>p.X>.2f),"rear source metadata preserved");
            rear.Free();
            var regions = new[] {
                new QuayNotch.Region(box, planes), new QuayNotch.Region(box, new() { p => p.Z }),
                new QuayNotch.Region(box, new() { p => -.245643f - p.X }),
                new QuayNotch.Region(box, new() { p => -.3123456f - p.Z }) };
            foreach (bool compressed in new[] { false, true }) CompareBatch(regions, compressed);
            town.Free();
            GD.Print("RUIEN CUT PROOF PASS");
            GetTree().Quit();
        }
        catch (Exception e) { GD.PrintErr(e); GetTree().Quit(1); }
    }

    private static void CompareBatch(QuayNotch.Region[] regions, bool compressed)
    {
        var sequential = Fixture(compressed);
        var batched = Fixture(compressed);
        int count = 0;
        foreach (var r in regions) count += QuayNotch.CutRegion(sequential, _ => true, r.Box, _ => true, r.Inside);
        Require(QuayNotch.CutRegions(batched, _ => true, _ => true, regions) == count, "batch counts match sequential cuts");
        var left = sequential.GetChild<MeshInstance3D>(0).Mesh!;
        var right = batched.GetChild<MeshInstance3D>(0).Mesh!;
        var la = left.SurfaceGetArrays(0); var ra = right.SurfaceGetArrays(0);
        Require(la[(int)Mesh.ArrayType.Vertex].AsVector3Array().SequenceEqual(ra[(int)Mesh.ArrayType.Vertex].AsVector3Array()), "batch vertices match sequential cuts");
        Require(la[(int)Mesh.ArrayType.Index].AsInt32Array().SequenceEqual(ra[(int)Mesh.ArrayType.Index].AsInt32Array()), "batch indices match sequential cuts");
        Require(la[(int)Mesh.ArrayType.TexUV].AsVector2Array().SequenceEqual(ra[(int)Mesh.ArrayType.TexUV].AsVector2Array()), "batch UVs match sequential cuts");
        Require(left.GetMeta("native_solid_stand_in").AsVector3Array().SequenceEqual(right.GetMeta("native_solid_stand_in").AsVector3Array()), "batch collision matches sequential cuts");
        sequential.Free(); batched.Free();
    }

    private static Godot.Collections.Array Triangle(bool indexed)
    {
        var a = new Godot.Collections.Array(); a.Resize((int)Mesh.ArrayType.Max);
        a[(int)Mesh.ArrayType.Vertex] = new[] { new Vector3(-1, 0, -1), new Vector3(1, 0, -1), new Vector3(-1, 0, 1) };
        a[(int)Mesh.ArrayType.TexUV] = new[] { new Vector2(-1, -1), new Vector2(1, -1), new Vector2(-1, 1) };
        if (indexed) a[(int)Mesh.ArrayType.Index] = new[] { 0, 1, 2 };
        return a;
    }

    private static Node3D Fixture(bool compressed)
    {
        var root = new Node3D(); var mesh = new ArrayMesh();
        var arrays = Triangle(true);
        arrays[(int)Mesh.ArrayType.Vertex] = new[] { new Vector3(-1.1234567f, 0, -1.789456f), new Vector3(1.123456f, 0, -1.789456f), new Vector3(-1.1234567f, 0, 1.3456f) };
        arrays[(int)Mesh.ArrayType.Normal] = new[] { Vector3.Up, Vector3.Up, Vector3.Up };
        mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays, null, null, compressed ? Mesh.ArrayFormat.FlagCompressAttributes : 0);
        mesh.SetMeta("native_solid_stand_in", Triangle(false)[(int)Mesh.ArrayType.Vertex]);
        root.AddChild(new MeshInstance3D { Mesh = mesh });
        return root;
    }

    private static void Require(bool pass, string name)
    {
        if (!pass) throw new InvalidOperationException(name);
    }
}
