using Godot;
using System;
using System.Linq;
using System.Reflection;
using Scheldemist.Native.World;

public partial class StartupGeometryProof : Node
{
    public override void _Ready()
    {
        try
        {
            var filter = typeof(NativeRazedHouses).GetMethods(BindingFlags.NonPublic | BindingFlags.Static)
                .Single(m => m.Name == "Filter" && m.GetParameters()[1].ParameterType.GetGenericArguments().Length == 8);
            using var mesh = new ArrayMesh();
            using var material = new StandardMaterial3D();
            using var arrays = new Godot.Collections.Array(); arrays.Resize((int)Mesh.ArrayType.Max);
            arrays[(int)Mesh.ArrayType.Vertex] = new Vector3[] { Vector3.Zero, Vector3.Right, Vector3.Forward, Vector3.One };
            arrays[(int)Mesh.ArrayType.Index] = new int[] { 0, 1, 2, 1, 3, 2 };
            mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays);
            mesh.SurfaceSetMaterial(0, material); mesh.SetMeta("native_solid_stand_in", new Vector3[] { Vector3.One });
            var node = new MeshInstance3D { Mesh = mesh }; AddChild(node);
            int Run(Func<int, int, Vector3, Vector3, Vector3, int, string, bool> drop)
                => (int)filter.Invoke(null, new object[] { node, drop })!;
            void Check(bool ok, string message) { if (!ok) throw new Exception(message); }
            Check(Run((s,t,a,b,c,alpha,mat) => false) == 0 && node.Mesh == mesh, "Unchanged mesh identity");
            Check(Run((s,t,a,b,c,alpha,mat) => t == 0) == 1, "One triangle removed");
            Check(node.Mesh.SurfaceGetMaterial(0) == material && node.Mesh.HasMeta("native_solid_stand_in"), "Material and collision metadata");
            var kept = node.Mesh.SurfaceGetArrays(0)[(int)Mesh.ArrayType.Index].AsInt32Array();
            Check(kept.SequenceEqual(new[] { 1, 3, 2 }), "Surviving topology");
            Check(Run((s,t,a,b,c,alpha,mat) => true) == 1 && node.Mesh.GetSurfaceCount() == 0, "Empty mesh");
            var belongs = typeof(NativeRazedHouses).GetMethod("Belongs", BindingFlags.NonPublic | BindingFlags.Static)!;
            Vector2[] Square(float x, float z) => new[] { new Vector2(x,z), new Vector2(x+3,z), new Vector2(x+3,z+3), new Vector2(x,z+3) };
            var razed = new[] { Square(-4,-4), Square(5,5) };
            var standing = new[] { Square(-1,-4), Square(8,5), Square(40,40) };
            int points = 0;
            for (int x = -80; x <= 120; x++) for (int z = -80; z <= 120; z++)
            {
                var q = new Vector2(x / 10f, z / 10f);
                float Away(Vector2[] o) => NativeRazedHouses.Inside(o,q) ? 0 : NativeRazedHouses.EdgeDistance(o,q);
                float d = razed.Min(Away);
                bool expected = d <= 1.2f && standing.All(o => Away(o) > d);
                bool actual = (bool)belongs.Invoke(null, new object[] { q, razed, standing, 1.2f })!;
                Check(expected == actual, "Ownership at " + q); points++;
            }
            (int Count, Vector3[] Faces, Vector3[] Solid) Cut(bool batch)
            {
                var root = new Node3D(); AddChild(root);
                using var primitive = new BoxMesh { Size = new Vector3(4, 1, 4) };
                var source = new ArrayMesh(); source.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, primitive.GetMeshArrays());
                // A stand-in reaches beyond the drawn mesh: it must participate in bounds tests.
                source.SetMeta("native_solid_stand_in", new[] { new Vector3(5,0,0), new Vector3(7,0,0), new Vector3(5,0,2) });
                var item = new MeshInstance3D { Mesh = source, Position = new Vector3(-3, 0, 2) }; root.AddChild(item);
                int count;
                using (batch ? Scheldemist.World.QuayNotch.BeginCutBatch(root) : null)
                {
                    count = Scheldemist.World.QuayNotch.CutFloor(root, new Rect2(-4,1,1,1), -1, 1, solidCut:true);
                    count += Scheldemist.World.QuayNotch.CutFloor(root, new Rect2(2,2,1,1), -1, 1, solidCut:true);
                    count += Scheldemist.World.QuayNotch.CutFloor(root, new Rect2(40,40,1,1), -1, 1, solidCut:true);
                }
                var result = (count, item.Mesh.GetFaces(), item.Mesh.GetMeta("native_solid_stand_in").AsVector3Array());
                root.Free(); return result;
            }
            var reference = Cut(false); var indexed = Cut(true);
            Check(reference.Count == indexed.Count && reference.Faces.SequenceEqual(indexed.Faces)
                && reference.Solid.SequenceEqual(indexed.Solid), "Indexed cuts match sequential visual and collision geometry");
            using var plane = new PlaneMesh { Size = new Vector2(32,32), SubdivideWidth = 24, SubdivideDepth = 24 };
            var cutType = typeof(Scheldemist.World.QuayNotch);
            var scanType = cutType.GetNestedType("SurfaceScan", BindingFlags.NonPublic)!;
            var fastCut = cutType.GetMethods(BindingFlags.NonPublic | BindingFlags.Static).Single(m => m.Name == "CutSurfaceWith");
            foreach (float x in new[] { -16f, -4f, 0f, 3.99f, 16f, 40f })
            {
                using var slow = plane.GetMeshArrays(); using var fast = plane.GetMeshArrays();
                var xf = new Transform3D(new Basis(Vector3.Up, .3f), new Vector3(-2,0,3));
                var box = new Aabb(new Vector3(x,-1,-1),new Vector3(1,2,2));
                var planes = new System.Collections.Generic.List<Func<Vector3,float>>
                { p=>p.X-x,p=>x+1-p.X,p=>p.Z+1,p=>1-p.Z };
                bool Near((Vector3,Vector3,Vector3) t)
                { var lo=t.Item1.Min(t.Item2).Min(t.Item3); var hi=t.Item1.Max(t.Item2).Max(t.Item3);
                  return hi.X>=box.Position.X && lo.X<=box.End.X && hi.Z>=box.Position.Z && lo.Z<=box.End.Z; }
                int expected = Scheldemist.World.QuayNotch.CutSurfaceWith(slow,xf,Near,planes);
                var scan = Activator.CreateInstance(scanType, new object[] { fast,xf })!;
                int actual = (int)fastCut.Invoke(null,new object[] {fast,xf,(Func<(Vector3,Vector3,Vector3),bool>)Near,planes,scan,box})!;
                Check(expected==actual, "Triangle index cut count");
                Check(slow[(int)Mesh.ArrayType.Vertex].AsVector3Array().SequenceEqual(fast[(int)Mesh.ArrayType.Vertex].AsVector3Array()), "Triangle index vertices");
                Check(slow[(int)Mesh.ArrayType.Index].AsInt32Array().SequenceEqual(fast[(int)Mesh.ArrayType.Index].AsInt32Array()), "Triangle index topology");
                Check(slow[(int)Mesh.ArrayType.Normal].AsVector3Array().SequenceEqual(fast[(int)Mesh.ArrayType.Normal].AsVector3Array()), "Triangle index normals");
                Check(slow[(int)Mesh.ArrayType.TexUV].AsVector2Array().SequenceEqual(fast[(int)Mesh.ArrayType.TexUV].AsVector2Array()), "Triangle index UVs");
            }
            foreach(bool colors in new[]{false,true})foreach(bool custom in new[]{false,true})
            {
                using var mm=new MultiMesh{TransformFormat=MultiMesh.TransformFormatEnum.Transform3D,UseColors=colors,UseCustomData=custom,Mesh=mesh,InstanceCount=4};
                using var bulk=new MultiMesh{TransformFormat=MultiMesh.TransformFormatEnum.Transform3D,UseColors=colors,UseCustomData=custom,Mesh=mesh,InstanceCount=4};
                int stride=Scheldemist.World.MultiMeshData.Stride(mm);var buffer=new float[4*stride];
                for(int i=0;i<4;i++)
                {
                    var xf=new Transform3D(new Basis(Vector3.Up,i*.7f).Scaled(new Vector3(.7f,2f,-1f)),new Vector3(i,-2*i,3*i));
                    var color=new Color(.13f*i,.17f,.31f,.83f);var data=new Color(.4f,.2f*i,.8f,1);
                    mm.SetInstanceTransform(i,xf);Scheldemist.World.MultiMeshData.Transform(buffer,i*stride,xf);
                    if(colors){mm.SetInstanceColor(i,color);Scheldemist.World.MultiMeshData.Colour(buffer,i*stride+12,color);}
                    if(custom){mm.SetInstanceCustomData(i,data);Scheldemist.World.MultiMeshData.Colour(buffer,i*stride+12+(colors?4:0),data);}
                }
                if(DisplayServer.GetName()!="headless") Check(mm.Buffer.SequenceEqual(buffer),"Bulk buffer layout including colours/custom data");
                Scheldemist.World.MultiMeshData.Write(bulk,buffer);
                for(int i=0;i<4;i++)Check(mm.GetInstanceTransform(i)==bulk.GetInstanceTransform(i),"Bulk transform round trip");
                Scheldemist.World.MultiMeshData.Collapse(buffer,stride);Scheldemist.World.MultiMeshData.Write(bulk,buffer);
                if(DisplayServer.GetName()!="headless") Check(bulk.GetInstanceTransform(1).Origin==mm.GetInstanceTransform(1).Origin && bulk.GetInstanceTransform(1).Basis==new Basis(Vector3.Zero,Vector3.Zero,Vector3.Zero),"Collapsed plant preserves origin");
            }
            GD.Print($"STARTUP_GEOMETRY_PASS: topology, materials, collision metadata, {points} ownership comparisons");
            GetTree().Quit();
        }
        catch (Exception e) { GD.PrintErr(e); GetTree().Quit(1); }
    }
}
