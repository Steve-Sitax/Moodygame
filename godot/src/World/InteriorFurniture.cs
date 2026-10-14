using Godot;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
namespace Scheldemist.World;

/// <summary>Native scene anchors shared by local play and the authenticated host layout.</summary>
public sealed record InteriorFurniture(string Room, string Id, string Kind, Node3D Node,
    Vector3[] Seats, float Height, float SeatYaw, int Table, Vector3 Use, Vector3 Stand, Vector3 Size, Vector3 Offset, Vector3 Keeper)
{
    public Vector3 UseAt => Node.ToGlobal(Use);
    public Vector3 StandAt => Node.ToGlobal(Stand);
    public Vector3 KeeperAt => Node.ToGlobal(Keeper);
    public float Yaw => Node.GlobalRotation.Y + SeatYaw;
    public Vector3 LightAt => Node.ToGlobal(Offset+new Vector3(0,Kind=="stove"?Math.Min(.8f,Size.Y*.3f):Size.Y*.5f,0));
    public static JsonArray FixedCells(IEnumerable<InteriorFurniture> furniture, Transform3D frame, Rect2 bounds)
    {
        var result=new JsonArray();var inverse=frame.AffineInverse();
        foreach(var piece in furniture)
        {
            if(piece.Offset.Y>1.7f||piece.Offset.Y+piece.Size.Y<.25f)continue;
            var points=new List<Vector3>();
            foreach(float x in new[]{-.5f,.5f})foreach(float z in new[]{-.5f,.5f})points.Add(inverse*piece.Node.ToGlobal(piece.Offset+new Vector3(piece.Size.X*x,0,piece.Size.Z*z)));
            int gx=Math.Max(0,(int)Math.Floor((points.Min(p=>p.X)-bounds.Position.X)/.5f+.001f)),gz=Math.Max(0,(int)Math.Floor((points.Min(p=>p.Z)-bounds.Position.Y)/.5f+.001f));
            int endX=(int)Math.Ceiling((points.Max(p=>p.X)-bounds.Position.X)/.5f-.001f),endZ=(int)Math.Ceiling((points.Max(p=>p.Z)-bounds.Position.Y)/.5f-.001f);
            result.Add(new JsonObject{["kind"]=piece.Kind,["gx"]=gx,["gz"]=gz,["w"]=Math.Max(1,endX-gx),["d"]=Math.Max(1,endZ-gz),["rot"]=0});
        }
        return result;
    }
}
