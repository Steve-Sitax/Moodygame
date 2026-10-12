using System;
using System.Collections.Generic;
using System.Linq;

namespace Scheldemist.People;

public readonly record struct NativeCourtHome(int House,double X,double Z,double OutX,double OutZ);
public sealed class NativeCourtAnimal
{
    public string Id="",Kind="";
    public double HomeX,HomeZ,X,Z,Yaw,Timer,TargetX,TargetZ,Peck,Gait;
    public bool Walking,Fled;
}
/// <summary>The source courtyard selection and hen/goat rules without scene objects.</summary>
public static class NativeCourtyardRules
{
    public static double H01(string text){uint h=2166136261;foreach(char c in text)h=unchecked((h^c)*16777619);h^=h>>13;h=unchecked(h*0x5bd1e995);h^=h>>15;return h/4294967296.0;}
    public static double Dice(string key,params double[] numbers){uint h=2166136261;foreach(char c in key)h=unchecked((h^c)*16777619);foreach(double n in numbers){h=unchecked((h^(uint)(int)n)*0x01000193);h=unchecked((h^(uint)(int)(n*4096))*0x85ebca6b);}h=unchecked((h^(h>>15))*0x2c1b3c6d);h=unchecked((h^(h>>12))*0x297a2d39);return(h^(h>>15))/4294967296.0;}
    public static List<NativeCourtAnimal> Make(IEnumerable<NativeCourtHome> homes,Func<double,double,bool> open,Func<double,double,double,bool> free,Func<double,double,double,bool> clear)
    {
        var narrow=new List<(NativeCourtHome Home,double Width)>();foreach(var h in homes.DistinctBy(h=>h.House)){double width=12;for(double s=1;s<=12;s+=.5)if(!open(h.X+h.OutX*s,h.Z+h.OutZ*s)){width=s;break;}if(width<7.5)narrow.Add((h,width));}
        var output=new List<NativeCourtAnimal>();int hens=0,goats=0;
        foreach(var q in narrow.OrderBy(q=>H01("court:"+q.Home.House))){var h=q.Home;double x=h.X+h.OutX*Math.Min(1.6,q.Width/2)-h.OutZ*2.6,z=h.Z+h.OutZ*Math.Min(1.6,q.Width/2)+h.OutX*2.6;
            if(!open(x,z)||!free(x,z,.5)||!clear(x,z,.4)||output.Any(a=>Distance(a.HomeX,a.HomeZ,x,z)<30))continue;
            if(goats<2&&H01("goat:"+h.House)<.4){string id="a:goat:"+h.House;output.Add(new(){Id=id,Kind="goat",HomeX=x,HomeZ=z,X=x,Z=z,Yaw=Dice(id,1)*6.28,TargetX=x,TargetZ=z});goats++;}
            else if(hens<6){for(int k=0;k<3;k++){string id=$"a:hen:{h.House}:{k}";double ax=x+(Dice("henx",h.House,k)-.5)*1.6,az=z+(Dice("henz",h.House,k)-.5)*1.6;output.Add(new(){Id=id,Kind="hen",HomeX=x,HomeZ=z,X=ax,Z=az,Yaw=Dice(id,1)*6.28,Timer=Dice(id,2)*3,TargetX=ax,TargetZ=az});}hens++;}
            if(hens>=6&&goats>=2)break;
        }return output;
    }
    private static double Distance(double x,double z,double a,double b)=>Math.Sqrt(Math.Pow(x-a,2)+Math.Pow(z-b,2));
    private static double Wrap(double a)=>Math.Atan2(Math.Sin(a),Math.Cos(a));
    public static void Hen(NativeCourtAnimal h,double dt,IReadOnlyList<(double X,double Z)> players,Func<double> random,Func<double,double,double,bool> free)
    {
        h.Timer-=dt;h.Fled=false;foreach(var p in players){double d=Distance(h.X,h.Z,p.X,p.Z);if(d>=2||h.Fled)continue;double length=d==0?1:d;h.TargetX=h.X+(h.X-p.X)/length*2;h.TargetZ=h.Z+(h.Z-p.Z)/length*2;h.Timer=1;h.Fled=true;}
        if(!h.Fled&&h.Timer<=0){h.TargetX=h.HomeX+(random()*4-2);h.TargetZ=h.HomeZ+(random()*4-2);h.Timer=1.5+random()*2.5;h.Peck=0;}
        double dx=h.TargetX-h.X,dz=h.TargetZ-h.Z,len=Math.Sqrt(dx*dx+dz*dz);h.Walking=false;
        if(len>.1){double speed=h.Fled?2.2:.5,step=Math.Min(len,speed*dt),nx=h.X+dx/len*step,nz=h.Z+dz/len*step;if(free(nx,nz,.12)){h.X=nx;h.Z=nz;h.Walking=true;}else h.TargetX=h.X;h.Yaw+=Wrap(Math.Atan2(dx,dz)-h.Yaw)*Math.Min(1,dt*8);}
        h.Peck+=dt;if(!h.Walking)Quantize(h);
    }
    public static void Goat(NativeCourtAnimal g,double dt,Func<double> random,Func<double,double,double,bool> free)
    {
        g.Timer-=dt;if(g.Timer<=0){double angle=random()*Math.Tau;g.TargetX=g.HomeX+Math.Cos(angle)*(.3+random()*1.1);g.TargetZ=g.HomeZ+Math.Sin(angle)*(.3+random()*1.1);g.Timer=4+random()*5;}
        double dx=g.TargetX-g.X,dz=g.TargetZ-g.Z,len=Math.Sqrt(dx*dx+dz*dz);g.Walking=len>.08;
        if(g.Walking){double step=Math.Min(len,.45*dt),nx=g.X+dx/len*step,nz=g.Z+dz/len*step;if(free(nx,nz,.3)){g.X=nx;g.Z=nz;}else g.TargetX=g.X;g.Yaw+=Wrap(Math.Atan2(dx,dz)-g.Yaw)*Math.Min(1,dt*3);g.Gait+=dt*3;}
        else Quantize(g);
    }
    private static void Quantize(NativeCourtAnimal a){a.X=Math.Floor(a.X*50+.5)/50;a.Z=Math.Floor(a.Z*50+.5)/50;a.Yaw=Math.Floor(a.Yaw*256/Math.Tau+.5)*Math.Tau/256;}
}
