using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.World;

namespace Scheldemist.Town;

public sealed partial class Indoors
{
    private const float Grid=.25f, PersonRadius=.32f, LaneRadius=.72f;
    private readonly CapsuleShape3D clearanceShape=new(){Height=1.5f};
    private readonly PhysicsShapeQueryParameters3D clearanceQuery=new(){CollisionMask=Solid.Layer,Margin=.001f};
    private float FloorY(House h,Pt p)=>(Main.I.World.NativeRoom(h.Id)?.Frame.Origin.Y)??(float)town.Walk!.BaseAt(p.X,p.Z);
    private static Vector2 V(Pt p)=>new((float)p.X,(float)p.Z);
    public IReadOnlyList<Pt> StandingSpots(House h)=>SpotsOf(h);
    public bool InEntryLane(House h,Pt p,float margin=LaneRadius)
    {
        var at=V(p);if(at.DistanceTo(V(h.Door))<1.45f)return true;
        for(int i=1;i<h.EntryLane.Count;i++)if(at.DistanceTo(Geometry2D.GetClosestPointToSegment(at,V(h.EntryLane[i-1]),V(h.EntryLane[i])))<margin)return true;
        return false;
    }
    public bool FloorFree(House h,Vector3 at,float radius=PersonRadius)
    {
        if(Main.I.World.NativeRoom(h.Id) is not {} room)return false;
        var local=room.Frame.AffineInverse()*at;
        var inner=room.Bounds.Grow(-radius);
        if(!inner.HasPoint(new(local.X,local.Z)))return false;
        clearanceShape.Radius=radius;
        clearanceQuery.Shape=clearanceShape;
        clearanceQuery.Transform=new(Basis.Identity,new(at.X,room.Frame.Origin.Y+.85f,at.Z));
        if(Main.I.World.GetWorld3D().DirectSpaceState.IntersectShape(clearanceQuery,1).Count>0)return false;
        return true;
    }
    private List<Pt> RoomSpots(House h)
    {
        var spots=new List<Pt>();h.EntryLane.Clear();
        if(Main.I.World.NativeRoom(h.Id) is not {} room)return spots;
        var furniture=Main.I.World.NativeFurniture!.Where(f=>f.Room==h.Id).ToArray();
        var counter=furniture.FirstOrDefault(f=>f.Kind=="counter");
        var inward=room.Frame.Basis.Z.Normalized();var start=room.Frame.Origin+inward*.65f;
        var target=counter?.StandAt??(room.Frame*new Vector3(0,0,room.Bounds.GetCenter().Y));
        var queue=new Queue<(int,int)>();var from=new Dictionary<(int,int),(int,int)>();
        (int,int) Key(Vector3 p){var q=room.Frame.AffineInverse()*p;return((int)Math.Round(q.X/Grid),(int)Math.Round(q.Z/Grid));}
        Vector3 Point((int x,int z) k)=>room.Frame*new Vector3(k.x*Grid,0,k.z*Grid);
        var first=Key(start);queue.Enqueue(first);from[first]=first;(int,int)? end=null;
        while(queue.Count>0 && from.Count<12000)
        {
            var k=queue.Dequeue();var at=Point(k);
            if(new Vector2(at.X-target.X,at.Z-target.Z).Length()<.35f){end=k;break;}
            foreach(var (dx,dz) in new[]{(1,0),(-1,0),(0,1),(0,-1)})
            {var n=(k.Item1+dx,k.Item2+dz);if(from.ContainsKey(n)||!FloorFree(h,Point(n),Scheldemist.Player.Jef.Radius+.02f))continue;from[n]=k;queue.Enqueue(n);}
        }
        if(end is {} last){while(true){var p=Point(last);h.EntryLane.Add(new(p.X,p.Z));if(last==first)break;last=from[last];}h.EntryLane.Add(h.Door);h.EntryLane.Reverse();}
        // No connected customer route means no patrons are placed, rather than obstructing the entrance.
        if(h.EntryLane.Count==0)return spots;
        void Add(Vector3 at,bool seat=false){var p=new Pt(at.X,at.Z);if(!InEntryLane(h,p)&& (seat||FloorFree(h,at)) && !spots.Any(s=>V(s).DistanceTo(V(p))<.85f))spots.Add(p);}
        var cells=new List<Vector3>();
        for(float x=room.Bounds.Position.X+.5f;x<room.Bounds.End.X-.5f;x+=.5f)
            for(float z=room.Bounds.Position.Y+.5f;z<room.Bounds.End.Y-.5f;z+=.5f)cells.Add(room.Frame*new Vector3(x,0,z));
        h.Serve=null;
        if(counter!=null && KeeperSpot(h,counter) is {} keeper){spots.Add(new(keeper.X,keeper.Z));var serve=counter.StandAt;h.Serve=new(serve.X,serve.Z);}
        // Standing allocations never use chair centres. TavernSeats places actual seated
        // occupants on their authored seats independently, with the same entry-lane guard.
        foreach(var p in cells.OrderByDescending(p=>p.DistanceSquaredTo(room.Frame.Origin)))if(spots.Count<PerHouse)Add(p);
        return spots;
    }
    /// <summary>The keeper's place: on the serving side of the counter, the anchor or the nearest free point along
    /// the bar (a standing body of KeeperRadius between the bar and the back shelves), never on the customers' side.
    /// Null when the bar has no free floor behind it; the room's layout must then give the bar its serving gap.</summary>
    public Vector3? KeeperSpot(House h,InteriorFurniture counter)
    {
        float toward=Math.Sign(counter.Stand.X-counter.Keeper.X),half=Math.Max(.2f,counter.Size.Z*.5f-.3f);
        Vector3? best=null;float bestDistance=float.MaxValue;
        foreach(float dx in new[]{0f,.05f,-.05f,.1f})
            for(float dz=0;dz<=half;dz+=.1f)
                foreach(float sign in dz==0?new[]{1f}:new[]{1f,-1f})
                {
                    var local=counter.Keeper+new Vector3(toward*dx,0,sign*dz);float distance=new Vector2(dx,dz).Length();
                    if(distance>=bestDistance)continue;
                    var at=counter.Node.ToGlobal(local);
                    if(FloorFree(h,at,KeeperRadius)){best=at;bestDistance=distance;}
                }
        return best;
    }
    private const float KeeperRadius=.24f;
    private void Yield(House h,Figure f,double dt,Vector3 eye)
    {
        if(Math.Abs(eye.Y-FloorY(h,new(eye.X,eye.Z))-1.6)>1.5)return;
        var at=f.Group.Position;var distance=new Vector2(at.X-eye.X,at.Z-eye.Z).Length();
        if(distance>=.9f || f.Human.Motion=="sit")return;
        var direction=new Vector2(at.X-eye.X,at.Z-eye.Z).Normalized();if(direction.LengthSquared()<.1f)direction=new((float)h.Out.Z,-(float)h.Out.X);
        foreach(float angle in new[]{0f,MathF.PI/2,-MathF.PI/2,MathF.PI})
        {var v=direction.Rotated(angle)*(float)Math.Min(dt*1.1,.12);var next=at+new Vector3(v.X,0,v.Y);if(!FloorFree(h,next)||InEntryLane(h,new(next.X,next.Z))||h.Figures.Values.Any(other=>other!=f&&new Vector2(other.Group.Position.X-next.X,other.Group.Position.Z-next.Z).Length()<.65f))continue;f.Group.Position=next;f.Human.Play("walk",.2f);f.Wait=.3;break;}
    }
}
