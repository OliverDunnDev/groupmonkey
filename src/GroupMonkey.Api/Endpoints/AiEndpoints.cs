using System.Security.Claims;
using System.Text.RegularExpressions;
using GroupMonkey.Api.Ai;
using GroupMonkey.Api.Data;
using GroupMonkey.Api.Models;
using GroupMonkey.Api.Services;

namespace GroupMonkey.Api.Endpoints;

public static partial class AiEndpoints
{
    private static readonly string[] AgentColors = ["#0A0A0A", "#FFD400", "#FFFFFF", "#E5251B", "#FFB800"];

    private static readonly AgentTemplateDto[] Templates =
    [
        new("researcher", "Researcher", "Digs into questions and writes up findings with sources and open questions.",
            "You research topics for the team. Gather what is known from the project context, structure your findings with clear headings, state assumptions, and list open questions. Keep it practical and concise.",
            Autonomy.AskFirst, [AgentTools.AddComment, AgentTools.UpdateTaskStatus, AgentTools.RequestHumanInput], "#0A0A0A"),
        new("writer", "Writer", "Drafts copy, docs and announcements in the team's voice.",
            "You draft written content: copy, documentation and updates. Match the tone of the project description, keep drafts easy to scan, and offer one alternative headline or opening where it helps.",
            Autonomy.AskFirst, [AgentTools.AddComment, AgentTools.UpdateTaskStatus, AgentTools.RequestHumanInput], "#0A0A0A"),
        new("qa", "QA reviewer", "Reviews work and writes test plans. Comments only; never changes tasks.",
            "You review work for gaps and risks. Produce a short checklist of things to verify, edge cases to test, and anything unclear in the task. You only comment; people decide what to change.",
            Autonomy.Suggest, [AgentTools.AddComment, AgentTools.RequestHumanInput], "#0A0A0A"),
        new("triage", "Triage assistant", "Breaks large tasks into follow-ups and suggests owners. Changes need approval.",
            "You help organise work. Break big tasks into small follow-up tasks with clear titles, suggest sensible owners based on who is on the team, and flag anything blocked or overdue.",
            Autonomy.AskFirst, [AgentTools.AddComment, AgentTools.CreateTask, AgentTools.AssignTask, AgentTools.RequestHumanInput], "#0A0A0A"),
    ];

    public static void MapAi(this WebApplication app)
    {
        var sec = app.MapGroup("/api").RequireAuthorization();

        sec.MapGet("/ai/status", (AiSettingsStore ai) => Results.Ok(new AiStatusDto(ai.Enabled, ai.Mode)));

        // ---- admin settings (key is write-only) ----
        sec.MapGet("/admin/ai", (ClaimsPrincipal p, DataStore s, AiSettingsStore ai) =>
            Admin(p, s) ? Results.Ok(ai.ToDto()) : Results.Forbid());
        sec.MapPut("/admin/ai", (AiSettingsInput input, ClaimsPrincipal p, DataStore s, AiSettingsStore ai) =>
        {
            if (!Admin(p, s)) return Results.Forbid();
            return ai.Update(input) is { } err ? ApiEndpoints.Invalid(err) : Results.Ok(ai.ToDto());
        });
        sec.MapPost("/admin/ai/test", async (ClaimsPrincipal p, DataStore s, AiSettingsStore ai, IConfiguration config, CancellationToken ct) =>
        {
            if (!Admin(p, s)) return Results.Forbid();
            var key = ai.ActiveKey;
            if (key is null) return Results.Ok(new AiTestResult(false, "No API key is set, so agents run in demo mode. Add a key to use real Claude."));
            return Results.Ok(await ClaudeAgentModel.TestAsync(key, ai.Model, config["Anthropic:BaseUrl"], ct));
        });

        // ---- agents ----
        sec.MapGet("/agents/templates", (DataStore s) => s.AiEnabled ? Results.Ok(Templates) : Results.NotFound());
        sec.MapGet("/agents", ListAgents);
        sec.MapPost("/agents", CreateAgent);
        sec.MapPut("/agents/{id:int}", UpdateAgent);
        sec.MapDelete("/agents/{id:int}", DeleteAgent);

        // ---- task activity ----
        sec.MapGet("/tasks/{id:int}/comments", (int id, ClaimsPrincipal p, DataStore s) =>
            !s.AiEnabled ? Results.NotFound() : ApiEndpoints.ForTask(s, p, id, (_, _, t) =>
                Results.Ok(s.Comments.Where(c => c.TaskId == t.Id).OrderBy(c => c.CreatedAt).Select(CommentToDto).ToList())));
        sec.MapPost("/tasks/{id:int}/comments", AddComment);
        sec.MapPost("/tasks/{id:int}/run", RunNow);
        sec.MapGet("/tasks/{id:int}/runs", (int id, ClaimsPrincipal p, DataStore s) =>
            !s.AiEnabled ? Results.NotFound() : ApiEndpoints.ForTask(s, p, id, (_, _, t) =>
                Results.Ok(s.Runs.Where(r => r.TaskId == t.Id).OrderByDescending(r => r.CreatedAt).Take(20).Select(r => RunToDto(s, r)).ToList())));

        // ---- runs ----
        sec.MapGet("/runs/recent", RecentRuns);
        sec.MapGet("/runs/{id:int}", (int id, ClaimsPrincipal p, DataStore s) => WithRun(s, p, id, (_, r) => Results.Ok(RunToDto(s, r))));
        sec.MapPost("/runs/{id:int}/cancel", (int id, ClaimsPrincipal p, DataStore s, AgentRunService runs) =>
            WithRun(s, p, id, (_, r) => runs.Cancel(r.Id) ? Results.Ok(RunToDto(s, r)) : Results.NotFound()));

        // ---- approvals ----
        sec.MapGet("/approvals", ListApprovals);
        sec.MapPost("/approvals/{id:int}/approve", (int id, ClaimsPrincipal p, DataStore s) => Decide(id, p, s, approve: true));
        sec.MapPost("/approvals/{id:int}/reject", (int id, ClaimsPrincipal p, DataStore s) => Decide(id, p, s, approve: false));
    }

