using System.Collections.Generic;
using Godot;
using Scheldemist.Player;
namespace Scheldemist.Play;
public partial class FerryArrival
{
    private List<Vector2>? guideWay;
    private int guideAt;
    private bool guideOnce;
    private void BeginGuide()
    {
        var local=ferry.Transform.AffineInverse()*new Vector3(Jef.I.X,deckY,Jef.I.Z);
        guideWay=ferryDeck.Path(new(local.X,local.Z),new(side-1.05f,portZ));
        for(int i=0;i<guideWay.Count;i++){var p=ferry.Transform*new Vector3(guideWay[i].X,deckY,guideWay[i].Y);guideWay[i]=new(p.X,p.Z);}
        guideWay.Add(Port);guideWay.Add(new(-249,-59.18f));guideWay.Add(new(-249,-57.4f));guideAt=0;
    }
    private Vector2 GuideTarget()
    {
        if(guideWay==null||guideWay.Count==0)return new(-249,-58.5f);
        while(guideAt<guideWay.Count-1&&new Vector2(Jef.I.X,Jef.I.Z).DistanceTo(guideWay[guideAt])<.05f)guideAt++;
        if(guideAt==guideWay.Count-1&&new Vector2(Jef.I.X,Jef.I.Z).DistanceTo(guideWay[guideAt])<.05f)guide=false;
        return guideWay[guideAt];
    }
}
