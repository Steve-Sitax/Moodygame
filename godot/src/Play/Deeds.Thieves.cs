using System;
using System.Collections.Generic;
using Godot;
using Scheldemist.Game;
using Scheldemist.Player;
using Scheldemist.Net;
using Scheldemist.Windows;
namespace Scheldemist.Play;
public partial class Deeds
{
    private void ThiefStep(double dt)
    {
        using var cost = Scheldemist.Dev.FrameCost.Track("Deeds.ThiefStep");
        if(town?.Crowd==null) return;
        foreach(var s in town.Simulations)
        {
            if(s.R.Trade!="thief" || s.P==null || s.Inside || pursuers.ContainsKey(s.R.Id) || s.ActionHeld && !ReferenceEquals(s.ActionOwner,this)) continue;
            var p=s.P; double dx=p.X-Jef.I.X,dz=p.Z-Jef.I.Z,d=Math.Sqrt(dx*dx+dz*dz);
            if(caught.Contains(s.R.Id))
            {
                // caught by the collar: he runs off for a while, then he is the police's and the street's again
                if(fled.TryGetValue(s.R.Id,out var ran))
                {
                    if(GameState.PlayNow-ran>25000) { town.ReleasePlayerPerson(s.R.Id,this); fled.Remove(s.R.Id); }
                    else town.Crowd.PuppetGo(p,Jef.I.X+dx/Math.Max(d,0.1)*24,Jef.I.Z+dz/Math.Max(d,0.1)*24,2.8);
                }
                continue;
            }
            if(robbed.TryGetValue(s.R.Id,out var when))
            {
                if(GameState.PlayNow-when>25000) { town.ReleasePlayerPerson(s.R.Id,this); continue; }
                town.Crowd.PuppetGo(p,Jef.I.X+dx/Math.Max(d,0.1)*20,Jef.I.Z+dz/Math.Max(d,0.1)*20,2.8);
                continue;
            }
            bool can=(GameState.I.HourF>=20 || GameState.I.HourF<6) && !Interact.I.IsShut && !Day.I.Busy && !busy && !Dialogs.I!.Any;
            if(!can || d>28) { town.ReleasePlayerPerson(s.R.Id,this); thieves.Remove(s.R.Id); continue; }
            if(d>=22 || s.ActionHeld && !ReferenceEquals(s.ActionOwner,this)) continue;
            var sim=town.ClaimPlayerPerson(s.R.Id,this); if(sim==null) continue;
            var t=thieves.GetValueOrDefault(s.R.Id);
            // how far in front of Jef he stands: 1 straight ahead, 0 to the side, -1 right behind
            double ahead=(-Math.Sin(Jef.I.Yaw)*dx-Math.Cos(Jef.I.Yaw)*dz)/Math.Max(d,1);
            // a thief works from behind and never in plain sight: when Jef looks at him he gives it up for a moment,
            // keeps his distance (or strolls off when he is near) and tries again only when Jef's back is turned
            if(ahead>0.35 && d<16) t.wary=2.5; else t.wary=Math.Max(0,t.wary-dt);
            if(t.wary>0 || ahead>=0.1)
            {
                t.close=0;
                if(t.wary>0 && d<7) town.Crowd.PuppetGo(p,p.X+dx/Math.Max(d,0.1)*8,p.Z+dz/Math.Max(d,0.1)*8,1.3);
                else if(town.Crowd.PuppetBusy(p) || p.Human.Motion!="idle") town.Crowd.PuppetStand(p,"idle",p.Yaw);
                thieves[s.R.Id]=t;
                continue;
            }
            t.close=d<1.9 ? t.close+dt : Math.Max(0,t.close-dt);
            double bx=Jef.I.X+Math.Sin(Jef.I.Yaw)*0.8,bz=Jef.I.Z+Math.Cos(Jef.I.Yaw)*0.8;
            if(d<4.5)
            {
                double db=Math.Sqrt((bx-p.X)*(bx-p.X)+(bz-p.Z)*(bz-p.Z)),k=Math.Min(1,1.1*dt/Math.Max(db,0.001));
                double nx=p.X+(bx-p.X)*k,nz=p.Z+(bz-p.Z)*k;
                if(town.Walk?.Free(nx,nz)==true && Math.Sqrt((nx-Jef.I.X)*(nx-Jef.I.X)+(nz-Jef.I.Z)*(nz-Jef.I.Z))>0.55) { town.Crowd.PuppetStand(p,"walk",Math.Atan2(bx-p.X,bz-p.Z)); p.X=nx; p.Z=nz; }
                else town.Crowd.PuppetStand(p,"idle");
            }
            else town.Crowd.PuppetGo(p,bx,bz,1.5);
            thieves[s.R.Id]=t;
            if(t.close>1.2) { robbed[s.R.Id]=GameState.PlayNow; _=Rob(s.R.Id); }
        }
    }
    public async System.Threading.Tasks.Task Rob(string id)
    {
        if(busy || Api==null) return; busy=true;
        try { var r=await Api.RobbedBy(id); Answered?.Invoke(new { robbedBy=id },r); Apply(r); }
        catch(ApiException e) { Fail(e); } finally { busy=false; robbed[id]=GameState.PlayNow; }
    }
}
