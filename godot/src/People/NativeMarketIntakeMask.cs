using System;
using Godot;
using Scheldemist.World;

namespace Scheldemist.People;

/// <summary>Runtime replacements keep their frozen intake pictures out of physics and navigation.</summary>
[GamePart(9)]
public partial class NativeMarketIntakeMask : Node
{
    public int MaskedGroups {get;private set;}
    public int MaskedNodes {get;private set;}
    private static string Source(Node n)=>n.HasMeta("source_name")?n.GetMeta("source_name").AsString():n.Name.ToString();
    private static bool Replaced(Node n){string s=Source(n);return s is"market_vismarkt"or"market_grote_markt"||s.StartsWith("lively_hen_",StringComparison.Ordinal)||s.StartsWith("lively_goat_",StringComparison.Ordinal);}
    public NativeMarketIntakeMask()=>Solid.Leave.Add(Replaced);
    public override void _Ready()
    {
        foreach(var node in BakedWorld.All(Main.I.World))if(Replaced(node)){
            MaskedGroups++;foreach(var child in BakedWorld.All(node)){child.SetMeta("native_market_replaced",true);if(child is Node3D n)n.Visible=false;if(child is CollisionObject3D b){b.CollisionLayer=0;b.CollisionMask=0;}MaskedNodes++;}
        }
    }
}