    // ---------- helpers ----------

    private static bool Admin(ClaimsPrincipal p, DataStore s)
    {
        lock (s.Sync) return s.Users.Any(u => u.Id == p.UserId() && u.Role == Role.Admin && u.Kind == UserKind.Human);
    }

    private static User? Human(DataStore s, ClaimsPrincipal p) =>
        s.Users.FirstOrDefault(u => u.Id == p.UserId() && u.Kind == UserKind.Human);

    private static CommentDto CommentToDto(TaskComment c) => new(c.Id, c.TaskId, c.AuthorId, c.Body, c.CreatedAt);

    private static ActionDto ActionToDto(DataStore s, ProposedAction a) =>
        new(a.Id, a.RunId, a.AgentId, a.ProjectId, a.TaskId, s.Tasks.FirstOrDefault(t => t.Id == a.TaskId)?.Title ?? "(deleted task)",
            a.Tool, a.Summary, a.State, a.DecidedBy, a.CreatedAt);

    private static RunDto RunToDto(DataStore s, AgentRun r) =>
        new(r.Id, r.AgentId, r.TaskId, r.ProjectId, r.Status, r.CreatedAt, r.StartedAt, r.EndedAt, r.Provider, r.Model,
            r.InputTokens, r.OutputTokens, r.Error, r.TriggeredBy,
            r.Steps.Select(x => new RunStepDto(x.Type, x.Content, x.At)).ToList(),
            r.ActionIds.Select(id => s.Actions.FirstOrDefault(a => a.Id == id)).OfType<ProposedAction>().Select(a => ActionToDto(s, a)).ToList());

    private static IResult WithRun(DataStore s, ClaimsPrincipal p, int id, Func<User, AgentRun, IResult> act)
    {
        if (!s.AiEnabled) return Results.NotFound();
        lock (s.Sync)
        {
            var r = s.Runs.FirstOrDefault(x => x.Id == id);
            return r is null ? Results.NotFound() : ApiEndpoints.InProject(s, p, r.ProjectId, ApiEndpoints.Level.View, (me, _) => act(me, r));
        }
    }

    private static AgentDto AgentToDto(DataStore s, AgentConfig c, User viewer)
    {
        var user = s.Users.First(u => u.Id == c.UserId);
        var today = DateTime.UtcNow.Date;
        var runs = s.Runs.Where(r => r.AgentId == c.UserId).ToList();
        var last = runs.OrderByDescending(r => r.CreatedAt).FirstOrDefault();
        var projects = s.Projects.Where(pr => pr.MemberIds.Contains(c.UserId) && Access.CanView(viewer, pr)).Select(pr => pr.Id).ToList();
        return new AgentDto(c.UserId, user.Name, user.Color, c.Description, c.Instructions, c.Model, c.Autonomy, [.. c.AllowedTools],
            c.Enabled, c.DailyRunLimit, projects, runs.Count(r => r.CreatedAt >= today), last?.Status, last?.CreatedAt,
            runs.Count(r => r.Status is RunStatus.Queued or RunStatus.Running), CanEditAgent(viewer, c));
    }

