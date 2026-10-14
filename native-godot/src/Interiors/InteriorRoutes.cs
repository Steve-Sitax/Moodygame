using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.CompilerServices;
using Godot;
using Scheldemist.Native.Authoring;
namespace Scheldemist.Native.Interiors;

/// <summary>Room floor graph, including stairs and upper floors, with proposed furniture clearance.</summary>
public static class InteriorRoutes
{
    private const float Step=.25f;
    private sealed record Grid(int Width,int Depth,List<Vector3> Points,List<int>[] Columns);
    private static readonly ConditionalWeakTable<WorkshopSession,Dictionary<string,Grid>> cache=new();
    public static object Diagnostics {get;private set;}=new{};
    private static HashSet<string> reachable=new(StringComparer.Ordinal);
    public static bool KeepsRoutes(WorkshopSession session,LayoutDocument next,out string why)
    {
        if(Check(session,next,out why))return true;
        var after=reachable.ToHashSet(StringComparer.Ordinal);
        if(Check(session,session.Document,out _))return false;
        // An existing recovered shell defect must not lock all its editing tools.
        // Preserve every interaction that could be reached before this edit.
        if(reachable.Any(id=>!after.Contains(id))){why="This would block an existing furniture route.";return false;}
        why="";return true;
    }
    private sealed record Axis(Vector3 Direction,float Min,float Max);
    private sealed record Triangle(Aabb Box,Axis[] Axes)
    {
        public bool Intersects(Aabb body)
        {
            if(!Box.Intersects(body))return false;
            var center=body.GetCenter();var half=body.Size/2;
            foreach(var axis in Axes)
            {
                float middle=axis.Direction.Dot(center),radius=axis.Direction.Abs().Dot(half);
                if(axis.Min>middle+radius||axis.Max<middle-radius)return false;
            }
            return true;
        }
    }
    private static readonly Dictionary<string,Triangle[]> geometry=new(StringComparer.Ordinal);
    private static Triangle[] Bounds(AuthorAsset asset)
    {
        string path=asset.Scene!.ResourcePath;if(geometry.TryGetValue(path,out var saved))return saved;
        var root=asset.Scene.Instantiate<Node3D>();var result=new List<Triangle>();
        foreach(var mesh in Scheldemist.World.BakedWorld.All(root).OfType<MeshInstance3D>().Where(m=>m.Mesh!=null))
        {
            var transform=mesh.Transform;
            for(var parent=mesh.GetParent();parent!=root&&parent is Node3D node;parent=node.GetParent())transform=node.Transform*transform;
            var faces=mesh.Mesh!.GetFaces();
            for(int i=0;i+2<faces.Length;i+=3)
            {
                var a=transform*faces[i];var b=transform*faces[i+1];var c=transform*faces[i+2];
                var directions=new List<Vector3>{(b-a).Cross(c-a)};
                foreach(var edge in new[]{b-a,c-b,a-c})foreach(var axis in new[]{Vector3.Right,Vector3.Up,Vector3.Back})directions.Add(edge.Cross(axis));
                var axes=directions.Where(v=>v.LengthSquared()>1e-10f).Select(v=>new Axis(v,Math.Min(a.Dot(v),Math.Min(b.Dot(v),c.Dot(v))),Math.Max(a.Dot(v),Math.Max(b.Dot(v),c.Dot(v))))).ToArray();
                result.Add(new Triangle(new Aabb(a,Vector3.Zero).Expand(b).Expand(c).Grow(.001f),axes));
            }
        }
        root.Free();return geometry[path]=result.ToArray();
    }
    private static Grid Floors(WorkshopSession session)
    {
        var room=session.District;var rect=room.RoomBounds;
        var rooms=cache.GetOrCreateValue(session);if(rooms.TryGetValue(room.Id,out var existing))return existing;
        int width=(int)Math.Ceiling(rect.Size.X/Step),depth=(int)Math.Ceiling(rect.Size.Y/Step);
        if(width*depth>200000)throw new InvalidOperationException("This room is too large for its route grid.");
        var columns=Enumerable.Range(0,width*depth).Select(_=>new List<int>()).ToArray();var points=new List<Vector3>();
        var exclude=new Godot.Collections.Array<Rid>();
        foreach(var instance in session.Instances.Values)
            foreach(var n in Scheldemist.World.BakedWorld.All(instance).OfType<CollisionObject3D>())exclude.Add(n.GetRid());
        using var shape=new BoxShape3D{Size=new(.3f,1.15f,.3f)};
        using var query=new PhysicsShapeQueryParameters3D{Shape=shape,CollisionMask=3,Exclude=exclude,Margin=.001f};
        var space=session.GetWorld3D().DirectSpaceState;
        int blockedSamples=0;
        for(int i=0;i<columns.Length;i++)
        {
            var at=room.RoomFrame*new Vector3(rect.Position.X+(i%width+.5f)*Step,0,rect.Position.Y+(i/width+.5f)*Step);
            float bottom=at.Y-.18f,top=at.Y+room.RoomHeight+.2f;
            for(int layer=0;layer<40&&top>bottom;layer++)
            {
                using var ray=PhysicsRayQueryParameters3D.Create(new(at.X,top,at.Z),new(at.X,bottom,at.Z),1,exclude);
                var hit=space.IntersectRay(ray);if(hit.Count==0)break;
                var floor=hit["position"].AsVector3();top=floor.Y-.06f;
                // Recovered mirrored floors can have reversed triangle winding.
                // They still support feet from above, as in NativeWorldNavigation.
                if(Math.Abs(hit["normal"].AsVector3().Y)<.7f)continue;
                query.Transform=new(Basis.Identity,floor+Vector3.Up*.8f);
                var blockers=space.IntersectShape(query,1);
                if(blockers.Count!=0)
                {
                    if(blockedSamples<3&&room.EntryPoints.Any(e=>new Vector2(e.X-floor.X,e.Z-floor.Z).Length()<3&&Math.Abs(e.Y-floor.Y)<1))
                    {
                        var collider=blockers[0]["collider"].AsGodotObject() as Node;
                        GD.Print("floor blocked "+room.Id+" at "+floor+" by "+collider?.GetPath()+" material "+(collider?.GetParent() as MeshInstance3D)?.Mesh?.SurfaceGetMaterial(0)?.ResourceName);blockedSamples++;
                    }
                    continue;
                }
                columns[i].Add(points.Count);points.Add(floor);
            }
        }
        var grid=new Grid(width,depth,points,columns);rooms.Add(room.Id,grid);return grid;
    }
    public static bool Check(WorkshopSession session,LayoutDocument document,out string why)
    {
        why="";reachable=new(StringComparer.Ordinal);var room=session.District;if(room.RoomId=="")return true;
        var grid=Floors(session);var free=new bool[grid.Points.Count];var reached=new bool[free.Length];
        var solids=document.Objects.Select(p=>(p,a:session.Assets[p.Asset]))
            .Where(p=>p.a.Footprint.Y+p.a.FootprintOffset.Y>.3f)
            .Select(p=>(p.a,xf:new Transform3D(Basis.FromEuler(LayoutDocument.Vector(p.p.Rotation)).Scaled(LayoutDocument.Vector(p.p.Scale)),LayoutDocument.Vector(p.p.Position)).AffineInverse())).ToArray();
        for(int i=0;i<free.Length;i++)
        {
            free[i]=true;
            foreach(var item in solids)
            {
                var local=item.xf*grid.Points[i]-item.a.FootprintOffset;
                if(local.Y>item.a.Footprint.Y+.025f||local.Y+1.7f<0)continue;
                if(Math.Abs(local.X)>item.a.Footprint.X/2+.27f||Math.Abs(local.Z)>item.a.Footprint.Z/2+.27f)continue;
                if(item.a.GeometryClearance)
                {
                    var body=item.xf*new Aabb(grid.Points[i]+new Vector3(-.15f,.225f,-.15f),new(.3f,1.15f,.3f));
                    if(Bounds(item.a).Any(b=>b.Intersects(body))){free[i]=false;break;}
                    continue;
                }
                if(Math.Abs(local.X)<item.a.Footprint.X/2+.12f&&Math.Abs(local.Z)<item.a.Footprint.Z/2+.12f){free[i]=false;break;}
            }
        }
        var queue=new Queue<int>();var inverse=room.RoomFrame.AffineInverse();var rect=room.RoomBounds;
        var doors=new List<object>();
        var entries=new List<Vector3>();
        foreach(var node in Scheldemist.World.BakedWorld.All(session.GetNode("District")))
            if(node.HasMeta("extras")&&node.GetMeta("extras").AsGodotDictionary().TryGetValue("room",out var info))
            {
                var metadata=info.AsGodotDictionary();if(metadata["id"].AsString()!=room.RoomId)continue;
                foreach(var opening in metadata["openings"].AsGodotArray())
                {
                    var door=opening.AsGodotDictionary();if(door["kind"].AsString()!="door")continue;
                    var center=door["centre"].AsGodotArray();var box=door["box"].AsGodotArray();
                    entries.Add(new(center[0].AsSingle(),box[1].AsSingle(),center[2].AsSingle()));
                }
            }
        entries.AddRange(room.EntryPoints.Length>0?room.EntryPoints:new[]{room.WalkSpawn});
        foreach(var entry in entries)
        {
            var local=inverse*entry;
            // Door leaves can be closed in the offline workshop. Start on the room
            // side of that leaf, as the gameplay indoor roster does after entry.
            var inward=(rect.GetCenter()-new Vector2(local.X,local.Z)).Normalized()*1.2f;
            local.X+=inward.X;local.Z+=inward.Y;
            var target=room.RoomFrame*new Vector3(Math.Clamp(local.X,rect.Position.X+.3f,rect.End.X-.3f),local.Y,Math.Clamp(local.Z,rect.Position.Y+.5f,rect.End.Y-.5f));
            int seed=-1;float distance=float.PositiveInfinity;
            for(int i=0;i<free.Length;i++)if(free[i]&&Math.Abs(grid.Points[i].Y-target.Y)<.8f)
            {float d=grid.Points[i].DistanceSquaredTo(target);if(d<distance){distance=d;seed=i;}}
            var closest=grid.Points.Where((p,i)=>free[i]).OrderBy(p=>p.DistanceSquaredTo(target)).Take(1).ToArray();
            doors.Add(new{target=LayoutDocument.Floats(target),distance=float.IsFinite(distance)?(float?)distance:null,nearest=closest.Select(LayoutDocument.Floats).ToArray()});
            Diagnostics=new{points=free.Length,free=free.Count(p=>p),doors};
            if(seed>=0&&distance<=4)queue.Enqueue(seed);
        }
        if(queue.Count==0){why="Keep a clear way in from the room's door.";return false;}
        while(queue.TryDequeue(out int i))
        {
            if(reached[i])continue;reached[i]=true;var local=inverse*grid.Points[i];
            int x=(int)Math.Floor((local.X-rect.Position.X)/Step),z=(int)Math.Floor((local.Z-rect.Position.Y)/Step);
            foreach(var next in new[]{(x-1,z),(x+1,z),(x,z-1),(x,z+1)})
                if(next.Item1>=0&&next.Item2>=0&&next.Item1<grid.Width&&next.Item2<grid.Depth)
                    foreach(int n in grid.Columns[next.Item2*grid.Width+next.Item1])
                        if(free[n]&&!reached[n]&&Math.Abs(grid.Points[n].Y-grid.Points[i].Y)<=.36f)queue.Enqueue(n);
        }
        foreach(var p in document.Objects)
        {
            var a=session.Assets[p.Asset];if(a.SeatPoints.Length==0&&a.FurnitureKind is not ("bed" or "counter" or "stove"))continue;
            var xf=new Transform3D(Basis.FromEuler(LayoutDocument.Vector(p.Rotation)).Scaled(LayoutDocument.Vector(p.Scale)),LayoutDocument.Vector(p.Position)).AffineInverse();
            bool accessible=false;
            for(int i=0;i<reached.Length&&!accessible;i++)if(reached[i])
            {
                var local=xf*grid.Points[i]-a.FootprintOffset;
                float reach=a.FurnitureKind is "stove" or "counter"?1.5f:a.FurnitureKind=="bed"?1.1f:.7f;
                float footHeight=a.SeatPoints.Length>0?a.SeatPoints[0].Y:a.StandPoint.Y;
                float y=(xf*grid.Points[i]).Y;
                accessible=Math.Abs(y-footHeight)<.4f&&Math.Abs(local.X)<=a.Footprint.X/2+reach&&Math.Abs(local.Z)<=a.Footprint.Z/2+reach;
            }
            if(accessible)reachable.Add(p.Id);
            else if(why==""){Diagnostics=new{points=free.Length,free=free.Count(p=>p),reached=reached.Count(p=>p),doors,unreachable=p.Id};why="Keep a walking route to "+a.Title+".";}
        }
        return why=="";
    }
}
