using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.Native.World;

// Explicit authoring command, never run during gameplay. Run once on a clean pre-rebuild checkout.
public partial class CathedralShellBake : Node
{
    private record V(Vector3 P, Vector3 N, Vector2 UV, Color C, Vector4 T)
    {
        public V Lerp(V b,float t) => new(P.Lerp(b.P,t),N.Lerp(b.N,t).Normalized(),UV.Lerp(b.UV,t),C.Lerp(b.C,t),T.Lerp(b.T,t));
    }
    public override void _Ready()
    {
        try
        {
            if (!OS.GetCmdlineUserArgs().Contains("--write-cathedral-shell")) throw new Exception("Explicit --write-cathedral-shell required");
            if(ResourceLoader.Load<ArrayMesh>("res://world/town/resources/r001836.res").GetSurfaceCount()!=1)
                throw new Exception("Shell already rebuilt: restore the four inputs from the pre-rebuild commit before rebaking");
            var panels=NativeCathedralTowers.ShellPanels().ToArray();
            if(panels.Length!=14) throw new Exception("Expected fourteen exposed lower-stage faces");
            var scene=ResourceLoader.Load<PackedScene>("res://world/town/roots/node-02105.scn").Instantiate();
            AddChild(scene);
            int changed=0, removed=0;
            foreach(var node in Scheldemist.World.BakedWorld.All(scene).OfType<MeshInstance3D>())
            {
                if(!node.Name.ToString().StartsWith("landmark_cathedral") || node.Mesh is not ArrayMesh mesh) continue;
                // Roof slopes meeting the inner face remain authored roof geometry.
                if(node.Name == "landmark_cathedral_2") continue;
                var xf=node.GlobalTransform; var inv=xf.AffineInverse();
                var result=new ArrayMesh(); int touched=0;
                for(int s=0;s<mesh.GetSurfaceCount();s++)
                {
                    var arrays=mesh.SurfaceGetArrays(s);
                    for(int k=5;k<12;k++) if(arrays[k].VariantType!=Variant.Type.Nil) throw new Exception($"Unhandled vertex channel {k}");
                    var p=arrays[0].AsVector3Array().ToList();var n=arrays[1].AsVector3Array().ToList();
                    var t=arrays[2].AsFloat32Array().ToList();var c=arrays[3].AsColorArray().ToList();var uv=arrays[4].AsVector2Array().ToList();
                    bool hasT=t.Count>0, hasC=c.Count>0, hasUv=uv.Count>0, hasN=n.Count>0;
                    if(!hasUv) uv.AddRange(Enumerable.Repeat(Vector2.Zero,p.Count));
                    if(!hasN) n.AddRange(Enumerable.Repeat(Vector3.Up,p.Count));
                    if(!hasT) for(int k=0;k<p.Count;k++) t.AddRange(new[]{1f,0f,0f,1f});
                    if(!hasC) c.AddRange(Enumerable.Repeat(Colors.White,p.Count));
                    var ix=arrays[12].AsInt32Array();var keep=new List<int>();
                    V Read(int i)=>new(xf*p[i],n[i],uv[i],c[i],new Vector4(t[i*4],t[i*4+1],t[i*4+2],t[i*4+3]));
                    void Add(V v) {keep.Add(p.Count);p.Add(inv*v.P);n.Add(v.N);uv.Add(v.UV);c.Add(v.C);t.AddRange(new[]{v.T.X,v.T.Y,v.T.Z,v.T.W});}
                    for(int i=0;i<ix.Length;i+=3)
                    {
                        var original=new List<V>{Read(ix[i]),Read(ix[i+1]),Read(ix[i+2])};
                        var pieces=new List<List<V>>{original}; bool hit=false;
                        foreach(var panel in panels)
                        {
                            var next=new List<List<V>>();
                            foreach(var poly in pieces)
                            {
                                // Completely outside one half-space: retain the original triangle and attributes.
                                if(panel.Panel.Planes.Any(pl=>poly.All(v=>v.P.Dot(pl.N)<pl.Offset-.00001f))) {next.Add(poly);continue;}
                                var inside=poly;
                                foreach(var pl in panel.Panel.Planes)
                                {
                                    var outside=Clip(inside,-pl.N,-pl.Offset);
                                    if(outside.Count>=3) next.Add(outside);
                                    inside=Clip(inside,pl.N,pl.Offset);
                                    if(inside.Count<3) break;
                                }
                                if(inside.Count>=3) hit=true;
                            }
                            pieces=next;
                        }
                        if(!hit) {keep.AddRange(new[]{ix[i],ix[i+1],ix[i+2]});continue;}
                        touched++;
                        foreach(var poly in pieces) for(int j=1;j+1<poly.Count;j++)
                        {
                            if((poly[j].P-poly[0].P).Cross(poly[j+1].P-poly[0].P).LengthSquared()<1e-12f) continue;
                            Add(poly[0]);Add(poly[j]);Add(poly[j+1]);
                        }
                    }
                    arrays[0]=p.ToArray();if(hasN) arrays[1]=n.ToArray();if(hasT) arrays[2]=t.ToArray();if(hasC) arrays[3]=c.ToArray();if(hasUv) arrays[4]=uv.ToArray();arrays[12]=keep.ToArray();
                    result.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,arrays);
                    result.SurfaceSetMaterial(s,mesh.SurfaceGetMaterial(s));result.SurfaceSetName(s,mesh.SurfaceGetName(s));
                }
                if(node.Name=="landmark_cathedral_1" || node.Name=="landmark_cathedral_7")
                    foreach(var panel in panels)
                    {
                        var add=node.Name=="landmark_cathedral_1"?panel.Wall:panel.Dress;
                        result.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,add.SurfaceGetArrays(0));
                        result.SurfaceSetMaterial(result.GetSurfaceCount()-1,add.SurfaceGetMaterial(0));
                    }
                if(touched==0) continue;
                result.ResourceName=mesh.ResourceName;
                var path=mesh.ResourcePath;
                var error=ResourceSaver.Save(result,path,ResourceSaver.SaverFlags.Compress);
                if(error!=Error.Ok) throw new Exception($"Save {path}: {error}");
                GD.Print($"SHELL SAVED {path}: replaced {touched} source triangles; surfaces {result.GetSurfaceCount()}");
                changed++;removed+=touched;
            }
            GD.Print($"SHELL BAKE PASS panels={panels.Length} resources={changed} replaced source triangles={removed}");
            GetTree().Quit();
        }
        catch(Exception e) {GD.PrintErr(e);GetTree().Quit(1);}
    }
    private static List<V> Clip(List<V> poly,Vector3 n,float offset)
    {
        var output=new List<V>();
        for(int i=0;i<poly.Count;i++)
        {
            var a=poly[i];var b=poly[(i+1)%poly.Count];float da=a.P.Dot(n)-offset,db=b.P.Dot(n)-offset;
            bool ia=da>=0,ib=db>=0;
            if(ia) output.Add(a);
            if(ia!=ib) output.Add(a.Lerp(b,da/(da-db)));
        }
        return output;
    }
}
