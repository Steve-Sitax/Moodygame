using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Godot;

namespace Scheldemist.World.Ruien;

public static partial class RuienConnections
{
    private static readonly Dictionary<string,List<List<Func<Vector3,float>>>> joins=new();
    // A new supported walk replaces the narrow strip of bank/coping beneath its landing. Keep one visible
    // surface and matching collision, rather than stacking two differently charted sets of paving.
    public static bool TrimImported(Godot.Collections.Array arrays,string area)
    {
        if(!joins.TryGetValue(area,out var regions))
        {
            joins[area]=regions=new();
            var root=JsonDocument.Parse(Godot.FileAccess.GetFileAsString(RuienData.AreasFile)).RootElement;
            var spec=root.GetProperty("areas").EnumerateArray().Single(a=>a.GetProperty("id").GetString()==area);
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
        bool changed=false;
        foreach(var region in regions)changed|=QuayNotch.CutSurfaceWith(arrays,Transform3D.Identity,_=>true,region)>0;
        return changed;
    }
}
