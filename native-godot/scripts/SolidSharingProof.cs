using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Godot;
using Scheldemist.World;

public partial class SolidSharingProof : Node
{
    private static readonly Type SolidType = typeof(Solid);
    private const BindingFlags Hidden = BindingFlags.NonPublic | BindingFlags.Instance;
    private static object Field(object instance, string name) => SolidType.GetField(name, Hidden)!.GetValue(instance)!;
    private static void Set(object instance, string name, object value) => SolidType.GetField(name, Hidden)!.SetValue(instance, value);
    private static void Check(bool ok, string why) { if (!ok) throw new InvalidOperationException(why); }

    public override async void _Ready()
    {
        var reference = new Solid(); var shared = new Solid();
        var spaces = new[] { PhysicsServer3D.SpaceCreate(), PhysicsServer3D.SpaceCreate() };
        using var mesh = new BoxMesh { Size = new Vector3(2, 1, 2) };
        using var floor = new BoxMesh { Size = new Vector3(2, .1f, 2) };
        var poses = new List<(Mesh Mesh, Transform3D At, string Name)>();
        int rays = 0, vertices = 0;
        try
        {
            Basis[] bases = { Basis.Identity, new(Vector3.Up, .7f), Basis.FromScale(new(2,.5f,1.3f)),
                Basis.FromScale(new(-1,1,1)), new(new Vector3(1,.2f,0), new Vector3(.1f,1,0), new Vector3(.2f,0,1)) };
            for (int b = 0; b < bases.Length; b++)
                for (int copy = 0; copy < 2; copy++)
                    poses.Add((mesh, new Transform3D(bases[b], new Vector3(b * 10, .25f, copy * 10)), "box_"+b+"_"+copy));
            poses.Add((floor, Transform3D.Identity, "ground_cut"));
            poses.Add((floor, new Transform3D(Basis.Identity, new Vector3(0,0,20)), "ground_uncut"));
            for (int n = 0; n < 2; n++)
            {
                var solid = n == 0 ? reference : shared;
                PhysicsServer3D.SpaceSetActive(spaces[n], true); Set(solid, "space", spaces[n]);
                var holeType = SolidType.GetNestedType("Hole", BindingFlags.NonPublic)!;
                Vector2[] polygon = { new(-.4f,-.4f),new(.4f,-.4f),new(.4f,.4f),new(-.4f,.4f) };
                ((IList)Field(solid,"holes")).Add(Activator.CreateInstance(holeType, new object[] { polygon,-.4f,.4f,-.4f,.4f,0f })!);
                Set(solid,"holeX0",-.4f);Set(solid,"holeX1",.4f);Set(solid,"holeZ0",-.4f);Set(solid,"holeZ1",.4f);
                var itemType = SolidType.GetNestedType("Item",BindingFlags.NonPublic)!;
                var build = SolidType.GetMethod("Build",Hidden,null,new[]{itemType,typeof(bool)},null)!;
                foreach(var pose in poses)
                {
                    var item = Activator.CreateInstance(itemType,true)!;
                    itemType.GetField("Mesh")!.SetValue(item,pose.Mesh);
                    itemType.GetField("Xf")!.SetValue(item,pose.At);
                    itemType.GetField("Box")!.SetValue(item,pose.At*pose.Mesh.GetAabb());
                    itemType.GetField("Name")!.SetValue(item,pose.Name);
                    build.Invoke(solid,new[]{item,(object)(n==1)});
                }
            }
            Check(reference.Triangles==shared.Triangles && reference.Built==shared.Built,"Triangle and body counts stay unchanged");
            Check((int)Field(shared,"reusedShapes")==5,"Exactly five repeated placements share their shape");
            var before = (List<Rid>)Field(reference,"bodies"); var after = (List<Rid>)Field(shared,"bodies");
            for(int b=0;b<before.Count;b++)
            {
                Vector3[] a=PhysicsServer3D.ShapeGetData(PhysicsServer3D.BodyGetShape(before[b],0)).AsGodotDictionary()["faces"].AsVector3Array();
                Vector3[] z=PhysicsServer3D.ShapeGetData(PhysicsServer3D.BodyGetShape(after[b],0)).AsGodotDictionary()["faces"].AsVector3Array();
                var xf=PhysicsServer3D.BodyGetState(after[b],PhysicsServer3D.BodyState.Transform).AsTransform3D();
                Check(a.Length==z.Length,"Face counts agree");
                for(int v=0;v<a.Length;v++){Check(a[v].DistanceTo(xf*z[v])<.00002f,"World triangle is unchanged");vertices++;}
            }
            for(int i=0;i<3;i++)await ToSignal(GetTree(),SceneTree.SignalName.PhysicsFrame);
            var first=PhysicsServer3D.SpaceGetDirectState(spaces[0]);var second=PhysicsServer3D.SpaceGetDirectState(spaces[1]);
            void Ray(Vector3 from, Vector3 to)
            {
                using var query=PhysicsRayQueryParameters3D.Create(from,to,Solid.Layer);
                var a=first.IntersectRay(query);var b=second.IntersectRay(query);
                Check((a.Count==0)==(b.Count==0),"Ray hit/miss agrees");
                if(a.Count>0)
                {
                    Check(a["position"].AsVector3().DistanceTo(b["position"].AsVector3())<.0001f,"Ray contact agrees");
                    Check(a["normal"].AsVector3().DistanceTo(b["normal"].AsVector3())<.0001f,"Ray normal agrees");
                }
                rays++;
            }
            foreach(var pose in poses)
                for(int a=-12;a<=12;a++)for(int b=-12;b<=12;b++)
                {
                    var p=pose.At.Origin+new Vector3(a*.19f,0,b*.19f);
                    Ray(p+Vector3.Up*4,p-Vector3.Up*4);
                    Ray(p+new Vector3(0,b*.13f,4),p+new Vector3(0,b*.13f,-4));
                }
            // A cut is placement-specific, even for two copies of the same mesh and basis.
            using var holeRay=PhysicsRayQueryParameters3D.Create(new Vector3(0,.1f,0),new Vector3(0,-.2f,0),Solid.Layer);
            Check(second.IntersectRay(holeRay).Count==0,"Stair opening stays open");
            holeRay.From+=Vector3.Back*20;holeRay.To+=Vector3.Back*20;
            Check(second.IntersectRay(holeRay).Count>0,"Uncut copy stays solid");
            GD.Print($"SOLID_SHARING_PASS: {vertices} vertices, {rays} physics rays, mirrored/scaled/sheared bases and placement-specific stair holes");
        }
        catch(Exception e){GD.PushError(e.ToString());GetTree().Quit(1);return;}
        finally
        {
            reference._ExitTree();shared._ExitTree();reference.Free();shared.Free();
            foreach(var space in spaces)PhysicsServer3D.FreeRid(space);
        }
        GetTree().Quit();
    }
}
