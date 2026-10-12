using System;
using System.Collections.Concurrent;
using System.Globalization;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Scheldemist.Net.Mp;

/// <summary>Explicit mover field lists exclude scene references; discrete counts/indices use source-style underscore keys.</summary>
public static class NativeWorldFields
{
    private static readonly ConcurrentDictionary<(Type,string),FieldInfo> fields=new();
    private static FieldInfo Field(object value,string name)=>fields.GetOrAdd((value.GetType(),name),key=>key.Item1.GetField(key.Item2,BindingFlags.Instance|BindingFlags.Public)??throw new InvalidOperationException("Missing network mover field "+key));
    private static string Key(FieldInfo field)=>field.Name=="Id"?"id":(field.FieldType.IsEnum||field.FieldType==typeof(int)||field.FieldType==typeof(uint)?"_":"")+char.ToLowerInvariant(field.Name[0])+field.Name[1..];
    public static JsonObject Read(object value,params string[] names){var result=new JsonObject();foreach(string name in names){var field=Field(value,name);object? item=field.GetValue(value);if(item is float f&&!float.IsFinite(f)||item is double d&&!double.IsFinite(d))continue;result[Key(field)]=item==null?null:field.FieldType.IsEnum?JsonValue.Create(Convert.ToInt32(item)):JsonSerializer.SerializeToNode(item);}return result;}
    public static void Apply(object value,JsonObject data,params string[] names){foreach(string name in names){var field=Field(value,name);string key=Key(field);if(!data.ContainsKey(key))continue;var node=data[key];Type type=Nullable.GetUnderlyingType(field.FieldType)??field.FieldType;if(node==null){if(!field.FieldType.IsValueType||Nullable.GetUnderlyingType(field.FieldType)!=null)field.SetValue(value,null);continue;}object? item=null;
        if(type==typeof(string)){if(node is JsonValue sv&&sv.TryGetValue<string>(out var text)&&text.Length<=256)item=text;}
        else if(type==typeof(bool)){if(node is JsonValue bv&&bv.TryGetValue<bool>(out bool boolean))item=boolean;}
        else if(double.TryParse(node.ToJsonString(),NumberStyles.Float,CultureInfo.InvariantCulture,out double number)&&double.IsFinite(number)){try{item=type.IsEnum?Enum.ToObject(type,(int)number):Convert.ChangeType(number,type,CultureInfo.InvariantCulture);}catch(OverflowException){continue;}}
        if(item!=null)field.SetValue(value,item);
    }}
    public static double N(JsonNode? node,string key,double fallback=0)=>node?[key]!=null&&double.TryParse(node[key]!.ToJsonString(),NumberStyles.Float,CultureInfo.InvariantCulture,out var n)&&double.IsFinite(n)?n:fallback;
    public static string S(JsonNode? node,string key,string fallback="")=>node?[key] is JsonValue v&&v.TryGetValue<string>(out var text)?text:fallback;
    public static bool B(JsonNode? node,string key)=>node?[key] is JsonValue v&&v.TryGetValue<bool>(out bool on)&&on;
    public static JsonArray A(JsonNode? node)=>node as JsonArray??new();
}
