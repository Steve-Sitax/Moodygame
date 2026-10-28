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
    // (the shader's pud_turn: a stretch of the noise turned its own way)
    private static double Turned(double x, double z, double c, double s, double scale, double add) => Value((c*x-s*z)/scale+add,(s*x+c*z)/scale+add);
    public static double At(double x, double z, double level, double scale = 1.1)
    {
        // (the shader's pud_warp)
        double wx = x+(Value(x/2.6+5.3,z/2.6+5.3)-.5)*.7+(Value(x/.9+1.7,z/.9+1.7)-.5)*.35, wz = z+(Value(x/2.6-9.1,z/2.6-9.1)-.5)*.7+(Value(x/.9-4.3,z/.9-4.3)-.5)*.35;
        double pn = Value(wx/17,wz/17)*.55+Value(wx/7.3+31.7,wz/7.3+31.7)*.3+Value(wx/2.9-12.1,wz/2.9-12.1)*.15;
        pn = Math.Clamp((pn-.5)*2.4+.5,0,1); double threshold = .97-Math.Clamp(level*scale,0,1)*.22;
        // (the shader's finer edge, #240; not the paving's joints, which only the picture knows)
        double ed = (Turned(wx,wz,.8,.6,.55,7.7)-.5)*.05+(Turned(wx,wz,-.5,.866,.21,-3.1)-.5)*.025, pe = pn+ed;
        if (pe <= threshold) return 0;
        return Smooth(threshold,threshold+.018,pe)*Smooth(.46,.56,Turned(wx,wz,.454,-.891,2.1,57.1)+ed*1.5)*Smooth(.3,.42,Turned(wx,wz,-.6,-.8,4.7,-23.9)+ed*1.5);
    }
}
