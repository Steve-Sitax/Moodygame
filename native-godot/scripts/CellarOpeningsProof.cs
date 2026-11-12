using System;
using System.Linq;
using Godot;
using Scheldemist.Native.World;

public partial class CellarOpeningsProof : Node
{
    public override void _Ready()
    {
        try
        {
            var town = new Node3D { Position = new Vector3(11, 0, -7) }; AddChild(town);
            MeshInstance3D Plane(Node3D parent, string name, float y, float size)
            {
                var mesh = new ArrayMesh(); var arrays = new Godot.Collections.Array(); arrays.Resize((int)Mesh.ArrayType.Max);
                arrays[(int)Mesh.ArrayType.Vertex] = new[] { new Vector3(-size,y,-size), new Vector3(size,y,-size), new Vector3(size,y,size), new Vector3(-size,y,-size), new Vector3(size,y,size), new Vector3(-size,y,size) };
                mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays);
                var node = new MeshInstance3D { Name = name, Mesh = mesh }; parent.AddChild(node); return node;
            }
            var room = new Node3D { Name = "ROOM_fixture" }; town.AddChild(room);
            Plane(room, "floor", -2, 3);
            var tread = Plane(room, "tread", -1, 1);
            var lining = Plane(town, "house_lining_fixture", 0, 4);
            var ground = Plane(town, "ground_fixture", 0, 4);
            var untouched = Plane(town, "ground_neighbour", 0, 1); untouched.Position = new Vector3(20, 0, 0);
            var before = untouched.Mesh;
            var originalTread = tread.Mesh;
            ground.Mesh.SetMeta("native_solid_stand_in", ground.Mesh.GetFaces());
            NativeCellarOpenings.Cut(town, GD.Print);
            bool CoversOrigin(Vector3[] faces)
            {
                for (int i=0;i<faces.Length;i+=3)
                {
                    var p = new[] { faces[i],faces[i+1],faces[i+2] }.Select(v=>new Vector2(v.X,v.Z)).ToArray();
                    var signs = Enumerable.Range(0,3).Select(e=>(p[(e+1)%3]-p[e]).Cross(-p[e])).ToArray();
                    if (signs.All(s=>s>=-1e-5f)||signs.All(s=>s<=1e-5f)) return true;
                }
                return false;
            }
            void Check(bool ok, string why) { if(!ok)throw new Exception(why); }
            Check(!CoversOrigin(ground.Mesh.GetFaces()), "Drawn paving still covers stair");
            Check(!CoversOrigin(lining.Mesh.GetFaces()), "Lining still covers stair");
            Check(!CoversOrigin(ground.Mesh.GetMeta("native_solid_stand_in").AsVector3Array()), "Collision stand-in still covers stair");
            Check(untouched.Mesh==before && tread.Mesh==originalTread, "Neighbour or authored treads changed");
            float Area(Vector3[] f) { float sum=0;for(int i=0;i<f.Length;i+=3)sum+=(f[i+1]-f[i]).Cross(f[i+2]-f[i]).Length()/2;return sum; }
            Check(Math.Abs(Area(ground.Mesh.GetFaces())-(64-2.08f*2.08f))<.001f, "Opening differs from tread footprint plus its 40 mm lining overlap");
            room.Name="ROOM_poesje"; lining.Name="house_lining_poesje";
            NativeCellarOpenings.Cut(town, GD.Print);
            Check(Math.Abs(Area(ground.Mesh.GetFaces())-(64-2.6f*2.6f))<.001f, "Poesje railing-side well clearance");
            Check(untouched.Mesh==before && tread.Mesh==originalTread, "Wider well changed neighbour or treads");
            GD.Print("CELLAR_OPENINGS_PASS: drawn paving, lining, collision stand-in, transformed parent, unchanged neighbour/treads, exact remaining area");
            GetTree().Quit();
        }
        catch(Exception e){GD.PrintErr(e);GetTree().Quit(1);}
    }
}
