using System;
using System.Collections.Generic;
using System.Text.Json;
using Godot;

namespace Scheldemist.People;

// Package D2's idles, talk and sitting (peopleRig.json "idles"): which clip of a body's family serves a motion.
// Humans.Motions and the wire stay unchanged: every choice here is local, made from the person's stable id, so
// every PC shows the same variant. docs/godot-people2.md "Idles, talk and sitting".
internal static class People2Moves
{
    internal sealed record Seat(string Clip, float Height, float Hips, bool Dangle);

    internal sealed class Family
    {
        public string Name = "", Body = "";
        public string? FallbackName;
        public Family? Fallback;
        public readonly Dictionary<string, string[]> Lists = new();
        public readonly Dictionary<string, Seat> Sits = new();
        public readonly Dictionary<string, string> SitDown = new(), StandUp = new();
        public string[] List(string key)
        {
            for (var f = this; f != null; f = f.Fallback)
                if (f.Lists.TryGetValue(key, out var l) && l.Length > 0) return l;
            return Array.Empty<string>();
        }
        public Seat? SeatOf(string kind)
        {
            for (var f = this; f != null; f = f.Fallback)
                if (f.Sits.TryGetValue(kind, out var s)) return s;
            return null;
        }
        public string? Change(bool down, string kind)
        {
            for (var f = this; f != null; f = f.Fallback)
                if ((down ? f.SitDown : f.StandUp).TryGetValue(kind, out var c)) return c;
            return null;
        }
    }

    private static readonly Dictionary<string, Family> families = new();

    // D3: per family the work clips that serve a motion or a context the game knows; the kinds whose load decides
    // their clips; where a carried load rides (peopleRig.json "work")
    internal sealed class WorkFamily
    {
        public string Name = "";
        public string? FallbackName;
        public WorkFamily? Fallback;
        public readonly Dictionary<string, string[]> Motions = new(), Contexts = new();
        public string[] Motion(string m)
        {
            for (var f = this; f != null; f = f.Fallback)
                if (f.Motions.TryGetValue(m, out var l) && l.Length > 0) return l;
            return Array.Empty<string>();
        }
        public string[] Context(string c)
        {
            for (var f = this; f != null; f = f.Fallback)
                if (f.Contexts.TryGetValue(c, out var l) && l.Length > 0) return l;
            return Array.Empty<string>();
        }
    }
    internal sealed record LoadSpec(string Bone, Transform3D Offset, Vector3 Size, string Walk, string Hold, string[] Lift, string? Down);
    private static readonly Dictionary<string, WorkFamily> work = new();
    private static readonly Dictionary<string, Dictionary<string, string>> workKinds = new();
    internal static readonly Dictionary<string, LoadSpec> Loads = new();
    internal static WorkFamily? WorkOf(string? family) => family != null && work.TryGetValue(family, out var f) ? f : null;
    internal static string? KindClip(string kind, string motion) => workKinds.TryGetValue(kind, out var k) && k.TryGetValue(motion, out var c) ? c : null;

    internal static void LoadWork(JsonElement w)
    {
        if (w.TryGetProperty("families", out var fams))
            foreach (var p in fams.EnumerateObject())
            {
                var f = new WorkFamily { Name = p.Name };
                if (p.Value.TryGetProperty("fallback", out var fb) && fb.ValueKind == JsonValueKind.String) f.FallbackName = fb.GetString();
                foreach (var (key, into) in new[] { ("motions", f.Motions), ("contexts", f.Contexts) })
                    if (p.Value.TryGetProperty(key, out var d))
                        foreach (var m in d.EnumerateObject()) into[m.Name] = Names(m.Value);
                work[p.Name] = f;
            }
        foreach (var f in work.Values) if (f.FallbackName != null) f.Fallback = work.GetValueOrDefault(f.FallbackName);
        if (w.TryGetProperty("kinds", out var kinds))
            foreach (var k in kinds.EnumerateObject())
            {
                var d = new Dictionary<string, string>();
                foreach (var m in k.Value.EnumerateObject()) d[m.Name] = m.Value.GetString()!;
                workKinds[k.Name] = d;
            }
        if (w.TryGetProperty("loads", out var loads))
            foreach (var l in loads.EnumerateObject())
            {
                var v = l.Value;
                var o = v.GetProperty("offset"); var q = v.GetProperty("turn"); var sz = v.GetProperty("size");
                var offset = new Transform3D(new Basis(new Quaternion(q[0].GetSingle(), q[1].GetSingle(), q[2].GetSingle(), q[3].GetSingle()).Normalized()),
                    new Vector3(o[0].GetSingle(), o[1].GetSingle(), o[2].GetSingle()));
                // the size as the game's model has it: length, thickness (up), width
                Loads[l.Name] = new LoadSpec(v.GetProperty("bone").GetString()!, offset, new Vector3(sz[0].GetSingle(), sz[2].GetSingle(), sz[1].GetSingle()),
                    v.GetProperty("walk").GetString()!, v.GetProperty("hold").GetString()!,
                    v.TryGetProperty("lift", out var lift) ? Names(lift) : Array.Empty<string>(),
                    v.TryGetProperty("down", out var down) ? down.GetString() : null);
            }
    }
    private static readonly Dictionary<string, string> bodyFamily = new();
    internal static readonly HashSet<string> Standing = new();
    internal static readonly List<Human2> Talkers = new();
    private static readonly Dictionary<string, Human2> byId = new();
    private static bool hooked;

