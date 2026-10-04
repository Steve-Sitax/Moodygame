using System;
using Godot;
namespace Scheldemist.Movers;
public partial class Lock
{
    private Func<Vector2>? rowWhere;
    private int rowFrom=-1;
    public void RowRequest(bool on,Func<Vector2>? where=null)
    {boatWant=on;if(where!=null)rowWhere=where;if(!on){rowWhere=null;rowFrom=-1;}}
    private int PlayerTarget(int fallback)
    {if(rowWhere==null)return fallback;float z=rowWhere().Y;bool inside=z>Gz0+1.5f&&z<Gz1-1.5f;if(!inside)rowFrom=-1;else if(rowFrom<0)rowFrom=gateOpen[0]>=gateOpen[1]?0:1;return inside?(rowFrom==0?1:0):z<=Gz0+1.5f?0:1;}
    public float PlayerUnderside(float x,float z)
    {float y=float.PositiveInfinity;foreach(var leaf in BridgeLeaves)y=Math.Min(y,Bridges.PlayerLeafUnderside(leaf,Lift,x,z));return y;}
}
