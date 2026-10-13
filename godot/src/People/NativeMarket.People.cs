using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.Net.Mp;
using Scheldemist.Town;

namespace Scheldemist.People;

public partial class NativeMarket
{
    public static double Share(string place,int day,double hour,double soldOutAt=double.NaN)=>NativeMarketCalendar.Share(place,day,hour,soldOutAt);
    // people2 (package D3): a fishwife behind a fish table guts the catch while she stands there (her idle and her
    // folded arms; calling stays a call); she stands at the board's edge (gut: the table's near edge 0.30 before
    // her, the layout puts the seller 0.49 back). A local look: the sellers are drawn from the layout on every PC.
    private static void FishTable(NativeMarketItem it,Puppet p)
    {
        if(it.Kind!="fishtable"||!p.Human.IsPeople2)return;
        p.Human.Work="fish_stall";
        p.X+=Math.Sin(it.Yaw)*.19;p.Z+=Math.Cos(it.Yaw)*.19;
    }

    private void DrawSellers(Field f,double distance,Vector3 me)
    {
        var crowd=town.Crowd!;if(town.StormLevel>.3){foreach(var pair in f.Sellers){var it=pair.Key;var s=pair.Value;if(s.Fled)continue;s.Fled=true;if(it.Sits)crowd.PuppetSit(s.Body,it.Yaw);else crowd.PuppetStand(s.Body,"fold",it.Yaw);}return;}
        foreach(var s in f.Sellers.Values)if(s.Fled){s.Fled=false;s.Talk=0;}
        var near=f.Items.Where(it=>it.Rank>=f.Low&&it.Rank<f.High&&distance<92&&Distance(it.X,it.Z,me.X,me.Z)<32).OrderBy(it=>Distance(it.X,it.Z,me.X,me.Z)).Take(8).ToArray();
        foreach(var pair in f.Sellers.ToArray())if(!near.Contains(pair.Key)&&(crowd.IsHidden(pair.Key.Seller.X,pair.Key.Seller.Z)||pair.Key.Rank<f.Low||pair.Key.Rank>=f.High)){crowd.RemovePuppet(pair.Value.Body);f.Sellers.Remove(pair.Key);}
        foreach(var it in near){if(f.Sellers.ContainsKey(it))continue;if(f.Sellers.Count>=8)break;double hash=Math.Sin(it.Seller.X*12.9898+it.Seller.Z*78.233)*43758.5453;var p=crowd.AddPuppet(it.SellerKind,it.Seller.X,it.Seller.Z,it.Yaw,1,(float)(.95+(hash-Math.Floor(hash))*.1));if(p==null)return;FishTable(it,p);f.Sellers[it]=new(){Body=p,Talk=it.Talk};if(it.Sits)crowd.PuppetSit(p,it.Yaw);else crowd.PuppetStand(p,"idle",it.Yaw);}
    }
    private void StepSellers(Field f,double dt)
    {
        foreach(var pair in f.Sellers){var it=pair.Key;var s=pair.Value;if(s.Fled||(s.Talk-=dt)>0)continue;bool calling=random.NextDouble()<.3;if(it.Sits)town.Crowd!.PuppetSit(s.Body,it.Yaw);else town.Crowd!.PuppetStand(s.Body,calling?"talk":random.NextDouble()<.3?"fold":"idle",it.Yaw);s.Talk=calling?R(2,4):R(4,9);}
    }
    private void Gesture(Target target,double x,double z,double seconds)
    {
        if(target.Item!=null&&target.Field?.Sellers.TryGetValue(target.Item,out var draw)==true){double yaw=Math.Atan2(x-draw.Body.X,z-draw.Body.Z);if(target.Item.Sits)town.Crowd!.PuppetSit(draw.Body,yaw);else town.Crowd!.PuppetStand(draw.Body,"talk",yaw);draw.Talk=seconds;}
        else if(target.Keeper!=""&&town.ActionPerson(target.Keeper)?.P is{} p&&NativeStreet.I?.Owns(target.Keeper)!=false)town.Crowd!.PuppetStand(p,"talk",Math.Atan2(x-p.X,z-p.Z));
    }
    private void MakeShoppers(Field f,double distance,Vector3 me)
    {
        var crowd=town.Crowd!;foreach(var p in f.Shoppers.ToArray())if(!crowd.Alive(p))Drop(p,true);
        bool lead=NativeExtras.I?.RunAnimal("g:mk:"+f.Place,f.Centre.X,f.Centre.Z,55)!=false;int want=f.On&&distance<55&&lead?8:0;
        if(f.Shoppers.Count<want){var entries=f.Entries.Where(p=>crowd.IsHidden(p.X,p.Z)&&!OthersSee(p.X,p.Z)&&crowd.OpenNear(p.X,p.Z)!=null).ToArray();if(entries.Length>0){var e=Pick(entries);var at=crowd.CanStand(e.X,e.Z)?(x:e.X,z:e.Z):crowd.OpenNear(e.X,e.Z);var kinds=definitions["shoppers"]!.AsArray().Select(S).ToArray();string kind=Pick(kinds);var p=at is{} q?crowd.AddPuppet(kind,q.x,q.z,0,R(.95,1.2)):null;if(p!=null){f.Shoppers.Add(p);browsing[p]=new(){Place=f.Place,Time=R(0,1),Want=2+random.Next(3),Own=true};if(Together.I?.On==true&&NativeExtras.I is{} share)netIds[p]=share.NewId("ms",kind);}}}
        foreach(var p in f.Shoppers.ToArray()){if(netIds.TryGetValue(p,out string? id))NativeExtras.I?.Person(id,p);if(!browsing.TryGetValue(p,out var b))continue;if(!f.On&&b.Phase is not("leave"or"gone"))Leave(p,b,f);if(b.Phase is"gone"or"leave"&&(crowd.IsHidden(p.X,p.Z)&&!OthersSee(p.X,p.Z)||b.Time<-40))Drop(p,true);}
        if(distance>75)foreach(var p in f.Shoppers.ToArray())Drop(p,!(Together.I?.On==true&&Nearest(p.X,p.Z)<55));
    }
    private void Drop(Puppet p,bool ended)
    {
        if(netIds.Remove(p,out string? id)){if(ended)NativeExtras.I?.PersonGone(id);else NativeExtras.I?.Release(id);}browsing.Remove(p);foreach(var f in fields)f.Shoppers.Remove(p);if(town.Crowd?.Alive(p)==true)town.Crowd.RemovePuppet(p);
    }
    private void Leave(Puppet p,Browser b,Field f)
    {
        b.Phase="leave";b.Time=0;var me=Main.I.Cam.GlobalPosition;var far=f.Entries.OrderByDescending(q=>Distance(q.X,q.Z,me.X,me.Z)).First();var q=town.Crowd!.OpenNear(far.X,far.Z)??(far.X,far.Z);town.Crowd.PuppetGo(p,q.Item1,q.Item2);
    }
    private List<Target> Targets(string place)
    {
        var result=new List<Target>();var f=fields.FirstOrDefault(f=>f.Place==place);if(f!=null)foreach(var it in f.Items)if(it.Rank>=f.Low&&it.Rank<f.High)result.Add(new(){X=it.Front.X,Z=it.Front.Z,Yaw=it.Yaw+Math.PI,Goods=it.Goods,Item=it,Field=f});
        foreach(var s in town.Data!.Stalls)if(s.Place==place&&s.Keeper!=null&&openKeepers.Contains(s.Keeper))result.Add(new(){X=s.X+s.Face.X*1.45,Z=s.Z+s.Face.Z*1.45,Yaw=Math.Atan2(-s.Face.X,-s.Face.Z),Goods=s.Goods,Keeper=s.Keeper});return result;
    }
    private bool Browse(Puppet p,string place,double dt)
    {
        if(!built)return false;string key=place.StartsWith("market:")?place[7..]:place;if(!browsing.TryGetValue(p,out var b)||b.Place!=key){if(Targets(key).Count==0)return false;browsing[p]=b=new(){Place=key,Want=99};}StepBrowser(p,b,dt);return true;
    }
    private void Forget(Puppet p){if(browsing.TryGetValue(p,out var b)&&!b.Own)browsing.Remove(p);}
    private readonly NativeMarketBrowseContext browseContext=new();
    private Puppet? currentBuyer;
    private Browser? currentBrowse;
    private bool contextBound;
    private void StepBrowser(Puppet p,Browser b,double dt)
    {
        if(!contextBound){contextBound=true;browseContext.Random=random.NextDouble;browseContext.Targets=place=>Targets(place);browseContext.Open=(x,z)=>town.Crowd!.OpenNear(x,z);browseContext.Busy=()=>town.Crowd!.PuppetBusy(currentBuyer!);browseContext.HasField=place=>fields.Any(f=>f.Place==place);browseContext.Go=(x,z,pace)=>town.Crowd!.PuppetGo(currentBuyer!,x,z,pace);browseContext.Stand=(motion,yaw)=>town.Crowd!.PuppetStand(currentBuyer!,motion,yaw);browseContext.Gesture=(target,seconds)=>Gesture((Target)target,currentBuyer!.X,currentBuyer.Z,seconds);browseContext.Buy=kind=>town.Crowd!.PuppetCarry(currentBuyer!,kind);browseContext.Leave=place=>Leave(currentBuyer!,currentBrowse!,fields.First(f=>f.Place==place));browseContext.Bought=goods=>S(definitions["bought"]?[goods])is{Length:>0} kind?kind:"parcel";}
        currentBuyer=p;currentBrowse=b;browseContext.X=p.X;browseContext.Z=p.Z;NativeMarketBrowseRules.Step(b,dt,browseContext);currentBuyer=null;currentBrowse=null;
    }
}