    internal static void Forget()
    {
        families.Clear(); bodyFamily.Clear(); Standing.Clear(); Talkers.Clear(); byId.Clear(); work.Clear(); workKinds.Clear(); Loads.Clear();
        if (hooked && Talks.Talk.I is { } talk) talk.OnReply -= Replied;
        hooked = false;
    }

    internal static void Load(JsonElement idles)
    {
        if (idles.TryGetProperty("bodyFamily", out var bf))
            foreach (var p in bf.EnumerateObject()) bodyFamily[p.Name] = p.Value.GetString()!;
        if (!idles.TryGetProperty("families", out var fams)) return;
        foreach (var p in fams.EnumerateObject())
        {
            var f = new Family { Name = p.Name, Body = p.Value.GetProperty("body").GetString()! };
            if (p.Value.TryGetProperty("fallback", out var fb) && fb.ValueKind == JsonValueKind.String) f.FallbackName = fb.GetString();
            foreach (var key in new[] { "idle", "listen", "laugh", "shrug", "point", "fold", "behind", "pockets" })
                if (p.Value.TryGetProperty(key, out var l)) f.Lists[key] = Names(l);
            if (p.Value.TryGetProperty("talk", out var talk))
                foreach (var t in talk.EnumerateObject()) f.Lists["talk_" + t.Name] = Names(t.Value);
            if (p.Value.TryGetProperty("sit", out var sits))
                foreach (var s in sits.EnumerateObject())
                    f.Sits[s.Name] = new Seat(s.Value.GetProperty("clip").GetString()!, s.Value.GetProperty("seat").GetSingle(),
                        s.Value.GetProperty("hips").GetSingle(), s.Value.TryGetProperty("dangle", out var d) && d.GetBoolean());
            foreach (var (key, into) in new[] { ("sitDown", f.SitDown), ("standUp", f.StandUp) })
                if (p.Value.TryGetProperty(key, out var c))
                    foreach (var s in c.EnumerateObject()) into[s.Name] = s.Value.GetString()!;
            families[p.Name] = f;
        }
        foreach (var f in families.Values)
        {
            if (f.FallbackName != null) f.Fallback = families.GetValueOrDefault(f.FallbackName);
            foreach (var (key, list) in f.Lists)
                if (key is "idle" or "fold" or "behind" or "pockets" or "listen" || key.StartsWith("talk_", StringComparison.Ordinal))
                    foreach (var n in list) Standing.Add(n);
        }
    }

    private static string[] Names(JsonElement list)
    {
        var out_ = new string[list.GetArrayLength()];
        int i = 0;
        foreach (var n in list.EnumerateArray()) out_[i++] = n.GetString()!;
        return out_;
    }

    internal static Family? Of(string body) =>
        bodyFamily.TryGetValue(body, out var name) && families.TryGetValue(name, out var f) ? f : null;

    // FNV-1a over UTF-16 code units (as People2Faces): the same on every PC, unlike string.GetHashCode.
    internal static uint Hash(string text)
    {
        uint hash = 2166136261;
        foreach (char c in text) { hash ^= c; hash = unchecked(hash * 16777619); }
        return hash;
    }

    /// <summary>A stable choice among n from a seed and a salt (a different salt for each kind of choice).</summary>
    internal static int Pick(uint seed, uint salt, int n)
    {
        if (n <= 1) return 0;
        uint x = unchecked(seed ^ (salt * 0x9E3779B9u));
        x ^= x >> 16; x = unchecked(x * 0x7feb352du); x ^= x >> 15; x = unchecked(x * 0x846ca68bu); x ^= x >> 16;
        return (int)(x % (uint)n);
    }

    internal static void Identify(Human2 h, string? old, string id)
    {
        if (old != null && byId.TryGetValue(old, out var was) && was == h) byId.Remove(old);
        byId[id] = h;
        if (!hooked && Talks.Talk.I is { } talk) { talk.OnReply += Replied; hooked = true; }
    }

