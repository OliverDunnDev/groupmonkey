using System.Text.Json;
using GroupMonkey.Api.Data;
using GroupMonkey.Api.Models;
using Microsoft.AspNetCore.DataProtection;

namespace GroupMonkey.Api.Ai;

/// <summary>
/// Admin-controlled AI settings. The Claude API key is write-only: it is encrypted at rest with
/// ASP.NET Data Protection, never returned by any endpoint, and only handed to the Claude client.
/// </summary>
public class AiSettingsStore
{
    public const string DefaultModel = "claude-opus-5-5";
    public static readonly string[] Models = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"];

    private readonly object _lock = new();
    private readonly DataStore _store;
    private readonly IDataProtector _protector;
    private readonly string _path;
    private readonly string? _configKey;
    private readonly bool _forceMock;

    private bool _enabled;
    private string _model = DefaultModel;
    private string? _adminKey;

    private record Persisted(bool Enabled, string? DefaultModel, string? ProtectedKey);

    public AiSettingsStore(DataStore store, IDataProtectionProvider dp, IConfiguration config, IWebHostEnvironment env)
    {
        _store = store;
        _protector = dp.CreateProtector("GroupMonkey.Ai.ApiKey.v1");
        var dir = config["Ai:DataDir"] ?? Path.Combine(env.ContentRootPath, "App_Data");
        _path = Path.Combine(dir, "ai-settings.json");
        _configKey = string.IsNullOrWhiteSpace(config["Anthropic:ApiKey"]) ? null : config["Anthropic:ApiKey"]!.Trim();
        _forceMock = config.GetValue("Ai:ForceMock", false);
        Load();
        _store.AiEnabled = _enabled;
    }

    private void Load()
    {
        try
        {
            if (!File.Exists(_path)) return;
            var p = JsonSerializer.Deserialize<Persisted>(File.ReadAllText(_path));
            if (p is null) return;
            _enabled = p.Enabled;
            if (p.DefaultModel is { } m && Models.Contains(m)) _model = m;
            if (!string.IsNullOrEmpty(p.ProtectedKey)) _adminKey = _protector.Unprotect(p.ProtectedKey);
        }
        catch
        {
            // Unreadable or undecryptable settings (e.g. rotated keys): start clean rather than fail startup.
            _adminKey = null;
        }
    }

    private void Save()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
            var p = new Persisted(_enabled, _model, _adminKey is null ? null : _protector.Protect(_adminKey));
            File.WriteAllText(_path, JsonSerializer.Serialize(p));
        }
        catch
        {
            // Persistence is best effort; the in-memory value stays effective for this process.
        }
    }

    public bool Enabled { get { lock (_lock) return _enabled; } }
    public string Model { get { lock (_lock) return _model; } }

    /// <summary>The key to use for real calls, or null for demo mode. Internal use by the Claude client only.</summary>
    public string? ActiveKey
    {
        get
        {
            lock (_lock) return _forceMock ? null : _adminKey ?? _configKey;
        }
    }

    public string Mode => ActiveKey is null ? "Mock" : "Claude";

    public AiSettingsDto ToDto()
    {
        lock (_lock)
        {
            var key = _forceMock ? null : _adminKey ?? _configKey;
            var source = key is null ? "none" : _adminKey is not null ? "admin" : "config";
            var hint = key is null ? null : "..." + key[^Math.Min(4, key.Length)..];
            return new AiSettingsDto(_enabled, key is null ? "Mock" : "Claude", _model, key is not null, hint, source, Models);
        }
    }

    /// <summary>Returns an error message, or null on success.</summary>
    public string? Update(AiSettingsInput input)
    {
        lock (_lock)
        {
            if (input.DefaultModel is { } m && !Models.Contains(m)) return "Unknown model.";
            if (input.ApiKey is { } raw && !string.IsNullOrWhiteSpace(raw))
            {
                var key = raw.Trim();
                if (key.Length < 20 || key.Any(char.IsWhiteSpace) || !key.StartsWith("sk-ant-", StringComparison.Ordinal))
                    return "That doesn't look like an Anthropic API key (it should start with sk-ant-).";
                _adminKey = key;
            }
            if (input.ClearKey == true) _adminKey = null;
            if (input.DefaultModel is { } dm) _model = dm;
            if (input.Enabled is { } e) _enabled = e;
            _store.AiEnabled = _enabled;
            Save();
            return null;
        }
    }
}