    [GeneratedRegex("[^a-z0-9]+")]
    private static partial Regex NonSlug();

    // ---------- agents ----------

    /// <summary>Validates the editable agent fields. Returns an error message or null.</summary>
    private static string? ValidateAgent(DataStore s, AgentInput i, int? selfId)
    {
        var name = i.Name?.Trim() ?? "";
        if (name.Length is < 2 or > 40) return "Give the agent a name of 2 to 40 characters.";
        if (s.Users.Any(u => u.Id != selfId && string.Equals(u.Name, name, StringComparison.OrdinalIgnoreCase))) return "Someone on the team already has that name.";
        if ((i.Description?.Length ?? 0) > 400) return "Description is too long (400 characters max).";
        if ((i.Instructions?.Length ?? 0) > 6000) return "Instructions are too long (6000 characters max).";
        if (i.Model is { Length: > 0 } m && !AiSettingsStore.Models.Contains(m)) return "Unknown model.";
        if (i.AllowedTools is { } tools && tools.Any(t => !AgentTools.Optional.Contains(t))) return "Unknown tool in the allowed list.";
        if (i.DailyRunLimit is < 1 or > 200) return "Daily run limit must be between 1 and 200.";
        if (i.Color is { } c && !AgentColors.Contains(c, StringComparer.OrdinalIgnoreCase)) return "Unknown colour.";
        return null;
    }

    private static void SyncProjects(DataStore s, User me, int agentId, List<int> wanted)
    {
        foreach (var pr in s.Projects.Where(pr => Access.CanManage(me, pr)).ToList())
        {
            var isMember = pr.MemberIds.Contains(agentId);
            if (wanted.Contains(pr.Id) && !isMember) pr.MemberIds.Add(agentId);
            else if (!wanted.Contains(pr.Id) && isMember) RemoveFromProject(s, pr, agentId);
        }
    }

    private static void RemoveFromProject(DataStore s, Project pr, int agentId)
    {
        pr.MemberIds.Remove(agentId);
        foreach (var g in s.Groups.Where(g => g.ProjectId == pr.Id)) g.MemberIds.Remove(agentId);
        foreach (var t in s.Tasks.Where(t => t.ProjectId == pr.Id && t.AssigneeId == agentId)) t.AssigneeId = null;
    }

    private static IResult ListAgents(ClaimsPrincipal p, DataStore s)
    {
        if (!s.AiEnabled) return Results.NotFound();
        lock (s.Sync)
        {
            var me = Human(s, p);
            if (me is null) return Results.Unauthorized();
            var list = s.Agents
                .Where(c => me.Role == Role.Admin || s.Projects.Any(pr => pr.MemberIds.Contains(c.UserId) && Access.CanView(me, pr)) || c.CreatedBy == me.Id)
                .Select(c => AgentToDto(s, c, me)).ToList();
            return Results.Ok(list);
        }
    }

    private static IResult CreateAgent(AgentInput input, ClaimsPrincipal p, DataStore s)
    {
        if (!s.AiEnabled) return Results.NotFound();
        lock (s.Sync)
        {
            var me = Human(s, p);
            if (me is null) return Results.Unauthorized();
            if (me.Role == Role.Member) return Results.Forbid();
            if (ValidateAgent(s, input, null) is { } err) return ApiEndpoints.Invalid(err);

            var wanted = input.ProjectIds ?? [];
            foreach (var pid in wanted)
            {
                var pr = s.Projects.FirstOrDefault(x => x.Id == pid);
                if (pr is null || !Access.CanManage(me, pr)) return ApiEndpoints.Invalid("You can only add agents to projects you manage.");
            }

            var name = input.Name.Trim();
            var slug = NonSlug().Replace(name.ToLowerInvariant(), "-").Trim('-');
            var user = new User
            {
                Id = s.Users.Max(u => u.Id) + 1, Kind = UserKind.Agent, Name = name, Role = Role.Member, Password = "",
                Email = $"{(slug.Length == 0 ? "agent" : slug)}@agents.groupmonkey.local", Color = input.Color ?? AgentColors[0],
            };
            s.Users.Add(user);
            var cfg = new AgentConfig
            {
                UserId = user.Id, Description = input.Description?.Trim() ?? "", Instructions = input.Instructions?.Trim() ?? "",
                Model = string.IsNullOrEmpty(input.Model) ? null : input.Model, Autonomy = input.Autonomy ?? Autonomy.AskFirst,
                AllowedTools = input.AllowedTools is { } t ? [.. t.Distinct()] : [.. AgentTools.Optional],
                Enabled = input.Enabled ?? true, DailyRunLimit = input.DailyRunLimit ?? 20, CreatedBy = me.Id,
            };
            s.Agents.Add(cfg);
            SyncProjects(s, me, user.Id, wanted);
            return Results.Created($"/api/agents/{user.Id}", AgentToDto(s, cfg, me));
        }
    }

