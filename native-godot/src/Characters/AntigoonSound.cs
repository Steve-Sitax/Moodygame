using Godot;
using Scheldemist.Native.Services;
using System;

namespace Scheldemist.Native.Characters;

/// <summary>Original runtime heartbeat, breath and swing synthesis, plus the project's CC0 impact samples.</summary>
public partial class AntigoonSound : Node
{
    private AudioStreamPlayer pulse=null!;
    private AudioStreamPlayer3D kick=null!,stomp=null!,breath=null!,swish=null!;
    private int swing;
    private AntigoonActor actor=null!;
    private double time;
    private string previous="";
    public override void _Ready()
    {
        actor=(AntigoonActor)GetParent();
        const int rate=22050,count=18742;var bytes=new byte[count*2];
        for(int i=0;i<count;i++)
        {
            double t=(double)i/rate;
            double Beat(double at,double gain){double x=t-at;return x>=0&&x<.16?gain*Math.Sin(2*Math.PI*(52*x-45*x*x))*Math.Exp(-x*29)*Math.Min(1,x/.008):0;}
            short sample=(short)(15000*(Beat(.025,1)+Beat(.205,.6)));bytes[i*2]=(byte)(sample&255);bytes[i*2+1]=(byte)(sample>>8);
        }
        pulse=new AudioStreamPlayer {Stream=new AudioStreamWav {Format=AudioStreamWav.FormatEnum.Format16Bits,MixRate=rate,Stereo=false,Data=bytes,LoopMode=AudioStreamWav.LoopModeEnum.Forward,LoopBegin=0,LoopEnd=count},VolumeDb=-80};AddChild(pulse);pulse.Play();
        kick=new AudioStreamPlayer3D {Stream=ResourceLoader.Load<AudioStream>("res://world/data/public/audio/kenney-impact/impactSoft_heavy_001.ogg"),PitchScale=.5f,VolumeDb=-2,MaxDistance=35*AntigoonSize.Scale,UnitSize=6*AntigoonSize.Scale};actor.AddChild(kick);
        stomp=new AudioStreamPlayer3D {Stream=ResourceLoader.Load<AudioStream>("res://world/data/public/audio/kenney-impact/impactSoft_heavy_000.ogg"),PitchScale=.42f,VolumeDb=-1,MaxDistance=50*AntigoonSize.Scale,UnitSize=8*AntigoonSize.Scale};actor.AddChild(stomp);
        // A slow, heavy breath out through the nose when he spots you; the air the boot moves on the swing.
        breath=new AudioStreamPlayer3D {Stream=Air(1.5,180,520,.55,1),MaxDistance=40*AntigoonSize.Scale,UnitSize=7*AntigoonSize.Scale,VolumeDb=-4,Position=Vector3.Up*(4.9f*AntigoonSize.Scale)};actor.AddChild(breath);
        swish=new AudioStreamPlayer3D {Stream=Air(.42,300,1400,.25,2),MaxDistance=25*AntigoonSize.Scale,UnitSize=5*AntigoonSize.Scale,VolumeDb=-6,Position=Vector3.Up*(1.2f*AntigoonSize.Scale)};actor.AddChild(swish);
    }
    /// <summary>Band-limited noise with a breath envelope: rises over `attack` of the length, then dies away.</summary>
    private static AudioStreamWav Air(double seconds,double low,double high,double attack,int seed)
    {
        const int rate=22050;int count=(int)(rate*seconds);var bytes=new byte[count*2];var rng=new Random(seed);
        double lp=0,lp2=0,hp=0,prev=0;
        double a=1-Math.Exp(-2*Math.PI*high/rate),b=Math.Exp(-2*Math.PI*low/rate);
        for(int i=0;i<count;i++)
        {
            double u=(double)i/count,noise=rng.NextDouble()*2-1;
            lp+=(noise-lp)*a;lp2+=(lp-lp2)*a;hp=b*(hp+lp2-prev);prev=lp2;
            double env=u<attack?Math.Sin(u/attack*Math.PI/2):Math.Pow(Math.Max(0,1-(u-attack)/(1-attack)),1.6);
            short sample=(short)(Math.Clamp(hp*env*3.2,-1,1)*20000);
            bytes[i*2]=(byte)sample;bytes[i*2+1]=(byte)(sample>>8);
        }
        return new AudioStreamWav{Format=AudioStreamWav.FormatEnum.Format16Bits,MixRate=rate,Data=bytes};
    }
    public override void _Process(double delta)
    {
        var camera=actor.GetViewport().GetCamera3D();
        float distance=camera==null?100:camera.GlobalPosition.DistanceTo(actor.GlobalPosition);
        float threat=actor.Visible&&actor.State is not ("hidden" or "death")?Mathf.Clamp(1-distance/22,0,1):0;
        pulse.VolumeDb=Mathf.Lerp(pulse.VolumeDb,threat>0?-36+threat*18:-80,(float)Math.Min(1,delta*3));pulse.PitchScale=1+threat*.35f;
        if(actor.State!=previous||actor.AttackSerial!=swing){time=0;previous=actor.State;swing=actor.AttackSerial;}
        double before=time;time+=delta;
        if(actor.State=="notice"&&before<.25&&time>=.25){breath.PitchScale=.9f+(float)GD.RandRange(0,.15);breath.Play();}
        if(actor.State=="attack"&&before<.4&&time>=.4){swish.PitchScale=.85f+(float)GD.RandRange(0,.2);swish.Play();}
        if(actor.State=="attack"&&before<.62&&time>=.62)kick.Play();
        if(actor.State=="attack"&&before<1.08&&time>=1.08){stomp.Play();actor.Stomped();}
    }
}
