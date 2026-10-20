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
    private bool? requested;

    public override void _Ready()
    {
        All[Way.Id]=this;
        float half=Way.Hole.Size.X/2+.055f,length=Way.Hole.Size.Y;
        var anchors=new SurfaceTool();anchors.Begin(Mesh.PrimitiveType.Triangles);
        foreach(float side in new[]{-1f,1f})
        {
            var hinge=new Node3D{Name=side<0?"left_lid":"right_lid",Position=new Vector3(side*half,RuienSurround.LidTop,0)};
            AddChild(hinge);leaves.Add((hinge,-side));
            var st=new SurfaceTool();st.Begin(Mesh.PrimitiveType.Triangles);
            void Box(Vector3 p,Vector3 size,float r=.002f)=>st.AppendFrom(BevelMesh.Box(size,r,RuienMaterials.Get("ruien_iron")),0,new Transform3D(Basis.Identity,p));
            float x=-side*half/2;
            Box(new Vector3(x,-.021f,length/2),new Vector3(half-.008f,.042f,length+.05f),.003f);
            // Low cast traction ribs make the closed plate legible at a grazing angle.
            for(float z=.12f;z<length-.06f;z+=.16f)
                foreach(float u in new[]{.22f,.44f})
                    Box(new Vector3(-side*u,.002f,z),new Vector3(.10f,.004f,.018f),.001f);
            // A real rebated meeting edge closes the centre joint beneath the other leaf.
            // The player's narrow ground probe must land on iron here, not pass through the seam.
            if(side<0)Box(new Vector3(half,-.052f,length/2),new Vector3(.05f,.025f,length-.04f),.001f);
            for(float z=.10f;z<length;z+=.45f)
                foreach(float edge in new[]{.035f,half-.035f})
                    Box(new Vector3(-side*edge,.002f,z),new Vector3(.018f,.012f,.018f),.004f);
            Underside(hinge,side,half,length);
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
                // Fixed anchor shoe is let into the outer coping, separate from the rotating leaf.
                anchors.AppendFrom(BevelMesh.Box(new Vector3(.18f,.025f,.10f),.003f,RuienMaterials.Get("ruien_iron")),0,
                    new Transform3D(Basis.Identity,new Vector3(side*(half+.09f),.066f,z)));
                anchors.AppendFrom(BevelMesh.Box(new Vector3(.05f,.065f,.115f),.003f,RuienMaterials.Get("ruien_iron")),0,
                    new Transform3D(Basis.Identity,new Vector3(side*(half+.025f),.035f,z)));
                foreach(float dz in new[]{-.027f,.027f})
                    anchors.AppendFrom(BevelMesh.Box(new Vector3(.022f,.012f,.022f),.003f,RuienMaterials.Get("ruien_iron")),0,
                        new Transform3D(Basis.Identity,new Vector3(side*(half+.13f),.084f,z+dz)));
                // The shoe's strap runs down the stone reveal, leaded in and bolted: what one sees from the stair.
                float reveal=Way.Hole.Size.X/2;
                anchors.AppendFrom(BevelMesh.Box(new Vector3(.014f,.215f,.105f),.003f,RuienMaterials.Get("ruien_iron")),0,
                    new Transform3D(Basis.Identity,new Vector3(side*(reveal-.007f),-.122f,z)));
                anchors.AppendFrom(BevelMesh.Box(new Vector3(.03f,.012f,.105f),.003f,RuienMaterials.Get("ruien_iron")),0,
                    new Transform3D(Basis.Identity,new Vector3(side*(reveal-.002f),-.021f,z)));
                foreach(float by in new[]{-.075f,-.185f})foreach(float dz in new[]{-.03f,.03f})
                    anchors.AppendFrom(BevelMesh.Box(new Vector3(.012f,.022f,.022f),.004f,RuienMaterials.Get("ruien_iron")),0,
                        new Transform3D(Basis.Identity,new Vector3(side*(reveal-.019f),by,z+dz)));
                // Lead caulking round the strap where it is let into the bluestone.
                anchors.AppendFrom(BevelMesh.Box(new Vector3(.006f,.225f,.118f),.002f,RuienMaterials.Get("ruien_iron")),0,
                    new Transform3D(Basis.Identity,new Vector3(side*(reveal-.002f),-.119f,z)));
            }
            RuienStair.Add(hinge,st,"ruien_iron",true);
        }
        RuienStair.Add(this,anchors,"ruien_iron",true);
        // Providers are installed after the interaction part is ready.
        CallDeferred(MethodName.Install);
    }
    /// <summary>
    /// A leaf's underside as one sees it from the stair: riveted angle frame, a deep T-rib every 45 cm, a central
    /// stiffener and a drop ring, with rust bloom and soot in the panels (weather colour) and their occlusion.
    /// Built in the hinge's frame: u runs from the hinge (0) to the meeting edge, z along the flight.
    /// </summary>
    private static void Underside(Node3D hinge,float side,float half,float length)
    {
        var st=new SurfaceTool();st.Begin(Mesh.PrimitiveType.Triangles);st.SetCustomFormat(0,SurfaceTool.CustomFormat.Rgba8Unorm);
        const float plate=-.042f;
        void B(float u,float y,float z,Vector3 size,float r,Color w,float ao)
        {
            var a=BevelMesh.Box(size,r,null!).SurfaceGetArrays(0);
            var p=a[(int)Mesh.ArrayType.Vertex].AsVector3Array();var n=a[(int)Mesh.ArrayType.Normal].AsVector3Array();var uv=a[(int)Mesh.ArrayType.TexUV].AsVector2Array();
            var at=new Vector3(-side*u,y,z);
            for(int i=0;i<p.Length;i++){st.SetNormal(n[i]);st.SetUV(uv[i]+new Vector2(at.X+at.Z*.37f,at.Y+at.Z));st.SetColor(w);st.SetCustom(0,new Color(0,0,0,ao));st.AddVertex(at+p[i]);}
        }
        // Rust bloom and soot vary from panel to panel (a hash of the panel), salts gather on the low edge.
        Color Panel(int k)=>new(.12f+.2f*((k*37)%10)/10f,.03f+.08f*((k*53)%7)/7f,.04f+.12f*((k*29)%9)/9f,0);
        float m=half-.006f;
        // Soot-dark panel skin between the members.
        B(m/2,plate-.0015f,length/2,new Vector3(m-.02f,.003f,length-.02f),.001f,new Color(.55f,.08f,.8f,0),.38f);
        // Perimeter angle: flange riveted to the plate, leg hanging 60 mm.
        foreach(float u in new[]{.068f,m-.028f})
        {
            B(u,plate-.004f,length/2,new Vector3(.05f,.008f,length-.03f),.002f,new Color(.15f,.05f,.1f,0),.85f);
            B(u+(u<.1f?.022f:-.022f),plate-.038f,length/2,new Vector3(.009f,.06f,length-.05f),.002f,new Color(.2f,.04f,.12f,0),.8f);
            for(float z=.06f;z<length-.04f;z+=.085f)B(u,plate-.011f,z,new Vector3(.019f,.009f,.019f),.0045f,new Color(.08f,.1f,.02f,0),.95f);
        }
        foreach(float z in new[]{.03f,length-.03f})
        {
            B(m/2+.02f,plate-.004f,z,new Vector3(m-.1f,.008f,.05f),.002f,new Color(.15f,.05f,.1f,0),.85f);
            B(m/2+.02f,plate-.038f,z+(z<1?.022f:-.022f),new Vector3(m-.12f,.06f,.009f),.002f,new Color(.2f,.04f,.12f,0),.8f);
            for(float u=.11f;u<m-.05f;u+=.085f)B(u,plate-.011f,z,new Vector3(.019f,.009f,.019f),.0045f,new Color(.08f,.1f,.02f,0),.95f);
        }
        // Transverse T-ribs and their rivet rows.
        int k=0;
        for(float z=.475f;z<length-.3f;z+=.45f,k++)
        {
            B(m/2+.02f,plate-.004f,z,new Vector3(m-.12f,.008f,.06f),.002f,Panel(k),.8f);
            B(m/2+.02f,plate-.043f,z,new Vector3(m-.14f,.07f,.012f),.002f,Panel(k+3),.72f);
            B(m/2+.02f,plate-.082f,z,new Vector3(m-.15f,.01f,.05f),.003f,Panel(k+5),.85f);
            for(float u=.13f;u<m-.07f;u+=.1f)foreach(float dz in new[]{-.021f,.021f})
                B(u,plate-.011f,z+dz,new Vector3(.018f,.009f,.018f),.0042f,new Color(.08f,.12f,.02f,0),.95f);
        }
        // Central stiffener along the leaf, stopping at each rib.
        B(m*.55f,plate-.03f,length/2,new Vector3(.012f,.05f,length-.12f),.002f,new Color(.2f,.05f,.15f,0),.8f);
        B(m*.55f,plate-.057f,length/2,new Vector3(.03f,.008f,length-.12f),.002f,new Color(.18f,.06f,.1f,0),.85f);
        // A forged drop ring near the meeting edge, for pulling the leaf shut from below.
        float rz=length*.62f,ru=m-.13f;
        B(ru,plate-.02f,rz,new Vector3(.045f,.012f,.045f),.004f,new Color(.3f,.1f,.4f,0),.85f);
        for(int i=0;i<12;i++)
        {
            float a=i*Mathf.Tau/12;var c=new Vector3(0,-.06f+.04f*MathF.Cos(a),.04f*MathF.Sin(a));
            var b=BevelMesh.Box(new Vector3(.014f,.024f,.014f),.005f,null!).SurfaceGetArrays(0);
            var p=b[(int)Mesh.ArrayType.Vertex].AsVector3Array();var n=b[(int)Mesh.ArrayType.Normal].AsVector3Array();var uv=b[(int)Mesh.ArrayType.TexUV].AsVector2Array();
            var rot=new Basis(Vector3.Right,-a);var at=new Vector3(-side*ru,plate+c.Y,rz+c.Z);
            for(int j=0;j<p.Length;j++){st.SetNormal(rot*n[j]);st.SetUV(uv[j]);st.SetColor(new Color(.3f,.1f,.35f,0));st.SetCustom(0,new Color(0,0,0,.85f));st.AddVertex(at+rot*p[j]);}
        }
        RuienStair.Add(hinge,st,"ruien_iron",true);
    }

    private void Install()=>Interact.I?.AddProvider(Keys);
    public override void _ExitTree()=>All.Remove(Way.Id);
    private Offers? Keys(float x,float z)
    {
        var j=Jef.I;
        if(!Known||pending||requested.HasValue||MathF.Abs(Open-(Target?1:0))>.01f||j==null||j.Fly||j.Climbing||j.Frozen)return null;
        var box=Way.Hole;var close=new Vector2(Math.Clamp(x,box.Position.X,box.End.X),Math.Clamp(z,box.Position.Y,box.End.Y));
        if(Target&&box.HasPoint(new Vector2(x,z))&&j.Y> -1.85f&&j.Y<.10f)return null;
        float distance=new Vector2(x,z).DistanceTo(close);
        if(distance>1.4f||j.Y< -1.8f||j.Y> .6f)return null;
        return new Offers{Options=new(){(distance,Act.At(Key.E,Target?"close the iron lids":"open the iron lids",new Vector3(close.X,.1f,close.Y),()=>Set(!Target)))}};
    }
    public void Set(bool open)
    {
        // An interaction must not disappear when a state poll is already in flight.
        requested=open;
    }
    private void Read(JsonElement state)
    {
        pending=false;Target=state.GetProperty("open").GetBoolean();
        if(!Known){Open=Target?1:0;Known=true;}
    }
    public override void _PhysicsProcess(double delta)
    {
        poll-=(float)delta;
        if(!pending&&ServerLink.I?.Api is{} api)
        {
            if(requested is bool open)
            {
                requested=null;pending=true;poll=1;
                api.Run(api.Post<JsonElement>("api/ruien/hatches/"+Way.Id,new{open}),Read,_=>pending=false);
            }
            else if(poll<=0)
            {
                poll=1;pending=true;api.Run(api.Get<JsonElement>("api/ruien/hatches/"+Way.Id),Read,_=>pending=false);
            }
        }
        Open=Mathf.MoveToward(Open,Target?1:0,(float)delta*.48f);
        foreach(var (hinge,sign) in leaves)hinge.Rotation=new Vector3(0,0,sign*Open*Mathf.DegToRad(85));
    }
}
