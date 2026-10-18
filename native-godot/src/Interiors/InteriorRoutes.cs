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
    private sealed record Grid(int Width,int Depth,List<Vector3> Points,List<int>[] Columns,List<(Vector3 At,string By)> Blocked);
    private static readonly ConditionalWeakTable<WorkshopSession,Dictionary<string,Grid>> cache=new();
    public static object Diagnostics {get;private set;}=new{};
    /// <summary>The first furniture the last Check found no route to, or null.</summary>
    public static string? Unreachable {get;private set;}
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
        int blockedSamples=0;var blocked=new List<(Vector3,string)>();
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
                    blocked.Add((floor,(blockers[0]["collider"].AsGodotObject() as Node)?.GetParent()?.Name.ToString()??"?"));
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
        var grid=new Grid(width,depth,points,columns,blocked);rooms.Add(room.Id,grid);return grid;
    }
    public static bool Check(WorkshopSession session,LayoutDocument document,out string why)
    {
        why="";Unreachable=null;reachable=new(StringComparer.Ordinal);var room=session.District;if(room.RoomId=="")return true;
        var grid=Floors(session);var free=new bool[grid.Points.Count];var reached=new bool[free.Length];
        var solids=document.Objects.Select(p=>(p,a:session.Assets[p.Asset]))
            .Where(p=>p.a.Footprint.Y+p.a.FootprintOffset.Y>.3f)
            .Select(p=>(p.a,xf:new Transform3D(Basis.FromEuler(LayoutDocument.Vector(p.p.Rotation)).Scaled(LayoutDocument.Vector(p.p.Scale)),LayoutDocument.Vector(p.p.Position)).AffineInverse(),id:p.p.Id)).ToArray();
        lastBlockers.Clear();
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
                    if(Bounds(item.a).Any(b=>b.Intersects(body))){free[i]=false;lastBlockers[item.id]=lastBlockers.GetValueOrDefault(item.id)+1;break;}
                    continue;
                }
                if(Math.Abs(local.X)<item.a.Footprint.X/2+.12f&&Math.Abs(local.Z)<item.a.Footprint.Z/2+.12f){free[i]=false;lastBlockers[item.id+" "+item.a.Id+" footprint "+item.a.Footprint]=lastBlockers.GetValueOrDefault(item.id+" "+item.a.Id+" footprint "+item.a.Footprint)+1;break;}
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
        lastReached=reached;lastFree=free;lastEntries=entries;
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
            else if(why==""){Diagnostics=new{points=free.Length,free=free.Count(p=>p),reached=reached.Count(p=>p),doors,unreachable=p.Id};Unreachable=p.Id;why="Keep a walking route to "+a.Title+".";}
        }
        return why=="";
    }
    private static bool[] lastReached=Array.Empty<bool>(),lastFree=Array.Empty<bool>();
    private static List<Vector3> lastEntries=new();
    private static readonly Dictionary<string,int> lastBlockers=new(StringComparer.Ordinal);
    /// <summary>
    /// The room's floors after a Check, by storey (half-metre squares): R reached from a door, o free but cut off, # blocked by the
    /// shell at a walker's height, D a door's start, X the furniture with no route. Below, what blocks most squares, by mesh.
    /// </summary>
    public static string Dump(WorkshopSession session,string? unreachable)
    {
        var room=session.District;if(room.RoomId=="")return "";
        var grid=Floors(session);var inverse=room.RoomFrame.AffineInverse();var rect=room.RoomBounds;
        var text=new System.Text.StringBuilder();
        Vector3? target=null;
        if(unreachable!=null&&session.Document.Objects.FirstOrDefault(o=>o.Id==unreachable) is {} item)target=LayoutDocument.Vector(item.Position);
        var all=grid.Points.Select((p,i)=>(p,kind:i<lastReached.Length&&lastReached[i]?'R':i<lastFree.Length&&lastFree[i]?'o':'f')).Concat(grid.Blocked.Select(b=>(p:b.At,kind:'#'))).ToList();
        foreach(var storey in all.GroupBy(q=>Math.Round((inverse*q.p).Y/1.5)).OrderBy(g=>g.Key))
        {
            if(storey.Count()<40)continue;
            int w=(int)Math.Ceiling(rect.Size.X/.5),d=(int)Math.Ceiling(rect.Size.Y/.5);var cells=new char[w*d];Array.Fill(cells,' ');
            int Rank(char c)=>c switch{'R'=>4,'o'=>3,'f'=>2,'#'=>1,_=>0};
            foreach(var q in storey){var l=inverse*q.p;int x=(int)((l.X-rect.Position.X)/.5),z=(int)((l.Z-rect.Position.Y)/.5);if(x<0||z<0||x>=w||z>=d)continue;if(Rank(q.kind)>Rank(cells[z*w+x]))cells[z*w+x]=q.kind;}
            void Mark(Vector3 at,char c){var l=inverse*at;int x=(int)((l.X-rect.Position.X)/.5),z=(int)((l.Z-rect.Position.Y)/.5);if(x>=0&&z>=0&&x<w&&z<d&&Math.Round(l.Y/1.5)==storey.Key)cells[z*w+x]=c;}
            foreach(var e in lastEntries)Mark(e,'D');if(target is {} t)Mark(t,'X');
            text.AppendLine($"storey at about {storey.Key*1.5:0.0} m (room frame), x from {rect.Position.X:0.0}, z from {rect.Position.Y:0.0}, 0.5 m squares; f is free furniture-blocked:");
            for(int z=0;z<d;z++)text.AppendLine($"{rect.Position.Y+z*.5,7:0.0} "+new string(cells,z*w,w).TrimEnd());
        }
        // every sample (all of a small room, or those in --proof-window x0,x1,z0,z1 of the plan), for a closer look
        var window=Scheldemist.Native.Game.NativeArguments.Arg("proof-window").Split(',',StringSplitOptions.RemoveEmptyEntries).Select(v=>float.Parse(v,System.Globalization.CultureInfo.InvariantCulture)).ToArray();
        bool Shown(Vector3 p)=>window.Length==4?p.X>=window[0]&&p.X<=window[1]&&p.Z>=window[2]&&p.Z<=window[3]:all.Count<5000;
        foreach(var q in all.Where(q=>q.kind!='#'&&Shown(q.p)).OrderBy(q=>q.p.Z).ThenBy(q=>q.p.X))text.AppendLine($"point {q.p.X:0.00} {q.p.Y:0.00} {q.p.Z:0.00} {q.kind}");
        foreach(var b in grid.Blocked.Where(b=>Shown(b.At)))text.AppendLine($"blocked {b.At.X:0.00} {b.At.Y:0.00} {b.At.Z:0.00} {b.By}");
        text.AppendLine("furniture blocking: "+string.Join(", ",lastBlockers.OrderByDescending(q=>q.Value).Take(12).Select(q=>$"{q.Key} {q.Value}")));
        text.AppendLine("blocked by: "+string.Join(", ",grid.Blocked.GroupBy(b=>b.By).OrderByDescending(g=>g.Count()).Take(12).Select(g=>$"{g.Key} {g.Count()}")));
        return text.ToString();
    }
}
