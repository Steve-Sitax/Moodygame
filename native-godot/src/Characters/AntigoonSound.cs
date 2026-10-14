using Godot;
using System;

namespace Scheldemist.Native.Characters;

/// <summary>Original runtime heartbeat and bellow synthesis, plus the project's CC0 impact samples.</summary>
public partial class AntigoonSound : Node
{
    private AudioStreamPlayer pulse=null!;
    private AudioStreamPlayer3D kick=null!,stomp=null!,voice=null!;
    private AudioStreamWav bellow=null!,snarl=null!;
    private int roars,swing;
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
        kick=new AudioStreamPlayer3D {Stream=ResourceLoader.Load<AudioStream>("res://world/data/public/audio/kenney-impact/impactSoft_heavy_001.ogg"),PitchScale=.5f,VolumeDb=-2,MaxDistance=35,UnitSize=6};actor.AddChild(kick);
        stomp=new AudioStreamPlayer3D {Stream=ResourceLoader.Load<AudioStream>("res://world/data/public/audio/kenney-impact/impactSoft_heavy_000.ogg"),PitchScale=.42f,VolumeDb=-1,MaxDistance=50,UnitSize=8};actor.AddChild(stomp);
        voice=new AudioStreamPlayer3D {MaxDistance=90,UnitSize=12,VolumeDb=2,Position=Vector3.Up*4.8f};actor.AddChild(voice);
        bellow=Voice(1.7,64,1);snarl=Voice(.55,92,2);
    }
    /// <summary>Original giant's voice: a rough low glottal pulse through an open-throat vowel, with breath noise.</summary>
    private static AudioStreamWav Voice(double seconds,double pitch,int seed)
    {
        const int rate=22050;int count=(int)(rate*seconds);var bytes=new byte[count*2];var rng=new Random(seed);
        double phase=0,breath=0,rough=0;
        for(int i=0;i<count;i++)
        {
            double t=(double)i/rate,u=t/seconds;
            double f=pitch*(1+.38*Math.Sin(Math.PI*Math.Min(1,u*1.6))-.22*u)+3*Math.Sin(t*37)+(rng.NextDouble()-.5)*6;
            phase+=2*Math.PI*f/rate;double sound=0;
            for(int h=1;h<=28;h++)
            {
                double hz=f*h,form=.35+1.8*Math.Exp(-Math.Pow((hz-520)/160,2))+1.2*Math.Exp(-Math.Pow((hz-980)/220,2))+.5*Math.Exp(-Math.Pow((hz-2500)/500,2));
                sound+=Math.Sin(phase*h+h*h*.13)*form/h;
            }
            // Vocal-fold roughness: a sub-harmonic flutter and a grinding amplitude jitter.
            rough+=(rng.NextDouble()-.5)*.35-rough*.02;
            sound*=.75+.25*Math.Sin(phase*.5)+.18*rough;
            breath+=((rng.NextDouble()-.5)-breath)*.18;
            double env=Math.Min(1,t/.09)*Math.Pow(Math.Max(0,1-u),.45)*(.8+.2*Math.Sin(t*9));
            short sample=(short)(Math.Tanh((sound*.34+breath*.9)*env*1.6)*21000);
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
        if(actor.State=="roar"&&before==0){voice.Stream=bellow;voice.PitchScale=.92f+(roars++%3)*.06f;voice.Play();}
        if(actor.State=="attack"&&before==0){voice.Stream=snarl;voice.PitchScale=.95f+(float)GD.RandRange(0,.12);voice.Play();}
        if(actor.State=="attack"&&before<.62&&time>=.62)kick.Play();
        if(actor.State=="attack"&&before<1.08&&time>=1.08){stomp.Play();actor.Stomped();}
    }
}