    internal static void Drop(Human2 h, string? id)
    {
        if (id != null && byId.TryGetValue(id, out var was) && was == h) byId.Remove(id);
        Talkers.Remove(h);
    }

    // The game knows a townsperson's mood while Jef talks to them: their gestures follow it.
    private static void Replied(string id, Net.TalkLine line)
    {
        if (line.Mood is { Length: > 0 } mood && byId.TryGetValue(id, out var h)) h.SetMood(mood);
    }

    /// <summary>The set of gestures for a mood: cross for the angry and the cold, eager for the warm and the
    /// amused, calm otherwise.</summary>
    internal static string SetForMood(string mood) => mood switch
    {
        "angry" or "cold" => "cross",
        "warm" or "amused" => "eager",
        _ => "calm",
    };

    /// <summary>The nearest other person talking within 3 m (who is taken to be the one spoken to).</summary>
    internal static Human2? Partner(Human2 me, Vector3 at)
    {
        Human2? best = null;
        float bestD = 9f;
        for (int i = Talkers.Count - 1; i >= 0; i--)
        {
            var t = Talkers[i];
            if (!t.Alive) { Talkers.RemoveAt(i); continue; }
            if (t == me) continue;
            float d = t.Position.DistanceSquaredTo(at);
            if (d < bestD) { bestD = d; best = t; }
        }
        return best;
    }
}

// The shoulder helpers' rule for arms turned by code (docs/people.md "Shoulder helpers"): each shoulder helper
// takes half of the upper arm's swing as seen from the chest. Clips key it; blends, fades and arm IK must redo it.
internal static class People2Shoulders
{
    private sealed record Bones(int Chest, int[] Arm, int[] Clavicle, int[] Helper, Quaternion ChestRest, Quaternion[] ArmRest, Vector3[] Down);
    private static readonly Dictionary<ulong, Bones?> cache = new();
    internal static void Forget() => cache.Clear();

    private static Bones? Of(Skeleton3D sk)
    {
        ulong key = sk.GetInstanceId();
        if (cache.TryGetValue(key, out var b)) return b;
        int chest = sk.FindBone("upperChest");
        var arm = new[] { sk.FindBone("armUpL"), sk.FindBone("armUpR") };
        var clav = new[] { sk.FindBone("clavicleL"), sk.FindBone("clavicleR") };
        var help = new[] { sk.FindBone("shoulderL"), sk.FindBone("shoulderR") };
        if (chest < 0 || arm[0] < 0 || arm[1] < 0 || clav[0] < 0 || clav[1] < 0 || help[0] < 0 || help[1] < 0)
        {
            cache[key] = null;
            return null;
        }
        var armRest = new[] { sk.GetBoneGlobalRest(arm[0]).Basis.GetRotationQuaternion(), sk.GetBoneGlobalRest(arm[1]).Basis.GetRotationQuaternion() };
        b = new Bones(chest, arm, clav, help, sk.GetBoneGlobalRest(chest).Basis.GetRotationQuaternion(), armRest,
            new[] { (armRest[0] * Vector3.Up).Normalized(), (armRest[1] * Vector3.Up).Normalized() });
        cache[key] = b;
        return b;
    }

    private static Quaternion Swing(Quaternion q, Vector3 axis)
    {
        float p = new Vector3(q.X, q.Y, q.Z).Dot(axis);
        var tw = new Quaternion(axis.X * p, axis.Y * p, axis.Z * p, q.W);
        return tw.LengthSquared() < 1e-12f ? q : q * tw.Normalized().Inverse();
    }

    /// <summary>Set both shoulder helpers from the arms as they are now (no-op on a skeleton without them).</summary>
    internal static void Apply(Skeleton3D sk)
    {
        var b = Of(sk);
        if (b == null) return;
        Quaternion uc = sk.GetBoneGlobalPose(b.Chest).Basis.GetRotationQuaternion();
        Quaternion chest = uc * b.ChestRest.Inverse();
        for (int s = 0; s < 2; s++)
        {
            Quaternion arm = sk.GetBoneGlobalPose(b.Arm[s]).Basis.GetRotationQuaternion();
            Quaternion d = chest.Inverse() * (arm * b.ArmRest[s].Inverse());
            Quaternion half = Quaternion.Identity.Slerp(Swing(d.Normalized(), b.Down[s]).Normalized(), 0.5f);
            Quaternion want = chest * half * b.ArmRest[s];
            Quaternion parent = sk.GetBoneGlobalPose(b.Clavicle[s]).Basis.GetRotationQuaternion();
            sk.SetBonePoseRotation(b.Helper[s], (parent.Inverse() * want).Normalized());
        }
    }
}
