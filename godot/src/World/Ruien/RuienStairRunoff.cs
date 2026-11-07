using System;
using Godot;

namespace Scheldemist.World.Ruien;

/// <summary>A transparent damp/sediment film conforming to the paving below each downpipe. No plate or collision.</summary>
public partial class RuienStairRunoff : Node3D
{
    public RuienEntrance.Spec Spec=null!;
    public float Back;
    private static ShaderMaterial? material;
    public override async void _Ready()
    {
        await ToSignal(GetTree(),SceneTree.SignalName.PhysicsFrame);
        await ToSignal(GetTree(),SceneTree.SignalName.PhysicsFrame);
        if(!IsInsideTree())return;
        if(material==null)
        {
            var stone=(ShaderMaterial)ResourceLoader.Load<Material>("res://world/town/resources/r000648.res").Duplicate();
            var shader=new Shader{Code=stone.Shader.Code.Replace("c.rgb *= COLOR.rgb;","c.rgb *= COLOR.rgb; ALPHA = COLOR.a;")};
            stone.Shader=shader;stone.RenderPriority=-1;material=stone;
        }
        var t=new SurfaceTool();t.Begin(Mesh.PrimitiveType.Triangles);
        foreach(float side in new[]{-1f,1f})
        {
            const int nx=10,nz=14;
            Vector3 Local(int i,int j)=>new(side*(RuienStairHouse.Half+.08f+i*.072f),0,Back+.35f+(j-7)*.055f);
            void V(int i,int j)
            {
                var local=Local(i,j);var at=GlobalTransform*local;
                var q=PhysicsRayQueryParameters3D.Create(at+Vector3.Up*.5f,at-Vector3.Up*.5f,Solid.Layer);
                var hit=GetWorld3D().DirectSpaceState.IntersectRay(q);
                if(hit.Count>0)at.Y=hit["position"].AsVector3().Y+.003f;
                float u=i/(float)nx,v=(j-nz/2f)/(nz/2f);
                float a=Math.Clamp((1-v*v)*(1-MathF.Pow((u-.48f)*1.9f,2)),0,1)*.38f;
                if(MathF.Abs(local.X)>RuienStairHouse.Half+.38f && MathF.Abs(local.Z-Back-.35f)<.25f)a=0;
                a*=.65f+.35f*MathF.Sin(local.Z*41+local.X*17)*MathF.Sin(local.X*35);
                t.SetColor(new Color(.23f,.24f,.18f,a));t.SetNormal(Vector3.Up);t.SetUV(new Vector2(at.X,at.Z)/1.2f);
                t.AddVertex(GlobalTransform.AffineInverse()*at);
            }
            for(int i=0;i<nx;i++)for(int j=0;j<nz;j++)
            {
                if(side>0){V(i,j);V(i+1,j+1);V(i+1,j);V(i,j);V(i,j+1);V(i+1,j+1);}
                else {V(i,j);V(i+1,j);V(i+1,j+1);V(i,j);V(i+1,j+1);V(i,j+1);}
            }
        }
        AddChild(new MeshInstance3D{Name="runoff_film",Mesh=t.Commit(),MaterialOverride=material,
            CastShadow=GeometryInstance3D.ShadowCastingSetting.Off,VisibilityRangeEnd=35,VisibilityRangeEndMargin=4});
    }
}
