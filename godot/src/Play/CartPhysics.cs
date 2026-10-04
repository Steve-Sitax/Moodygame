using System;
using Godot;

namespace Scheldemist.Play;

/// <summary>The browser's cartPhysics.ts, with value poses and fixed loops instead of temporary arrays.</summary>
public static class CartPhysics
{
    public readonly record struct Pose(float X,float Z,float Dir);
    public interface IWorld
    {
        bool Water(float x,float z);
        float Base(float x,float z);
        bool Free(float x,float z,float radius);
        int People(Pose p);
    }
    public static Vector2 Axle(Pose p) => new(p.X+MathF.Sin(p.Dir)*2.6f,p.Z+MathF.Cos(p.Dir)*2.6f);
    public static Vector3 Point(Pose p,int i)
    {
        var axle=Axle(p); float fx=MathF.Sin(p.Dir),fz=MathF.Cos(p.Dir);
        if(i<9) { float a=(i/3-1)*.62f,s=(i%3-1)*.42f; return new(axle.X+fx*a+fz*s,axle.Y+fz*a-fx*s,.32f); }
        float t=i==9?.35f:.7f; return new(axle.X-fx*2.1f*t,axle.Y-fz*2.1f*t,.3f);
    }
    public static int Misfit(Pose p,IWorld w,float ground=0,int stop=int.MaxValue)
    {
        int n=0;
        for(int i=0;i<11;i++)
        {
            var q=Point(p,i);float x=q.X,z=q.Y,r=q.Z;
            if(w.Water(x,z)||w.Water(x+r,z)||w.Water(x-r,z)||w.Water(x,z+r)||w.Water(x,z-r)) return 99;
            if(Math.Abs(w.Base(x,z)-ground)>.08f)n+=2;
            else if(!w.Free(x,z,r))n++;
            if(n>=stop)return n;
        }
        return n+w.People(p);
    }
    public static Pose Step(Pose from,Vector2 to,float face,float dt,IWorld w,float ground=0)
    {
        bool moving=new Vector2(to.X-from.X,to.Y-from.Z).Length()>1e-4f;
        float limit=(moving?1.8f:.9f)*dt;
        float diff=MathF.Atan2(MathF.Sin(face-from.Dir),MathF.Cos(face-from.Dir));
        float dir=from.Dir+Math.Clamp(diff,-limit,limit);
        int now=Misfit(from,w,ground);
        for(int i=0;i<3;i++)
        {
            var p=i==0?new Pose(to.X,to.Y,dir):i==1?new Pose(to.X,to.Y,from.Dir):new Pose(from.X,from.Z,dir);
            if(p==from)continue;
            int m=Misfit(p,w,ground,now+1);
            bool back=(p.X-from.X)*MathF.Sin(from.Dir)+(p.Z-from.Z)*MathF.Cos(from.Dir)<-1e-4f&&p.Dir==from.Dir;
            if(m==0||(now>0&&(m<now||(back&&m<=now))&&(m<99||back)))return p;
        }
        return from;
    }
}
