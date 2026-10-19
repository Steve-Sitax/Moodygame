using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using Godot;

namespace Scheldemist.World.Ruien;

/// <summary>One-time resource repair from an immutable export snapshot; never run during gameplay.</summary>
public static class RuienRepair
{
    public static void Screen(string source)
    {
        var root=ResourceLoader.Load<PackedScene>(source).Instantiate<Node3D>();
        var rack=BakedWorld.All(root).OfType<MeshInstance3D>().Single(m=>m.Name=="quayfurniture_-3,1,0");
        var old=(ArrayMesh)rack.Mesh;var mesh=new ArrayMesh();int removed=0;
        for(int s=0;s<old.GetSurfaceCount();s++)
        {
            var a=old.SurfaceGetArrays(s);var p=a[(int)Mesh.ArrayType.Vertex].AsVector3Array();var ix=a[(int)Mesh.ArrayType.Index].AsInt32Array();
            var keep=Enumerable.Range(0,ix.Length/3).Where(t=>
            {
                if(s!=0 || t<7136 || t>=7168)return true;
                var c=rack.Transform*((p[ix[t*3]]+p[ix[t*3+1]]+p[ix[t*3+2]])/3);
                if(c.X< -148 || c.X> -144.5f || c.Z<77 || c.Z>78)throw new InvalidOperationException("Drying rack source changed.");
                removed++;return false;
            }).SelectMany(t=>new[]{ix[t*3],ix[t*3+1],ix[t*3+2]}).ToArray();
            a[(int)Mesh.ArrayType.Index]=keep;mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,a,null,null,old.SurfaceGetFormat(s));
            mesh.SurfaceSetMaterial(s,old.SurfaceGetMaterial(s));
        }
        if(removed!=32)throw new InvalidOperationException("Drying rack panels not found.");
        rack.Mesh=mesh;
        var net=new MeshInstance3D{Name="vliet_drying_net",Mesh=RuienNet.Make(old.SurfaceGetMaterial(0)),Position=new Vector3(-146.3127f,2.58f,77.425f)};
        root.AddChild(net);net.Owner=root;
        var scene=new PackedScene();scene.Pack(root);
        ResourceSaver.Save(scene,"res://world/town/roots/node-07947.scn",ResourceSaver.SaverFlags.Compress);
        root.Free();
    }
    public static void Convert(string source, string area, string headers)
    {
        string target = ProjectSettings.GlobalizePath($"res://world/ruien/{area}");
        var layout=RuienData.Load().Areas.First(a=>a.Id==area);
        var geometry=layout.Zones.First(z=>z.Kind=="line");
        var areaConfig=JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath(RuienData.AreasFile)))!["areas"]!.AsArray().First(a=>a!["id"]!.GetValue<string>()==area)!;
        if(areaConfig["surfaceRepairPath"] is JsonArray keys)
        {
            // Coverage extends into the hall throat; the authored sweep itself ends before that extension.
            var points=keys.Select(p=>new Vector2(p![0]!.GetValue<float>(),p[1]!.GetValue<float>())).ToArray();
            var path=RuienData.Smooth(points,new[]{false,true,false},3.2f);
            geometry=new RuienData.Zone{S=geometry.S,Path=path,Along=new float[path.Length]};
            for(int i=1;i<path.Length;i++)geometry.Along[i]=geometry.Along[i-1]+path[i].DistanceTo(path[i-1]);
        }
        RuienPaving.Layout(layout);
        var stairs=layout.Ways.Where(w=>w.Kind=="keeper_stair").ToArray();
        var pavedFaces=new List<Vector3>();
        foreach (string path in Directory.GetFiles(source, "mesh_*.res"))
        {
            var old = ResourceLoader.Load<ArrayMesh>(path);
            var mesh = new ArrayMesh { ResourceName = old.ResourceName };
            bool changed = false;
            var paving=new SurfaceTool();paving.Begin(Mesh.PrimitiveType.Triangles);bool paved=false;
            for (int s = 0; s < old.GetSurfaceCount(); s++)
            {
                string family = old.SurfaceGetName(s);
                // The host already carries the seepage masks. Separate flat ribbons fought the relief and
                // produced cut-outs; sacks on the butcher bank were unfinished, smooth closed blobs.
                bool remove = family.Contains("Runoff_") || family.EndsWith("Sacking") && path.Contains("hall_bay0");
                var arrays = old.SurfaceGetArrays(s);
                if(path.Contains("gallery_s2"))
                {
                    // The shaft's helper swapped height and lateral offset, lifting its irons above the street.
                    // The street grate is drawn by RuienKit; the repaired ladder comes from the corrected source.
                    var pos=arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array(); var idx=arrays[(int)Mesh.ArrayType.Index].AsInt32Array();
                    var kept=Enumerable.Range(0,idx.Length/3).Where(t=>(pos[idx[t*3]].Y+pos[idx[t*3+1]].Y+pos[idx[t*3+2]].Y)/3<.1f)
                        .SelectMany(t=>new[]{idx[t*3],idx[t*3+1],idx[t*3+2]}).ToArray();
                    changed|=kept.Length!=idx.Length; remove|=kept.Length==0; arrays[(int)Mesh.ArrayType.Index]=kept;
                }
                if(path.Contains("gallery_s0") || path.Contains("gallery_s1"))
                    foreach(var stair in stairs)
                        changed |= QuayNotch.CutSurfaceWith(arrays,Transform3D.Identity,_=>true,RuienStair.Cut(stair))>0;
                if (path.Contains("gallery_s0"))
                {
                    var p = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
                    var normals = arrays[(int)Mesh.ArrayType.Normal].AsVector3Array();
                    for (int i = 0; i < p.Length; i++)
                    {
                        var before = p[i]; p[i] = Splay(before);
                        if (p[i] == before) continue;
                        changed = true;
                        const float e=.001f;
                        var jacobian=new Basis((Splay(before+Vector3.Right*e)-p[i])/e,(Splay(before+Vector3.Up*e)-p[i])/e,(Splay(before+Vector3.Back*e)-p[i])/e);
                        if(MathF.Abs(jacobian.Determinant())>1e-5f)normals[i]=(jacobian.Inverse().Transposed()*normals[i]).Normalized();
                    }
                    arrays[(int)Mesh.ArrayType.Vertex] = p;
                    arrays[(int)Mesh.ArrayType.Normal] = normals;
                }
                if (family.EndsWith("Brick_loose") && path.Contains("gallery_s"))
                {
                    var p = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
                    var ix = arrays[(int)Mesh.ArrayType.Index].AsInt32Array();
                    var keep = Enumerable.Range(0, ix.Length / 3).Where(t =>
                        (p[ix[t * 3]].Y + p[ix[t * 3 + 1]].Y + p[ix[t * 3 + 2]].Y) / 3 < -3.59f)
                        .SelectMany(t => new[] { ix[t * 3], ix[t * 3 + 1], ix[t * 3 + 2] }).ToArray();
                    changed |= keep.Length != ix.Length;
                    remove |= keep.Length == 0;
                    arrays[(int)Mesh.ArrayType.Index] = keep;
                }
                if (remove) { changed = true; continue; }
                if(path.Contains("gallery_s"))changed|=RuienSurfaceRepair.Apply(arrays,family,geometry);
                if(family.StartsWith("ruien_brick"))
                {
                    bool replaced=RuienPaving.Extract(arrays,paving,path.Contains("lod0")?.045f:.075f);
                    paved|=replaced;changed|=replaced;
                    if(arrays[(int)Mesh.ArrayType.Index].AsInt32Array().Length==0)continue;
                }
                changed|=RuienUv.Repair(arrays,family);
                // Quantised UV attributes re-collapse millimetre bevel charts when the chunk spans many tiles.
                mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays, null, null, old.SurfaceGetFormat(s)&~Mesh.ArrayFormat.FlagCompressAttributes);
                mesh.SurfaceSetName(mesh.GetSurfaceCount() - 1, family);
            }
            if(paved)
            {
                paving.Index();var pm=paving.Commit();
                if(path.Contains("lod0"))pavedFaces.AddRange(pm.GetFaces());
                var pavement=pm.SurfaceGetArrays(0);
                if(path.Contains("gallery_s"))RuienSurfaceRepair.Apply(pavement,"ruien_setts",geometry);
                RuienUv.Repair(pavement,"ruien_setts");
                mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,pavement);
                mesh.SurfaceSetName(mesh.GetSurfaceCount()-1,"ruien_setts");
            }
            if (changed)
            {
                if (mesh.GetSurfaceCount() == 0) throw new InvalidOperationException("Repair removed an entire chunk: " + path);
                ResourceSaver.Save(mesh, Path.Combine(target, Path.GetFileName(path)), ResourceSaver.SaverFlags.Compress);
                GD.Print("ruien repair: " + Path.GetFileName(path));
            }
        }
        var collision = ResourceLoader.Load<ConcavePolygonShape3D>(Path.Combine(source,"collision.res"));
        var faces = collision.Data;
        for (int i=0;i<faces.Length;i+=3)
        {
            var c = (faces[i]+faces[i+1]+faces[i+2])/3;
            if (c.Z < 72 || c.Z > 76.5f || MathF.Abs(c.X+146.1f)>3 || c.Y > -3.4f) continue;
            for(int j=0;j<3;j++) faces[i+j]=Splay(faces[i+j]);
        }
        var ca=new Godot.Collections.Array(); ca.Resize((int)Mesh.ArrayType.Max); ca[(int)Mesh.ArrayType.Vertex]=faces;
        foreach(var stair in stairs) QuayNotch.CutSurfaceWith(ca,Transform3D.Identity,_=>true,RuienStair.Cut(stair));
        foreach(var(u,side) in RuienDrain.Mouths)QuayNotch.CutSurfaceWith(ca,Transform3D.Identity,_=>true,RuienDrain.GutterCut(geometry,u,side));
        // The original collision boxed the entire hall's south wall, including its visible gallery mouth.
        QuayNotch.CutSurfaceWith(ca,Transform3D.Identity,_=>true,new(){p=>p.X+152.5f,p=>-146.5f-p.X,p=>p.Z-109.9f,p=>110.6f-p.Z,p=>p.Y+6.15f,p=>-.95f-p.Y});
        var cp=ca[(int)Mesh.ArrayType.Vertex].AsVector3Array(); var ci=ca[(int)Mesh.ArrayType.Index].AsInt32Array();
        var solid=ci.Select(i=>cp[i]).ToList();
        // The short authored throat was omitted from the simplified collision export. Keep its actual floor
        // and coping faces; no invisible bridge or change to its visible construction.
        foreach(string file in Directory.GetFiles(source,"mesh_*lod1*.res").Where(f=>f.Contains("gallery_s3") || f.Contains("hall_bay10")))
        {
            var mesh=ResourceLoader.Load<ArrayMesh>(file);
            for(int s=0;s<mesh.GetSurfaceCount();s++)
            {
                string family=mesh.SurfaceGetName(s);
                if(!family.Contains("brick") && !family.Contains("bluestone"))continue;
                var a=mesh.SurfaceGetArrays(s);var v=a[(int)Mesh.ArrayType.Vertex].AsVector3Array();var ix=a[(int)Mesh.ArrayType.Index].AsInt32Array();
                for(int i=0;i<ix.Length;i+=3)
                {
                    var p=v[ix[i]];var q=v[ix[i+1]];var r=v[ix[i+2]];var c=(p+q+r)/3;
                    if(c.Z<109.2f || c.Z>110.6f || c.X< -152.5f || c.X> -146.5f || c.Y> -.9f)continue;
                    solid.AddRange(new[]{p,q,r});
                }
            }
        }
        solid.AddRange(pavedFaces);
        ResourceSaver.Save(new ConcavePolygonShape3D{Data=solid.ToArray(),BackfaceCollision=true},Path.Combine(target,"collision.res"),ResourceSaver.SaverFlags.Compress);
        if (headers.Length > 0)
        {
            var merged = new ArrayMesh();
            foreach (var obj in RuienGlb.Read(headers))
            {
                var part = RuienImport.Build(obj, out _);
                if (part == null) continue;
                for (int s = 0; s < part.GetSurfaceCount(); s++)
                {
                    var surface=part.SurfaceGetArrays(s);RuienUv.Repair(surface,part.SurfaceGetName(s));
                    merged.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, surface, null, null, part.SurfaceGetFormat(s)&~Mesh.ArrayFormat.FlagCompressAttributes);
                    merged.SurfaceSetName(merged.GetSurfaceCount() - 1, part.SurfaceGetName(s));
                }
            }
            var areaSpec=JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath(RuienData.AreasFile)))!["areas"]!.AsArray().First(a=>a!["id"]!.GetValue<string>()==area)!;
            if(areaSpec["pavingSeams"] is JsonArray seams && seams.Count>0)
            {
                var stone=new SurfaceTool();stone.Begin(Mesh.PrimitiveType.Triangles);
                foreach(var seam in seams)
                {
                    Vector3 V(JsonNode p)=>new(p[0]!.GetValue<float>(),p[1]!.GetValue<float>(),p[2]!.GetValue<float>());
                    RuienPaving.Border(stone,V(seam!["from"]!),V(seam["to"]!));
                }
                var surface=stone.Commit().SurfaceGetArrays(0);
                surface[(int)Mesh.ArrayType.TexUV]=surface[(int)Mesh.ArrayType.TexUV].AsVector2Array().Select(uv=>uv/2.4f).ToArray();
                surface[(int)Mesh.ArrayType.Color]=surface[(int)Mesh.ArrayType.Vertex].AsVector3Array().Select(_=>new Color(.3f,0,.15f,0)).ToArray();
                merged.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,surface);
                merged.SurfaceSetName(merged.GetSurfaceCount()-1,"ruien_bluestone");
            }
            merged.SetMeta("ruien_solid",true);
            ResourceSaver.Save(merged, "res://world/ruien/kit/drain_headers.res", ResourceSaver.SaverFlags.Compress);
        }
        // Metadata follows the repaired resources, rather than reporting the retired ribbons and sacks.
        var index=JsonNode.Parse(File.ReadAllText(Path.Combine(source,"area.json")))!;
        foreach(var key in index["keys"]!.AsObject())
            foreach(var lod in key.Value!.AsObject())
                foreach(var entry in lod.Value!.AsArray())
                {
                    var mesh=ResourceLoader.Load<ArrayMesh>(Path.Combine(target,entry!["file"]!.GetValue<string>()),cacheMode:ResourceLoader.CacheMode.Ignore);
                    entry["tris"]=Enumerable.Range(0,mesh.GetSurfaceCount()).Sum(s=>mesh.SurfaceGetArrayIndexLen(s)/3);
                    var b=mesh.GetAabb(); entry["box"]=new JsonArray(b.Position.X,b.Position.Y,b.Position.Z,b.End.X,b.End.Y,b.End.Z);
                }
        File.WriteAllText(Path.Combine(target,"area.json"),index.ToJsonString(new(){WriteIndented=true})+"\n");
    }

    private static float SplayFactor(float z) => Math.Clamp((74.5f-z)/2.5f,0,.94f);
    private static Vector3 Splay(Vector3 p)
    {
        float side=p.X+146.1f;
        if(p.Y> -3.4f || p.Z<72 || p.Z>76.5f || MathF.Abs(side)>3) return p;
        // A masonry apron rises smoothly from the deep gallery bed to the vliet bed, without a vertical step.
        float ramp=1-Mathf.SmoothStep(73.5f,76.5f,p.Z);
        p.Y+=Math.Clamp((-5.05f-p.Y)/1.05f,0,1)*1.05f*ramp;
        if(p.Z<=74.5f && MathF.Abs(side)>=1.4f)p.X+=MathF.Sign(side)*(4-MathF.Abs(side))*SplayFactor(p.Z);
        return p;
    }
}
