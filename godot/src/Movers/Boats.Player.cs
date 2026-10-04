using System;
using System.Collections.Generic;
using Godot;

namespace Scheldemist.Movers;

public partial class Boats
{
    private readonly HashSet<(Row,int)> playerHidden=new();
    private readonly HashSet<Float> playerHiddenFloats=new();
    public (string Kind,Vector3 At,Node3D? Owner) PlayerLastHull;
    public readonly List<Func<float,float,float,bool>> PlayerWaterBlocks=new();
    public void PlayerWarmHulls(){foreach(var r in rows)Dims(r.Kind);foreach(var f in floats)Dims(f.Kind);}
    public void PlayerShowSmall(){playerHidden.Clear();foreach(var f in playerHiddenFloats)if(GodotObject.IsInstanceValid(f.Outer))f.Outer.Visible=true;playerHiddenFloats.Clear();}
    public void PlayerHideSmall(float x,float z,bool hide)
    {
        foreach(var row in rows)for(int i=0;i<row.N;i++)if(Math.Abs(row.X[i]-x)<.12f&&Math.Abs(row.Z[i]-z)<.12f)
        {if(hide)playerHidden.Add((row,i));else playerHidden.Remove((row,i));}
        foreach(var f in floats)if(Dims(f.Kind).Length<9&&Math.Abs(f.Outer.GlobalPosition.X-x)<.12f&&Math.Abs(f.Outer.GlobalPosition.Z-z)<.12f)
        {if(hide&&f.Outer.Visible){playerHiddenFloats.Add(f);f.Outer.Visible=false;}else if(!hide&&playerHiddenFloats.Remove(f))f.Outer.Visible=true;}
    }
    private Transform3D PlayerDraw(Row row,int i,Transform3D at)
    {if(playerHidden.Contains((row,i)))at.Basis=new Basis(Vector3.Zero,Vector3.Zero,Vector3.Zero);return at;}
    /// <summary>Clearance of the live hulls, including the moving ships, without scene traversal or temporary lists.</summary>
    public bool PlayerWaterFree(float x,float z,float radius)
    {
        foreach(var clear in PlayerWaterBlocks)if(!clear(x,z,radius))return false;
        static bool Hits(float x,float z,float radius,Transform3D xf,float length,float beam)
        {var p=xf.AffineInverse()*new Vector3(x,xf.Origin.Y,z);return Math.Abs(p.Z)<length/2-.5f+radius&&Math.Abs(p.X)<beam/2-.15f+radius;}
        foreach(var row in rows)
        {var d=Dims(row.Kind);for(int i=0;i<row.N;i++)if(!playerHidden.Contains((row,i))&&Math.Abs(row.X[i]-x)<d.Length/2+radius&&Math.Abs(row.Z[i]-z)<d.Length/2+radius&&Hits(x,z,radius,row.World[i],d.Length,d.Beam)){PlayerLastHull=(row.Kind,row.World[i].Origin,null);return false;}}
        foreach(var f in floats)
        {if(!f.Outer.Visible||f.Kind=="pontoon_section"&&z<-58.2f&&Math.Abs(x+249)<3)continue;var xf=f.Inner.GlobalTransform;var d=Dims(f.Kind);if(Math.Abs(xf.Origin.X-x)>d.Length/2+radius||Math.Abs(xf.Origin.Z-z)>d.Length/2+radius)continue;if(Hits(x,z,radius,xf,d.Length,d.Beam)){PlayerLastHull=(f.Kind,xf.Origin,f.Outer);return false;}}
        return true;
    }
}
