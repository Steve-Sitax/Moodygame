using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Godot;

namespace Scheldemist.World.Ruien;

public static partial class RuienConnections
{
    private static readonly Dictionary<string,List<List<Func<Vector3,float>>>> joins=new();
    private static Dictionary<string,JsonElement>? definitions;
    public static bool NeedsTrim(string area)=>Regions(area).Count>0||definitions![area].TryGetProperty("bedClearances",out _);
    // A new supported walk replaces the narrow strip of bank/coping beneath its landing. Keep one visible
    // surface and matching collision, rather than stacking two differently charted sets of paving.
    private static List<List<Func<Vector3,float>>> Regions(string area)
    {
        if(!joins.TryGetValue(area,out var regions))
        {
            joins[area]=regions=new();
            if(definitions==null)
            {
                using var timing=Dev.StartupTiming.Measure("ruien.connection-definitions");
                using var document=JsonDocument.Parse(Godot.FileAccess.GetFileAsString(RuienData.AreasFile));
                definitions=document.RootElement.GetProperty("areas").EnumerateArray().ToDictionary(a=>a.GetProperty("id").GetString()!,a=>a.Clone());
            }
            var spec=definitions[area];
            // A chamber's outlet kit replaces its original portal, jambs and
            // landing noses through the kit's depth. Leaving both shells puts
            // the short portal's outer arris through the moving gate hinges.
            if(area.StartsWith("network_",StringComparison.Ordinal)
                &&spec.GetProperty("zones")[0].TryGetProperty("rect",out _)
                &&spec.TryGetProperty("gates",out var gates))
                foreach(var gate in gates.EnumerateArray())
                {
                    var o=gate.GetProperty("origin");var n=gate.GetProperty("normal");
                    var origin=new Vector3(o[0].GetSingle(),0,o[1].GetSingle());
                    var inward=-new Vector3(n[0].GetSingle(),0,n[1].GetSingle());var across=Vector3.Up.Cross(inward);
                    var opening=gate.GetProperty("opening").EnumerateArray().ToArray();
                    float lo=opening.Min(p=>p[0].GetSingle()),hi=opening.Max(p=>p[0].GetSingle());
                    float bottom=opening.Min(p=>p[1].GetSingle()),top=opening.Max(p=>p[1].GetSingle());
                    float depth=gate.GetProperty("depth").GetSingle();
                    regions.Add(new(){p=>(p-origin).Dot(across)-lo,p=>hi-(p-origin).Dot(across),
                        p=>(p-origin).Dot(inward)+.65f,p=>depth-(p-origin).Dot(inward),p=>p.Y-bottom,p=>top-p.Y});
                }
            if(spec.TryGetProperty("bridgeRailCuts",out var railCuts))
                foreach(var cut in railCuts.EnumerateArray())
                {
                    Vector3 V(JsonElement v)=>new(v[0].GetSingle(),v[1].GetSingle(),v[2].GetSingle());
                    var a=V(cut.GetProperty("from"));var b=V(cut.GetProperty("to"));var dir=(b-a).Normalized();
                    var across=Vector3.Up.Cross(dir);float half=cut.GetProperty("width").GetSingle()/2,length=a.DistanceTo(b);
                    regions.Add(new(){p=>half-(p-a).Dot(across),p=>half+(p-a).Dot(across),
                        p=>(p-a).Dot(dir),p=>length-(p-a).Dot(dir),p=>p.Y-a.Y-.035f,p=>a.Y+1.35f-p.Y});
                }
            if(spec.TryGetProperty("walkConnections",out var walks))
                foreach(var w in walks.EnumerateArray())
                {
                    if(!w.TryGetProperty("trimImported",out var trim)||!trim.GetBoolean())continue;
                    Vector3 V(JsonElement v)=>new(v[0].GetSingle(),v[1].GetSingle(),v[2].GetSingle());
                    var a=V(w.GetProperty("from"));var b=V(w.GetProperty("to"));var dir=(b-a).Normalized();
                    var across=Vector3.Up.Cross(dir);float half=w.GetProperty("width").GetSingle()/2,length=a.DistanceTo(b);
                    regions.Add(new(){p=>half-(p-a).Dot(across),p=>half+(p-a).Dot(across),
                        p=>(p-a).Dot(dir),p=>length-(p-a).Dot(dir),p=>p.Y-a.Y+.12f,p=>a.Y+.08f-p.Y});
                }
        }
        return regions;
    }
    public static bool TrimImported(Godot.Collections.Array arrays,string area)
    {
        bool changed=false;
        foreach(var region in Regions(area))changed|=QuayNotch.CutSurfaceWith(arrays,Transform3D.Identity,_=>true,region)>0;
        return changed;
    }

    /// <summary>Open the simplified retained collision walls where the visible
    /// side-channel arches already exist. Floors and the authored arch stay intact.</summary>
    public static bool TrimCollisionMouths(Godot.Collections.Array arrays,string area)
    {
        Regions(area);
        if(!definitions![area].TryGetProperty("collisionMouths",out var mouths))return false;
        bool changed=false;
        foreach(var mouth in mouths.EnumerateArray())
        {
            Vector3 V(string key){var p=mouth.GetProperty(key);return new(p[0].GetSingle(),p[1].GetSingle(),p[2].GetSingle());}
            var origin=V("at");var axis=V("axis");var across=Vector3.Up.Cross(axis);
            float half=mouth.GetProperty("half").GetSingle(),spring=mouth.GetProperty("spring").GetSingle(),rise=mouth.GetProperty("rise").GetSingle();
            var planes=new List<Func<Vector3,float>>{p=>.65f-(p-origin).Dot(axis),p=>.65f+(p-origin).Dot(axis),
                p=>half-(p-origin).Dot(across),p=>half+(p-origin).Dot(across),p=>p.Y+6.4f};
            // Polygon chords sit just inside the visible elliptical soffit.
            for(int i=0;i<40;i++)
            {
                float a=i*MathF.PI/40,b=(i+1)*MathF.PI/40;
                var first=new Vector2(half*MathF.Cos(a),spring+rise*MathF.Sin(a));
                var last=new Vector2(half*MathF.Cos(b),spring+rise*MathF.Sin(b));var edge=last-first;
                planes.Add(p=>edge.Cross(new Vector2((p-origin).Dot(across),p.Y)-first));
            }
            changed|=QuayNotch.CutSurfaceWith(arrays,Transform3D.Identity,tri=>
            {
                var normal=(tri.Item2-tri.Item1).Cross(tri.Item3-tri.Item1).Normalized();
                return MathF.Abs(normal.Dot(axis))>.9f;
            },planes)>0;
        }
        return changed;
    }
}
