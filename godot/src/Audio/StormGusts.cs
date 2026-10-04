using System;
namespace Scheldemist.Audio;

/// <summary>alive/wind.ts shared-clock gust fronts. Evaluate in place without building a list each frame.</summary>
public static class StormGusts
{
    private static double Dice(string key, int window, int sample)
    {
        uint h = 0x811c9dc5;
        unchecked
        {
            foreach (char ch in key) h = (h ^ ch) * 0x01000193;
            h = (h ^ (uint)window) * 0x01000193; h = (h ^ (uint)(window * 4096)) * 0x85ebca6b;
            h = (h ^ (uint)sample) * 0x01000193; h = (h ^ (uint)(sample * 4096)) * 0x85ebca6b;
            h = (h ^ (h >> 15)) * 0x2c1b3c6d; h = (h ^ (h >> 12)) * 0x297a2d39;
        }
        return (h ^ (h >> 15)) / 4294967296.0;
    }
    public static double At(double t, string weather, double fury, double x, double z)
    {
        var (window, strength, high, speed, key) = weather switch
        {
            "fog" => (115d,.6,1.2,9.05,"gust:fog"), "mist" => (50d,1d,2d,9.8,"gust:mist"),
            "clear" => (27d,1.5,3d,10.7,"gust:clear"), "rain" => (15d,1.5,2.8,12.5,"gust:rain"),
            _ => (6d,.8,1.6,17.6,"gust:storm")
        };
        t %= 1e6; double angle = .35 + Math.Sin(t * .013) * .25, along = x * Math.Cos(angle) + z * Math.Sin(angle), g = 0;
        int first = (int)Math.Floor((t-60)/window), last = first + (int)Math.Ceiling(120/window) + 1;
        for (int w=first;w<=last;w++)
        {
            double len=2+Dice(key,w,1)*4, t0=w*window+Dice(key,w,2)*Math.Max(1,window-len), local=t-t0-along/speed;
            if (local<-.5 || local>len+1) continue;
            double k=(strength+(high-strength)*Dice(key,w,3))*(1+2*fury);
            double env=Math.Clamp((local+.5)/.8,0,1)*Math.Clamp((len+1-local)/1.5,0,1);
            g=Math.Max(g,k*env*(.75+.25*Math.Sin(local*7+x*.3)));
        }
        return g;
    }
}
