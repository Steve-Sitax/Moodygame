using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
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
    /// <summary>
    /// One area's repair, from its immutable export snapshot (`source`, never the repaired resources) and, when given,
    /// the corrected fittings glb (`headers`). The generic passes run on every chunk: brick re-charting (RuienUnfold),
    /// narrow-face UVs (RuienUv), calcite and lime variation, dark bluestone bakes, round-shaft collars, the retired
    /// run-off ribbons and the keeper stair cuts; on each line zone's chunks its drains, sealed drains and pipes. An
    /// area's own defects are its `repair.fixes` (<see cref="RuienRepairFix"/>). Writes res://world/ruien/&lt;area&gt;
    /// and the headers piece res://world/ruien/kit/&lt;repair.headersPiece&gt;.res (default drain_headers_&lt;area&gt;).
    /// </summary>
    public static void Convert(string source, string area, string headers, string output = "")
    {
        string target = output.Length > 0 ? Path.GetFullPath(output) : ProjectSettings.GlobalizePath($"res://world/ruien/{area}");
        Directory.CreateDirectory(target);
        if(output.Length>0)
            foreach(var file in Directory.GetFiles(source)) File.Copy(file,Path.Combine(target,Path.GetFileName(file)),true);
        var layout=RuienData.Load().Areas.FirstOrDefault(a=>a.Id==area)??throw new InvalidOperationException($"ruien repair: no area '{area}' in {RuienData.AreasFile}");
        var areaConfig=JsonNode.Parse(File.ReadAllText(ProjectSettings.GlobalizePath(RuienData.AreasFile)))!["areas"]!.AsArray().First(a=>a!["id"]!.GetValue<string>()==area)!;
        var zoneConfig=areaConfig["zones"]!.AsArray().ToDictionary(z=>z!["id"]!.GetValue<string>(),z=>z!);
        // Each line zone's repair geometry: its `repairPath` (the export's own sweep, which may run on past the zone's
        // end into a throat), smoothed with the zone's curve flags and handle, or the zone itself.
        var lines=new List<(RuienData.Zone zone,RuienData.Zone geometry,string[] chunks)>();
        foreach(var zone in layout.Zones.Where(z=>z.Kind=="line"))
        {
            var spec=zoneConfig[zone.Id];var geometry=zone;
            if(spec["repairPath"] is JsonArray keys)
            {
                var points=keys.Select(p=>new Vector2(p![0]!.GetValue<float>(),p[1]!.GetValue<float>())).ToArray();
                var curve=spec["repairCurve"] is JsonArray rc?rc.Select(b=>b!.GetValue<bool>()).ToArray():
                    spec["curve"] is JsonArray zc?zc.Select(b=>b!.GetValue<bool>()).ToArray():new bool[points.Length-1];
                float handle=spec["repairHandle"]?.GetValue<float>()??spec["handle"]?.GetValue<float>()??3.2f;
                var path=RuienData.Smooth(points,curve,handle);
                geometry=new RuienData.Zone{Id=zone.Id,S=zone.S,Path=path,Along=new float[path.Length]};
                for(int i=1;i<path.Length;i++)geometry.Along[i]=geometry.Along[i-1]+path[i].DistanceTo(path[i-1]);
            }
            var chunks=spec["repairChunks"] is JsonArray ch?ch.Select(c=>c!.GetValue<string>()).ToArray():Array.Empty<string>();
            lines.Add((zone,geometry,chunks));
        }
        var built=lines.ToDictionary(l=>l.zone.Id,l=>l.geometry);
        RuienSurfaceRepair.Mouth Resolve(RuienData.Drain d)=>new(built[d.Zone],d.U,d.Side);
        var drains=layout.Drains.Select(d=>(drain:Resolve(d),zone:d.Zone)).ToList();
        // A drain the plan retired (its lining and mouth hole stayed, open to the void): bricked up and its ghost mended.
        var sealedDrains=RuienData.ReadDrains(JsonDocument.Parse(areaConfig.ToJsonString()).RootElement,"sealedDrains",built.ContainsKey)
            .Select(d=>(drain:Resolve(d),zone:d.Zone)).ToList();
        var fixes=RuienRepairFix.Read(areaConfig,layout);
        RuienPaving.Layout(layout,built);
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
        // Which chunks each keeper stair's cut reaches (keeperStairs[].repairChunks; none: every chunk).
        var stairChunks=(areaConfig["keeperStairs"] as JsonArray)?.Select(k=>k!["repairChunks"] is JsonArray c?c.Select(x=>x!.GetValue<string>()).ToArray():Array.Empty<string>()).ToArray()??Array.Empty<string[]>();
                var pipes=RuienPipe.Read(areaConfig,layout);var backed=new HashSet<(string,bool)>();
        var pavedFaces=new List<Vector3>();
        bool In(string file,string[] chunks)=>chunks.Length==0||chunks.Any(file.Contains);
        foreach (string path in Directory.GetFiles(source, "mesh_*.res"))
        {
            string file=Path.GetFileName(path);
            var old = ResourceLoader.Load<ArrayMesh>(path);
            var mesh = new ArrayMesh { ResourceName = old.ResourceName };
            bool changed = false;
            var paving=new SurfaceTool();paving.Begin(Mesh.PrimitiveType.Triangles);bool paved=false;
            bool lod0=file.Contains("lod0");
            // The line zones this chunk belongs to: their drains, sealed drains and pipes are repaired in it.
            var here=lines.Where(l=>In(file,l.chunks)).Select(l=>l.zone.Id).ToHashSet();
            bool line=here.Count>0;
            var mouths=drains.Where(d=>here.Contains(d.zone)).Select(d=>d.drain).ToList();
            var cards=line?DrainCards(old,mouths):new List<Card>();
            var sealedCards=line?DrainCards(old,sealedDrains.Where(d=>here.Contains(d.zone)).Select(d=>d.drain).ToList()):new List<Card>();
            var box=old.GetAabb().Grow(.05f);
            for (int s = 0; s < old.GetSurfaceCount(); s++)
            {
                string family = old.SurfaceGetName(s);
                // The host already carries the seepage masks. Separate flat ribbons fought the relief and
                // produced cut-outs; an area's dropFamily fixes retire its own unfinished props.
                bool remove = family.Contains("Runoff_") || fixes.Any(f=>f.Action=="dropFamily"&&f.Applies(file,family));
                var arrays = old.SurfaceGetArrays(s);
                for(int k=0;k<stairs.Length;k++)
                    if(In(file,k<stairChunks.Length?stairChunks[k]:Array.Empty<string>()))
                    {
                        var stair=stairs[k];
                        changed |= QuayNotch.CutSurfaceWith(arrays,Transform3D.Identity,_=>true,RuienStair.Cut(stair))>0;
                        // The mouth's corner gives way to the native rounded arris (#217).
                        if(RuienStair.ArrisCut(stair,layout.StairZone(stair)) is { } arris)changed |= RuienPatch.Trim(arrays,arris,.025f)>0;
                    }
                bool emptied=false;
                foreach(var fix in fixes)
                    if(RuienRepairFix.Shape.Contains(fix.Action)&&fix.Applies(file,family)&&fix.ApplyShape(arrays,ref changed,ref remove)){emptied=true;break;}
                if(emptied)continue;
                if(family.StartsWith("ruien_brick")&&rings.Count>0)
                {
                    // The decimated flare round each round shaft gives way to RuienKit.Collar (the shaft wall stays).
                    changed|=RuienPatch.Drop(arrays,c=>rings.Any(r=>{float d=new Vector2(c.X,c.Z).DistanceTo(r.Centre);
                        return d>r.Radius+.012f&&d<.66f&&c.Y>r.Rim-.16f&&c.Y<r.Rim+.14f;}))>0;
                    if(arrays[(int)Mesh.ArrayType.Index].AsInt32Array().Length==0){changed=true;continue;}
                }
                if (remove) { changed = true; continue; }
                if(family=="ruien_calcite")changed|=RuienSurfaceRepair.Calcite(arrays);
                if(family=="ruien_bluestone")changed|=ClearDarkBake(arrays,path);
                if(line)
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
                                // The old mouth's header ring reaches 1.2 m out from its axis and up to the crown.
                                return before> -.06f&&before<2.2f&&MathF.Abs(d.Dot(lat))<1.25f&&c.Y> -3.5f+k.Section.WalkOffset&&c.Y< -1.4f+k.Section.WalkOffset;})>0;
                        }
                    if(family=="ruien_brick_stretcher")
                        for(int sc=0;sc<sealedCards.Count;sc++)
                            if(backed.Add(("sealed"+sc,lod0)))
                            {
                                var k=sealedCards[sc];
                                // Brick up the old mouth 12 mm behind the vault face; the stair's own opening stays cut.
                                var lat=Vector3.Up.Cross(k.Axis).Normalized();var plug=new RuienPatch.Tris();
                                Vector3 W(float along,float h){float y=RuienDrain.Invert+h+k.Section.WalkOffset;var q=k.Centre+lat*along+Vector3.Up*(y-k.Centre.Y);
                                    return q-k.Axis*(4.6f+(k.Section.Width/2-3f)-k.Section.Shell(y)-.03f);}
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
                                GD.Print($"ruien repair: old drain mouth bricked up in {file}");
                            }
                    if(family=="ruien_brick_stretcher")
                        foreach(var k in sealedCards)changed|=MendSealed(arrays,k);
                    if(arrays[(int)Mesh.ArrayType.Index].AsInt32Array().Length==0){changed=true;continue;}
                }
                if(line)changed|=RuienSurfaceRepair.Apply(arrays,family,mouths,pipes);
                if(family.StartsWith("ruien_brick"))
                {
                    bool replaced=RuienPaving.Extract(arrays,paving,lod0?.045f:.075f);
                    paved|=replaced;changed|=replaced;
                    if(arrays[(int)Mesh.ArrayType.Index].AsInt32Array().Length==0)continue;
                }
                if(family=="ruien_brick_flemish")
                    foreach(var card in cards)
                    {
                        // The lining darkens towards its old end and runs on round a bend beyond sight.
                        var sample=Lining(arrays,card);
                        RuienPatch.Append(arrays,RuienDrain.Throat(card.Ring,card.Centre,card.Axis,sample,1));
                        changed=true;GD.Print($"ruien repair: drain throat in {file}");
                    }
                if(family=="ruien_brick_stretcher")
                    for(int i=0;i<pipes.Count;i++)
                        if(box.HasPoint(RuienPipe.Wall(pipes[i]))&&backed.Add(("pipe"+i,lod0)))
                        {RuienPatch.Append(arrays,RuienPipe.Backing(pipes[i]));changed=true;}
                // The area's own closing pieces (an outlet's missing jamb stones, a vault left open to the sky).
                foreach(var fix in fixes)
                    if(RuienRepairFix.Close.Contains(fix.Action)&&fix.Applies(file,family))changed|=fix.ApplyClose(arrays,file,lod0,backed);
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
                if(lod0)pavedFaces.AddRange(pm.GetFaces());
                var pavement=pm.SurfaceGetArrays(0);
                if(line)RuienSurfaceRepair.Apply(pavement,"ruien_setts",mouths,pipes);
                RuienUv.Repair(pavement,"ruien_setts",continuous:true);RuienUv.UnfoldFlanks(pavement,"ruien_setts"); // (#214)
                mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,pavement);
                mesh.SurfaceSetName(mesh.GetSurfaceCount()-1,"ruien_setts");
            }
            if (changed)
            {
                if (mesh.GetSurfaceCount() == 0) throw new InvalidOperationException("Repair removed an entire chunk: " + path);
                ResourceSaver.Save(mesh, Path.Combine(target, file), ResourceSaver.SaverFlags.Compress);
                GD.Print("ruien repair: " + file);
            }
        }
        var collision = ResourceLoader.Load<ConcavePolygonShape3D>(Path.Combine(source,"collision.res"));
        var faces = collision.Data;
        foreach(var fix in fixes.Where(f=>f.Action=="splay"))
            for (int i=0;i<faces.Length;i+=3)
            {
                var c = (faces[i]+faces[i+1]+faces[i+2])/3;
                if (!fix.InSplay(c)) continue;
                for(int j=0;j<3;j++) faces[i+j]=fix.Splay(faces[i+j]);
            }
        var ca=new Godot.Collections.Array(); ca.Resize((int)Mesh.ArrayType.Max); ca[(int)Mesh.ArrayType.Vertex]=faces;
        foreach(var stair in stairs)
        {
            QuayNotch.CutSurfaceWith(ca,Transform3D.Identity,_=>true,RuienStair.Cut(stair));
            if(RuienStair.ArrisCut(stair,layout.StairZone(stair)) is { } arris)RuienPatch.Trim(ca,arris,.02f);
        }
        foreach(var(d,_) in drains)QuayNotch.CutSurfaceWith(ca,Transform3D.Identity,_=>true,RuienDrain.GutterCut(d.Zone,d.U,d.Side));
        // An area's collision boxes over openings it shows (a hall wall boxed across its visible gallery mouth).
        foreach(var fix in fixes.Where(f=>f.Action=="cutCollision"))QuayNotch.CutSurfaceWith(ca,Transform3D.Identity,_=>true,fix.CollisionCut());
        var cp=ca[(int)Mesh.ArrayType.Vertex].AsVector3Array(); var ci=ca[(int)Mesh.ArrayType.Index].AsInt32Array();
        var solid=ci.Select(i=>cp[i]).ToList();
        // Geometry the simplified collision export left out (a short authored throat): its actual floor and coping
        // faces, no invisible bridge or change to its visible construction.
        foreach(var fix in fixes.Where(f=>f.Action=="addCollisionFaces"))
        {
            string lod=fix.Spec["lod"]?.GetValue<string>()??"lod1";
            foreach(string file in Directory.GetFiles(source,$"mesh_*{lod}*.res").Where(f=>fix.Chunk(Path.GetFileName(f))))
            {
                var mesh=ResourceLoader.Load<ArrayMesh>(file);
                for(int s=0;s<mesh.GetSurfaceCount();s++)
                {
                    if(!fix.Family(mesh.SurfaceGetName(s)))continue;
                    var a=mesh.SurfaceGetArrays(s);var v=a[(int)Mesh.ArrayType.Vertex].AsVector3Array();var ix=a[(int)Mesh.ArrayType.Index].AsInt32Array();
                    for(int i=0;i<ix.Length;i+=3)
                    {
                        var p=v[ix[i]];var q=v[ix[i+1]];var r=v[ix[i+2]];
                        if(fix.InFaces((p+q+r)/3))solid.AddRange(new[]{p,q,r});
                    }
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
            if(areaConfig["pavingSeams"] is JsonArray seams && seams.Count>0)
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
            // Each area writes its own piece (placed by its `kit` list), so one area's repair never replaces another's.
            string piece=areaConfig["repair"]?["headersPiece"]?.GetValue<string>()??"drain_headers_"+area;
            ResourceSaver.Save(merged, output.Length>0 ? Path.Combine(target,piece+".res") : $"{RuienKit.Dir}/{piece}.res", ResourceSaver.SaverFlags.Compress);
            GD.Print($"ruien repair: headers piece {piece}");
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

    private sealed record Card(Vector3 Centre,Vector3 Axis,Vector3[] Ring,RuienData.Section Section);

    /// <summary>
    /// Bluestone whose study bake came out near black (a bake darker than 0.07 linear, mean byte below 70: the hall's
    /// quoins, plinths and voussoirs, where the study's render saw them buried) drew as black boxes (RU-ruien2, Steve's
    /// 2nd picture). Such a bake is dropped, so the stone shows its own dressed texture like the copings beside it; the
    /// bake's occlusion stays.
    /// </summary>
    private static bool ClearDarkBake(Godot.Collections.Array a,string path)
    {
        if(a[(int)Mesh.ArrayType.Custom0].VariantType!=Variant.Type.PackedByteArray)return false;
        var bake=a[(int)Mesh.ArrayType.Custom0].AsByteArray();int cleared=0;
        for(int i=0;i+3<bake.Length;i+=4)
        {
            int sum=bake[i]+bake[i+1]+bake[i+2];
            if(sum==0||sum>=210)continue;
            bake[i]=bake[i+1]=bake[i+2]=0;cleared++;
        }
        if(cleared==0)return false;
        a[(int)Mesh.ArrayType.Custom0]=bake;
        GD.Print($"ruien repair: {cleared} near-black bluestone bakes dropped in {Path.GetFileName(path)}");
        return true;
    }

    /// <summary>
    /// The bricked-up first drain's ghost (RU-ruien2, Steve's circular scar right of the keeper niche): the vault face
    /// round the old mouth kept the study's bake from when the mouth was open, a dark ring of occlusion and soot that
    /// traced the arch. Inside and just round the plug, the bake and weather masks take the values of the same course
    /// heights further out on the face, faded over 0.3 m, so the wall reads as one bricked-up surface.
    /// </summary>
    private static bool MendSealed(Godot.Collections.Array a,Card k)
    {
        var p=a[(int)Mesh.ArrayType.Vertex].AsVector3Array();
        if(a[(int)Mesh.ArrayType.Custom0].VariantType!=Variant.Type.PackedByteArray)return false;
        var bake=a[(int)Mesh.ArrayType.Custom0].AsByteArray();if(bake.Length!=p.Length*4)return false;
        var col=a[(int)Mesh.ArrayType.Color].VariantType==Variant.Type.Nil?null:a[(int)Mesh.ArrayType.Color].AsColorArray();
        var lat=Vector3.Up.Cross(k.Axis).Normalized();
        // Outside distance from the plug's outline (its rows: -0.08 to 1.72 m over the invert, egg plus 0.62 m),
        // and whether the vertex lies on the vault face there.
        (float edge,bool face,float h) Where(Vector3 v)
        {
            var d=v-k.Centre;float along=MathF.Abs(d.Dot(lat)),h=v.Y-RuienDrain.Invert-k.Section.WalkOffset,before=-d.Dot(k.Axis);
            float half=RuienDrain.EggHalf(Math.Clamp(h,0,1.6f))+.62f;
            float edge=Math.Max(along-half,Math.Max(h-1.72f,-.08f-h));
            return(edge,MathF.Abs(before-(4.6f+(k.Section.Width/2-3f)-k.Section.Shell(v.Y)))<.3f,h);
        }
        // The face's own values by course height, from a band 0.5 to 1.2 m outside the plug.
        var sum=new Dictionary<int,(double r,double g,double b,double a,Color c,int n)>();
        for(int i=0;i<p.Length;i++)
        {
            var (edge,face,h)=Where(p[i]);
            if(!face||edge<.5f||edge>1.2f||bake[i*4+3]==0)continue;
            int band=(int)MathF.Floor(h/.25f);
            var s=sum.GetValueOrDefault(band);
            var c=col!=null?col[i]:new Color(0,0,0,0);
            sum[band]=(s.r+bake[i*4],s.g+bake[i*4+1],s.b+bake[i*4+2],s.a+bake[i*4+3],new Color(s.c.R+c.R,s.c.G+c.G,s.c.B+c.B,s.c.A+c.A),s.n+1);
        }
        if(sum.Count==0)return false;
        int changed=0;
        for(int i=0;i<p.Length;i++)
        {
            var (edge,face,h)=Where(p[i]);
            if(!face||edge>.45f||bake[i*4+3]==0)continue;
            int band=(int)MathF.Floor(h/.25f);
            // The nearest band that has samples (the plug's top rows reach above the sampled face).
            int use=sum.Keys.OrderBy(b=>Math.Abs(b-band)).First();var s=sum[use];
            float w=1-Mathf.SmoothStep(.15f,.45f,edge);
            for(int ch=0;ch<4;ch++)
            {
                double mean=ch switch{0=>s.r,1=>s.g,2=>s.b,_=>s.a}/s.n;
                bake[i*4+ch]=(byte)Math.Clamp(Math.Round(Mathf.Lerp(bake[i*4+ch],(float)mean,w)),ch==3?1:0,255);
            }
            if(col!=null)col[i]=col[i].Lerp(new Color(s.c.R/s.n,s.c.G/s.n,s.c.B/s.n,s.c.A/s.n),w);
            changed++;
        }
        a[(int)Mesh.ArrayType.Custom0]=bake;if(col!=null)a[(int)Mesh.ArrayType.Color]=col;
        if(changed>0)GD.Print($"ruien repair: old drain mouth's ghost evened over {changed} vertices");
        return changed>0;
    }


    /// <summary>The exported drains' flat dark end cards (a fan over the lining's last ring) in one chunk.</summary>
    private static List<Card> DrainCards(ArrayMesh mesh,IReadOnlyList<RuienSurfaceRepair.Mouth> mouths)
    {
        var found=new List<Card>();
        for(int s=0;s<mesh.GetSurfaceCount();s++)
        {
            if(mesh.SurfaceGetName(s)!="ruien_misc_Soot_black")continue;
            var a=mesh.SurfaceGetArrays(s);var p=a[(int)Mesh.ArrayType.Vertex].AsVector3Array();
            var ix=a[(int)Mesh.ArrayType.Index].VariantType==Variant.Type.Nil?Enumerable.Range(0,p.Length).ToArray():a[(int)Mesh.ArrayType.Index].AsInt32Array();
            foreach(var (zone,u,side) in mouths)
            {
                var (c,t)=zone.Frame(u);var n=new Vector2(t.Y,-t.X)*side;var guess=c+n*(4.6f+(zone.S.Width/2-3f));
                var pts=new List<Vector3>();
                for(int i=0;i<ix.Length;i+=3)
                {
                    var m=(p[ix[i]]+p[ix[i+1]]+p[ix[i+2]])/3;
                    if(new Vector2(m.X,m.Z).DistanceTo(guess)>1.4f||m.Y< -3.45f+zone.S.WalkOffset||m.Y> -1.65f+zone.S.WalkOffset)continue;
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
                    var tube=lp.Where(q=>{var d=q-centre;float before=-d.Dot(axis);return before>.15f&&before<1.5f&&MathF.Abs(d.Dot(lat0))<.6f&&q.Y> -3.4f+zone.S.WalkOffset&&q.Y< -1.7f+zone.S.WalkOffset;}).ToArray();
                    if(tube.Length<200)continue;
                    // The tube's centre line: mean position in slices along the guess, fitted by least squares.
                    var near=tube.Where(q=>-(q-centre).Dot(axis)<.6f).ToArray();var far=tube.Where(q=>-(q-centre).Dot(axis)>1.0f).ToArray();
                    if(near.Length<50||far.Length<50)continue;
                    var dir=far.Aggregate(Vector3.Zero,(x,y)=>x+y)/far.Length-near.Aggregate(Vector3.Zero,(x,y)=>x+y)/near.Length;
                    dir.Y=0;if(dir.LengthSquared()>1e-4f){dir=-dir.Normalized();if(dir.Dot(axis)>.97f)axis=dir;}
                }
                var lat=Vector3.Up.Cross(axis).Normalized();
                ring=ring.OrderBy(q=>MathF.Atan2((q-centre).Y,(q-centre).Dot(lat))).ToList();
                found.Add(new Card(centre,axis,ring.ToArray(),zone.S));
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
}
