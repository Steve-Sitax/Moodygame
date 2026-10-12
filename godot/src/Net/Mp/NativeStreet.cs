using System;
using System.Buffers.Binary;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.Town;

namespace Scheldemist.Net.Mp;

/// <summary>One owner simulates each resident; the other games draw the owner's movement.</summary>
[GamePart(225)]
public partial class NativeStreet : Node
{
    public static NativeStreet? I { get; private set; }
    private Townspeople town = null!;
    private Together together = null!;
    private readonly Dictionary<string, Replica> people = new();
    private readonly Dictionary<ushort, string> numbered = new();
    private readonly Dictionary<string, int> pins = new();
    private readonly Dictionary<string, Sent> sent = new();
    private double claimAge, sendAge;
    private bool connected;
    public int Received { get; private set; }
    public int Transmitted { get; private set; }
    public int RemoteCount => people.Values.Count(r => r.Track.States > 0 && r.Owner != together.PlayerId && r.Owner > 0);
    private sealed class Replica
    {
        public ushort Number;
        public int Owner;
        public RemoteTrack Track = new() { Delay = 220 };
        public float Size = 1;
        public double Heard, Changed;
        public double GoneAt;
        public bool Fresh;
        public float OffsetX, OffsetZ;
    }
    private sealed record Sent(double X, double Z, double Yaw, double At, int Mode, int Gear, int Bought, int Vehicle, int Load, int Goods);
    public bool Owns(string id) => !together.On || people.TryGetValue(id, out var row) && row.Owner == together.PlayerId;
    public int OwnerOf(string id) => people.GetValueOrDefault(id)?.Owner ?? 0;
    private bool MayWalk(string id) => !together.On || !people.TryGetValue(id, out var row) || row.Owner <= 0 || row.Owner == together.PlayerId;
    public override void _Ready()
    {
        I = this; town = Main.I.GetNode<Townspeople>("Townspeople"); together = Together.I!;
        town.MaySimulate = MayWalk; town.BeforeCrowd += Apply; town.AfterCrowd += Send; town.PopulationChanged += Reset;
        together.OtherText += Text; together.OtherBatch += Batch;
    }
    private void Text(string type, JsonElement message)
    {
        if (type == "pins" && message.TryGetProperty("list", out var pinned))
        {
            pins.Clear(); foreach (var row in pinned.EnumerateArray()) pins[row[0].GetString()!] = row[1].GetInt32(); return;
        }
        if (type != "owners" || !message.TryGetProperty("list", out var list)) return;
        if (message.TryGetProperty("full", out var full) && full.ValueKind == JsonValueKind.True) foreach (var row in people.Values) row.Owner = 0;
        foreach (var item in list.EnumerateArray())
        {
            ushort number = item[0].GetUInt16(); string id = item[1].GetString()!; int owner = item[2].GetInt32();
            if (!people.TryGetValue(id, out var row)) people[id] = row = new();
            int previous = row.Owner; row.Number = number; row.Owner = owner; numbered[number] = id;
            if (previous == owner) continue;
            row.Changed = together.ServerNow; row.Track = new() { Delay = 220 }; row.Heard = together.ServerNow;
            row.Fresh = previous == together.PlayerId; row.OffsetX = row.OffsetZ = 0;
            row.GoneAt = owner < 0 ? together.ServerNow + 520 : 0;
            var person = town.ActionPerson(id); if (person == null || person.ActionOwner is Game.Actors) continue;
            if (owner == together.PlayerId || owner == 0) { town.RemoteRelease(person); sent.Remove(id); }
            else if (person.P != null) person.P.Remote = true;
        }
    }
    private void Batch(byte kind, byte[] data, double received)
    {
        if (kind != EventPuppets.Kind || !EventPuppets.Valid(data)) return;
        double time = BinaryPrimitives.ReadDoubleLittleEndian(data.AsSpan(2));
        for (int i = 0; i < data[1]; i++)
        {
            if (!EventPuppets.Read(data.AsSpan(10 + i * 24, 24), time, out ushort number, out var pose, out float size)
                || !numbered.TryGetValue(number, out string? id) || !people.TryGetValue(id, out var row)
                || row.Owner <= 0 || row.Owner == together.PlayerId) continue;
            if (town.ActionPerson(id)?.ActionOwner is Game.Actors) continue;
            pose.Flags |= MpProtocol.FlagGrounded;
            row.Track.Push(pose, received); row.Size = size; row.Heard = together.ServerNow; Received++;
        }
    }
    private void Apply(double delta)
    {
        if (!together.Connected)
        {
            if (connected) Reset(); connected = false; return;
        }
        connected = true;
        var camera = Main.I.Cam.GlobalPosition;
        foreach (var pair in people)
        {
            var row = pair.Value;
            if (row.Owner == together.PlayerId || row.Owner == 0 || town.ActionPerson(pair.Key) is not { } person || person.ActionOwner is Game.Actors) continue;
            if (together.ServerNow - row.Heard > 3000 || row.GoneAt > 0 && together.ServerNow > row.GoneAt)
            {
                if (person.P?.Remote == true) town.RemoteRelease(person, true); continue;
            }
            if (row.Track.Sample(together.ServerNow) is not { } pose) continue;
            double dx = pose.X - camera.X, dz = pose.Z - camera.Z;
            if (dx * dx + dz * dz > 10000) { if (person.P?.Remote == true) town.RemoteRelease(person, true); continue; }
            if (row.Fresh) {
                row.Fresh = false;
                if (person.P is { } current && Math.Pow(current.X - pose.X, 2) + Math.Pow(current.Z - pose.Z, 2) < 9)
                { row.OffsetX = (float)current.X - pose.X; row.OffsetZ = (float)current.Z - pose.Z; }
            }
            float fade = MathF.Exp(-(float)delta * 8); row.OffsetX *= fade; row.OffsetZ *= fade;
            pose.X += row.OffsetX; pose.Z += row.OffsetZ;
            town.RemotePose(person, pose, row.Size);
        }
    }
    private void Send(double delta)
    {
        if (!together.Connected) return;
        claimAge += delta; sendAge += delta;
        if (claimAge >= .5)
        {
            claimAge = 0; var claims = new List<string>(); var steal = new List<string>(); var releases = new List<string>(); var gone = new List<string>();
            foreach (var person in town.Sims)
            {
                if (person.ActionOwner is Game.Actors) continue;
                int owner = OwnerOf(person.R.Id); int pin = pins.GetValueOrDefault(person.R.Id);
                if (pin == together.PlayerId && owner != together.PlayerId) { steal.Add(person.R.Id); continue; }
                if (pin > 0 && pin != together.PlayerId) continue;
                if (person.P != null && !person.Inside)
                {
                    if (owner <= 0) claims.Add(person.R.Id);
                    else if (!together.Guest && owner != together.PlayerId && people.TryGetValue(person.R.Id, out var row) && together.ServerNow - row.Changed >= 5000)
                    {
                        var p = Main.I.Cam.GlobalPosition; if (Math.Pow(person.X - p.X, 2) + Math.Pow(person.Z - p.Z, 2) < 2500) steal.Add(person.R.Id);
                    }
                }
                else if (owner == together.PlayerId && !person.ActionHeld) { releases.Add(person.R.Id); if (person.Inside) gone.Add(person.R.Id); }
            }
            if (claims.Count > 0) together.SendText(new { type = "claim", ids = claims });
            if (steal.Count > 0) together.SendText(new { type = "claim", ids = steal, steal = true });
            if (releases.Count > 0) together.SendText(new { type = "release", ids = releases, gone });
        }
        if (sendAge < .1) return; sendAge = 0;
        var output = new List<(ushort Number, MpState State, float Size)>();
        foreach (var person in town.Sims)
        {
            if (person.P is not { Remote: false } puppet || person.ActionOwner is Game.Actors || !people.TryGetValue(person.R.Id, out var row) || row.Owner != together.PlayerId) continue;
            int mode = Math.Max(0, Array.IndexOf(EventPuppets.Motions, puppet.Human.Motion ?? "idle"));
            int gear = (puppet.State == "sit" ? 1 : 0) | (puppet.Lantern != null ? 2 : 0) | (puppet.Loaded ? 4 : 0);
            int bought = Math.Max(0, Array.IndexOf(EventPuppets.Bought, puppet.Bought));
            double now = together.ServerNow; sent.TryGetValue(person.R.Id, out var was);
            if (was != null && Math.Abs(was.X - puppet.X) + Math.Abs(was.Z - puppet.Z) < .01 && Math.Abs(was.Yaw - puppet.Yaw) < .01 && mode == was.Mode && gear == was.Gear && bought == was.Bought && puppet.NetworkVehicle == was.Vehicle && puppet.NetworkLoad == was.Load && puppet.NetworkGoods == was.Goods && now - was.At < 1000) continue;
            double dt = was == null ? .1 : Math.Max(.05, (now - was.At) / 1000);
            double vx = was == null ? 0 : (puppet.X - was.X) / dt, vz = was == null ? 0 : (puppet.Z - was.Z) / dt;
            bool snap = was == null || vx * vx + vz * vz > 64;
            var state = new MpState { T = now, X = (float)puppet.X, Z = (float)puppet.Z, Yaw = (float)puppet.Yaw, Vx = snap ? 0 : (float)vx, Vz = snap ? 0 : (float)vz, Mode = mode, Gear = gear | (snap ? 8 : 0), PuppetBought = bought, PuppetVehicle = puppet.NetworkVehicle, PuppetLoad = puppet.NetworkLoad, PuppetGoods = puppet.NetworkGoods };
            output.Add((row.Number, state, puppet.Size)); sent[person.R.Id] = new(puppet.X, puppet.Z, puppet.Yaw, now, mode, gear, bought, puppet.NetworkVehicle, puppet.NetworkLoad, puppet.NetworkGoods);
        }
        for (int start = 0; start < output.Count; start += EventPuppets.Max)
        {
            int count = Math.Min(EventPuppets.Max, output.Count - start); var data = new byte[10 + count * 24]; data[0] = EventPuppets.Kind; data[1] = (byte)count;
            BinaryPrimitives.WriteDoubleLittleEndian(data.AsSpan(2), together.ServerNow);
            for (int i = 0; i < count; i++) { var row = output[start + i]; EventPuppets.Write(data.AsSpan(10 + i * 24, 24), row.Number, row.State, row.Size); }
            if (together.SendBinary(data)) Transmitted += count;
        }
    }
    private void Reset()
    {
        people.Clear(); numbered.Clear(); pins.Clear(); sent.Clear(); claimAge = sendAge = 0;
        foreach (var person in town.Sims) if (person.P?.Remote == true) town.RemoteRelease(person);
    }
    public override void _ExitTree()
    {
        town.MaySimulate = null; town.BeforeCrowd -= Apply; town.AfterCrowd -= Send; town.PopulationChanged -= Reset;
        together.OtherText -= Text; together.OtherBatch -= Batch; Reset(); if (I == this) I = null;
    }
}
