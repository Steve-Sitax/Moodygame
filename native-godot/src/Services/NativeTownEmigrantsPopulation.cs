using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
namespace Scheldemist.Native.Services;

/// <summary>Current native doors and shared resident intake for the emigrants' persistent lifecycle.</summary>
public sealed class NativeTownEmigrantsPopulation
{

    private readonly NativeEmigrants emigrants;
    public NativeTownEmigrantsPopulation(NativeTownPopulation population,NativeEmigrants emigrants)
    {
        this.emigrants=emigrants;
        emigrants.Doors=()=>population.Doors;
        emigrants.InworldHouses=()=>NativeTownPopulation.A(population.Kept["houses"]).Select(h=>(int)NativeTownPopulation.N(h?["house"])).ToHashSet();
        emigrants.Snap=(x,z,max)=>population.Snap(x,z,max);
        emigrants.SaveResident=person=>population.AddResident(person,NativeGoods.S(emigrants.Facts["labels"],NativeGoods.S(person,"trade")),"rijnkaai");
        emigrants.Invalidate=population.Town.Clear;
    }
    public void Ensure(uint seed)=>emigrants.Ensure(seed);
}

