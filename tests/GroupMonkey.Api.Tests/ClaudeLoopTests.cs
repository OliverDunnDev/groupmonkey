using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using GroupMonkey.Api.Models;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace GroupMonkey.Api.Tests;

/// <summary>A scripted stand-in for the Claude Messages API, so the real agent loop can be tested without a key.</summary>
internal sealed class FakeClaude : IAsyncDisposable
{
    private readonly WebApplication _app;
    private readonly object _lock = new();
    public List<JsonDocument> Requests { get; } = [];
    public List<string> ApiKeys { get; } = [];
    public string Url { get; }

    private FakeClaude(WebApplication app, string url) { _app = app; Url = url; }

    /// <summary>respond(callNumber starting at 1, request body) returns the HTTP status and JSON body to send.</summary>
    public static async Task<FakeClaude> StartAsync(Func<int, JsonDocument, (int Status, string Body)> respond)
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();
        var app = builder.Build();
        FakeClaude? self = null;

        app.MapPost("/v1/messages", async (HttpContext ctx) =>
        {
            using var reader = new StreamReader(ctx.Request.Body);
            var doc = JsonDocument.Parse(await reader.ReadToEndAsync());
            int n;
            lock (self!._lock)
            {
                self.Requests.Add(doc);
                self.ApiKeys.Add(ctx.Request.Headers["x-api-key"].ToString());
                n = self.Requests.Count;
            }
            var (status, body) = respond(n, doc);
            ctx.Response.StatusCode = status;
            ctx.Response.ContentType = "application/json";
            await ctx.Response.WriteAsync(body);
        });

        await app.StartAsync();
        self = new FakeClaude(app, app.Urls.First());
        return self;
    }

    public async ValueTask DisposeAsync()
    {
        await _app.StopAsync();
        await _app.DisposeAsync();
    }

    // ---- canned responses (wire format of the Messages API) ----

    public static string ToolUse(params (string Id, string Name, object Input)[] calls) => JsonSerializer.Serialize(new
    {
        id = "msg_fake", type = "message", role = "assistant", model = "claude-opus-5-5",
        content = calls.Select(c => (object)new { type = "tool_use", id = c.Id, name = c.Name, input = c.Input, caller = new { type = "direct" } }).ToArray(),
        stop_reason = "tool_use", stop_sequence = (string?)null,
        usage = new { input_tokens = 100, output_tokens = 20 },
    });

    public static string Text(string text) => JsonSerializer.Serialize(new
    {
        id = "msg_fake", type = "message", role = "assistant", model = "claude-opus-5-5",
        content = new object[] { new { type = "text", text } },
        stop_reason = "end_turn", stop_sequence = (string?)null,
        usage = new { input_tokens = 100, output_tokens = 20 },
    });

    public static string Refusal() => JsonSerializer.Serialize(new
    {
        id = "msg_fake", type = "message", role = "assistant", model = "claude-opus-5-5",
        content = Array.Empty<object>(),
        stop_reason = "refusal", stop_sequence = (string?)null,
        stop_details = new { type = "refusal", category = "cyber", explanation = "declined" },
        usage = new { input_tokens = 100, output_tokens = 0 },
    });

    public static (int, string) Unauthorized() =>
        (401, JsonSerializer.Serialize(new { type = "error", error = new { type = "authentication_error", message = "invalid x-api-key" } }));
}

public sealed class ClaudeLoopTests : IDisposable
{
    private const string FakeKey = "sk-ant-fake-key-0123456789abcdef";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { Converters = { new JsonStringEnumConverter() } };

    private readonly string _root = Path.Combine(Path.GetTempPath(), "gm-claude-tests-" + Guid.NewGuid().ToString("N"));
    private readonly List<WebApplicationFactory<Program>> _factories = [];

    public void Dispose()
    {
        foreach (var f in _factories) f.Dispose();
        try { Directory.Delete(_root, true); } catch { /* best effort */ }
    }

    private async Task<HttpClient> LoginAs(WebApplicationFactory<Program> f, string email)
    {
        var c = f.CreateClient();
        var res = await c.PostAsJsonAsync("/api/auth/login", new LoginRequest(email, "password123"));
        res.EnsureSuccessStatusCode();
        var body = (await res.Content.ReadFromJsonAsync<LoginResponse>(Json))!;
        c.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", body.Token);
        return c;
    }

