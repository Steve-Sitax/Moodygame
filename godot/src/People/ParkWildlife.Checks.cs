using System;
using System.Collections.Generic;
using Scheldemist.Town;
namespace Scheldemist.People;

public partial class ParkWildlife
{
    /// <summary>Use the real stepper and habitat; restore the live town after deterministic ecology fixtures.</summary>
    internal Dictionary<string,bool> EcologyChecks()
    {
        var result=new Dictionary<string,bool>(); if(List.Count==0)return result;
        uint savedSeed=seed; double savedClock=clock; int savedCaptures=Captures;
        int parent=List.FindIndex(a=>a.Species=="duck"&&!a.Young); if(parent<0)return result;
        var mother=List[parent]; string savedMode=mother.Mode; double savedTimer=mother.Timer;
        var a=new Beast {Id=-99,Home=mother.Home,Species="duck",Mode="forage",X=mother.X,Z=mother.Z,Y=.06,Timer=10,Target=new(mother.X,mother.Z)};
        List<Pt> far=new(){new(a.X+100,a.Z+100)}, close=new(){new(a.X+.1,a.Z)}, empty=new();
        try
        {
            seed=2000;clock=Math.Max(1,clock);Step(a,.01,far,close,empty,empty);
            result["unguarded duck capture"] = a.Mode=="caught"&&Math.Abs(a.Timer-240)<.001;
            a.Mode="forage";a.Timer=10;a.Y=.06;seed=2000;Step(a,.01,far,close,empty,empty);
            result["capture attempt waits 45 seconds"] = a.Mode!="caught";
            a.Mode="caught";a.Timer=0;Step(a,.01,close,empty,empty,empty);
            result["caught duck stays hidden while watched"] = a.Mode=="caught";
            Step(a,.01,far,empty,empty,empty);
            result["caught duck returns only out of view"] = a.Mode!="caught";
            huntUntil.Remove(a.Id);a.X=mother.X;a.Z=mother.Z;a.Y=.06;a.Mode="forage";a.Young=true;a.Parent=parent;seed=2000;
            mother.Mode="swim";
            Step(a,.01,far,close,empty,empty);
            result["parent guards duckling"] = a.Mode!="caught"&&mother.Mode=="defend";
            var escape=HuntTarget(mother.X+.1,mother.Z);
            result["defending parent drives cat away"] = escape is { } q&&Distance(q.X,q.Z,mother.X,mother.Z)>4;
        }
        finally {seed=savedSeed;clock=savedClock;Captures=savedCaptures;mother.Mode=savedMode;mother.Timer=savedTimer;huntUntil.Remove(a.Id);watched.Remove(a.Id);}
        return result;
    }
}
