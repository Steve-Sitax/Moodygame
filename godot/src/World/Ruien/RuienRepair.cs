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
        RuienPaving.Layout(layout,geometry);
        // Round grates with a brick collar in the vault crown take ring courses (areas.json grates[].collar).
        var rings=new List<RuienUnfold.Ring>();
        if(areaConfig["grates"] is JsonArray grateList)
            foreach(var g in grateList)
                if(g!["collar"] is JsonObject collar)
                {
                    var at=g["at"]!.AsArray();float size=g["size"]!.GetValue<float>();
                    rings.Add(new RuienUnfold.Ring(new Vector2(at[0]!.GetValue<float>(),at[2]!.GetValue<float>()),size/2,
                        collar["outer"]!.GetValue<float>(),collar["rim"]!.GetValue<float>(),at[1]!.GetValue<float>()+.2f));
                }
        var stairs=layout.Ways.Where(w=>w.Kind=="keeper_stair").ToArray();
        var pipes=RuienPipe.Read(areaConfig);var backed=new HashSet<(int,bool)>();
        var pavedFaces=new List<Vector3>();
        foreach (string path in Directory.GetFiles(source, "mesh_*.res"))
        {
            var old = ResourceLoader.Load<ArrayMesh>(path);
            var mesh = new ArrayMesh { ResourceName = old.ResourceName };
            bool changed = false;
            var paving=new SurfaceTool();paving.Begin(Mesh.PrimitiveType.Triangles);bool paved=false;
            bool lod0=path.Contains("lod0");
            var cards=path.Contains("gallery_s")?DrainCards(old,geometry,RuienDrain.Mouths):new List<Card>();
            // The study's first drain (u 9.2) became the keeper landing: its lining and mouth hole stayed, open to the void.
            var sealedCards=path.Contains("gallery_s")?DrainCards(old,geometry,new[]{(9.2f,-1)}):new List<Card>();
            var box=old.GetAabb().Grow(.05f);
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
                if((path.Contains("hall_bay03")||path.Contains("hall_bay13"))&&(family.StartsWith("ruien_brick_header")||family=="ruien_calcite"))
                {
                    // When the hall stair moved into the street its well cut a rib open: the rib's top and its crust
                    // hung inside the well, seen from below through the missing soffit. The well's own walls stay.
                    changed|=RuienPatch.Drop(arrays,c=>c.X> -154.07f&&c.X< -152.93f&&c.Z>134.2f&&c.Z<136.8f&&c.Y> -1.55f&&c.Y< -.8f)>0;
                    if(arrays[(int)Mesh.ArrayType.Index].AsInt32Array().Length==0){changed=true;continue;}
                }
                if(family.StartsWith("ruien_brick")&&rings.Count>0)
                {
                    // The decimated flare round each round shaft gives way to RuienKit.Collar (the shaft wall stays).
                    changed|=RuienPatch.Drop(arrays,c=>rings.Any(r=>{float d=new Vector2(c.X,c.Z).DistanceTo(r.Centre);
                        return d>r.Radius+.012f&&d<.66f&&c.Y>r.Rim-.16f&&c.Y<r.Rim+.14f;}))>0;
                    if(arrays[(int)Mesh.ArrayType.Index].AsInt32Array().Length==0){changed=true;continue;}
                }
                if (remove) { changed = true; continue; }
                if(family=="ruien_calcite")changed|=RuienSurfaceRepair.Calcite(arrays);
                if(path.Contains("gallery_s"))
                {
                    // The closed outlets and the drains' flat end cards make way for open bores and throats.
                    changed|=RuienPipe.Retire(arrays,family,pipes);
                    if(family=="ruien_misc_Soot_black"&&cards.Count+sealedCards.Count>0)
                        changed|=RuienPatch.Drop(arrays,c=>cards.Concat(sealedCards).Any(k=>c.DistanceTo(k.Centre)<1.0f&&MathF.Abs((c-k.Centre).Dot(k.Axis))<.08f))>0;
                    if(family=="ruien_brick_flemish")
                        foreach(var k in sealedCards)
                        {
                            var lat=Vector3.Up.Cross(k.Axis).Normalized();
                            changed|=RuienPatch.Drop(arrays,c=>{var d=c-k.Centre;float before=-d.Dot(k.Axis);
                                return before> -.03f&&before<2.0f&&MathF.Abs(d.Dot(lat))<.62f&&c.Y> -3.42f&&c.Y< -1.68f;})>0;
                        }
                    if(family=="ruien_brick_stretcher")
                        foreach(var k in sealedCards)
                            if(backed.Add((100,lod0)))
                            {
                                // Brick up the old mouth 12 mm behind the vault face; the stair's own opening stays cut.
                                var lat=Vector3.Up.Cross(k.Axis).Normalized();var plug=new RuienPatch.Tris();
                                Vector3 W(float along,float h){float y=RuienDrain.Invert+h;var q=k.Centre+lat*along+Vector3.Up*(y-k.Centre.Y);
                                    return q-k.Axis*(4.6f-RuienDrain.Shell(y)-.03f);}
                                const int rows=24;
                                for(int r=0;r<rows;r++)
                                {
                                    float h0=-.08f+1.8f*r/rows,h1=-.08f+1.8f*(r+1)/rows;
                                    float w0=Math.Max(RuienDrain.EggHalf(Math.Clamp(h0,0,1.6f)),RuienDrain.EggHalf(Math.Clamp(h1,0,1.6f)))+.62f,w1=w0;
                                    for(int cI=0;cI<12;cI++)
                                    {
                                        float a0=-w0+2*w0*cI/12,a1=-w0+2*w0*(cI+1)/12;
                                        var n=-k.Axis;
                                        plug.Tri(W(a0,h0),W(a1,h0),W(a1,h1),n,new Color(.4f,.05f,.3f,0),.85f);
                                        plug.Tri(W(a0,h0),W(a1,h1),W(a0,h1),n,new Color(.4f,.05f,.3f,0),.85f);
                                    }
                                }
                                var cut=RuienPatch.ToArrays(plug);
                                foreach(var stair in stairs)QuayNotch.CutSurfaceWith(cut,Transform3D.Identity,_=>true,RuienStair.Cut(stair));
                                RuienPatch.Append(arrays,RuienPatch.FromArrays(cut));changed=true;
                                GD.Print($"ruien repair: old drain mouth bricked up in {Path.GetFileName(path)}");
                            }
                    if(arrays[(int)Mesh.ArrayType.Index].AsInt32Array().Length==0){changed=true;continue;}
                }
                if(path.Contains("gallery_s"))changed|=RuienSurfaceRepair.Apply(arrays,family,geometry,pipes);
                if(family.StartsWith("ruien_brick"))
                {
                    bool replaced=RuienPaving.Extract(arrays,paving,path.Contains("lod0")?.045f:.075f);
                    paved|=replaced;changed|=replaced;
                    if(arrays[(int)Mesh.ArrayType.Index].AsInt32Array().Length==0)continue;
                }
                if(family=="ruien_brick_flemish")
                    foreach(var card in cards)
                    {
                        // The lining darkens towards its old end and runs on round a bend beyond sight.
                        var sample=Lining(arrays,card);
                        RuienPatch.Append(arrays,RuienDrain.Throat(card.Ring,card.Centre,card.Axis,sample,1));
                        changed=true;GD.Print($"ruien repair: drain throat in {Path.GetFileName(path)}");
                    }
                if(family=="ruien_brick_stretcher")
                    for(int i=0;i<pipes.Count;i++)
                        if(box.HasPoint(RuienPipe.Wall(pipes[i]))&&backed.Add((i,lod0)))
                        {RuienPatch.Append(arrays,RuienPipe.Backing(pipes[i]));changed=true;}
                if(family=="ruien_bluestone"&&path.Contains("outlet_gate"))
                {
                    // Close the slots between the outlet's coping blocks and jamb stones, where brick showed through.
                    var stone=new RuienPatch.Tris();
                    foreach(float x in new[]{-147.757f,-144.443f})
                        RuienPatch.Box(stone,new Vector3(.38f,.29f,.085f),.006f,new Transform3D(Basis.Identity,new Vector3(x,-3.752f,72.522f)),new Color(.35f,.04f,.25f,0),.7f,2.4f);
                    RuienPatch.Append(arrays,stone);changed=true;
                }
                if(family=="ruien_brick_stretcher"&&path.Contains("hall_bay23")&&backed.Add((200,lod0)))
                {
                    // The study left a strip of the east side channel's mouth vault open beside its arch ring
                    // (x -145.2..-144.5, z 138-139.2): sky showed through. Close it 3 cm above the intrados.
                    var strip=new RuienPatch.Tris();const float cx=-143.1f,a=3f,b=2.5f,spring=-3.4f;
                    Vector3 V(float x,float z){float u=(x-cx)/a;return new Vector3(x,spring+b*MathF.Sqrt(Math.Max(0,1-u*u))+.03f,z);}
                    Vector3 N(float x){float u=(x-cx)/a;float y=b*MathF.Sqrt(Math.Max(0,1-u*u));return -new Vector3((x-cx)/(a*a),y/(b*b),0).Normalized();}
                    for(int i=0;i<14;i++)
                    {
                        float x0=-145.75f+i*.1f,x1=x0+.1f;
                        foreach(var (z0,z1) in new[]{(137.98f,138.6f),(138.6f,139.27f)})
                        {
                            strip.Tri(V(x0,z0),V(x1,z0),V(x1,z1),N((x0+x1)/2),new Color(.3f,.05f,.3f,0),.7f);
                            strip.Tri(V(x0,z0),V(x1,z1),V(x0,z1),N((x0+x1)/2),new Color(.3f,.05f,.3f,0),.7f);
                        }
                    }
                    RuienPatch.Append(arrays,strip);changed=true;
                }
                if(family=="ruien_brick_stretcher"&&path.Contains("hall_side_"))
                {
                    // Each side channel's mouth ring is loose headers with open joints; a backing ring 4 cm above the
                    // intrados, through the wall's thickness, shows brick through them instead of the sky.
                    var mouths=new (string id,Vector3 plane,Vector3 axis)[]{("side_e",new(-143.1f,0,138f),Vector3.Back),
                        ("side_ne",new(-140.5f,0,113.75f),Vector3.Right),("side_sw",new(-159.5f,0,127.68f),Vector3.Left)};
                    for(int m=0;m<mouths.Length;m++)
                    {
                        var (id,plane,ax)=mouths[m];
                        if(!path.Contains("hall_"+id+"_")||!backed.Add((300+m,lod0)))continue;
                        var lat=Vector3.Up.Cross(ax).Normalized();var ring=new RuienPatch.Tris();
                        Vector3 V(float s,float d){float u=s/3f;return plane+lat*s+ax*d+Vector3.Up*(-3.4f+2.5f*MathF.Sqrt(Math.Max(0,1-u*u))+.04f);}
                        Vector3 Nn(float s){float u=s/3f;float y=2.5f*MathF.Sqrt(Math.Max(0,1-u*u));return -(lat*(s/9f)+Vector3.Up*(y/6.25f)).Normalized();}
                        for(int i=0;i<40;i++)
                        {
                            float s0=-2.95f+i*5.9f/40,s1=s0+5.9f/40;
                            ring.Tri(V(s0,-.01f),V(s1,-.01f),V(s1,.45f),Nn((s0+s1)/2),new Color(.3f,.05f,.3f,0),.6f);
                            ring.Tri(V(s0,-.01f),V(s1,.45f),V(s0,.45f),Nn((s0+s1)/2),new Color(.3f,.05f,.3f,0),.6f);
                        }
                        RuienPatch.Append(arrays,ring);changed=true;
                    }
                }
                // One unfolded metric chart per connected surface: the bond runs on across exported objects.
                if(RuienUnfold.Bricks(family))changed|=RuienUnfold.Apply(arrays,family,rings);
                if(RuienUnfold.Bricks(family))changed|=RuienSurfaceRepair.VaryLime(arrays);
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
                if(path.Contains("gallery_s"))RuienSurfaceRepair.Apply(pavement,"ruien_setts",geometry,pipes);
                RuienUv.Repair(pavement,"ruien_setts",continuous:true);
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
                    // B2's decimated header rings and their bed are replaced by RuienDrain's native rowlock ring.
                    if(part.SurfaceGetName(s) is "ruien_brick_header" or "ruien_misc_Mortar_header")continue;
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

    private sealed record Card(Vector3 Centre,Vector3 Axis,Vector3[] Ring);

    /// <summary>The exported drains' flat dark end cards (a fan over the lining's last ring) in one chunk.</summary>
    private static List<Card> DrainCards(ArrayMesh mesh,RuienData.Zone zone,IEnumerable<(float u,int side)> mouths)
    {
        var found=new List<Card>();
        for(int s=0;s<mesh.GetSurfaceCount();s++)
        {
            if(mesh.SurfaceGetName(s)!="ruien_misc_Soot_black")continue;
            var a=mesh.SurfaceGetArrays(s);var p=a[(int)Mesh.ArrayType.Vertex].AsVector3Array();
            var ix=a[(int)Mesh.ArrayType.Index].VariantType==Variant.Type.Nil?Enumerable.Range(0,p.Length).ToArray():a[(int)Mesh.ArrayType.Index].AsInt32Array();
            foreach(var (u,side) in mouths)
            {
                var (c,t)=zone.Frame(u);var n=new Vector2(t.Y,-t.X)*side;var guess=c+n*4.6f;
                var pts=new List<Vector3>();
                for(int i=0;i<ix.Length;i+=3)
                {
                    var m=(p[ix[i]]+p[ix[i+1]]+p[ix[i+2]])/3;
                    if(new Vector2(m.X,m.Z).DistanceTo(guess)>1.4f||m.Y< -3.45f||m.Y> -1.65f)continue;
                    pts.AddRange(new[]{p[ix[i]],p[ix[i+1]],p[ix[i+2]]});
                }
                if(pts.Count<45)continue;
                var groups=pts.GroupBy(q=>(MathF.Round(q.X*1000),MathF.Round(q.Y*1000),MathF.Round(q.Z*1000))).ToList();
                var unique=groups.Select(g=>g.First()).ToList();
                // The fan's centre is the corner every triangle shares.
                var centre=groups.OrderByDescending(g=>g.Count()).First().First();
                var ring=unique.Where(q=>q!=centre).ToList();
                var axis=new Vector3(n.X,0,n.Y).Normalized();
                // The card is flat: its own normal is the drain's axis (the zone path only approximates the study's,
                // which bends here).
                var sum=Vector3.Zero;
                for(int i=0;i+2<pts.Count;i+=3)sum+=(pts[i+1]-pts[i]).Cross(pts[i+2]-pts[i]);
                sum.Y=0;if(sum.LengthSquared()>1e-8f){sum=sum.Normalized();axis=sum.Dot(axis)<0?-sum:sum;}
                // Refine the drain's axis from its own lining tube.
                for(int s2=0;s2<mesh.GetSurfaceCount();s2++)
                {
                    if(mesh.SurfaceGetName(s2)!="ruien_brick_flemish")continue;
                    var lp=mesh.SurfaceGetArrays(s2)[(int)Mesh.ArrayType.Vertex].AsVector3Array();
                    var lat0=Vector3.Up.Cross(axis).Normalized();
                    var tube=lp.Where(q=>{var d=q-centre;float before=-d.Dot(axis);return before>.15f&&before<1.5f&&MathF.Abs(d.Dot(lat0))<.6f&&q.Y> -3.4f&&q.Y< -1.7f;}).ToArray();
                    if(tube.Length<200)continue;
                    // The tube's centre line: mean position in slices along the guess, fitted by least squares.
                    var near=tube.Where(q=>-(q-centre).Dot(axis)<.6f).ToArray();var far=tube.Where(q=>-(q-centre).Dot(axis)>1.0f).ToArray();
                    if(near.Length<50||far.Length<50)continue;
                    var dir=far.Aggregate(Vector3.Zero,(x,y)=>x+y)/far.Length-near.Aggregate(Vector3.Zero,(x,y)=>x+y)/near.Length;
                    dir.Y=0;if(dir.LengthSquared()>1e-4f){dir=-dir.Normalized();if(dir.Dot(axis)>.97f)axis=dir;}
                }
                var lat=Vector3.Up.Cross(axis).Normalized();
                ring=ring.OrderBy(q=>MathF.Atan2((q-centre).Y,(q-centre).Dot(lat))).ToList();
                found.Add(new Card(centre,axis,ring.ToArray()));
            }
        }
        return found;
    }

    /// <summary>
    /// Darken the exported lining towards its old end ring, and sample its weather and bake there for the throat.
    /// </summary>
    private static Func<Vector3,(Color,byte[])> Lining(Godot.Collections.Array a,Card card)
    {
        var p=a[(int)Mesh.ArrayType.Vertex].AsVector3Array();
        var col=a[(int)Mesh.ArrayType.Color].VariantType==Variant.Type.Nil?p.Select(_=>new Color(0,0,0,0)).ToArray():a[(int)Mesh.ArrayType.Color].AsColorArray();
        var bake=a[(int)Mesh.ArrayType.Custom0].VariantType==Variant.Type.PackedByteArray?a[(int)Mesh.ArrayType.Custom0].AsByteArray():new byte[p.Length*4];
        if(bake.Length!=p.Length*4)bake=new byte[p.Length*4];
        var lat=Vector3.Up.Cross(card.Axis).Normalized();
        float y0=card.Ring.Min(q=>q.Y)-.06f,y1=card.Ring.Max(q=>q.Y)+.06f;
        var inside=new List<int>();
        for(int i=0;i<p.Length;i++)
        {
            var d=p[i]-card.Centre;float before=-d.Dot(card.Axis);
            if(before< -.02f||before>1.9f||MathF.Abs(d.Dot(lat))>.62f||p[i].Y<y0||p[i].Y>y1)continue;
            inside.Add(i);
            float k=Mathf.Lerp(.38f,1f,MathF.Pow(Math.Clamp(before/1.6f,0,1),.8f));
            bake[i*4+3]=(byte)Math.Clamp(MathF.Round((bake[i*4+3]==0?255:bake[i*4+3])*k),1,255);
            var c=col[i];float wet=1-Math.Clamp(before/1.6f,0,1);
            col[i]=new Color(Math.Max(c.R,.5f*wet),c.G,Math.Max(c.B,.35f*wet),c.A);
        }
        a[(int)Mesh.ArrayType.Custom0]=bake;a[(int)Mesh.ArrayType.Color]=col;
        return q=>
        {
            int best=-1;float bd=float.MaxValue;
            foreach(int i in inside){float d=p[i].DistanceSquaredTo(q);if(d<bd){bd=d;best=i;}}
            if(best<0)return (new Color(.6f,0,.4f,0),new byte[]{0,0,0,96});
            return (col[best],new[]{bake[best*4],bake[best*4+1],bake[best*4+2],bake[best*4+3]});
        };
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
