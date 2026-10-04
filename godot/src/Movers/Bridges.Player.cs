using System;
namespace Scheldemist.Movers;
public partial class Bridges
{
    public static float PlayerLeafUnderside(DrawLeaf l,float amount,float x,float z)
    {float dx=x-l.Hx,dz=z-l.Hz,lx=dx*MathF.Cos(l.Yaw)-dz*MathF.Sin(l.Yaw),lz=dx*MathF.Sin(l.Yaw)+dz*MathF.Cos(l.Yaw);if(Math.Abs(lz)>l.Half||lx<0)return float.PositiveInfinity;float a=DrawBridge.DrawMax*amount;if(lx>l.L*MathF.Cos(a)+.42f*MathF.Sin(a))return float.PositiveInfinity;return lx*MathF.Tan(a)-.42f/MathF.Cos(a);}
    public float PlayerUnderside(float x,float z)
    {float y=float.PositiveInfinity;for(int i=0;i<ctls.Count;i++)foreach(var leaf in Defs[i].Leaves)y=Math.Min(y,PlayerLeafUnderside(leaf,ctls[i].Open,x,z));return Math.Min(y,Lock.I?.PlayerUnderside(x,z)??float.PositiveInfinity);}
}
