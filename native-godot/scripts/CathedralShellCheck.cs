using System;
using System.Linq;
using Godot;
using Scheldemist.Native.World;
public partial class CathedralShellCheck : Node
{
    public override void _Ready()
    {
        try
        {
            int tris=0,rays=0;
            foreach(var panel in NativeCathedralTowers.ShellPanels())
            foreach(var mesh in new[]{panel.Wall,panel.Dress})
            {
                var a=mesh.SurfaceGetArrays(0);var p=a[0].AsVector3Array();var n=a[1].AsVector3Array();var uv=a[4].AsVector2Array();
                for(int i=0;i<p.Length;i+=3)
                {
                    var cross=(p[i+1]-p[i]).Cross(p[i+2]-p[i]);
                    if(!p[i].IsFinite() || !n[i].IsFinite() || !uv[i].IsFinite() || cross.Dot(n[i])>=0) throw new Exception("Bad shell triangle");
                    float ratio=Math.Abs((uv[i+1]-uv[i]).Cross(uv[i+2]-uv[i]))/cross.Length();
                    if(!float.IsFinite(ratio)||ratio<.03f||ratio>1) throw new Exception($"Bad shell UV {ratio}");
                    tris++;
                }
            }
            var scene=ResourceLoader.Load<PackedScene>("res://world/town/roots/node-02105.scn").Instantiate();AddChild(scene);
            var meshes=Scheldemist.World.BakedWorld.All(scene).OfType<MeshInstance3D>().Where(n=>n.Name.ToString().StartsWith("landmark_cathedral")).ToArray();
            foreach(var item in NativeCathedralTowers.ShellPanels())
            {
                var panel=item.Panel;
                // The old central masonry shaft and both old openings must now be one aperture.
                foreach(float fraction in new[]{.30f,.42f,.5f,.58f,.70f})
                {
                    float length=panel.Left+panel.Right;
                    var point=panel.P+panel.D*(length*fraction)+Vector3.Up*Mathf.Lerp(panel.Bottom,panel.Top,.45f);
                    foreach(var node in meshes)
                    for(int s=0;s<node.Mesh.GetSurfaceCount();s++)
                    {
                        var a=node.Mesh.SurfaceGetArrays(s);var p=a[0].AsVector3Array();var ix=a[12].AsInt32Array();var xf=node.GlobalTransform;
                        for(int i=0;i<ix.Length;i+=3)
                        {
                            var hit=Geometry3D.SegmentIntersectsTriangle(point+panel.O*1.39f,point-panel.O*1.01f,xf*p[ix[i]],xf*p[ix[i+1]],xf*p[ix[i+2]]);
                            if(hit.VariantType!=Variant.Type.Nil) throw new Exception($"Obstructed single opening: {node.Name} {point} hit {hit}");
                        }
                    }
                    rays++;
                }
            }
            GD.Print($"SHELL CHECK PASS {tris} generated triangles: finite attributes, outward winding, noncollapsed metric UVs; {rays} native-mesh aperture rays clear across old shaft and both old openings");GetTree().Quit();
        }
        catch(Exception e){GD.PrintErr(e);GetTree().Quit(1);}
    }
}
