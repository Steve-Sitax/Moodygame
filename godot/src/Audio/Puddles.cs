using System;
namespace Scheldemist.Audio;

/// <summary>world/puddlemask.ts: float32 hash, the same three stretches and fine cut as the ground shader.</summary>
public static class Puddles
{
    private static float Fract(float x) => x - MathF.Floor(x);
    private static float Hash(float x, float y)
    {
        float px = Fract(x * 123.34f), py = Fract(y * 456.21f);
        float d = px * (px + 45.32f) + py * (py + 45.32f);
        px += d; py += d; return Fract(px * py);
    }
    private static double Value(double x, double y)
    {
        x = (float)x; y = (float)y;
        float ix = (float)Math.Floor(x), iy = (float)Math.Floor(y);
        double fx = x-ix, fy = y-iy, ux = fx*fx*(3-2*fx), uy = fy*fy*(3-2*fy);
        double a = Hash(ix,iy), b = Hash(ix+1,iy), c = Hash(ix,iy+1), d = Hash(ix+1,iy+1);
        return (a+(b-a)*ux)*(1-uy)+(c+(d-c)*ux)*uy;
    }
    private static double Smooth(double a, double b, double x) { double t = Math.Clamp((x-a)/(b-a),0,1); return t*t*(3-2*t); }
    public static double At(double x, double z, double level, double scale = 1.1)
    {
        double pn = Value(x/17,z/17)*.55+Value(x/7.3+31.7,z/7.3+31.7)*.3+Value(x/2.9-12.1,z/2.9-12.1)*.15;
        pn = Math.Clamp((pn-.5)*2.4+.5,0,1); double threshold = .97-Math.Clamp(level*scale,0,1)*.22;
        if (pn <= threshold) return 0;
        return Smooth(threshold,threshold+.018,pn)*Smooth(.46,.56,Value(x/2.1+57.1,z/2.1+57.1))*Smooth(.3,.42,Value(x/4.7-23.9,z/4.7-23.9));
    }
}
