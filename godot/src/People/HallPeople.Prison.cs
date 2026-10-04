using System.Collections.Generic;
using Godot;
namespace Scheldemist.People;
public partial class HallPeople
{
    public static List<Vector3> PrisonRoute(Hall h,Vector3 from,Vector3 to)=>Route(h,from,to);
    public static bool PrisonFree(Hall h,Vector3 at)=>FreeSegment(h,at,at+new Vector3(.00001f,0,0));
}
