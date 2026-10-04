using System;
using System.Collections.Generic;
using Godot;
namespace Scheldemist.Town;

public partial class Townspeople
{
    private sealed class RopePitch
    {
        public readonly List<Sim> Line=new(12);
        public double X,Z,Yaw,T=.5,Poll,Pause;
        public int Left=12,Slot;
        public ulong Frame;
        public MultiMeshInstance3D Draw=null!;
    }
    private readonly Dictionary<string,RopePitch> ropes=new();
    private bool RopeStep(Sim s,double dt)
    {
        string id=s.Goal.Place??"";if(Place(id) is not {} place)return false;
        if(!ropes.TryGetValue(id,out var r))
        {
            var mm=new MultiMesh{TransformFormat=MultiMesh.TransformFormatEnum.Transform3D,Mesh=StreetWindows.RopeMesh,InstanceCount=24,VisibleInstanceCount=0};
            var draw=new MultiMeshInstance3D{Name="skipping_rope_"+id,Multimesh=mm,CastShadow=GeometryInstance3D.ShadowCastingSetting.Off};Main.I.View.AddChild(draw);
            var pitch=Pitch(id);double pitchYaw=pitch?.Yaw??0;
            r=new(){X=(pitch?.X??place.X)-Math.Cos(pitchYaw)*3,Z=(pitch?.Z??place.Z)+Math.Sin(pitchYaw)*3,Yaw=pitchYaw,Draw=draw};ropes[id]=r;
        }
        if(r.Frame!=Engine.GetProcessFrames())
        {
            r.Frame=Engine.GetProcessFrames();r.Poll-=dt;
            if(r.Poll<=0)
            {
                r.Poll=.5;
                for(int i=r.Line.Count-1;i>=0;i--){var q=r.Line[i];if(q.P==null||q.ActionHeld||q.Goal.Mode!="play"||q.Goal.Place!=id||GameOf(q)!="rope")r.Line.RemoveAt(i);}
                foreach(var q in sims)if(q.P is {} p&&p.Human.Scale<.9&&!q.ActionHeld&&q.Goal.Mode=="play"&&q.Goal.Place==id&&GameOf(q)=="rope"&&!r.Line.Contains(q))r.Line.Add(q);
            }
            if(r.Pause>0)r.Pause-=dt;
            else if(r.Line.Count>=3)
            {
                double before=r.T;r.T+=dt/.8;
                if(Math.Floor(r.T-.5)>Math.Floor(before-.5)&&--r.Left<=0)
                {
                    r.T=Math.Floor(r.T-.5)+.5;r.Pause=1.6;
                    int end=r.Slot%2;var turner=r.Line[end];r.Line[end]=r.Line[2];r.Line.RemoveAt(2);r.Line.Add(turner);
                    r.Slot++;r.Left=12+(int)(LifeHash(id+":"+r.Slot)*14);
                }
            }
            DrawRope(r);
        }
        int role=r.Line.IndexOf(s);if(role<0)return true;
        if(r.Line.Count<3)role+=3;
        double fx=Math.Sin(r.Yaw),fz=Math.Cos(r.Yaw),rx=Math.Cos(r.Yaw),rz=-Math.Sin(r.Yaw),x,z,yaw;
        var puppet=s.P!;double scale=puppet.Human.Scale*puppet.Size;
        if(role<=1)
        {
            int end=role==0?-1:1;double faceX=-end*fx,faceZ=-end*fz;yaw=Math.Atan2(faceX,faceZ);
            x=r.X+end*fx*1.5-faceX*.39*scale+Math.Cos(yaw)*.375*scale;
            z=r.Z+end*fz*1.5-faceZ*.39*scale-Math.Sin(yaw)*.375*scale;
        }
        else if(role==2){x=r.X;z=r.Z;yaw=Math.Atan2(rx,rz);}
        else {int q=role-3,m=Math.Max(1,r.Line.Count-3);x=r.X+rx*1.5+fx*(q-(m-1)/2.0)*.7;z=r.Z+rz*1.5+fz*(q-(m-1)/2.0)*.7;yaw=Math.Atan2(-rx,-rz);}
        if(!ReachGame(puppet,x,z,dt))return true;
        string motion=role<=1?"rope":role==2&&r.Pause<=0?"hop":"idle";
        Crowd!.PuppetStand(puppet,motion,yaw);
        if(role<=2){float phase=(float)(r.T-Math.Floor(r.T));puppet.Human.SetPhase(motion,role==1?1-phase:role==2?phase-.25f:phase);}
        return true;
    }
    private bool ReachGame(Puppet p,double x,double z,double dt)
    {
        double d=Dist(p.X,p.Z,x,z);
        if(d>1){Crowd!.PuppetGo(p,x,z,1.4);return false;}
        double k=d<=.001?1:Math.Min(1,1.1*dt/d),nx=p.X+(x-p.X)*k,nz=p.Z+(z-p.Z)*k;
        if(!Walk!.Free(nx,nz))return false;
        foreach(var other in Crowd!.Walking)if(other!=p&&Dist(other.X,other.Z,nx,nz)<.7)return false;
        if(Player.Jef.I is {} j&&Dist(j.X,j.Z,nx,nz)<.8)return false;
        Crowd.PuppetStand(p,d>.3?"walk":"idle",Math.Atan2(x-p.X,z-p.Z));p.X=nx;p.Z=nz;
        return d<.3;
    }
    private void DrawRope(RopePitch r)
    {
        var mm=r.Draw.Multimesh;
        if(r.Line.Count<3||r.Line[0].P is not {} a||r.Line[1].P is not {} b||a.Human.Motion!="rope"||b.Human.Motion!="rope"||(!a.Shown&&!b.Shown)) {mm.VisibleInstanceCount=0;return;}
        var ah=a.Human.Hand(true);var bh=b.Human.Hand(true);if(ah==null||bh==null){mm.VisibleInstanceCount=0;return;}
        Vector3 start=ah.Value-Vector3.Up*.03f,end=bh.Value-Vector3.Up*.03f;
        double rad=1.19*(a.Human.Scale*a.Size+b.Human.Scale*b.Size)/2,angle=(r.T-Math.Floor(r.T))*Math.PI*2;
        float ground=(float)Walk!.BaseAt((start.X+end.X)/2,(start.Z+end.Z)/2);
        Vector3 Point(int i){float u=i/24f,bow=(float)(Math.Sin(Math.PI*u)*rad);var q=start.Lerp(end,u)+new Vector3((float)(-Math.Cos(a.Yaw)*Math.Sin(angle))*bow,(float)Math.Cos(angle)*bow,(float)(Math.Sin(a.Yaw)*Math.Sin(angle))*bow);q.Y=Math.Max(ground+.018f,q.Y);return q;}
        Vector3 previous=Point(0);
        for(int i=0;i<24;i++){var next=Point(i+1);var d=next-previous;float length=d.Length();if(length>.0001f)mm.SetInstanceTransform(i,new Transform3D(new Basis(new Quaternion(Vector3.Up,d/length))*Basis.FromScale(new(1,length,1)),(previous+next)/2));previous=next;}
        mm.VisibleInstanceCount=24;
    }
    internal void ClearStreetGames(){foreach(var table in cardTables.Values)table.QueueFree();cardTables.Clear();foreach(var r in ropes.Values)r.Draw.QueueFree();ropes.Clear();ClearChalkPitches();}
    internal void HideOldGames(){ulong frame=Engine.GetProcessFrames();foreach(var r in ropes.Values)if(r.Frame+2<frame)r.Draw.Multimesh.VisibleInstanceCount=0;foreach(var r in chalkPitches.Values)if(r!=null&&r.Frame+2<frame)r.Marbles.Visible=false;}
}
