using Godot;
using System;

namespace Scheldemist.Native.Characters;

/// <summary>Original runtime heartbeat synthesis, plus the project's CC0 impact sample.</summary>
public partial class AntigoonSound : Node
{
    private AudioStreamPlayer pulse=null!;
    private AudioStreamPlayer3D kick=null!;
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
        kick=new AudioStreamPlayer3D {Stream=ResourceLoader.Load<AudioStream>("res://world/data/public/audio/kenney-impact/impactSoft_heavy_001.ogg"),PitchScale=.6f,VolumeDb=-9,MaxDistance=30,UnitSize=5};actor.AddChild(kick);
    }
    public override void _Process(double delta)
    {
        var camera=actor.GetViewport().GetCamera3D();
        float distance=camera==null?100:camera.GlobalPosition.DistanceTo(actor.GlobalPosition);
        float threat=actor.Visible&&actor.State is not ("hidden" or "death")?Mathf.Clamp(1-distance/22,0,1):0;
        pulse.VolumeDb=Mathf.Lerp(pulse.VolumeDb,threat>0?-36+threat*18:-80,(float)Math.Min(1,delta*3));pulse.PitchScale=1+threat*.35f;
        if(actor.State!=previous){time=0;previous=actor.State;}
        double before=time;time+=delta;
        if(actor.State=="attack"&&before<.62&&time>=.62)kick.Play();
    }
}