    private static bool CanEditAgent(User me, AgentConfig cfg) => me.Role == Role.Admin || (me.Role == Role.Manager && cfg.CreatedBy == me.Id);

    private static IResult UpdateAgent(int id, AgentInput input, ClaimsPrincipal p, DataStore s)
    {
        if (!s.AiEnabled) return Results.NotFound();
        lock (s.Sync)
        {
            var me = Human(s, p);
            if (me is null) return Results.Unauthorized();
            var cfg = s.Agents.FirstOrDefault(a => a.UserId == id);
            var user = s.Users.FirstOrDefault(u => u.Id == id && u.Kind == UserKind.Agent);
            if (cfg is null || user is null) return Results.NotFound();
            if (!CanEditAgent(me, cfg)) return Results.Forbid();
            if (ValidateAgent(s, input, id) is { } err) return ApiEndpoints.Invalid(err);

            user.Name = input.Name.Trim();
            user.Color = input.Color ?? user.Color;
            cfg.Description = input.Description?.Trim() ?? cfg.Description;
            cfg.Instructions = input.Instructions?.Trim() ?? cfg.Instructions;
            cfg.Model = input.Model is null ? cfg.Model : string.IsNullOrEmpty(input.Model) ? null : input.Model;
            cfg.Autonomy = input.Autonomy ?? cfg.Autonomy;
            if (input.AllowedTools is { } t) cfg.AllowedTools = [.. t.Distinct()];
            cfg.Enabled = input.Enabled ?? cfg.Enabled;
            cfg.DailyRunLimit = input.DailyRunLimit ?? cfg.DailyRunLimit;
            if (input.ProjectIds is { } wanted) SyncProjects(s, me, id, wanted);
            return Results.Ok(AgentToDto(s, cfg, me));
        }
    }

    private static IResult DeleteAgent(int id, ClaimsPrincipal p, DataStore s)
    {
        if (!s.AiEnabled) return Results.NotFound();
        lock (s.Sync)
        {
            var me = Human(s, p);
            if (me is null) return Results.Unauthorized();
            var cfg = s.Agents.FirstOrDefault(a => a.UserId == id);
            if (cfg is null) return Results.NotFound();
            if (!CanEditAgent(me, cfg)) return Results.Forbid();

            foreach (var pr in s.Projects.Where(pr => pr.MemberIds.Contains(id)).ToList()) RemoveFromProject(s, pr, id);
            s.Actions.RemoveAll(a => a.AgentId == id);
            s.Runs.RemoveAll(r => r.AgentId == id);
            s.Agents.Remove(cfg);
            s.Users.RemoveAll(u => u.Id == id);
            return Results.NoContent();
        }
    }

    // ---------- comments and runs ----------

    private static IResult AddComment(int id, CommentInput input, ClaimsPrincipal p, DataStore s, AgentRunService runs)
    {
        if (!s.AiEnabled) return Results.NotFound();
        return ApiEndpoints.ForTask(s, p, id, (me, _, t) =>
        {
            var body = input.Body?.Trim();
            if (string.IsNullOrEmpty(body)) return ApiEndpoints.Invalid("Write something first.");
            if (body.Length > 8000) return ApiEndpoints.Invalid("That comment is too long.");
            var c = new TaskComment { Id = s.NextCommentId(), TaskId = t.Id, AuthorId = me.Id, Body = body, CreatedAt = DateTime.UtcNow };
            s.Comments.Add(c);

            // A reply to an agent that asked for input picks the work back up.
            if (t.AssigneeId is { } a && s.IsAgent(a))
            {
                var last = s.Runs.Where(r => r.TaskId == t.Id && r.AgentId == a).OrderByDescending(r => r.CreatedAt).FirstOrDefault();
                if (last?.Status == RunStatus.NeedsInput) runs.TryStart(t.Id, a, $"Reply from {me.Name}");
            }
            return Results.Created($"/api/tasks/{t.Id}/comments", CommentToDto(c));
        });
    }

