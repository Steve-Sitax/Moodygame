using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Godot;

namespace Scheldemist.World.Ruien;

/// <summary>
/// An area's converted export (res://world/ruien/&lt;area&gt;, RuienImport): its meshes by key, each key's levels of
/// detail switched together by the eye's distance to the key's box (no hole and no double where two levels' pieces
/// differ), every surface given its family's shared material, and its collision.
/// </summary>
public sealed class RuienArea
{
    /// <summary>The nearest a key is drawn in full detail (m from the eye to its box); past it the lighter level.</summary>
    public const float Near = 16;

    public sealed class Key
    {
        public string Name = "";
        public Aabb Box;
        public readonly List<MeshInstance3D>[] Lods = { new(), new(), new() };
        public int Shown = -1;
    }

    public readonly List<Key> Keys = new();
    /// <summary>Dev (--ruien-lod N): every key at that level, to measure what each costs.</summary>
    public static readonly int Forced = int.TryParse(Main.I?.Arg("ruien-lod"), out int f) ? f : -1;
    public Node3D Root = null!;
    public ConcavePolygonShape3D? Shape;
    public int Triangles0, Triangles1;

    public static RuienArea? Load(RuienData.Area area)
    {
        if (!area.Exported) return null;
        string index = area.Export + "/area.json";
        if (!Godot.FileAccess.FileExists(index)) return null;
        var a = new RuienArea { Root = new Node3D { Name = "ruien_" + area.Id } };
        var keys = JsonDocument.Parse(Godot.FileAccess.GetFileAsString(index)).RootElement.GetProperty("keys");
        foreach (var k in keys.EnumerateObject())
        {
            if (area.SkipKeys.Contains(k.Name)) continue;
            var key = new Key { Name = k.Name };
            bool first = true;
            foreach (var lod in k.Value.EnumerateObject())
            {
                int l = Math.Clamp(int.Parse(lod.Name[3..]), 0, 2);
                foreach (var e in lod.Value.EnumerateArray())
                {
                    string source=area.Export + "/" + e.GetProperty("file").GetString();
                    var mesh=RuienGeometryCache.Get(source,area.Id,()=>
                    {
                    var original = ResourceLoader.Load<ArrayMesh>(source) ?? new ArrayMesh();
                    if(original.GetAabb().End.Y>RuienSurround.Bottom-.015f || RuienEntrance.All.Any(s=>s.ConnectArea==area.Id))
                    {
                        var repaired=new ArrayMesh();
                        for(int s=0;s<original.GetSurfaceCount();s++)
                        {
                            var arrays=original.SurfaceGetArrays(s);
                            string family=original.SurfaceGetName(s);
                            RuienStreetClosure.Trim(arrays,area);
                            RuienConnections.TrimImported(arrays,area.Id);
                            RuienEntrance.TrimConnected(arrays,area.Id);
                            // Keep the hall's continuous handrail; only the masonry lining is replaced by the new cap.
                            if(family.Contains("brick")||family.Contains("bluestone"))RuienSurround.Trim(arrays,area);
                            // The export's thick hall leaves give way to RuienSurround.Leaves; the handrail stays.
                            RuienSurround.DropExportLeaves(arrays,area,family);
                            if(arrays[(int)Mesh.ArrayType.Index].AsInt32Array().Length==0)continue;
                            repaired.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,arrays,null,null,original.SurfaceGetFormat(s)&~Mesh.ArrayFormat.FlagCompressAttributes);
                            repaired.SurfaceSetName(repaired.GetSurfaceCount()-1,original.SurfaceGetName(s));
                        }
                        return repaired;
                    }
                    return original;
                    });
                    if(mesh.GetSurfaceCount()==0)continue;
                    for (int s = 0; s < mesh.GetSurfaceCount(); s++) mesh.SurfaceSetMaterial(s, RuienMaterials.Get(mesh.SurfaceGetName(s)));
                    var mi = new MeshInstance3D { Name = e.GetProperty("file").GetString()!.Replace(".res", ""), Mesh = mesh, Layers = Ruien.Layer, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off, Visible = false };
                    a.Root.AddChild(mi);
                    key.Lods[l].Add(mi);
                    int tris = e.GetProperty("tris").GetInt32();
                    if (l == 0) a.Triangles0 += tris; else a.Triangles1 += tris;
                    var b = e.GetProperty("box").EnumerateArray().Select(x => x.GetSingle()).ToArray();
                    var box = new Aabb(new Vector3(b[0], b[1], b[2]), new Vector3(b[3] - b[0], b[4] - b[1], b[5] - b[2]));
                    key.Box = first ? box : key.Box.Merge(box);
                    first = false;
                }
            }
            a.Keys.Add(key);
        }
        string col = area.Export + "/collision.res";
        if(ResourceLoader.Exists(col))
        {
            a.Shape=RuienGeometryCache.Get(col,area.Id,()=>
            {
            var original=ResourceLoader.Load<ConcavePolygonShape3D>(col);
            using var arrays=new Godot.Collections.Array();arrays.Resize((int)Mesh.ArrayType.Max);
            arrays[(int)Mesh.ArrayType.Vertex]=original.Data;
            bool trimmed=RuienStreetClosure.Trim(arrays,area);
            trimmed|=RuienConnections.TrimImported(arrays,area.Id);
            trimmed|=RuienEntrance.TrimConnected(arrays,area.Id);
            trimmed|=RuienSurround.Trim(arrays,area);
            trimmed|=RuienSurround.DropExportLeaves(arrays,area,null);
            if(trimmed)
            {
                var p=arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();var ix=arrays[(int)Mesh.ArrayType.Index].AsInt32Array();
                return new ConcavePolygonShape3D{Data=ix.Select(i=>p[i]).ToArray(),BackfaceCollision=true};
            }
            return original;
            });
        }
        return a;
    }

    /// <summary>Each key at the level of detail its distance from the eye asks for.</summary>
    public void Lod(Vector3 eye)
    {
        foreach (var k in Keys)
        {
            float d = k.Box.HasPoint(eye) ? 0 : (eye - Closest(k.Box, eye)).Length();
            int want = d < Near || k.Lods[1].Count == 0 ? 0 : 1;
            if (Forced >= 0) want = k.Lods[Math.Min(Forced, 2)].Count > 0 ? Math.Min(Forced, 2) : want;
            if (want == k.Shown) continue;
            k.Shown = want;
            for (int l = 0; l < k.Lods.Length; l++)
                foreach (var mi in k.Lods[l]) mi.Visible = l == want;
        }
    }

    private static Vector3 Closest(Aabb b, Vector3 p) => new(Math.Clamp(p.X, b.Position.X, b.End.X), Math.Clamp(p.Y, b.Position.Y, b.End.Y), Math.Clamp(p.Z, b.Position.Z, b.End.Z));
}
