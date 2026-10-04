using Godot;
namespace Scheldemist.Audio;
public static class LifeAnimalSounds
{
    public static void Snort(Vector3 head)=>Soundscape.I?.Placed(head,new(Ref:1.5,Reach:8,Max:12),AliveSounds.Snort(),"horse snort");
    public static void Hiss(double x,double z) => Soundscape.I?.Placed(new((float)x,.35f,(float)z),new(Ref:1,Reach:5,Max:7),AliveSounds.Hiss(),"cat hiss");
    public static void Wings(double x,double y,double z) => Soundscape.I?.Placed(new((float)x,(float)y,(float)z),new(Ref:1.5,Reach:10,Max:18,Gain:.3),AliveSounds.Wings(3),"bird takes flight");
}
