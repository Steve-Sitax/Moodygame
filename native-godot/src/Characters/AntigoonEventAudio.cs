using Godot;
using System;
namespace Scheldemist.Native.Characters;

internal static class AntigoonEventAudio
{
    // Original voiced alarm cry: glottal harmonics, vowel formants and a rough breath envelope.
    public static void Scream(Node parent,Vector3 at,int variant)
    {
        const int rate=22050;int count=(int)(rate*.85);var bytes=new byte[count*2];var rng=new Random(variant);double phase=0;
        for(int i=0;i<count;i++)
        {
            double t=(double)i/rate,f=270+(variant%5)*34+130*Math.Sin(t/.85*Math.PI)+12*Math.Sin(t*42);phase+=2*Math.PI*f/rate;double voice=0;
            for(int h=1;h<=12;h++){double hz=f*h,form=.4+2*Math.Exp(-Math.Pow((hz-850)/250,2))+1.4*Math.Exp(-Math.Pow((hz-1500)/400,2));voice+=Math.Sin(phase*h)*form/(h*4);}
            double env=Math.Min(1,t/.035)*Math.Pow(Math.Max(0,1-t/.85),.6);short sample=(short)(Math.Clamp((voice*.8+(rng.NextDouble()-.5)*.12)*env,-1,1)*22000);
            bytes[i*2]=(byte)sample;bytes[i*2+1]=(byte)(sample>>8);
        }
        var sound=new AudioStreamPlayer3D{Position=at,MaxDistance=65,UnitSize=9,VolumeDb=-6,Stream=new AudioStreamWav{Format=AudioStreamWav.FormatEnum.Format16Bits,MixRate=rate,Data=bytes}};
        parent.AddChild(sound);sound.Finished+=sound.QueueFree;sound.Play();
    }
    // Original stone scrape: a heavy shoulder dragged along a brick wall. Low grit noise with a grinding judder,
    // swelling and dying away over a second and a half.
    public static void Scrape(Node parent,Vector3 at)
    {
        const int rate=22050;int count=(int)(rate*1.5);var bytes=new byte[count*2];var rng=new Random(1873);double lp=0,lp2=0,hp=0,prev=0,grit=0;
        double a=1-Math.Exp(-2*Math.PI*900/rate),b=Math.Exp(-2*Math.PI*140/rate);
        for(int i=0;i<count;i++)
        {
            double t=(double)i/rate,noise=rng.NextDouble()*2-1;lp+=(noise-lp)*a;lp2+=(lp-lp2)*a;hp=b*(hp+lp2-prev);prev=lp2;
            if(rng.NextDouble()<.004)grit=1;grit*=.9985;
            double judder=.55+.45*Math.Abs(Math.Sin(t*2*Math.PI*(9+3*Math.Sin(t*2.3))));
            double env=Math.Sin(Math.Min(1,t/.35)*Math.PI/2)*Math.Pow(Math.Max(0,1-Math.Max(0,t-.5)/1),1.4);
            short sample=(short)(Math.Clamp(hp*(judder+grit*.8)*env*3.4,-1,1)*21000);bytes[i*2]=(byte)sample;bytes[i*2+1]=(byte)(sample>>8);
        }
        var sound=new AudioStreamPlayer3D{Position=at,MaxDistance=70,UnitSize=10,VolumeDb=-3,Stream=new AudioStreamWav{Format=AudioStreamWav.FormatEnum.Format16Bits,MixRate=rate,Data=bytes}};
        parent.AddChild(sound);sound.Finished+=sound.QueueFree;sound.Play();
    }
    /// <summary>One of his footfalls where he cannot be seen: the same boot on stone as his walking feet.</summary>
    public static void Step(Node parent,Vector3 at)
    {
        var sound=new AudioStreamPlayer3D{Position=at,MaxDistance=55*Services.AntigoonSize.Scale,UnitSize=7*Services.AntigoonSize.Scale,VolumeDb=-5,PitchScale=.58f,Stream=ResourceLoader.Load<AudioStream>("res://world/data/public/audio/kenney-impact/footstep_concrete_003.ogg")};
        parent.AddChild(sound);sound.Finished+=sound.QueueFree;sound.Play();
    }
    public static void Impact(Node parent,Vector3 at)
    {
        var sound=new AudioStreamPlayer3D{Position=at,MaxDistance=55,UnitSize=8,VolumeDb=-6,PitchScale=1.2f,Stream=ResourceLoader.Load<AudioStream>("res://world/data/public/audio/kenney-impact/impactPlank_medium_001.ogg")};
        parent.AddChild(sound);sound.Finished+=sound.QueueFree;sound.Play();
    }
}
