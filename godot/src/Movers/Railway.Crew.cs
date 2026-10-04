using System;
using Godot;
using Scheldemist.People;
using Scheldemist.Audio;
using System.Collections.Generic;

namespace Scheldemist.Movers;

public partial class Railway
{
    private Human? shunter,keeper;
    private RopeLines harness=null!;
    private double keeperTime;
    private float[] soundAxles=Array.Empty<float>();
    private bool soundGate;
    private readonly Dictionary<Crane,(Emitter At,bool Hoisting,bool Travelling)> craneSounds=new();
    private void MakeCrew()
    {
        shunter=Humans.Make("carter");keeper=Humans.Make("porter");if(shunter!=null)AddChild(shunter.Root);if(keeper!=null)AddChild(keeper.Root);
        soundAxles=new float[wagons.Count*2];foreach(var c in cranes)craneSounds.Add(c,(new Emitter{Kind="crane",X=c.X,Z=c.Z,Y=6},false,false));
        harness=new("railway_harness",Boats.I.Rope);AddChild(harness);
        for(int i=0;i<32;i++)harness.Add(Vector3.Zero,Vector3.Zero);harness.Clear();
    }
    private void UpdateCrew(float dt)
    {
        var f=HorseFrame(0);bool visible=state!="shed"&&f.X>hideX;var at=new Vector3(f.X-MathF.Cos(f.Yaw)*1.25f,0,f.Z+MathF.Sin(f.Yaw)*1.25f);
        if(shunter!=null){shunter.Root.Visible=visible;shunter.Root.Transform=new(new Basis(Vector3.Up,f.Yaw+(state=="work"?1.2f:0)),at);shunter.Play(v>.08f?"walk":"idle");shunter.SetPace(Math.Max(.3f,v));if(visible)shunter.Update(dt);}
        keeperTime+=dt;float cycle=(float)(keeperTime%36);bool walks=!gate.WantOpen&&cycle<12;float z=walks?10.7f+Math.Min(cycle,12-cycle)*.85f:10.7f;
        if(keeper!=null){keeper.Root.Position=new(Gate.Face+1.3f,0,z);keeper.Root.Rotation=new(0,gate.WantOpen?-MathF.PI/2:cycle<6?0:MathF.PI,0);keeper.Play(walks?"walk":"idle");keeper.SetPace(.85f);keeper.Update(dt);}
        harness.Clear();
        if(visible)for(int i=0;i<2;i++)
        {
            var h=HorseFrame(i);var frame=new Transform3D(new Basis(Vector3.Up,h.Yaw),new(h.X,0,h.Z));
            for(int side=-1;side<=1;side+=2)
            {
                var collar=frame*new Vector3(side*.31f,1.52f,.8f);var hip=frame*new Vector3(side*.41f,1.22f,-.62f);
                var rear=HorseFrame(1);var anchor=i==0?new Transform3D(new Basis(Vector3.Up,rear.Yaw),new(rear.X,0,rear.Z))*new Vector3(side*.31f,1.52f,.8f):frame*new Vector3(side*.42f,.98f,-1.4f);
                harness.Add(collar,hip);harness.Add(hip,(hip+anchor)*.5f-Vector3.Up*.08f);harness.Add((hip+anchor)*.5f-Vector3.Up*.08f,anchor);
                var bit=frame*new Vector3(side*.17f,1.38f,1.12f);harness.Add(bit,frame*new Vector3(side*.31f,1.53f,.66f));harness.Add(bit,at+new Vector3(0,1.1f,0));
            }
        }
        if(visible){var rear=HorseFrame(1);var frame=new Transform3D(new Basis(Vector3.Up,rear.Yaw),new(rear.X,0,rear.Z));harness.Add(frame*new Vector3(-.42f,.98f,-1.4f),frame*new Vector3(.42f,.98f,-1.4f));}
        harness.Commit();UpdateSounds();
    }
    public void AddSounds(List<VehicleSound> output)
    {if(state=="shed")return;foreach(var w in wagons)output.Add(new("dray",w.X,w.Z,v>.08f?"go":"stop"));}
    private void UpdateSounds()
    {
        var sound=Soundscape.I;bool ready=sound?.Prepared==true&&Main.I.Arg("soundtest")=="";
        if(ready&&gate.WantOpen&&!soundGate)sound!.GateBell(Gate.Face,4);soundGate=gate.WantOpen;
        for(int i=0;i<wagons.Count;i++)for(int j=0;j<2;j++){float s=head-wagons[i].Front-LBuf/2+(j==0?Wb/2:-Wb/2);int k=i*2+j;if(ready&&state!="shed"&&s>soundAxles[k]&&MathF.Floor(s/9)!=MathF.Floor(soundAxles[k]/9)){var at=line.At(s);if(at.X>-345)sound!.RailClack(at.X,at.Y);}soundAxles[k]=s;}
        foreach(var c in cranes){var previous=craneSounds[c];bool hoist=c.Ops.Count>0&&c.Ops[0].T==OpT.Hoist&&Math.Abs(c.Ops[0].V-c.Hy)>.5f,travel=c.Mode=="travel";previous.At.X=c.X;previous.At.Z=c.Z;if(ready&&hoist&&!previous.Hoisting)sound!.CraneWork(previous.At);if(ready&&travel&&!previous.Travelling)sound!.GateBell(c.X,c.Z);craneSounds[c]=(previous.At,hoist,travel);}
    }
    private void CrewProbes()
    {
        YieldProbes();FeedProbe();
        if(shunter!=null)MoversTest.Add(new(){Name="railway_shunter_harness",Hour=13,Gap=3,MinMove=.1,MinTurn=0,
            Start=()=>TestAt(40),Ready=()=>shunter.Root.Visible&&v>.1f,
            Where=()=> (shunter.Root.Position,head,"shunter accompanies the prepared horse harness"),
            View=()=>{var f=HorseFrame(0);var at=new Vector3(f.X,1.15f,f.Z);return(at+new Vector3(4,1.3f,4),at);},
            Check=()=>!shunter.Root.Visible||harness.Mesh.GetSurfaceCount()==0?"shunter or prepared harness missing":""});
        if(keeper!=null)MoversTest.Add(new(){Name="railway_keeper",Hour=13,Gap=3,MinMove=.1,MinTurn=0,Start=()=>keeperTime=0,Where=()=> (keeper.Root.Position,keeperTime,"keeper walks outside gate sweep"),View=()=> (keeper.Root.Position+new Vector3(3,2,3),keeper.Root.Position+Vector3.Up)});
    }
}
