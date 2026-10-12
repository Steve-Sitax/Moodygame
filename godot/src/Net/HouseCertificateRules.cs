using System;
using System.Collections.Generic;
using System.Formats.Asn1;
using System.Linq;
using System.Net;
using System.Text.RegularExpressions;

namespace Scheldemist.Net;

/// <summary>The source house certificate's narrow DNS and IPv4 rules, shared by host and guest.</summary>
public static class HouseCertificateRules
{
    public const string ServerAuth = "1.3.6.1.5.5.7.3.1";
    public const string ConstraintsOid = "2.5.29.30";
    public static bool DnsName(string value) => Regex.IsMatch(value, @"^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$");
    public static byte[]? Ip4(string value)
    {
        if (!Regex.IsMatch(value, @"^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$")) return null;
        var parts = value.Split('.'); var bytes = new byte[4];
        for (int i = 0; i < 4; i++) if (!byte.TryParse(parts[i], out bytes[i])) return null;
        return bytes;
    }
    public static bool LanIp(string value) { var b = Ip4(value); return b != null && (b[0] == 10 || b[0] == 172 && b[1] >= 16 && b[1] <= 31 || b[0] == 192 && b[1] == 168); }
    public static bool VpnIp(string value) { var b = Ip4(value); return b != null && b[0] == 100 && b[1] >= 64 && b[1] <= 127; }
    public static bool PrivateIp(string value) => LanIp(value) || VpnIp(value) || Ip4(value) is { } b && b[0] == 127;
    public static string HostName(string value) => Regex.Replace(value.ToLowerInvariant(), "[^a-z0-9.-]", "") is { Length: > 0 } result ? result : "localhost";
    public static string[] DnsNames(IEnumerable<string> names) => names.Select(n => n.ToLowerInvariant().TrimEnd('.')).Where(DnsName).Distinct(StringComparer.Ordinal).OrderBy(n => n, StringComparer.Ordinal).ToArray();
    public static string[] IpNames(IEnumerable<string> names) => names.Where(PrivateIp).Distinct(StringComparer.Ordinal).OrderBy(n => n, StringComparer.Ordinal).ToArray();
    public static bool DnsPermitted(string name, IEnumerable<string> bases) => bases.Any(b => name == b || name.EndsWith("." + b, StringComparison.Ordinal));
    public static byte[] NameConstraintsDer(IEnumerable<string> dns, IEnumerable<(string Ip, int Bits)> ranges)
    {
        var writer = new AsnWriter(AsnEncodingRules.DER); writer.PushSequence();
        var permitted = new Asn1Tag(TagClass.ContextSpecific, 0, true); writer.PushSequence(permitted);
        foreach (string name in dns) { writer.PushSequence(); writer.WriteCharacterString(UniversalTagNumber.IA5String, name, new Asn1Tag(TagClass.ContextSpecific, 2)); writer.PopSequence(); }
        foreach (var (ip, bits) in ranges)
        {
            byte[] b = Ip4(ip) ?? throw new ArgumentException("IPv4 required.");
            if (bits < 0 || bits > 32) throw new ArgumentOutOfRangeException(nameof(ranges));
            uint mask = bits == 0 ? 0 : uint.MaxValue << (32 - bits);
            writer.PushSequence(); writer.WriteOctetString(new byte[] { b[0], b[1], b[2], b[3], (byte)(mask >> 24), (byte)(mask >> 16), (byte)(mask >> 8), (byte)mask }, new Asn1Tag(TagClass.ContextSpecific, 7)); writer.PopSequence();
        }
        writer.PopSequence(permitted); writer.PopSequence(); return writer.Encode();
    }
    public static (string[] Dns, string[] Ranges) ReadNameConstraints(byte[] der)
    {
        var dns = new List<string>(); var ranges = new List<string>();
        var reader = new AsnReader(der, AsnEncodingRules.DER); var outer = reader.ReadSequence(); reader.ThrowIfNotEmpty();
        var permitted = new Asn1Tag(TagClass.ContextSpecific, 0, true);
        while (outer.HasData)
        {
            if (!outer.PeekTag().HasSameClassAndValue(permitted)) throw new AsnContentException("Unsupported house name constraint.");
            var children = outer.ReadSequence(permitted);
            while (children.HasData)
            {
                var child = children.ReadSequence(); var tag = child.PeekTag();
                if (tag.HasSameClassAndValue(new Asn1Tag(TagClass.ContextSpecific, 2))) dns.Add(child.ReadCharacterString(UniversalTagNumber.IA5String, tag));
                else if (tag.HasSameClassAndValue(new Asn1Tag(TagClass.ContextSpecific, 7)))
                {
                    byte[] value = child.ReadOctetString(tag); if (value.Length != 8) throw new AsnContentException("IPv4 constraints required.");
                    uint mask = (uint)value[4] << 24 | (uint)value[5] << 16 | (uint)value[6] << 8 | value[7];
                    int bits = 0; while (bits < 32 && (mask & (0x80000000u >> bits)) != 0) bits++;
                    if (mask != (bits == 0 ? 0 : uint.MaxValue << (32 - bits))) throw new AsnContentException("Noncontiguous address constraint.");
                    ranges.Add(new IPAddress(value.AsSpan(0, 4)).ToString() + "/" + bits);
                }
                else throw new AsnContentException("Unsupported house constraint.");
                child.ThrowIfNotEmpty();
            }
        }
        return (dns.ToArray(), ranges.ToArray());
    }
}
