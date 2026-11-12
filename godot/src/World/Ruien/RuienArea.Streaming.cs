using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
namespace Scheldemist.World.Ruien;
/// <summary>Disk reads and visibility of already constructed, content-validated meshes.</summary>
public sealed partial class RuienArea
{
    private readonly Dictionary<MeshInstance3D,string> deferred=new();
    // Several rigid drain mouths share a file. A request belongs to the file, not to an
    // individual copy: a distant copy must never consume another copy's pending load.
    private sealed class Visual
    {
        internal ArrayMesh? Mesh;
        internal readonly HashSet<MeshInstance3D> Users=new();
    }
    private readonly Dictionary<string,Visual> visuals=new(StringComparer.Ordinal);
    private readonly Dictionary<MeshInstance3D,Visual> usingVisual=new();
    internal static RuienArea Streamer(string name)=>new(){Root=new Node3D{Name=name}};
    internal void Prepared(string keyName,string file,string identity,Aabb box,int lod,Transform3D frame)
    {
        var key=Keys.FirstOrDefault(k=>k.Name==keyName);
        if(key==null){key=new Key{Name=keyName,Box=box};Keys.Add(key);}else key.Box=key.Box.Merge(box);
        var mi=new MeshInstance3D{Name=keyName+"_lod"+lod,Transform=frame,Layers=Ruien.Layer,CastShadow=GeometryInstance3D.ShadowCastingSetting.Off,Visible=false};
        mi.SetMeta("ruien_geometry",RuienGeometryCache.PreparedDigest(file));
        mi.SetMeta("ruien_source",identity);mi.SetMeta("ruien_tris",0);mi.SetMeta("ruien_bounds",box.ToString());
        deferred[mi]=file;key.Lods[lod].Add(mi);Root.AddChild(mi);
    }
    private bool Poll(MeshInstance3D mi)
    {
        if(mi.Mesh!=null)return true;
        if(!deferred.TryGetValue(mi,out string? file))return true;
        if(!visuals.TryGetValue(file,out var visual))
        {
            // These are private, validated spool files. Ignore the native weak cache:
            // reusing a resource whose managed wrapper is being finalized can trigger
            // Godot #112067. Keep our wrapper alive for the full period of use instead.
            var error=ResourceLoader.LoadThreadedRequest(file,"ArrayMesh",false,ResourceLoader.CacheMode.Ignore);
            if(error!=Error.Ok)throw new InvalidOperationException("Cannot request Ruien mesh "+file+": "+error);
            visuals.Add(file,visual=new Visual());
        }
        visual.Users.Add(mi);usingVisual[mi]=visual;
        if(visual.Mesh==null&&!Complete(file,visual,Main.I?.Loaded==false))return false;
        mi.Mesh=visual.Mesh;return true;
    }

    private static bool Complete(string file,Visual visual,bool wait=false)
    {
        if(visual.Mesh!=null)return true;
        var state=ResourceLoader.LoadThreadedGetStatus(file);
        if(state==ResourceLoader.ThreadLoadStatus.Failed)throw new InvalidOperationException("Cannot load prepared Ruien mesh "+file);
        if(state!=ResourceLoader.ThreadLoadStatus.Loaded&&!wait)return false;
        var mesh=ResourceLoader.LoadThreadedGet(file) as ArrayMesh??throw new InvalidOperationException("Invalid prepared Ruien mesh "+file);
        for(int s=0;s<mesh.GetSurfaceCount();s++)mesh.SurfaceSetMaterial(s,RuienMaterials.Get(mesh.SurfaceGetName(s)));
        visual.Mesh=mesh;return true;
    }

    private void Release(MeshInstance3D mi)
    {
        mi.Visible=false;
        if(!usingVisual.Remove(mi,out var visual))return;
        mi.Mesh=null;visual.Users.Remove(mi);
    }

    private void RetireUnused()
    {
        foreach(var pair in visuals.Where(p=>p.Value.Users.Count==0).ToArray())
        {
            // A request cannot be cancelled. Drain it once, even if the camera left
            // before it finished, then release this privately loaded resource.
            if(!Complete(pair.Key,pair.Value))continue;
            pair.Value.Mesh!.Dispose();visuals.Remove(pair.Key);
        }
    }

    /// <summary>Each key at the level of detail its distance from the eye asks for.</summary>
    private int Wanted(Key k,Vector3 eye,out float distance)
    {
        distance=k.Box.HasPoint(eye)?0:(eye-Closest(k.Box,eye)).Length();
        if(deferred.Count>0&&distance>130&&Forced<0)return -1;
        int want=distance<Near||k.Lods[1].Count==0?0:1;
        return Forced>=0&&k.Lods[Math.Min(Forced,2)].Count>0?Math.Min(Forced,2):want;
    }

    /// <summary>Proof captures wait for the actual requested meshes, including after a long camera jump.</summary>
    internal IEnumerable<string> PendingVisuals(Vector3 eye)
    {
        foreach(var k in Keys)
        {
            int want=Wanted(k,eye,out _);
            if(want>=0&&(k.Shown!=want||k.Lods[want].Any(mi=>mi.Mesh==null)))yield return k.Name;
        }
    }

    public void Lod(Vector3 eye)
    {
        foreach (var k in Keys)
        {
            int want=Wanted(k,eye,out float d);
            if(want<0)
            {
                foreach(var mi in k.Lods.SelectMany(l=>l))
                    Release(mi);
                k.Shown=-1;continue;
            }
            bool ready=true;foreach(var mi in k.Lods[want])ready=Poll(mi)&&ready;
            // Request the close level early, so crossing the 16 m threshold is seamless.
            if(deferred.Count>0&&d<Near+8)foreach(var mi in k.Lods[0])Poll(mi);
            if(!ready)continue;
            if (want == k.Shown) continue;
            k.Shown = want;
            for (int l = 0; l < k.Lods.Length; l++)
                foreach (var mi in k.Lods[l]) mi.Visible = l == want;
        }
        RetireUnused();
    }

    public void ReleaseVisuals()
    {
        if(deferred.Count==0)return;
        foreach(var pair in deferred)
            Release(pair.Key);
        RetireUnused();
        foreach(var key in Keys)key.Shown=-1;
    }

    private static Vector3 Closest(Aabb b, Vector3 p) => new(Math.Clamp(p.X, b.Position.X, b.End.X), Math.Clamp(p.Y, b.Position.Y, b.End.Y), Math.Clamp(p.Z, b.Position.Z, b.End.Z));
}
