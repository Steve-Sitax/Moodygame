using System;
using System.Collections.Generic;
using Godot;
namespace Scheldemist.World;
public partial class Rooms
{
    private readonly List<(Room room,Vector3 a,Vector3 b,Vector3 c)> soundFloors=new();
    private bool soundFloorsReady;
    private void PrepareSoundFloors()
    {
        soundFloorsReady=true;
        foreach(var room in rooms)foreach(var node in BakedWorld.All(room.Root))if(node is MeshInstance3D {Mesh:not null} mesh)
        {
            var faces=mesh.Mesh.GetFaces();var tr=mesh.GlobalTransform;
            for(int i=0;i+2<faces.Length;i+=3)
            {
                var a=tr*faces[i];var b=tr*faces[i+1];var c=tr*faces[i+2];
                if(Math.Abs(a.Y-b.Y)>.03f||Math.Abs(a.Y-c.Y)>.03f||a.Y>room.Box.Position.Y+.75f)continue;
                float area=(b.X-a.X)*(c.Z-a.Z)-(b.Z-a.Z)*(c.X-a.X);if(Math.Abs(area)<.01f)continue;
                soundFloors.Add((room,a,b,c));
            }
        }
    }
    public (string Id, string Kind)? SoundRoomAt(Vector3 point)
    {
        if(!soundFloorsReady)PrepareSoundFloors();
        foreach(var f in soundFloors)
        {
            if(Math.Abs(point.Y-f.a.Y)>.6f)continue;
            float Cross(Vector3 a,Vector3 b)=>(b.X-a.X)*(point.Z-a.Z)-(b.Z-a.Z)*(point.X-a.X);
            float x=Cross(f.a,f.b),y=Cross(f.b,f.c),z=Cross(f.c,f.a);
            if((x>=-.001f&&y>=-.001f&&z>=-.001f)||(x<=.001f&&y<=.001f&&z<=.001f))return(f.room.Id,f.room.Kind);
        }
        return null;
    }
}
