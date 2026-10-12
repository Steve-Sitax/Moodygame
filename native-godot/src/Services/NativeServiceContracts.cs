using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;

namespace Scheldemist.Native.Services;

/// <summary>The same game contracts in process: no HTTP process, browser or Node runtime.</summary>
public interface INativeServiceBackend : IDisposable
{
    Task<string> Call(string method, string path, string? body, int playerId = 1);
    bool CanHandle(string method, string path);
    event Action<string>? Push;
}

/// <summary>Public world events or a recipient's private view; transports must never broadcast a private envelope.</summary>
public interface INativeRecipientBackend : INativeServiceBackend
{
    event Action<int?, string>? RoutedPush;
}

public interface INativeServiceModule
{
    void Register(NativeServiceHost host);
}

public sealed class NativeServiceException : Exception
{
    public int Status { get; }
    public NativeServiceException(string message, int status = 400) : base(message) => Status = status;
}

public sealed record NativeServiceOptions(string DatabasePath, string DataDirectory, string SaveDirectory,
    Func<long>? NowMilliseconds = null, Func<double>? Random = null);

public sealed class NativeServiceRequest
{
    public NativeServiceContext Context { get; }
    public string Method { get; }
    public string Path { get; }
    public int PlayerId { get; }
    public JsonObject Body { get; }
    public IReadOnlyDictionary<string, string> Parameters { get; }
    public IReadOnlyDictionary<string, string> Query { get; }
    internal NativeServiceRequest(NativeServiceContext context, string method, string path, int playerId,
        JsonObject body, Dictionary<string, string> parameters, Dictionary<string, string> query)
        => (Context, Method, Path, PlayerId, Body, Parameters, Query) = (context, method, path, playerId, body, parameters, query);
    public string Param(string name) => Parameters.GetValueOrDefault(name, "");
    public string Text(string name, string fallback = "") => Body[name] is JsonValue v && v.TryGetValue<string>(out var s) ? s : fallback;
    public int Int(string name, int fallback = 0) => Body[name] is JsonValue v && v.TryGetValue<double>(out var n) && double.IsFinite(n) ? (int)n : fallback;
    public bool Bool(string name, bool fallback = false) => Body[name] is JsonValue v && v.TryGetValue<bool>(out var n) ? n : fallback;
}

