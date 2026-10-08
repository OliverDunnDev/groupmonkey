using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using GroupMonkey.Api.Ai;
using GroupMonkey.Api.Data;
using GroupMonkey.Api.Models;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;

namespace GroupMonkey.Api.Tests;

public sealed class AiTests : IDisposable
{
    private const string Admin = "admin@groupmonkey.dev";
    private const string Manager = "manager@groupmonkey.dev";
    private const string Member = "member@groupmonkey.dev";
    private const int Scout = 5; // AskFirst, can comment and move to Review
    private const int Patch = 6; // Suggest, comments only

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { Converters = { new JsonStringEnumConverter() } };

    private readonly string _root = Path.Combine(Path.GetTempPath(), "gm-ai-tests-" + Guid.NewGuid().ToString("N"));
    private readonly List<WebApplicationFactory<Program>> _factories = [];

    public void Dispose()
    {
        foreach (var f in _factories) f.Dispose();
        try { Directory.Delete(_root, true); } catch { /* best effort */ }
    }

    private sealed class App(WebApplicationFactory<Program> factory, string dir)
    {
        public string Dir => dir;

        public async Task<HttpClient> As(string email)
        {
            var c = factory.CreateClient();
            var res = await c.PostAsJsonAsync("/api/auth/login", new LoginRequest(email, "password123"));
            res.EnsureSuccessStatusCode();
            var body = (await res.Content.ReadFromJsonAsync<LoginResponse>(Json))!;
            c.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", body.Token);
            return c;
        }
    }

