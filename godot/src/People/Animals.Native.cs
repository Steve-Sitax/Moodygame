using Godot;
using Scheldemist.Net.Mp;

namespace Scheldemist.People;

public partial class Animals
{
    private void MakeHeardAnimals(Vector3 eye)
    {
        if(NativeExtras.I is not{} share)return;
        foreach(string id in share.AnimalsHeard){
            if(!id.StartsWith("a:")||HasBeast(id)||!hauntOf.TryGetValue(id,out var h)||share.OwnerOf(id)==(Together.I?.PlayerId??1)||share.Animal(id)is not{} pose||Hyp(pose.X-eye.X,pose.Z-eye.Z)>ReachR)continue;
            var a=Animal.Make(h.Kind,h.Id);if(a==null)continue;Main.I.View.AddChild(a.Group);a.Start();a.Play(pose.Motion);
            beasts.Add(new Beast{Id=id,A=a,X=pose.X,Z=pose.Z,Yaw=pose.Yaw,Timer=5});
        }
    }
}
