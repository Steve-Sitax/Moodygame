using System;
using System.Collections.Generic;
using System.Text.Json;
using Godot;
using Scheldemist.Models;
using Scheldemist.Net;
using Scheldemist.Play;
using Scheldemist.Player;

namespace Scheldemist.World.Ruien;

/// <summary>A shared native door state drives both cast leaves and their actual moving collision.</summary>
public partial class RuienHatch : Node3D
{
    public static readonly Dictionary<string,RuienHatch> All=new();
    public static float Light(string source)
    {
        foreach(var hatch in All.Values)if(hatch.Way.LightSource==source)return hatch.Open;
        return 1;
    }
    public RuienData.Way Way=null!;
    public float Open { get; private set; }
    public bool Target { get; private set; }
    public bool Known { get; private set; }
    private readonly List<(Node3D hinge,float sign)> leaves=new();
    private float poll;
    private bool pending;

    public override void _Ready()
    {
        All[Way.Id]=this;
        float half=Way.Hole.Size.X/2,length=Way.Hole.Size.Y;
        foreach(float side in new[]{-1f,1f})
        {
            var hinge=new Node3D{Name=side<0?"left_lid":"right_lid",Position=new Vector3(side*half,0,0)};
            AddChild(hinge);leaves.Add((hinge,-side));
            var st=new SurfaceTool();st.Begin(Mesh.PrimitiveType.Triangles);
            void Box(Vector3 p,Vector3 size,float r=.002f)=>st.AppendFrom(BevelMesh.Box(size,r,RuienMaterials.Get("ruien_iron")),0,new Transform3D(Basis.Identity,p));
            float x=-side*half/2;
            Box(new Vector3(x,-.021f,length/2),new Vector3(half-.008f,.042f,length-.01f),.003f);
            // A real rebated meeting edge closes the centre joint beneath the other leaf.
            // The player's narrow ground probe must land on iron here, not pass through the seam.
            if(side<0)Box(new Vector3(half,-.052f,length/2),new Vector3(.05f,.025f,length-.04f),.001f);
            foreach(float edge in new[]{.045f,half-.045f})Box(new Vector3(-side*edge,-.052f,length/2),new Vector3(.038f,.042f,length-.06f));
            for(float z=.10f;z<length;z+=.45f)
            {
                Box(new Vector3(x,-.052f,z),new Vector3(half-.04f,.04f,.038f));
                foreach(float edge in new[]{.035f,half-.035f})
                    Box(new Vector3(-side*edge,.002f,z),new Vector3(.018f,.012f,.018f),.004f);
            }
            // Flush lifting recess and folding handle, and three substantial hinge straps.
            Box(new Vector3(-side*(half-.12f),.002f,length*.23f),new Vector3(.09f,.012f,.18f));
            foreach(float dz in new[]{-.055f,.055f})
                Box(new Vector3(-side*(half-.12f),.011f,length*.23f+dz),new Vector3(.052f,.012f,.014f));
            Box(new Vector3(-side*(half-.095f),.011f,length*.23f),new Vector3(.014f,.012f,.12f));
            foreach(float z in new[]{.16f,length/2,length-.16f})
            {
                Box(new Vector3(-side*.10f,-.005f,z),new Vector3(.23f,.025f,.065f));
                // Machined pin ends stay flat; the cylindrical barrel has a real curved silhouette.
                // AppendFrom does not combine indexed cylinders with the unindexed bevel boxes safely.
                // Keep one unindexed stream, otherwise only the final pins survive the index buffer.
                var pin=new SurfaceTool();pin.CreateFrom(new CylinderMesh{TopRadius=.022f,BottomRadius=.022f,Height=.11f,RadialSegments=32},0);pin.Deindex();
                st.AppendFrom(pin.Commit(),0,
                    new Transform3D(new Basis(Vector3.Right,Mathf.Pi/2),new Vector3(0,-.004f,z)));
            }
            RuienStair.Add(hinge,st,"ruien_iron",true);
        }
        // Providers are installed after the interaction part is ready.
        CallDeferred(MethodName.Install);
    }
    private void Install()=>Interact.I?.AddProvider(Keys);
    public override void _ExitTree()=>All.Remove(Way.Id);
    private Offers? Keys(float x,float z)
    {
        var j=Jef.I;
        if(!Known||pending||j==null||j.Fly||j.Climbing||j.Frozen)return null;
        var box=Way.Hole;var close=new Vector2(Math.Clamp(x,box.Position.X,box.End.X),Math.Clamp(z,box.Position.Y,box.End.Y));
        if(Target&&box.HasPoint(new Vector2(x,z))&&j.Y> -1.85f&&j.Y<.10f)return null;
        float distance=new Vector2(x,z).DistanceTo(close);
        if(distance>1.4f||j.Y< -1.8f||j.Y> .6f)return null;
        return new Offers{Options=new(){(distance,Act.At(Key.E,Target?"close the iron lids":"open the iron lids",new Vector3(close.X,.1f,close.Y),()=>Set(!Target)))}};
    }
    public void Set(bool open)
    {
        var api=ServerLink.I?.Api;if(api==null||pending)return;
        pending=true;
        api.Run(api.Post<JsonElement>("api/ruien/hatches/"+Way.Id,new{open}),Read,_=>pending=false);
    }
    private void Read(JsonElement state)
    {
        pending=false;Target=state.GetProperty("open").GetBoolean();
        if(!Known){Open=Target?1:0;Known=true;}
    }
    public override void _PhysicsProcess(double delta)
    {
        if((poll-=(float)delta)<=0&&!pending&&ServerLink.I?.Api is{} api)
        {
            poll=1;pending=true;api.Run(api.Get<JsonElement>("api/ruien/hatches/"+Way.Id),Read,_=>pending=false);
        }
        Open=Mathf.MoveToward(Open,Target?1:0,(float)delta*.48f);
        foreach(var (hinge,sign) in leaves)hinge.Rotation=new Vector3(0,0,sign*Open*Mathf.DegToRad(85));
    }
}