    // Each app gets its own data (and its own settings directory), and never talks to the real Claude API.
    private App NewApp(bool forceMock = true)
    {
        var dir = Path.Combine(_root, Guid.NewGuid().ToString("N"));
        var f = new WebApplicationFactory<Program>().WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, c) =>
            c.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Ai:DataDir"] = dir,
                ["Ai:ForceMock"] = forceMock ? "true" : "false",
                ["Ai:MockDelayMs"] = "0",
                ["Anthropic:ApiKey"] = "",
            })));
        _factories.Add(f);
        return new App(f, dir);
    }

    private static async Task EnableAi(HttpClient admin)
    {
        var res = await admin.PutAsJsonAsync("/api/admin/ai", new AiSettingsInput(true, null, null, null), Json);
        res.EnsureSuccessStatusCode();
    }

    private static async Task Assign(HttpClient c, int taskId, int? userId)
    {
        var res = await c.PatchAsJsonAsync($"/api/tasks/{taskId}/assignee", new AssigneeInput(userId), Json);
        res.EnsureSuccessStatusCode();
    }

    private static async Task<List<RunDto>> WaitRuns(HttpClient c, int taskId, int minRuns = 1)
    {
        for (var i = 0; i < 200; i++)
        {
            var runs = await c.GetFromJsonAsync<List<RunDto>>($"/api/tasks/{taskId}/runs", Json) ?? [];
            if (runs.Count >= minRuns && runs.All(r => r.Status is not (RunStatus.Queued or RunStatus.Running))) return runs;
            await Task.Delay(50);
        }
        throw new TimeoutException($"Runs for task {taskId} did not finish.");
    }

    private static async Task<TaskItem> GetTask(HttpClient c, int projectId, int taskId) =>
        (await c.GetFromJsonAsync<List<TaskItem>>($"/api/projects/{projectId}/tasks", Json))!.Single(t => t.Id == taskId);

    // ---------- feature flag ----------

    [Fact]
    public async Task Ai_is_off_by_default_and_agents_are_hidden()
    {
        var app = NewApp();
        var mgr = await app.As(Manager);

        var status = (await mgr.GetFromJsonAsync<AiStatusDto>("/api/ai/status", Json))!;
        Assert.False(status.Enabled);

        var users = (await mgr.GetFromJsonAsync<List<UserDto>>("/api/users", Json))!;
        Assert.DoesNotContain(users, u => u.Kind == UserKind.Agent);

        var project = (await mgr.GetFromJsonAsync<ProjectDto>("/api/projects/1", Json))!;
        Assert.DoesNotContain(Scout, project.MemberIds);
        var groups = (await mgr.GetFromJsonAsync<List<GroupDto>>("/api/groups", Json))!;
        Assert.All(groups, g => Assert.DoesNotContain(Scout, g.MemberIds));

        Assert.Equal(HttpStatusCode.NotFound, (await mgr.GetAsync("/api/agents")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await mgr.GetAsync("/api/approvals")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await mgr.GetAsync("/api/tasks/7/comments")).StatusCode);
    }

    [Fact]
    public async Task Assigning_to_an_agent_is_rejected_while_ai_is_off()
    {
        var mgr = await NewApp().As(Manager);
        var res = await mgr.PatchAsJsonAsync("/api/tasks/8/assignee", new AssigneeInput(Scout), Json);
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Enabling_ai_reveals_agents_everywhere()
    {
        var app = NewApp();
        await EnableAi(await app.As(Admin));
        var mgr = await app.As(Manager);

        var users = (await mgr.GetFromJsonAsync<List<UserDto>>("/api/users", Json))!;
        Assert.Contains(users, u => u.Id == Scout && u.Kind == UserKind.Agent);
        var project = (await mgr.GetFromJsonAsync<ProjectDto>("/api/projects/1", Json))!;
        Assert.Contains(Scout, project.MemberIds);
        var group = (await mgr.GetFromJsonAsync<GroupDto>("/api/groups/1", Json))!;
        Assert.Contains(Scout, group.MemberIds); // agents are group members, like people

        var agents = (await mgr.GetFromJsonAsync<List<AgentDto>>("/api/agents", Json))!;
        Assert.Equal(2, agents.Count);

        var summary = (await mgr.GetFromJsonAsync<ProjectSummary>("/api/projects/1/summary", Json))!;
        Assert.Contains(summary.Members, m => m.UserId == Scout && m.Kind == UserKind.Agent);
    }

    [Fact]
    public async Task Agents_cannot_log_in()
    {
        var client = (await NewApp().As(Admin));
        // Agents have an empty password; make sure that never works as a credential.
        var login = await client.PostAsJsonAsync("/api/auth/login", new LoginRequest("scout@agents.groupmonkey.local", ""));
        Assert.Equal(HttpStatusCode.Unauthorized, login.StatusCode);
    }

    // ---------- admin settings and the key ----------

    [Fact]
    public async Task Only_admins_can_read_or_change_ai_settings()
    {
        var app = NewApp();
        var member = await app.As(Member);
        var mgr = await app.As(Manager);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.GetAsync("/api/admin/ai")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await mgr.GetAsync("/api/admin/ai")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await mgr.PutAsJsonAsync("/api/admin/ai", new AiSettingsInput(true, null, null, null), Json)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.PostAsync("/api/admin/ai/test", null)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await (await app.As(Admin)).GetAsync("/api/admin/ai")).StatusCode);
    }

    [Fact]
    public async Task Api_key_is_write_only_and_encrypted_at_rest()
    {
        const string key = "sk-ant-test-abcdefghijklmnop1234";
        var app = NewApp(forceMock: false);
        var admin = await app.As(Admin);

        var put = await admin.PutAsJsonAsync("/api/admin/ai", new AiSettingsInput(null, null, key, null), Json);
        put.EnsureSuccessStatusCode();
        var raw = await put.Content.ReadAsStringAsync();
        Assert.DoesNotContain(key, raw);
        var dto = JsonSerializer.Deserialize<AiSettingsDto>(raw, Json)!;
        Assert.True(dto.HasKey);
        Assert.Equal("Claude", dto.Mode);
        Assert.Equal("...1234", dto.KeyHint);
        Assert.Equal("admin", dto.KeySource);

        var again = await admin.GetStringAsync("/api/admin/ai");
        Assert.DoesNotContain(key, again);

        // Status for ordinary users never exposes the key either.
        Assert.DoesNotContain(key, await (await app.As(Member)).GetStringAsync("/api/ai/status"));

        var file = Path.Combine(app.Dir, "ai-settings.json");
        Assert.True(File.Exists(file));
        Assert.DoesNotContain(key, await File.ReadAllTextAsync(file));

        var cleared = await admin.PutAsJsonAsync("/api/admin/ai", new AiSettingsInput(null, null, null, true), Json);
        var after = (await cleared.Content.ReadFromJsonAsync<AiSettingsDto>(Json))!;
        Assert.False(after.HasKey);
        Assert.Equal("Mock", after.Mode);
    }

    [Fact]
    public async Task Obviously_wrong_keys_and_models_are_rejected()
    {
        var admin = await NewApp().As(Admin);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync("/api/admin/ai", new AiSettingsInput(null, null, "hello", null), Json)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync("/api/admin/ai", new AiSettingsInput(null, "gpt-5", null, null), Json)).StatusCode);
    }

    [Fact]
    public async Task Test_button_explains_demo_mode_when_there_is_no_key()
    {
        var admin = await NewApp().As(Admin);
        var res = (await (await admin.PostAsync("/api/admin/ai/test", null)).Content.ReadFromJsonAsync<AiTestResult>(Json))!;
        Assert.False(res.Ok);
        Assert.Contains("demo mode", res.Message, StringComparison.OrdinalIgnoreCase);
    }

    // ---------- running agents end to end (mock provider) ----------

    [Fact]
    public async Task Assigning_to_an_autonomous_agent_runs_it_and_moves_the_card_to_review()
    {
        var app = NewApp();
        var admin = await app.As(Admin);
        await EnableAi(admin);
        var mgr = await app.As(Manager);

        var created = await mgr.PostAsJsonAsync("/api/agents",
            new AgentInput("Bolt", "Does quick drafts.", "Be brief.", null, Autonomy.Autonomous, null, null, null, [1], null), Json);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var bolt = (await created.Content.ReadFromJsonAsync<AgentDto>(Json))!;
        Assert.Contains(1, bolt.GroupIds);

        await Assign(mgr, 8, bolt.UserId);
        var runs = await WaitRuns(mgr, 8);

        var run = Assert.Single(runs);
        Assert.Equal(RunStatus.Succeeded, run.Status);
        Assert.Equal("Mock", run.Provider);
        Assert.Contains(run.Steps, s => s.Type == StepType.ToolCall && s.Content.StartsWith(AgentTools.AddComment));
        Assert.Equal(WorkStatus.Review, (await GetTask(mgr, 1, 8)).Status);

        var comments = (await mgr.GetFromJsonAsync<List<CommentDto>>("/api/tasks/8/comments", Json))!;
        Assert.Contains(comments, c => c.AuthorId == bolt.UserId);
    }

    [Fact]
    public async Task Ask_first_agents_hold_changes_until_a_manager_approves()
    {
        var app = NewApp();
        await EnableAi(await app.As(Admin));
        var mgr = await app.As(Manager);

        await Assign(mgr, 8, Scout);
        var run = Assert.Single(await WaitRuns(mgr, 8));
        Assert.Equal(RunStatus.AwaitingApproval, run.Status);
        Assert.Equal(WorkStatus.Todo, (await GetTask(mgr, 1, 8)).Status); // not moved yet
        var action = Assert.Single(run.Actions);
        Assert.Equal(ActionState.Pending, action.State);

        var pending = (await mgr.GetFromJsonAsync<List<ActionDto>>("/api/approvals", Json))!;
        Assert.Contains(pending, a => a.Id == action.Id);

        var approve = await mgr.PostAsync($"/api/approvals/{action.Id}/approve", null);
        Assert.Equal(HttpStatusCode.OK, approve.StatusCode);
        Assert.Equal(WorkStatus.Review, (await GetTask(mgr, 1, 8)).Status);
        var after = (await mgr.GetFromJsonAsync<List<RunDto>>("/api/tasks/8/runs", Json))!.Single();
        Assert.Equal(RunStatus.Succeeded, after.Status);

        // Deciding twice is refused.
        Assert.Equal(HttpStatusCode.BadRequest, (await mgr.PostAsync($"/api/approvals/{action.Id}/approve", null)).StatusCode);
    }

    [Fact]
    public async Task Rejecting_a_proposal_leaves_the_task_alone_and_settles_the_run()
    {
        var app = NewApp();
        await EnableAi(await app.As(Admin));
        var mgr = await app.As(Manager);

        var pending = (await mgr.GetFromJsonAsync<List<ActionDto>>("/api/approvals", Json))!;
        var seeded = Assert.Single(pending, a => a.TaskId == 7);

        var reject = await mgr.PostAsync($"/api/approvals/{seeded.Id}/reject", null);
        reject.EnsureSuccessStatusCode();
        Assert.Equal(ActionState.Rejected, (await reject.Content.ReadFromJsonAsync<ActionDto>(Json))!.State);
        Assert.Equal(WorkStatus.Todo, (await GetTask(mgr, 1, 7)).Status);
        var run = (await mgr.GetFromJsonAsync<RunDto>($"/api/runs/{seeded.RunId}", Json))!;
        Assert.Equal(RunStatus.Succeeded, run.Status);
    }

    [Fact]
    public async Task Members_cannot_decide_proposals()
    {
        var app = NewApp();
        await EnableAi(await app.As(Admin));
        var member = await app.As(Member);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.PostAsync("/api/approvals/1/approve", null)).StatusCode);
        var list = (await member.GetFromJsonAsync<List<ActionDto>>("/api/approvals", Json))!;
        Assert.Empty(list);
    }

    [Fact]
    public async Task Suggest_agents_can_comment_but_not_change_tasks()
    {
        var app = NewApp();
        await EnableAi(await app.As(Admin));
        var mgr = await app.As(Manager);

        await Assign(mgr, 8, Patch);
        var run = Assert.Single(await WaitRuns(mgr, 8));
        Assert.Equal(RunStatus.Succeeded, run.Status);
        Assert.Empty(run.Actions);
        Assert.Contains(run.Steps, s => s.Type == StepType.ToolResult && s.Content.StartsWith("Error:") && s.Content.Contains("not enabled"));
        Assert.Equal(WorkStatus.Todo, (await GetTask(mgr, 1, 8)).Status);
        var comments = (await mgr.GetFromJsonAsync<List<CommentDto>>("/api/tasks/8/comments", Json))!;
        Assert.Contains(comments, c => c.AuthorId == Patch);
    }

    [Fact]
    public async Task An_agent_that_asks_a_question_resumes_when_someone_replies()
    {
        var app = NewApp();
        await EnableAi(await app.As(Admin));
        var mgr = await app.As(Manager);

        var created = await mgr.PostAsJsonAsync("/api/projects/1/tasks",
            new TaskInput("Draft launch note", "[ask] write the announcement", null, null, Scout, null, null), Json);
        var task = (await created.Content.ReadFromJsonAsync<TaskItem>(Json))!;

        var first = Assert.Single(await WaitRuns(mgr, task.Id));
        Assert.Equal(RunStatus.NeedsInput, first.Status);
        var comments = (await mgr.GetFromJsonAsync<List<CommentDto>>($"/api/tasks/{task.Id}/comments", Json))!;
        Assert.Contains(comments, c => c.AuthorId == Scout && c.Body.Contains("I need your input"));

        var reply = await mgr.PostAsJsonAsync($"/api/tasks/{task.Id}/comments", new CommentInput("It's for customers, due Friday."), Json);
        Assert.Equal(HttpStatusCode.Created, reply.StatusCode);
        var runs = await WaitRuns(mgr, task.Id, minRuns: 2);
        Assert.Equal(2, runs.Count);
    }

    [Fact]
    public async Task Daily_run_limit_stops_runaway_assignment()
    {
        var app = NewApp();
        await EnableAi(await app.As(Admin));
        var mgr = await app.As(Manager);

        var created = await mgr.PostAsJsonAsync("/api/agents",
            new AgentInput("Limiter", "Limited.", "", null, Autonomy.Autonomous, null, null, 1, [1], null), Json);
        var agent = (await created.Content.ReadFromJsonAsync<AgentDto>(Json))!;

        await Assign(mgr, 8, agent.UserId);
        await WaitRuns(mgr, 8);
        await Assign(mgr, 9, agent.UserId);
        Assert.Empty((await mgr.GetFromJsonAsync<List<RunDto>>("/api/tasks/9/runs", Json))!);

        var manual = await mgr.PostAsync("/api/tasks/9/run", null);
        Assert.Equal(HttpStatusCode.BadRequest, manual.StatusCode);
        Assert.Contains("limit", await manual.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Run_now_requires_an_agent_assignee()
    {
        var app = NewApp();
        await EnableAi(await app.As(Admin));
        var mgr = await app.As(Manager);
        Assert.Equal(HttpStatusCode.BadRequest, (await mgr.PostAsync("/api/tasks/8/run", null)).StatusCode);
    }

    // ---------- agent management ----------

    [Fact]
    public async Task Members_cannot_create_agents_and_names_must_be_unique()
    {
        var app = NewApp();
        await EnableAi(await app.As(Admin));
        var member = await app.As(Member);
        var mgr = await app.As(Manager);
        var input = new AgentInput("Newbie", "x", "", null, null, null, null, null, null, null);

        Assert.Equal(HttpStatusCode.Forbidden, (await member.PostAsJsonAsync("/api/agents", input, Json)).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await mgr.PostAsJsonAsync("/api/agents", input, Json)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await mgr.PostAsJsonAsync("/api/agents", input, Json)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await mgr.PostAsJsonAsync("/api/agents", input with { Name = "Priya Patel" }, Json)).StatusCode);
    }

    [Fact]
    public async Task Deleting_an_agent_unassigns_its_tasks()
    {
        var app = NewApp();
        await EnableAi(await app.As(Admin));
        var admin = await app.As(Admin);

        var del = await admin.DeleteAsync($"/api/agents/{Scout}");
        Assert.Equal(HttpStatusCode.NoContent, del.StatusCode);
        Assert.Null((await GetTask(admin, 1, 7)).AssigneeId);
        var users = (await admin.GetFromJsonAsync<List<UserDto>>("/api/users", Json))!;
        Assert.DoesNotContain(users, u => u.Id == Scout);
    }

    // ---------- the tool layer is the safety boundary ----------

    private static (DataStore Store, User Agent, AgentConfig Cfg) Setup(int agentId = Scout)
    {
        var s = DataStore.Seeded();
        s.AiEnabled = true;
        return (s, s.Users.First(u => u.Id == agentId), s.Agents.First(a => a.UserId == agentId));
    }

    [Fact]
    public void Tools_only_see_the_project_of_the_run()
    {
        var (s, agent, cfg) = Setup();
        var tools = new ProjectTools(s, agent, cfg, new AgentRun { Id = 1, AgentId = agent.Id, TaskId = 8, ProjectId = 1 });

        // Task 11 belongs to project 2.
        var other = tools.Execute(AgentTools.GetTask, AgentRunContext.Args(("task_id", 11)));
        Assert.True(other.IsError);
        Assert.DoesNotContain("Local data cache", other.Content);

        var comment = tools.Execute(AgentTools.AddComment, AgentRunContext.Args(("task_id", 11), ("body", "hi")));
        Assert.True(comment.IsError);
        Assert.DoesNotContain(s.Comments, c => c.TaskId == 11 && c.Body == "hi");
    }

    [Fact]
    public void Agents_outside_a_project_cannot_use_tools_on_it()
    {
        var (s, agent, cfg) = Setup(); // Scout is not a member of project 3
        var tools = new ProjectTools(s, agent, cfg, new AgentRun { Id = 1, AgentId = agent.Id, TaskId = 20, ProjectId = 3 });
        var result = tools.Execute(AgentTools.GetProjectSummary, AgentRunContext.Args());
        Assert.True(result.IsError);
        Assert.Contains("not a member", result.Content);
    }

    [Fact]
    public void Tools_not_in_the_allowed_list_are_refused()
    {
        var (s, agent, cfg) = Setup(Patch); // Patch may only comment and ask
        var tools = new ProjectTools(s, agent, cfg, new AgentRun { Id = 1, AgentId = agent.Id, TaskId = 17, ProjectId = 2 });
        var result = tools.Execute(AgentTools.CreateTask, AgentRunContext.Args(("title", "Sneaky")));
        Assert.True(result.IsError);
        Assert.DoesNotContain(s.Tasks, t => t.Title == "Sneaky");
    }

    [Fact]
    public void Agents_cannot_delegate_to_other_agents_or_mark_work_done_unless_autonomous()
    {
        var (s, agent, cfg) = Setup();
        cfg.AllowedTools.Add(AgentTools.AssignTask);
        cfg.AllowedTools.Add(AgentTools.CreateTask);
        cfg.Autonomy = Autonomy.Autonomous;
        var run = new AgentRun { Id = 1, AgentId = agent.Id, TaskId = 7, ProjectId = 1 };
        var tools = new ProjectTools(s, agent, cfg, run);

        // Another agent as assignee: refused on assign and on create.
        Assert.True(tools.Execute(AgentTools.AssignTask, AgentRunContext.Args(("task_id", 8), ("assignee_id", Patch))).IsError);
        Assert.True(tools.Execute(AgentTools.CreateTask, AgentRunContext.Args(("title", "Delegated"), ("assignee_id", Patch))).IsError);
        Assert.DoesNotContain(s.Tasks, t => t.Title == "Delegated");

        // Humans are fine.
        Assert.False(tools.Execute(AgentTools.AssignTask, AgentRunContext.Args(("task_id", 8), ("assignee_id", 3))).IsError);
        Assert.Equal(3, s.Tasks.First(t => t.Id == 8).AssigneeId);

        // Done only when Autonomous.
        cfg.Autonomy = Autonomy.AskFirst;
        var held = tools.Execute(AgentTools.UpdateTaskStatus, AgentRunContext.Args(("task_id", 7), ("status", "Done")));
        Assert.True(held.IsError);
        Assert.Equal(WorkStatus.Todo, s.Tasks.First(t => t.Id == 7).Status);
        Assert.DoesNotContain(s.Actions, a => a.TaskId == 7 && a.Summary.Contains("Done"));
    }

    [Fact]
    public void Agents_can_only_change_the_status_of_their_own_tasks()
    {
        var (s, agent, cfg) = Setup();
        cfg.Autonomy = Autonomy.Autonomous;
        var tools = new ProjectTools(s, agent, cfg, new AgentRun { Id = 1, AgentId = agent.Id, TaskId = 7, ProjectId = 1 });

        // Task 8 is assigned to Sam, not Scout.
        var result = tools.Execute(AgentTools.UpdateTaskStatus, AgentRunContext.Args(("task_id", 8), ("status", "Review")));
        Assert.True(result.IsError);
        Assert.Equal(WorkStatus.Todo, s.Tasks.First(t => t.Id == 8).Status);
    }

    [Fact]
    public void Suggest_autonomy_blocks_state_changes_even_when_the_tool_is_allowed()
    {
        var (s, agent, cfg) = Setup();
        cfg.Autonomy = Autonomy.Suggest;
        var tools = new ProjectTools(s, agent, cfg, new AgentRun { Id = 1, AgentId = agent.Id, TaskId = 7, ProjectId = 1 });
        var result = tools.Execute(AgentTools.UpdateTaskStatus, AgentRunContext.Args(("task_id", 7), ("status", "Review")));
        Assert.True(result.IsError);
        Assert.Contains("Suggest", result.Content);
        Assert.Equal(WorkStatus.Todo, s.Tasks.First(t => t.Id == 7).Status);
        // Commenting still works.
        Assert.False(tools.Execute(AgentTools.AddComment, AgentRunContext.Args(("task_id", 7), ("body", "Recommend moving to Review."))).IsError);
    }

    [Fact]
    public void There_is_no_tool_for_deleting_or_changing_membership()
    {
        var names = ToolCatalog.All.Select(t => t.Name).ToArray();
        Assert.DoesNotContain(names, n => n.Contains("delete", StringComparison.OrdinalIgnoreCase) || n.Contains("member", StringComparison.OrdinalIgnoreCase));
        var (s, agent, cfg) = Setup();
        var tools = new ProjectTools(s, agent, cfg, new AgentRun { Id = 1, AgentId = agent.Id, TaskId = 7, ProjectId = 1 });
        Assert.True(tools.Execute("delete_task", AgentRunContext.Args(("task_id", 7))).IsError);
        Assert.Contains(s.Tasks, t => t.Id == 7);
    }
}
