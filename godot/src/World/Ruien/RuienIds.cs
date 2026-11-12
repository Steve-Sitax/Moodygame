using System;
using System.Linq;
namespace Scheldemist.World.Ruien;
/// <summary>New construction owns its marker names; retained authored IDs stay permanent.</summary>
internal static class RuienIds
{
    internal static void Apply(RuienData data)
    {
        using var timing=Dev.StartupTiming.Measure("ruien.marker-ids");
        foreach(var area in data.Areas.Where(a=>a.Id.StartsWith("network_",StringComparison.Ordinal)))
        {
            string Own(string id)=>id.StartsWith(area.Id+"_",StringComparison.Ordinal)?id:area.Id+"_"+id;
            foreach(var source in area.Sources)source.Id=Own(source.Id);
            foreach(var way in area.Ways){way.Id=Own(way.Id);if(way.LightSource.Length>0)way.LightSource=Own(way.LightSource);}
            var hooks=area.LampHooks.Select(Own).ToArray();area.LampHooks.Clear();area.LampHooks.UnionWith(hooks);
        }
        var duplicates=data.Areas.SelectMany(a=>a.Sources).GroupBy(s=>s.Id).Where(g=>g.Count()>1).Select(g=>g.Key).ToArray();
        if(duplicates.Length>0)throw new InvalidOperationException("Duplicate Ruien light markers: "+string.Join(", ",duplicates));
    }
}
