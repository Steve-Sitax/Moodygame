using System;
using System.Collections.Generic;
using Godot;
using Scheldemist.World;
namespace Scheldemist.Audio;

public partial class LifeSound
{
    private readonly Random galeDice=new();
    private double bangNext=3,slateNext=12,signNext=6,caskNext=40,gustNext,lastGust;
    private double surfLook,surfNext;
    private readonly List<Vector3> surfEdges=new(16);
    public int GaleStarts {get;private set;}
    private double Rand(double a,double b)=>a+galeDice.NextDouble()*(b-a);
    private Vector3? WallNear()
    {
        if(town?.Walk==null||sound==null)return null;
        var eye=sound.Ear;
        for(int attempt=0;attempt<6;attempt++)
        {
            double angle=Rand(0,Math.PI*2),dx=Math.Cos(angle),dz=Math.Sin(angle);
            for(double d=2;d<55;d+=.8)
            {
                float x=(float)(eye.X+dx*d),z=(float)(eye.Z+dz*d);
                int flags=Ways.Flags(x,z);if(flags is 2 or 4 or 6)break;
                if(flags==1) {if(d>=6)return new((float)(eye.X+dx*(d-.4)),0,(float)(eye.Z+dz*(d-.4)));break;}
            }
        }
        return null;
    }
    private Vector3? OpenNear()
    {
        if(town?.Walk==null||sound==null)return null;
        for(int i=0;i<6;i++){double a=Rand(0,Math.PI*2),d=Rand(10,25);var p=sound.Ear+new Vector3((float)(Math.Cos(a)*d),0,(float)(Math.Sin(a)*d));if(Ways.Flags(p.X,p.Z)==0)return p;}
        return null;
    }
    private void Gale(double dt)
    {
        var (level,gust,_)=Tempest();if(level<.12||sound==null)return;
        gustNext-=dt;
        if(gust>.9&&lastGust<=.9&&gustNext<=0)
        {
            gustNext=2.5;
            var wind=Daylight.I?.Wind.Normalized()??Vector2.Right;
            var p=sound.Ear-new Vector3(wind.X*22,0,wind.Y*22);p.Y=7;
            if(sound.Placed(p,new(30,400,1e9,Occl:0,Wet:.5,Gain:.9*level,Must:true),AliveSounds.GustRoar(Math.Min(1,gust/2.4),Rand(3,5.5)),"storm gust"))GaleStarts++;
        }
        lastGust=gust;
        bangNext-=dt;slateNext-=dt;signNext-=dt;caskNext-=dt;
        if(bangNext<=0){bangNext=Rand(1.2,4.5)/Math.Max(.25,level);if(WallNear() is {} p){p.Y=(float)Rand(1.5,5);if(sound.Placed(p,new(4,60,110,Wet:.35),AliveSounds.ShutterBang(1+galeDice.Next(4)),"storm shutter"))GaleStarts++;}}
        if(slateNext<=0){slateNext=Rand(7,18)/Math.Max(.25,level);if(WallNear() is {} p){p.Y=1;if(sound.Placed(p,new(4,50,90,Wet:.3),AliveSounds.SlateCrash(),"storm slate"))GaleStarts++;}}
        if(signNext<=0){signNext=Rand(4,10)/Math.Max(.25,level);if(WallNear() is {} p){p.Y=3.2f;if(sound.Placed(p,new(2.5,30,45,Wet:.25),AliveSounds.SignCreak(),"storm sign"))GaleStarts++;}}
        if(caskNext<=0){caskNext=Rand(25,60)/Math.Max(.25,level);if(OpenNear() is {} p){p.Y=.3f;if(sound.Placed(p,new(3,40,60,Wet:.2),AliveSounds.RollingCask(Rand(2.5,5)),"storm cask"))GaleStarts++;}}
        if(level>.2&&town?.Walk!=null)
        {
            surfLook-=dt;surfNext-=dt;
            if(surfLook<=0)
            {
                surfLook=1;surfEdges.Clear();var eye=sound.Ear;
                for(int k=0;k<16;k++)
                {
                    double a=k*Math.PI/8,dx=Math.Cos(a),dz=Math.Sin(a);
                    for(double d=2;d<40;d+=.8)
                    {
                        float x=(float)(eye.X+dx*d),z=(float)(eye.Z+dz*d);
                        if(Ways.Flags(x,z)!=2)continue;
                        bool river=true;for(int reach=2;reach<25;reach+=2)if(Ways.Flags(x+dx*reach,z+dz*reach)!=2){river=false;break;}
                        float lx=(float)(x-dx*.8),lz=(float)(z-dz*.8);double top=town.Walk.BaseAt(lx,lz);
                        if(river&&town.Walk.Free(lx,lz)&&double.IsFinite(top))surfEdges.Add(new(lx,(float)top+.5f,lz));break;
                    }
                }
            }
            if(surfNext<=0&&surfEdges.Count>0)
            {
                surfNext=Rand(.5,2)/level;var p=surfEdges[galeDice.Next(surfEdges.Count)];
                double big=(.5+.5*galeDice.NextDouble())*level;
                if(sound.Placed(p,new(5,70,120,Wet:.35,Gain:1.2),AliveSounds.WaveSlam(Math.Min(1,.4+big)),"storm wave at quay"))GaleStarts++;
            }
        }
    }
}
