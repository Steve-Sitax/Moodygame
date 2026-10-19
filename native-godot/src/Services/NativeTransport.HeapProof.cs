#if DEBUG
using System;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

public sealed partial class NativeTransport
{
    // The old schedule walk is an independent regression oracle for call-local trip-point reuse.
    private string VehicleAtOriginal(JsonObject vehicle,int day,double hour)
    {
        if(S(vehicle,"kind")is "dray"or"boat")return"home";var row=C.One("SELECT data_json FROM resident WHERE id=$p0",S(vehicle,"owner"));if(row==null)return"home";var resident=JsonNode.Parse(S(row,"data_json","{}"))!;
        double h=((hour%24)+24)%24;int previousDay=day<=1?7:day-1;bool late=A(resident["sched"]?[previousDay%7==0?"sunday":"day"]).Any(n=>n is JsonArray seg&&V(seg[1])>24&&h+24>=V(seg[0])&&h+24<V(seg[1]));var keys=DayKeys(resident,late?previousDay:day);double now=late?h+24:h;bool cart=S(vehicle,"kind")=="handcart";string at="home",prev="home";
        foreach(var k in keys){if(k.from>now)break;if(k.key==prev)continue;bool outside=at!="home",far=false,load=false;var points=TripPoints?.Invoke(S(vehicle,"id"))??Data["tripPoints"]?[S(vehicle,"id")];var a=A(points?[prev]);var b=A(points?[k.key]);if(!cart&&a.Count>=2&&b.Count>=2)far=D(V(a[0]),V(a[1]),V(b[0]),V(b[1]))>300;
            if(cart&&new[]{"market_woman","fishwife","grocer","dealer"}.Contains(S(resident,"trade")))load=prev=="home"&&k.key.StartsWith("work")||prev.StartsWith("work")&&k.key=="home";
            bool takes=at==prev && vehicle["parks"]?[k.key]!=null && (outside&&(!cart||k.key=="home")||far||load);if(takes)at=k.key;
            // (#198: a handcart left where she was for a stop with no place for it, a tavern after the market, went nowhere again:
            // she takes it home first, as the town's journeys do)
            else if(cart&&at==prev&&at!="home"&&vehicle["parks"]?[k.key]==null)at="home";
            prev=k.key;}
        return at;
    }

    internal JsonObject VehicleAtHeapProof(JsonObject record, JsonObject currentPoints)
    {
        var previous = TripPoints;
        int comparisons = 0, reads = 0, originalReads = 0, cachedReads = 0;
        try
        {
            TripPoints = id => { reads++; return currentPoints[id]?.AsObject() ?? new(); };
            foreach (var node in A(record["vehicles"]))
            foreach (int day in new[] { 1, 2, 7 })
            for (double hour = -1; hour <= 25; hour += .25)
            {
                var vehicle = node!.AsObject();
                reads = 0; string before = VehicleAtOriginal(vehicle, day, hour); originalReads += reads;
                reads = 0; string after = VehicleAt(vehicle, day, hour); cachedReads += reads;
                if (before != after || reads > 1 || S(vehicle,"kind") == "handcart" && reads != 0)
                    throw new InvalidOperationException("Vehicle position or bounded trip-point reads changed");
                comparisons++;
            }
            // No provider uses the authored fallback; null results also stay local to the current query.
            foreach (bool missingProvider in new[] { true, false })
            {
                TripPoints = missingProvider ? null : _ => null!;
                foreach (var node in A(record["vehicles"]))
                foreach (double hour in new[] { 0.0, 8, 13, 18, 23.5, 25 })
                {
                    var vehicle = node!.AsObject();
                    if (VehicleAtOriginal(vehicle, 1, hour) != VehicleAt(vehicle, 1, hour))
                        throw new InvalidOperationException("Vehicle fallback trip points changed");
                    comparisons++;
                }
            }
            return new() { ["ok"] = true, ["comparisons"] = comparisons, ["originalReads"] = originalReads, ["cachedReads"] = cachedReads };
        }
        finally { TripPoints = previous; }
    }
}
#endif
