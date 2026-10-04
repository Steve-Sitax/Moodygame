using System;
using System.Collections.Generic;
using Godot;
using Scheldemist.Game;
using Scheldemist.Player;
using Scheldemist.Net;
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
            if(robbed.TryGetValue(s.R.Id,out var when))
            {
                if(GameState.PlayNow-when>25000) { town.ReleasePlayerPerson(s.R.Id,this); continue; }
                town.Crowd.PuppetGo(p,Jef.I.X+dx/Math.Max(d,0.1)*20,Jef.I.Z+dz/Math.Max(d,0.1)*20,2.8);
                continue;
            }
            bool can=(GameState.I.HourF>=20 || GameState.I.HourF<6) && !Interact.I.IsShut && !Day.I.Busy && !busy;
            if(!can || d>28) { town.ReleasePlayerPerson(s.R.Id,this); thieves.Remove(s.R.Id); continue; }
            if(d>=22 || s.ActionHeld && !ReferenceEquals(s.ActionOwner,this)) continue;
            var sim=town.ClaimPlayerPerson(s.R.Id,this); if(sim==null) continue;
            var t=thieves.GetValueOrDefault(s.R.Id);
            bool unseen=(-Math.Sin(Jef.I.Yaw)*dx-Math.Cos(Jef.I.Yaw)*dz)/Math.Max(d,1)<0.2;
            t.close=d<1.9 && unseen ? t.close+dt : Math.Max(0,t.close-dt);
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
