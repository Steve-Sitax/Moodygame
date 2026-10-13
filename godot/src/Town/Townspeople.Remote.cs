using System;
using Godot;
using Scheldemist.Net.Mp;

namespace Scheldemist.Town;

public partial class Townspeople
{
    public void RemotePose(Sim person, Pose pose, float size)
    {
        if (!CurrentPerson(person) || Crowd == null) return;
        person.X = pose.X; person.Z = pose.Z; person.Inside = false;
        if (person.P == null && Crowd.Walking.Count < Math.Max(150, MaxPuppets))
        {
            person.P = Crowd.AddPuppet(person.Kind, pose.X, pose.Z, pose.Yaw, size: size);
            person.P?.Human.SetIdentity(person.R.Id);
        }
        if (person.P is not { } puppet) return;
        puppet.Remote = true; puppet.X = pose.X; puppet.Z = pose.Z; puppet.Yaw = pose.Yaw;
        puppet.Size = size; puppet.Group.Scale = Vector3.One * size;
        string motion = EventPuppets.Motions[Math.Clamp(pose.Mode, 0, EventPuppets.Motions.Length - 1)];
        // people2 (package D3): a hauler bending at a sack pile lifts a sack there, as on the host (from the routes)
        if (puppet.Human.IsPeople2 && motion != puppet.Human.Motion)
            puppet.Human.Work = motion == "crouch" && (pose.Gear & 4) == 0 && HaulRoute.SackPileAt(pose.X, pose.Z) != null ? "haul_sack" : null;
        if (puppet.Human.Motion != motion) puppet.Human.Play(motion, .15f);
        puppet.PMotion = motion; puppet.State = (pose.Gear & 1) != 0 ? "sit" : motion is "walk" or "carry" or "push" or "ride" ? "walk" : "stand";
        puppet.Human.SetPace(Math.Max(.3f, pose.Speed));
        Crowd.PuppetLantern(puppet, (pose.Gear & 2) != 0);
        Crowd.PuppetLoad(puppet, (pose.Gear & 4) != 0);
        Crowd.PuppetCarry(puppet, EventPuppets.Bought[Math.Clamp(pose.PuppetBought, 0, EventPuppets.Bought.Length - 1)]);
        Crowd.PuppetVehicle(puppet, pose.PuppetVehicle, pose.PuppetLoad, pose.PuppetGoods);
    }

    public void RemoteRelease(Sim person, bool remove = false)
    {
        if (!CurrentPerson(person)) return;
        if (person.P is { } puppet) { puppet.Remote = false; Crowd!.PuppetStand(puppet); }
        if (remove) Lose(person, true);
        person.Key = ""; person.Hw = null; person.Round = null;
        if (!person.ActionHeld) Reschedule(person, false);
    }
}
