using System;
using Godot;

namespace Scheldemist.World;

/// <summary>Godot's documented row-major 3x4 MultiMesh buffer; one upload per edit.</summary>
public static class MultiMeshData
{
    public static int Stride(MultiMesh mesh)
    {
        if(mesh.TransformFormat!=MultiMesh.TransformFormatEnum.Transform3D)throw new ArgumentException("Expected a 3D MultiMesh");
        return 12+(mesh.UseColors?4:0)+(mesh.UseCustomData?4:0);
    }
    public static float[] Read(MultiMesh mesh)
    {
        int stride=Stride(mesh);var buffer=mesh.Buffer;
        if(buffer.Length==mesh.InstanceCount*stride)return buffer;
        // The dummy renderer does not expose a bulk buffer. Preserve its existing API semantics.
        buffer=new float[mesh.InstanceCount*stride];
        for(int i=0;i<mesh.InstanceCount;i++)
        {
            Transform(buffer,i*stride,mesh.GetInstanceTransform(i));
            if(mesh.UseColors)Colour(buffer,i*stride+12,mesh.GetInstanceColor(i));
            if(mesh.UseCustomData)Colour(buffer,i*stride+12+(mesh.UseColors?4:0),mesh.GetInstanceCustomData(i));
        }
        return buffer;
    }
    public static void Write(MultiMesh mesh,float[] buffer)
    {
        int stride=Stride(mesh);
        if(buffer.Length!=mesh.InstanceCount*stride)throw new ArgumentException("MultiMesh buffer size mismatch");
        if(DisplayServer.GetName()!="headless"){mesh.Buffer=buffer;return;}
        Color C(int a)=>new(buffer[a],buffer[a+1],buffer[a+2],buffer[a+3]);
        for(int i=0;i<mesh.InstanceCount;i++)
        {
            int a=i*stride;
            mesh.SetInstanceTransform(i,new Transform3D(new Basis(new Vector3(buffer[a],buffer[a+4],buffer[a+8]),new Vector3(buffer[a+1],buffer[a+5],buffer[a+9]),new Vector3(buffer[a+2],buffer[a+6],buffer[a+10])),Origin(buffer,a)));
            if(mesh.UseColors)mesh.SetInstanceColor(i,C(a+12));
            if(mesh.UseCustomData)mesh.SetInstanceCustomData(i,C(a+12+(mesh.UseColors?4:0)));
        }
    }
    public static Vector3 Origin(float[] data,int at)=>new(data[at+3],data[at+7],data[at+11]);
    public static void Transform(float[] data,int at,Transform3D value)
    {
        data[at]=value.Basis.X.X; data[at+1]=value.Basis.Y.X; data[at+2]=value.Basis.Z.X; data[at+3]=value.Origin.X;
        data[at+4]=value.Basis.X.Y; data[at+5]=value.Basis.Y.Y; data[at+6]=value.Basis.Z.Y; data[at+7]=value.Origin.Y;
        data[at+8]=value.Basis.X.Z; data[at+9]=value.Basis.Y.Z; data[at+10]=value.Basis.Z.Z; data[at+11]=value.Origin.Z;
    }
    public static void Colour(float[] data,int at,Color value)
    { data[at]=value.R;data[at+1]=value.G;data[at+2]=value.B;data[at+3]=value.A; }
    public static void Collapse(float[] data,int at)
    { for(int row=0;row<3;row++)for(int col=0;col<3;col++)data[at+row*4+col]=0; }
}
