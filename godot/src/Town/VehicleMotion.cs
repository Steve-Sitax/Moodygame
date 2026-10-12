namespace Scheldemist.Town;

/// <summary>The crowd and vehicle renderer must select the same clip rather than restarting their blend each frame.</summary>
public static class VehicleMotion
{
    public static string Walking(int vehicle,string kind,bool pushes,bool loaded,bool handCarry)=>vehicle switch {
        1=>"ride",2=>kind is "carter" or "porter"?"walk":"push",
        _=>pushes?"push":loaded&&handCarry?"carry":"walk"
    };
    public static string Waiting(int vehicle,string pose)=>vehicle switch {
        1=>"ride",2=>"idle",_=>pose is "walk" or "carry" or "push" or "ride"?"idle":pose
    };
}
