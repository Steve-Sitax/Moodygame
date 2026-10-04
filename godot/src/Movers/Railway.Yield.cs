using System;
using Godot;
using Scheldemist.Play;

namespace Scheldemist.Movers;

public partial class Railway
{
    private static bool Occupied(Crane c)=>CraneClimb.I?.On==c.Index;
    private static float Rank(Crane c)=>Math.Max(Occupied(c)?4:c.Reserved||c.Ops.Count>0?3:c.Mode!="berth"?2:1,c.YieldT>0?c.Lend:0);
    private static bool CanYield(Crane c)=>!Occupied(c);
    private void RequestYield(Crane c,int k)
    {
        if(k<0||k>=c.Near.Count*2)return;var other=c.Near[k>>1];float rank=Rank(c),theirs=Rank(other);
        if(!CanYield(other)||rank<theirs||rank==theirs&&c.Index>=other.Index)return;
        other.YieldT=1.2f;other.Lend=Math.Max(other.Lend,rank-.5f);
        float dx=other.X-c.X,dz=other.Z-c.Z,len=Math.Max(.001f,MathF.Sqrt(dx*dx+dz*dz));other.AwayX+=dx/len;other.AwayZ+=dz/len;
        if((k&1)!=0)other.MoveOn=true;
    }
    private bool YieldStep(Crane c,float dt)
    {
        if(c.YieldT<=0||!CanYield(c))return false;
        if(c.YieldT>=1.2f)c.Yields++;c.YieldT-=dt;
        if(c.MoveOn&&c.Axis!=' '&&!c.Reserved&&c.Ops.Count==0&&c.Mode=="berth"&&NextBerth(c) is {} berth)
        {c.Target=berth.P;c.NextA=berth.A;c.Mode="swingIn";c.Along=Math.Abs(CraneGeo.AngDiff(Math.PI/2,c.A))<Math.Abs(CraneGeo.AngDiff(-Math.PI/2,c.A))?MathF.PI/2:-MathF.PI/2;c.YieldT=0;c.Lend=c.AwayX=c.AwayZ=0;c.MoveOn=false;return false;}
        if(c.Mode=="travel"&&!c.Reserved&&c.Ops.Count==0&&Retreat(c)){c.YieldT=c.Lend=c.AwayX=c.AwayZ=0;c.MoveOn=false;return false;}
        if(c.Mode=="travel")c.Speed=0;
        if(c.Hy<Travel-.01f)HoistTo(c,Travel,dt);
        else {float len=MathF.Sqrt(c.AwayX*c.AwayX+c.AwayZ*c.AwayZ);float to=len<.3f?0:AngleTo(c,c.X+c.AwayX/len,c.Z+c.AwayZ/len);SlewTo(c,to,dt,Slew*.8f);}
        float decay=MathF.Pow(.5f,dt);c.AwayX*=decay;c.AwayZ*=decay;
        if(c.YieldT<=0){c.Lend=c.AwayX=c.AwayZ=0;c.MoveOn=false;}return true;
    }
    private bool Retreat(Crane c)
    {
        float push=c.Axis=='x'?c.AwayX:c.AwayZ;if(Math.Abs(push)<.3f)return false;float lo=c.Lo,hi=c.Hi;
        foreach(var other in cranes){if(other==c||!SameRunway(c,other))continue;float a=Math.Min(other.Pos,other.Target??other.Pos),b=Math.Max(other.Pos,other.Target??other.Pos);if(other.Pos<c.Pos)lo=Math.Max(lo,b+CraneGap);else hi=Math.Min(hi,a-CraneGap);}
        float to=Math.Clamp(c.Pos+Math.Sign(push)*8,Math.Min(lo,c.Pos),Math.Max(hi,c.Pos));if(Math.Abs(to-c.Pos)<1||c.Target is {} target&&Math.Sign(target-c.Pos)==Math.Sign(push)&&Math.Abs(target-c.Pos)>=Math.Abs(to-c.Pos))return false;
        c.Target=to;var(x,z)=SiteAt(c,to);c.NextA=HoldAngle(c,x,z,4)??0;c.Stuck=0;return true;
    }
    private void YieldProbes()
    {
        GoodsRailProbe();
        if(cranes.Count<2)return;var asker=cranes[0];var other=cranes[1];float oldHy=0,oldA=0;bool reserved=false;int count=0;
        MoversTest.Add(new(){Name="crane_make_way",Hour=13,Gap=2,MinMove=0,MinTurn=.001,
            Start=()=>{oldHy=other.Hy;oldA=other.A;reserved=asker.Reserved;count=other.Yields;asker.Reserved=true;int k=asker.Near.IndexOf(other)*2;RequestYield(asker,k);},
            Where=()=> (new(other.X,other.Hy,other.Z),other.A,"lower-rank crane raises hook and swings away"),
            View=()=> (new(other.X+10,9,other.Z+9),new(other.X,5,other.Z)),
            Check=()=>other.Yields>count&&other.Hy>=oldHy?"":"crane did not honour make-way request",
            End=()=>{asker.Reserved=reserved;other.Hy=oldHy;other.A=oldA;other.YieldT=other.Lend=other.AwayX=other.AwayZ=0;}});
    }
    private void GoodsRailProbe()
    {
        Play.GoodsItem? original=null;bool moved=false;string error="";
        MoversTest.Add(new(){Name="train_yields_to_loose_goods",Hour=13,Gap=3,MinMove=0,MaxWait=30,
            Start=()=>{TestAt(-20);moved=false;error="";_=Place();},
            Ready=()=>moved&&v<.02f&&waitWhy=="goods on the rails"||error!="",
            Where=()=> (HeadAt,head,"loose goods stop the horse railway: "+waitWhy),
            View=()=> (HeadAt+new Vector3(5,3,7),HeadAt+Vector3.Up),
            Check=()=>error!=""?error:!moved||v>=.02f||waitWhy!="goods on the rails"?"train did not stop for the loose crate":"",
            End=()=>{if(original is {} old)_=Restore(old);}});
        async System.Threading.Tasks.Task Place()
        {
            try{if(Scheldemist.Net.ServerLink.I?.Api is not {} api){error="server absent";return;}foreach(var item in Play.Goods.I.All.Values)if(item.S.Lies&&item.Kind=="crates"&&!item.Broken&&item.Y<1.2){bool above=false;foreach(var other in Play.Goods.I.All.Values)if(other.S.On.Contains(item.Id)){above=true;break;}if(!above){original=item.S;break;}}if(original==null){error="no loose crate";return;}var at=line.At(head+12);Play.Goods.I.MovingReply(await api.MovingFixtureItem(original.Id,at.X,at.Y));var placed=Play.Goods.I.All[original.Id];moved=new Vector2(placed.X-at.X,placed.Z-at.Y).Length()<1.35f;if(!moved)error="server did not place fixture crate on the track";}catch(Exception e){error=e.Message;}
        }
        async System.Threading.Tasks.Task Restore(Play.GoodsItem old){if(Scheldemist.Net.ServerLink.I?.Api is {} api)Play.Goods.I.MovingReply(await api.MovingFixtureItem(old.Id,old.X,old.Z));}
    }
    private void LooseGoodsLimit(ref float limit)
    {
        if(Play.Goods.I==null)return;
        foreach(var item in Play.Goods.I.Lying)
        {
            if(item.Y>1.2||item.Broken==true)continue;
            for(float d=0;d<=18;d+=.5f){var at=line.At(head+d);double dx=item.X-at.X,dz=item.Z-at.Y;if(dx*dx+dz*dz>1.35*1.35)continue;limit=Math.Min(limit,Math.Max(head,head+d-7.5f));waitWhy="goods on the rails";break;}
        }
    }
}
