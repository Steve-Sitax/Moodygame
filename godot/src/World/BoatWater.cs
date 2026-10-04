using System;
using Scheldemist.Movers;

namespace Scheldemist.World;

public static class BoatWater
{
    private static float Wave(float x,float z,float t,float sea)=>(MathF.Sin(x*.11f+z*.07f+t*.45f)*.08f+MathF.Sin(x*.35f+t*.9f)*.07f+MathF.Sin(z*.55f-t*.7f+x*.2f)*.05f+MathF.Sin((x+z)*1.3f+t*1.7f)*.02f)*sea+(MathF.Sin(x*.92f-z*.38f+t*2.6f)*.06f+MathF.Sin(z*1.07f+x*.55f-t*3.1f)*.045f)*Math.Max(0,sea-3.6f);
    /// <summary>The browser's four-metre water triangles, with the same wave sum as the shader.</summary>
    public static float At(float x,float z)
    {
        float x0=MathF.Floor(x/4)*4,z0=MathF.Floor(z/4)*4,fx=(x-x0)/4,fz=(z-z0)/4,t=(float)MoverClock.T,sea=MoverClock.Sea;
        float a=Wave(x0,z0,t,sea),b=Wave(x0,z0+4,t,sea),c=Wave(x0+4,z0+4,t,sea),d=Wave(x0+4,z0,t,sea);
        return Tide.LevelAt(x,z)+(fx+fz<=1?a+(d-a)*fx+(b-a)*fz:c+(b-c)*(1-fx)+(d-c)*(1-fz));
    }
}