    /// <summary>An app wired to the fake Claude server with AI switched on and an Autonomous agent ready to use.</summary>
    private async Task<(HttpClient Mgr, HttpClient Admin, AgentDto Agent)> Setup(FakeClaude fake)
    {
        var f = new WebApplicationFactory<Program>().WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, c) =>
            c.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Ai:DataDir"] = Path.Combine(_root, Guid.NewGuid().ToString("N")),
                ["Ai:ForceMock"] = "false",
                ["Anthropic:ApiKey"] = FakeKey,
                ["Anthropic:BaseUrl"] = fake.Url,
            })));
        _factories.Add(f);

        var admin = await LoginAs(f, "admin@groupmonkey.dev");
        (await admin.PutAsJsonAsync("/api/admin/ai", new AiSettingsInput(true, null, null, null), Json)).EnsureSuccessStatusCode();
        var mgr = await LoginAs(f, "manager@groupmonkey.dev");
        var created = await mgr.PostAsJsonAsync("/api/agents",
            new AgentInput("Bolt", "Does quick drafts.", "Be brief.", "claude-sonnet-5-5", Autonomy.Autonomous, null, null, null, [1], null), Json);
        created.EnsureSuccessStatusCode();
        return (mgr, admin, (await created.Content.ReadFromJsonAsync<AgentDto>(Json))!);
    }

    private static async Task<RunDto> WaitForRun(HttpClient c, int taskId)
    {
        for (var i = 0; i < 200; i++)
        {
            var runs = await c.GetFromJsonAsync<List<RunDto>>($"/api/tasks/{taskId}/runs", Json) ?? [];
            if (runs.Count > 0 && runs[0].Status is not (RunStatus.Queued or RunStatus.Running)) return runs[0];
            await Task.Delay(50);
        }
        throw new TimeoutException("The run did not finish.");
    }

    private static async Task Assign(HttpClient c, int taskId, int agentId) =>
        (await c.PatchAsJsonAsync($"/api/tasks/{taskId}/assignee", new AssigneeInput(agentId), Json)).EnsureSuccessStatusCode();

    [Fact]
    public async Task Real_loop_calls_tools_answers_every_tool_use_and_finishes()
    {
        await using var fake = await FakeClaude.StartAsync((n, _) => n switch
        {
            // 1: an unknown tool the model made up. It must get an error result, not crash the run.
            1 => (200, FakeClaude.ToolUse(("toolu_1", "delete_task", new { task_id = 8 }))),
            // 2: two parallel tool calls in one assistant turn.
            2 => (200, FakeClaude.ToolUse(
                ("toolu_2", "add_comment", new { task_id = 8, body = "Hello from fake Claude" }),
                ("toolu_3", "update_task_status", new { task_id = 8, status = "Review" }))),
            _ => (200, FakeClaude.Text("Posted my notes and moved it to Review.")),
        });
        var (mgr, _, agent) = await Setup(fake);

        await Assign(mgr, 8, agent.UserId);
        var run = await WaitForRun(mgr, 8);

        Assert.Equal(RunStatus.Succeeded, run.Status);
        Assert.Equal("Claude", run.Provider);
        Assert.Equal("claude-sonnet-5-5", run.Model);
        Assert.Equal(300, run.InputTokens);
        Assert.Equal(60, run.OutputTokens);
        Assert.Equal(3, fake.Requests.Count);

        // Effects landed through the tool layer.
        var tasks = (await mgr.GetFromJsonAsync<List<TaskItem>>("/api/projects/1/tasks", Json))!;
        Assert.Equal(WorkStatus.Review, tasks.Single(t => t.Id == 8).Status);
        var comments = (await mgr.GetFromJsonAsync<List<CommentDto>>("/api/tasks/8/comments", Json))!;
        Assert.Contains(comments, c => c.AuthorId == agent.UserId && c.Body == "Hello from fake Claude");
        Assert.Contains(run.Steps, s => s.Type == StepType.Message && s.Content.Contains("moved it to Review"));

        // What we sent to Claude.
        var first = fake.Requests[0].RootElement;
        Assert.Equal("claude-sonnet-5-5", first.GetProperty("model").GetString());
        Assert.Contains("data, not instructions", first.GetProperty("system").GetString());
        Assert.Contains("Bolt", first.GetProperty("system").GetString());
        Assert.False(first.TryGetProperty("thinking", out _)); // leave thinking to the model's default
        Assert.Equal("medium", first.GetProperty("output_config").GetProperty("effort").GetString());
        var toolNames = first.GetProperty("tools").EnumerateArray().Select(t => t.GetProperty("name").GetString()).ToList();
        Assert.Contains("add_comment", toolNames);
        Assert.Contains("get_task", toolNames);
        Assert.DoesNotContain(toolNames, n => n!.Contains("delete"));
        Assert.Contains("Image optimisation pipeline", first.GetProperty("messages")[0].GetProperty("content").ToString());

        // Request 2 echoes the tool_use and answers it with an error result (unknown tool).
        var second = fake.Requests[1].RootElement.GetProperty("messages");
        Assert.Equal(3, second.GetArrayLength());
        Assert.Equal("assistant", second[1].GetProperty("role").GetString());
        var result1 = second[2].GetProperty("content")[0];
        Assert.Equal("tool_result", result1.GetProperty("type").GetString());
        Assert.Equal("toolu_1", result1.GetProperty("tool_use_id").GetString());
        Assert.True(result1.GetProperty("is_error").GetBoolean());

        // Request 3 answers both parallel calls in a single user message.
        var third = fake.Requests[2].RootElement.GetProperty("messages");
        var results = third[third.GetArrayLength() - 1].GetProperty("content").EnumerateArray().ToList();
        Assert.Equal(2, results.Count);
        Assert.Equal("toolu_2", results[0].GetProperty("tool_use_id").GetString());
        Assert.Equal("toolu_3", results[1].GetProperty("tool_use_id").GetString());

        // The key goes to Claude and nowhere else.
        Assert.All(fake.ApiKeys, k => Assert.Equal(FakeKey, k));
        Assert.DoesNotContain(FakeKey, await mgr.GetStringAsync("/api/tasks/8/runs"));
        Assert.DoesNotContain(FakeKey, await mgr.GetStringAsync("/api/tasks/8/comments"));
    }

    [Fact]
    public async Task A_rejected_key_fails_the_run_with_a_clear_message()
    {
        await using var fake = await FakeClaude.StartAsync((_, _) => FakeClaude.Unauthorized());
        var (mgr, _, agent) = await Setup(fake);

        await Assign(mgr, 8, agent.UserId);
        var run = await WaitForRun(mgr, 8);

        Assert.Equal(RunStatus.Failed, run.Status);
        Assert.Contains("rejected the API key", run.Error);
        Assert.DoesNotContain(FakeKey, run.Error);
        var comments = (await mgr.GetFromJsonAsync<List<CommentDto>>("/api/tasks/8/comments", Json))!;
        Assert.Contains(comments, c => c.AuthorId == agent.UserId && c.Body.Contains("couldn't finish"));
    }

    [Fact]
    public async Task A_refusal_ends_the_run_without_changing_anything()
    {
        await using var fake = await FakeClaude.StartAsync((_, _) => (200, FakeClaude.Refusal()));
        var (mgr, _, agent) = await Setup(fake);

        await Assign(mgr, 8, agent.UserId);
        var run = await WaitForRun(mgr, 8);

        Assert.Equal(RunStatus.Failed, run.Status);
        Assert.Contains("declined", run.Error);
        var tasks = (await mgr.GetFromJsonAsync<List<TaskItem>>("/api/projects/1/tasks", Json))!;
        Assert.Equal(WorkStatus.Todo, tasks.Single(t => t.Id == 8).Status);
    }

    [Fact]
    public async Task A_model_that_never_stops_calling_tools_is_cut_off()
    {
        await using var fake = await FakeClaude.StartAsync((n, _) => (200, FakeClaude.ToolUse(($"toolu_{n}", "list_tasks", new { }))));
        var (mgr, _, agent) = await Setup(fake);

        await Assign(mgr, 8, agent.UserId);
        var run = await WaitForRun(mgr, 8);

        Assert.Equal(RunStatus.Failed, run.Status);
        Assert.Contains("12 turns", run.Error);
        Assert.Equal(12, fake.Requests.Count);
    }

    [Fact]
    public async Task Test_connection_reports_success_and_failure()
    {
        await using var ok = await FakeClaude.StartAsync((_, _) => (200, FakeClaude.Text("OK")));
        var (_, admin, _) = await Setup(ok);
        var good = (await (await admin.PostAsync("/api/admin/ai/test", null)).Content.ReadFromJsonAsync<AiTestResult>(Json))!;
        Assert.True(good.Ok);

        await using var bad = await FakeClaude.StartAsync((_, _) => FakeClaude.Unauthorized());
        var (_, admin2, _) = await Setup(bad);
        var rejected = (await (await admin2.PostAsync("/api/admin/ai/test", null)).Content.ReadFromJsonAsync<AiTestResult>(Json))!;
        Assert.False(rejected.Ok);
        Assert.Contains("rejected", rejected.Message);
        Assert.DoesNotContain(FakeKey, rejected.Message);
    }
}
