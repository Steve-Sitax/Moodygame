using System;
using Godot;
using Scheldemist.Models;
using Scheldemist.Movers;
using Scheldemist.World;

namespace Scheldemist.Play;

/// <summary>The browser's rower, including whole-hull fending and the individual oar stroke.</summary>
public sealed class RowPhysics
{
    public readonly record struct Hull(float Half,float Beam,float SeatZ,float SeatY,float Speed,Vector3 Pin,float Draft)
    {
        public static Hull Of(string kind)
        {
            // shared/smallBoats.ts is authoritative for the browser; an older shared model bake can carry older extras.
            return kind switch
            {
                "rowboat"=>new(2.65f,.72f,-.43f,.38f,1,new(.77f,.62f,.25f),.25f),
                "punt"=>new(2.55f,.64f,-1.25f,.38f,.9f,new(.68f,.56f,-.6f),.2f),
                "workboat"=>new(2.94f,.86f,-.84f,.368f,.85f,new(.945f,.58f,-.16f),.25f),
                "dinghy"=>new(2.107f,.753f,-.172f,.386f,.95f,new(.798f,.607f,.508f),.25f),
                "shipsboat"=>new(3.087f,.883f,0,.442f,1,new(.939f,.662f,.68f),.3f),
                "gig"=>new(3.626f,.642f,.148f,.344f,1.15f,new(.686f,.564f,.828f),.25f),
                "bumboat"=>new(2.45f,.907f,.6f,.415f,.8f,new(.808f,.668f,1.28f),.3f),
                "eelboat"=>new(3.038f,.93f,-1.24f,.379f,.8f,new(1.018f,.584f,-.56f),.25f),
                "oldboat"=>new(2.4f,.698f,-.294f,.386f,.7f,new(.757f,.606f,.386f),.3f),
                _=>throw new InvalidOperationException("no rowing hull for "+kind)
            };
        }
    }
    public interface IWorld {bool Free(float x,float z,float radius);Vector2 Current(float x,float z);}
    public float X,Z,Y,Heading,Speed,Turn,Phase,Port,Starboard,Pitch,Roll,Time;
    public bool Hard;
    public Hull Shape;
    private bool caught;
    public void Start(float x,float z,float heading,Hull hull)
    {X=x;Z=z;Heading=heading;Shape=hull;Y=BoatWater.At(x,z);Speed=Turn=Phase=Port=Starboard=Pitch=Roll=Time=0;caught=false;}
    public Vector3 Seat=>new(X+MathF.Sin(Heading)*Shape.SeatZ,Y+Shape.SeatY,Z+MathF.Cos(Heading)*Shape.SeatZ);
    public bool Blocked(IWorld w,float x,float z,float h)
    {float hl=Shape.Half-Shape.Beam*.6f,fx=MathF.Sin(h),fz=MathF.Cos(h);for(int k=-1;k<=1;k++)if(!w.Free(x+fx*hl*k,z+fz*hl*k,Shape.Beam))return true;return false;}
    private Vector2? Fend(IWorld w,float h)
    {
        float fx=MathF.Sin(Heading),fz=MathF.Cos(Heading);
        for(int i=0;i<4;i++){float dx=i==0?fz:i==1?-fz:i==2?-fx:fx,dz=i==0?-fx:i==1?fx:i==2?-fz:fz;float x=X+dx*.03f,z=Z+dz*.03f;if(!Blocked(w,x,z,h))return new(x,z);}return null;
    }
    public bool Step(float dt,IWorld w,bool forward,bool back,bool left,bool right,bool hard,out float bump)
    {
        bump=0;Time+=dt;Hard=hard&&(forward||back||left||right);
        float p=0,s=0;if(forward)p=s=1;else if(back)p=s=-1;
        if(left&&!right){s=forward||!back?1:-.4f;p=forward?.35f:back?-1:-.7f;}else if(right&&!left){p=forward||!back?1:-.4f;s=forward?.35f:back?-1:-.7f;}
        float ease=1-MathF.Exp(-dt*5);Port+=(p-Port)*ease;Starboard+=(s-Starboard)*ease;bool working=Math.Abs(p)+Math.Abs(s)>0,stroke=false;
        if(working||Phase>0){float was=Phase;Phase=(Phase+(Hard?1/1.35f:1/1.8f)*dt)%1;if(!working&&Phase<was)Phase=0;if(Phase<.45f&&!caught&&working){caught=true;stroke=true;}if(Phase>=.45f)caught=false;}
        float surge=Phase<.45f&&working?MathF.Sin(MathF.PI*Phase/.45f)/.2865f:0,k=(Hard?1.5f:.9f)*Shape.Speed,drive=working?k*(.6f+.4f*surge):0,both=(Port+Starboard)/2,diff=(Starboard-Port)/2;
        float v=Speed+drive*(both>=0?both:both*.65f)*dt;v-=(.08f*v+.35f*v*Math.Abs(v))*dt;
        float turn=Turn+(working?.55f+.45f*surge:0)*.95f*diff*dt;turn-=turn*1.8f*dt;turn-=turn*Math.Min(1,Math.Abs(v)*.15f)*dt;
        float sea=MoverClock.Sea;if(sea>2.5f)turn+=MathF.Sin(Time*.37f)*.04f*(sea-2.5f)*dt;
        var current=w.Current(X,Z);float h1=Heading+turn*dt,nx=X+(MathF.Sin(h1)*v+current.X)*dt,nz=Z+(MathF.Cos(h1)*v+current.Y)*dt,h=h1;
        if(Blocked(w,nx,nz,h))
        {
            float hit=Math.Abs(v),bx=-MathF.Sin(Heading)*.04f*Math.Sign(v==0?1:v),bz=-MathF.Cos(Heading)*.04f*Math.Sign(v==0?1:v);var fend=Math.Abs(turn)>.03f?Fend(w,h1):null;
            if(!Blocked(w,X,Z,h1)){nx=X;nz=Z;v*=MathF.Pow(.5f,dt*60);}
            else if(fend is {} f){nx=f.X;nz=f.Y;v*=MathF.Pow(.5f,dt*60);}
            else if(!Blocked(w,nx,Z,Heading)){nz=Z;h=Heading;v*=MathF.Pow(.6f,dt*60);}
            else if(!Blocked(w,X,nz,Heading)){nx=X;h=Heading;v*=MathF.Pow(.6f,dt*60);}
            else if(!Blocked(w,X+bx,Z+bz,h1)){nx=X+bx;nz=Z+bz;v=0;}
            else{nx=X;nz=Z;h=Heading;v=-.2f*v;turn*=.3f;}if(hit>.45f)bump=hit;
        }
        X=nx;Z=nz;Heading=h;Speed=v;Turn=turn;
        float fx=MathF.Sin(h),fz=MathF.Cos(h),len=Shape.Half*.75f,beam=Shape.Beam*.8f;
        float mid=BoatWater.At(X,Z),bow=BoatWater.At(X+fx*len,Z+fz*len),stern=BoatWater.At(X-fx*len,Z-fz*len),py=BoatWater.At(X+fz*beam,Z-fx*beam),sy=BoatWater.At(X-fz*beam,Z+fx*beam),e=1-MathF.Exp(-dt*4);
        Y+=((mid*2+bow+stern)/4-Y)*e;Pitch+=(MathF.Atan2(bow-stern,2*len)*.8f+surge*.004f-Pitch)*e;Roll+=(MathF.Atan2(py-sy,2*beam)*.7f+MathF.Sin(Time*1.9f)*.008f*Math.Min(sea,2.5f)-Roll)*e;
        return stroke;
    }
}