/// <summary>Shared SQLite/state API for independent native rule modules. SQL parameters are always values.</summary>
public sealed class NativeServiceContext : IDisposable
{
    public SqliteConnection Database { get; }
    public NativeServiceOptions Options { get; }
    public JsonObject Rules { get; }
    public long Now => (Options.NowMilliseconds ?? (() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()))();
    public double Roll() => (Options.Random ?? Random.Shared.NextDouble)();
    private SqliteTransaction? transaction;
    public NativeServiceContext(NativeServiceOptions options)
    {
        Options = options;
        if (options.DatabasePath != ":memory:") Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(options.DatabasePath))!);
        Database = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = options.DatabasePath, ForeignKeys = true, Pooling = false }.ToString());
        Database.Open();
        Execute("PRAGMA journal_mode=WAL");
        string schema = File.ReadAllText(Path.Combine(options.DataDirectory, "native-schema.sql"));
        schema = Regex.Replace(schema, @"CREATE (TABLE|INDEX|TRIGGER) (?!IF NOT EXISTS)", "CREATE $1 IF NOT EXISTS ");
        Execute(schema);
        Rules = JsonNode.Parse(File.ReadAllText(Path.Combine(options.DataDirectory, "native-rules.json")))!.AsObject();
        if (Scalar<long>("SELECT COUNT(*) FROM player") == 0) RestoreSeed();
    }
    private SqliteCommand Command(string sql, object?[] values)
    {
        var command = Database.CreateCommand();
        command.CommandText = sql;
        command.Transaction = transaction;
        for (int i = 0; i < values.Length; i++) command.Parameters.AddWithValue("$p" + i, values[i] ?? DBNull.Value);
        return command;
    }
    public int Execute(string sql, params object?[] values)
    {
        using var command = Command(sql, values);
        return command.ExecuteNonQuery();
    }
    public T Scalar<T>(string sql, params object?[] values)
    {
        using var command = Command(sql, values);
        var result = command.ExecuteScalar();
        return result == null || result is DBNull ? default! : (T)Convert.ChangeType(result, typeof(T), System.Globalization.CultureInfo.InvariantCulture);
    }
    public JsonArray Rows(string sql, params object?[] values)
    {
        using var command = Command(sql, values);
        using var reader = command.ExecuteReader();
        var rows = new JsonArray();
        while (reader.Read())
        {
            var row = new JsonObject();
            for (int i = 0; i < reader.FieldCount; i++) row[reader.GetName(i)] = reader.IsDBNull(i) ? null : JsonSerializer.SerializeToNode(reader.GetValue(i));
            rows.Add(row);
        }
        return rows;
    }
    public JsonObject? One(string sql, params object?[] values) => Rows(sql, values).FirstOrDefault()?.DeepClone().AsObject();
    public T Atomic<T>(Func<T> action)
    {
        if (transaction != null) return action();
        using var tx = Database.BeginTransaction();
        transaction = tx;
        try { var value = action(); tx.Commit(); return value; }
        finally { transaction = null; }
    }
    public void Atomic(Action action) => Atomic(() => { action(); return true; });
    public JsonNode? World(string key) => ParseState(Scalar<string>("SELECT value_json FROM world_state WHERE key=$p0", key));
    private static string PersistentJson(object? value)
    {
        string json = JsonSerializer.Serialize(value); if (!json.Contains("-0", StringComparison.Ordinal)) return json;
        var root = JsonNode.Parse(json);
        JsonNode? Normalize(JsonNode? node) {
            if (node is JsonObject obj) { foreach (string key in obj.Select(p => p.Key).ToArray()) { var old = obj[key]; var next = Normalize(old); if (!ReferenceEquals(old, next)) obj[key] = next; } }
            else if (node is JsonArray array) { for (int i = 0; i < array.Count; i++) { var old = array[i]; var next = Normalize(old); if (!ReferenceEquals(old, next)) array[i] = next; } }
            else if (node is JsonValue scalar && scalar.GetValueKind() == JsonValueKind.Number && scalar.ToJsonString().StartsWith("-", StringComparison.Ordinal) && scalar.TryGetValue<double>(out double number) && number == 0) return JsonValue.Create(0);
            return node;
        }
        // JSON.stringify writes -0 as 0. Persisted points later feed atan2; preserve in-memory geometry signs.
        return Normalize(root)?.ToJsonString() ?? "null";
    }
    public void SetWorld(string key, object? value) => Execute("INSERT INTO world_state(key,value_json) VALUES($p0,$p1) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json", key, PersistentJson(value));
    public JsonNode? PlayerState(int playerId, string key) => ParseState(Scalar<string>("SELECT value_json FROM player_state WHERE player_id=$p0 AND key=$p1", playerId, key));
    public void SetPlayerState(int playerId, string key, object? value) => Execute("INSERT INTO player_state(player_id,key,value_json) VALUES($p0,$p1,$p2) ON CONFLICT(player_id,key) DO UPDATE SET value_json=excluded.value_json", playerId, key, PersistentJson(value));
    private static JsonNode? ParseState(string? value) { try { return string.IsNullOrEmpty(value) ? null : JsonNode.Parse(value); } catch (JsonException) { return null; } }
    public void Log(int playerId, string verb, string? target, string text, string actor = "player") => Execute(
        "INSERT INTO log(day,hour,place,actor,verb,object,text,player_id) SELECT w.day,w.hour,p.district,$p0,$p1,$p2,$p3,$p4 FROM player p,player w WHERE p.id=$p4 AND w.id=1", actor, verb, target, text, playerId);
    public void RestoreSeed()
    {
        var data = JsonNode.Parse(File.ReadAllText(Path.Combine(Options.DataDirectory, "native-seed.json")))!["tables"]!.AsObject();
        // Inserting recovered town data retains authoritative IDs and references. New-town generation is a separate native module.
        Execute("PRAGMA foreign_keys=OFF");
        try
        {
            Atomic(() => {
                foreach (var table in data)
                {
                    if (!Regex.IsMatch(table.Key, "^[a-z_]+$")) throw new InvalidDataException("Invalid native table name");
                    foreach (var node in table.Value!.AsArray())
                    {
                        var row = node!.AsObject();
                        var columns = row.Select(x => x.Key).ToArray();
                        if (columns.Any(c => !Regex.IsMatch(c, "^[a-z_]+$"))) throw new InvalidDataException("Invalid native column name");
                        var values = columns.Select(c => row[c] == null ? null : row[c]!.GetValueKind() == JsonValueKind.Number ? (object)row[c]!.GetValue<double>() : row[c]!.GetValueKind() == JsonValueKind.String ? row[c]!.GetValue<string>() : (object)row[c]!.ToJsonString()).ToArray();
                        Execute("INSERT OR REPLACE INTO \"" + table.Key + "\"(" + string.Join(",", columns.Select(c => "\"" + c + "\"")) + ") VALUES(" + string.Join(",", values.Select((_, i) => "$p" + i)) + ")", values);
                    }
                }
            });
        }
        finally { Execute("PRAGMA foreign_keys=ON"); }
        if (Rows("PRAGMA foreign_key_check").Count != 0) throw new InvalidDataException("Native seed has broken references");
    }
    public void Dispose() => Database.Dispose();
}