    private static IResult RunNow(int id, ClaimsPrincipal p, DataStore s, AgentRunService runs)
    {
        if (!s.AiEnabled) return Results.NotFound();
        return ApiEndpoints.ForTask(s, p, id, (me, _, t) =>
        {
            if (t.AssigneeId is not { } a || !s.IsAgent(a)) return ApiEndpoints.Invalid("Assign this task to an agent first.");
            var (run, error) = runs.TryStart(t.Id, a, $"Run now by {me.Name}");
            return run is null ? ApiEndpoints.Invalid(error ?? "Could not start the run.") : Results.Accepted($"/api/runs/{run.Id}", RunToDto(s, run));
        });
    }

    private static IResult RecentRuns(ClaimsPrincipal p, DataStore s)
    {
        if (!s.AiEnabled) return Results.NotFound();
        lock (s.Sync)
        {
            var me = Human(s, p);
            if (me is null) return Results.Unauthorized();
            var viewable = s.Projects.Where(pr => Access.CanView(me, pr)).Select(pr => pr.Id).ToHashSet();
            var list = s.Runs.Where(r => viewable.Contains(r.ProjectId)).OrderByDescending(r => r.CreatedAt).Take(12)
                .Select(r => new RunSummaryDto(r.Id, r.AgentId, r.TaskId, r.ProjectId,
                    s.Tasks.FirstOrDefault(t => t.Id == r.TaskId)?.Title ?? "(deleted task)", r.Status, r.CreatedAt, r.EndedAt, r.Provider))
                .ToList();
            return Results.Ok(list);
        }
    }

    // ---------- approvals ----------

    private static IResult ListApprovals(ClaimsPrincipal p, DataStore s)
    {
        if (!s.AiEnabled) return Results.NotFound();
        lock (s.Sync)
        {
            var me = Human(s, p);
            if (me is null) return Results.Unauthorized();
            var list = s.Actions
                .Where(a => a.State == ActionState.Pending && s.Projects.Any(pr => pr.Id == a.ProjectId && Access.CanManage(me, pr)))
                .OrderBy(a => a.CreatedAt).Select(a => ActionToDto(s, a)).ToList();
            return Results.Ok(list);
        }
    }

    private static IResult Decide(int id, ClaimsPrincipal p, DataStore s, bool approve)
    {
        if (!s.AiEnabled) return Results.NotFound();
        lock (s.Sync)
        {
            var me = Human(s, p);
            if (me is null) return Results.Unauthorized();
            var action = s.Actions.FirstOrDefault(a => a.Id == id);
            var project = action is null ? null : s.Projects.FirstOrDefault(pr => pr.Id == action.ProjectId);
            if (action is null || project is null || !Access.CanView(me, project)) return Results.NotFound();
            if (!Access.CanManage(me, project)) return Results.Forbid();
            if (action.State != ActionState.Pending) return ApiEndpoints.Invalid("That proposal has already been decided.");

            var run = s.Runs.FirstOrDefault(r => r.Id == action.RunId);
            if (approve)
            {
                var agent = s.Users.FirstOrDefault(u => u.Id == action.AgentId);
                var cfg = s.Agents.FirstOrDefault(a => a.UserId == action.AgentId);
                if (agent is null || cfg is null || run is null) return ApiEndpoints.Invalid("The agent that proposed this no longer exists.");
                var result = new ProjectTools(s, agent, cfg, run).Execute(action.Tool, action.Args, approved: true);
                if (result.IsError) return ApiEndpoints.Invalid(result.Content);
                action.State = ActionState.Approved;
            }
            else
            {
                action.State = ActionState.Rejected;
            }

            action.DecidedBy = me.Id;
            run?.Steps.Add(new RunStep { Type = StepType.Message, At = DateTime.UtcNow, Content = $"{(approve ? "Approved" : "Rejected")} by {me.Name}: {action.Summary}" });
            if (run is not null) AgentRunService.Settle(s, run);
            return Results.Ok(ActionToDto(s, action));
        }
    }
}
