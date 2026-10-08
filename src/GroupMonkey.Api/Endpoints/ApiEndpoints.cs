using System.Security.Claims;
using GroupMonkey.Api.Ai;
using GroupMonkey.Api.Data;
using GroupMonkey.Api.Models;
using GroupMonkey.Api.Services;

namespace GroupMonkey.Api.Endpoints;

public static class ApiEndpoints
{
    internal enum Level { View, Manage, Edit }

    public static void MapApi(this WebApplication app)
    {
        var api = app.MapGroup("/api");
        api.MapPost("/auth/login", Login).AllowAnonymous();

        var sec = api.MapGroup("").RequireAuthorization();
        sec.MapGet("/auth/me", Me);
        sec.MapGet("/users", (DataStore s) =>
        {
            // Agents only exist for clients while the AI feature is switched on.
            lock (s.Sync) return Results.Ok(s.Users.Where(u => s.AiEnabled || u.Kind == UserKind.Human).Select(u => u.ToDto()).ToList());
        });

        sec.MapGet("/projects", ListProjects);
        sec.MapPost("/projects", CreateProject);
        sec.MapGet("/projects/{id:int}", (int id, ClaimsPrincipal p, DataStore s) =>
            InProject(s, p, id, Level.View, (me, pr) => Results.Ok(Progress.ToDto(s, pr, me))));
        sec.MapPut("/projects/{id:int}", UpdateProject);
        sec.MapDelete("/projects/{id:int}", DeleteProject);
        sec.MapGet("/projects/{id:int}/summary", (int id, ClaimsPrincipal p, DataStore s) =>
            InProject(s, p, id, Level.View, (_, pr) => Results.Ok(Progress.Summarise(s, pr))));

        // Groups
        sec.MapGet("/projects/{id:int}/groups", (int id, ClaimsPrincipal p, DataStore s) =>
            InProject(s, p, id, Level.View, (_, pr) =>
                Results.Ok(s.Groups.Where(g => g.ProjectId == pr.Id).Select(g => Progress.ToDto(s, g)).ToList())));
        sec.MapPost("/projects/{id:int}/groups", CreateGroup);
        sec.MapPut("/groups/{id:int}", UpdateGroup);
        sec.MapDelete("/groups/{id:int}", DeleteGroup);
        sec.MapPost("/groups/{id:int}/members/{userId:int}", AddGroupMember);
        sec.MapDelete("/groups/{id:int}/members/{userId:int}", RemoveGroupMember);

        // Tasks
        sec.MapGet("/projects/{id:int}/tasks", (int id, ClaimsPrincipal p, DataStore s) =>
            InProject(s, p, id, Level.View, (_, pr) => Results.Ok(s.Tasks.Where(t => t.ProjectId == pr.Id).ToList())));
        sec.MapPost("/projects/{id:int}/tasks", CreateTask);
        sec.MapPut("/tasks/{id:int}", UpdateTask);
        sec.MapDelete("/tasks/{id:int}", DeleteTask);
        sec.MapPatch("/tasks/{id:int}/status", (int id, StatusInput input, ClaimsPrincipal p, DataStore s) =>
            ForTask(s, p, id, (_, _, t) => { t.Status = input.Status; return Results.Ok(t); }));
        sec.MapPatch("/tasks/{id:int}/assignee", PatchAssignee);

        // Goals
        sec.MapGet("/projects/{id:int}/goals", (int id, ClaimsPrincipal p, DataStore s) =>
            InProject(s, p, id, Level.View, (_, pr) =>
                Results.Ok(s.Goals.Where(g => g.ProjectId == pr.Id).Select(g => Progress.ToDto(s, g)).ToList())));
        sec.MapPost("/projects/{id:int}/goals", CreateGoal);
        sec.MapPut("/goals/{id:int}", UpdateGoal);
        sec.MapDelete("/goals/{id:int}", DeleteGoal);
    }

    // ---------- helpers ----------

    internal static IResult Invalid(string message) => Results.BadRequest(new { error = message });

    internal static IResult InProject(DataStore s, ClaimsPrincipal p, int projectId, Level level, Func<User, Project, IResult> act)
    {
        lock (s.Sync)
        {
            var me = s.Users.FirstOrDefault(u => u.Id == p.UserId());
            if (me is null) return Results.Unauthorized();
            var proj = s.Projects.FirstOrDefault(x => x.Id == projectId);
            if (proj is null || !Access.CanView(me, proj)) return Results.NotFound();
            if (level == Level.Manage && !Access.CanManage(me, proj)) return Results.Forbid();
            if (level == Level.Edit && !Access.CanEdit(me, proj)) return Results.Forbid();
            return act(me, proj);
        }
    }

    internal static IResult ForTask(DataStore s, ClaimsPrincipal p, int id, Func<User, Project, TaskItem, IResult> act)
    {
        lock (s.Sync)
        {
            var t = s.Tasks.FirstOrDefault(x => x.Id == id);
            return t is null ? Results.NotFound() : InProject(s, p, t.ProjectId, Level.View, (me, pr) => act(me, pr, t));
        }
    }

    private static IResult ForGroup(DataStore s, ClaimsPrincipal p, int id, Func<User, Project, Group, IResult> act)
    {
        lock (s.Sync)
        {
            var g = s.Groups.FirstOrDefault(x => x.Id == id);
            return g is null ? Results.NotFound() : InProject(s, p, g.ProjectId, Level.Manage, (me, pr) => act(me, pr, g));
        }
    }

    private static IResult ForGoal(DataStore s, ClaimsPrincipal p, int id, Func<User, Project, Goal, IResult> act)
    {
        lock (s.Sync)
        {
            var g = s.Goals.FirstOrDefault(x => x.Id == id);
            return g is null ? Results.NotFound() : InProject(s, p, g.ProjectId, Level.Manage, (me, pr) => act(me, pr, g));
        }
    }

    // Returns an error message if the task's references do not belong to the project.
    private static string? ValidateTaskRefs(DataStore s, Project pr, int? assigneeId, int? groupId, int? goalId)
    {
        if (assigneeId is { } a && !pr.MemberIds.Contains(a)) return "Assignee must be a project member.";
        if (assigneeId is { } ag && !s.AiEnabled && s.IsAgent(ag)) return "AI agents are not enabled.";
        if (groupId is { } g && !s.Groups.Any(x => x.Id == g && x.ProjectId == pr.Id)) return "Group not found in this project.";
        if (goalId is { } go && !s.Goals.Any(x => x.Id == go && x.ProjectId == pr.Id)) return "Goal not found in this project.";
        return null;
    }

    // ---------- auth ----------

    private static IResult Login(LoginRequest req, DataStore s, TokenService tokens)
    {
        lock (s.Sync)
        {
            var u = s.Users.FirstOrDefault(x => string.Equals(x.Email, req.Email?.Trim(), StringComparison.OrdinalIgnoreCase));
            if (u is null || u.Kind != UserKind.Human || u.Password != req.Password) return Results.Json(new { error = "Invalid email or password." }, statusCode: 401);
            return Results.Ok(new LoginResponse(tokens.Create(u), u.ToDto()));
        }
    }

    private static IResult Me(ClaimsPrincipal p, DataStore s)
    {
        lock (s.Sync)
        {
            var u = s.Users.FirstOrDefault(x => x.Id == p.UserId());
            return u is null ? Results.Unauthorized() : Results.Ok(u.ToDto());
        }
    }

    // ---------- projects ----------

    private static IResult ListProjects(ClaimsPrincipal p, DataStore s)
    {
        lock (s.Sync)
        {
            var me = s.Users.FirstOrDefault(u => u.Id == p.UserId());
            if (me is null) return Results.Unauthorized();
            return Results.Ok(s.Projects.Where(pr => Access.CanView(me, pr)).Select(pr => Progress.ToDto(s, pr, me)).ToList());
        }
    }

    private static IResult CreateProject(ProjectInput input, ClaimsPrincipal p, DataStore s)
    {
        lock (s.Sync)
        {
            var me = s.Users.FirstOrDefault(u => u.Id == p.UserId());
            if (me is null) return Results.Unauthorized();
            if (me.Role == Role.Member) return Results.Forbid();
            if (string.IsNullOrWhiteSpace(input.Name)) return Invalid("Name is required.");

            var today = DateOnly.FromDateTime(DateTime.Today);
            var members = (input.MemberIds ?? []).Where(id => s.Users.Any(u => u.Id == id)).Append(me.Id).Distinct().ToList();
            var pr = new Project
            {
                Id = s.NextProjectId(), Name = input.Name.Trim(), Description = input.Description ?? "",
                Status = input.Status ?? ProjectStatus.Planning, StartDate = input.StartDate ?? today,
                DueDate = input.DueDate ?? today.AddDays(30), OwnerId = me.Id, MemberIds = members,
            };
            s.Projects.Add(pr);
            return Results.Created($"/api/projects/{pr.Id}", Progress.ToDto(s, pr, me));
        }
    }

    private static IResult UpdateProject(int id, ProjectInput input, ClaimsPrincipal p, DataStore s) =>
        InProject(s, p, id, Level.Edit, (me, pr) =>
        {
            if (string.IsNullOrWhiteSpace(input.Name)) return Invalid("Name is required.");
            pr.Name = input.Name.Trim();
            pr.Description = input.Description ?? pr.Description;
            pr.Status = input.Status ?? pr.Status;
            pr.StartDate = input.StartDate ?? pr.StartDate;
            pr.DueDate = input.DueDate ?? pr.DueDate;
            if (input.MemberIds is { } ids)
            {
                var members = ids.Where(u => s.Users.Any(x => x.Id == u)).Append(pr.OwnerId).Distinct().ToList();
                // While AI is off, clients never see agents, so don't let an edit silently drop them.
                if (!s.AiEnabled) members.AddRange(pr.MemberIds.Where(m => s.IsAgent(m) && !members.Contains(m)));
                pr.MemberIds = members;
                // Drop removed members from groups and unassign their tasks.
                foreach (var g in s.Groups.Where(g => g.ProjectId == pr.Id)) g.MemberIds.RemoveAll(m => !members.Contains(m));
                foreach (var t in s.Tasks.Where(t => t.ProjectId == pr.Id && t.AssigneeId is { } a && !members.Contains(a))) t.AssigneeId = null;
            }
            return Results.Ok(Progress.ToDto(s, pr, me));
        });

    private static IResult DeleteProject(int id, ClaimsPrincipal p, DataStore s) =>
        InProject(s, p, id, Level.Edit, (_, pr) =>
        {
            s.Groups.RemoveAll(g => g.ProjectId == pr.Id);
            s.Tasks.RemoveAll(t => t.ProjectId == pr.Id);
            s.Goals.RemoveAll(g => g.ProjectId == pr.Id);
            s.Projects.Remove(pr);
            return Results.NoContent();
        });

    // ---------- groups ----------

    private static IResult CreateGroup(int id, GroupInput input, ClaimsPrincipal p, DataStore s) =>
        InProject(s, p, id, Level.Manage, (_, pr) =>
        {
            if (string.IsNullOrWhiteSpace(input.Name)) return Invalid("Name is required.");
            var g = new Group { Id = s.NextGroupId(), ProjectId = pr.Id, Name = input.Name.Trim(), Color = input.Color ?? "#FFD400" };
            s.Groups.Add(g);
            return Results.Created($"/api/groups/{g.Id}", Progress.ToDto(s, g));
        });

    private static IResult UpdateGroup(int id, GroupInput input, ClaimsPrincipal p, DataStore s) =>
        ForGroup(s, p, id, (_, _, g) =>
        {
            if (string.IsNullOrWhiteSpace(input.Name)) return Invalid("Name is required.");
            g.Name = input.Name.Trim();
            g.Color = input.Color ?? g.Color;
            return Results.Ok(Progress.ToDto(s, g));
        });

    private static IResult DeleteGroup(int id, ClaimsPrincipal p, DataStore s) =>
        ForGroup(s, p, id, (_, _, g) =>
        {
            foreach (var t in s.Tasks.Where(t => t.GroupId == g.Id)) t.GroupId = null;
            s.Groups.Remove(g);
            return Results.NoContent();
        });

    private static IResult AddGroupMember(int id, int userId, ClaimsPrincipal p, DataStore s) =>
        ForGroup(s, p, id, (_, pr, g) =>
        {
            if (!s.Users.Any(u => u.Id == userId)) return Results.NotFound();
            if (!pr.MemberIds.Contains(userId)) pr.MemberIds.Add(userId);
            if (!g.MemberIds.Contains(userId)) g.MemberIds.Add(userId);
            return Results.Ok(Progress.ToDto(s, g));
        });

    private static IResult RemoveGroupMember(int id, int userId, ClaimsPrincipal p, DataStore s) =>
        ForGroup(s, p, id, (_, _, g) =>
        {
            g.MemberIds.Remove(userId);
            return Results.Ok(Progress.ToDto(s, g));
        });

    // ---------- tasks ----------

    // Assigning a task to an agent is what puts the agent to work.
    private static void KickAgent(DataStore s, AgentRunService runs, TaskItem t, int? previousAssignee, User by)
    {
        if (t.AssigneeId is { } a && a != previousAssignee && s.IsAgent(a)) runs.TryStart(t.Id, a, $"Assigned by {by.Name}");
    }

    private static IResult CreateTask(int id, TaskInput input, ClaimsPrincipal p, DataStore s, AgentRunService runs) =>
        InProject(s, p, id, Level.View, (me, pr) =>
        {
            if (string.IsNullOrWhiteSpace(input.Title)) return Invalid("Title is required.");
            if (ValidateTaskRefs(s, pr, input.AssigneeId, input.GroupId, input.GoalId) is { } err) return Invalid(err);
            var t = new TaskItem
            {
                Id = s.NextTaskId(), ProjectId = pr.Id, Title = input.Title.Trim(), Description = input.Description ?? "",
                Status = input.Status ?? WorkStatus.Todo, Priority = input.Priority ?? Priority.Medium,
                AssigneeId = input.AssigneeId, GroupId = input.GroupId, GoalId = input.GoalId, DueDate = input.DueDate,
            };
            s.Tasks.Add(t);
            KickAgent(s, runs, t, null, me);
            return Results.Created($"/api/tasks/{t.Id}", t);
        });

    private static IResult UpdateTask(int id, TaskInput input, ClaimsPrincipal p, DataStore s, AgentRunService runs) =>
        ForTask(s, p, id, (me, pr, t) =>
        {
            if (string.IsNullOrWhiteSpace(input.Title)) return Invalid("Title is required.");
            if (ValidateTaskRefs(s, pr, input.AssigneeId, input.GroupId, input.GoalId) is { } err) return Invalid(err);
            var previous = t.AssigneeId;
            t.Title = input.Title.Trim();
            t.Description = input.Description ?? "";
            t.Status = input.Status ?? t.Status;
            t.Priority = input.Priority ?? t.Priority;
            t.AssigneeId = input.AssigneeId;
            t.GroupId = input.GroupId;
            t.GoalId = input.GoalId;
            t.DueDate = input.DueDate;
            KickAgent(s, runs, t, previous, me);
            return Results.Ok(t);
        });

    private static IResult DeleteTask(int id, ClaimsPrincipal p, DataStore s) =>
        ForTask(s, p, id, (_, _, t) => { s.Tasks.Remove(t); return Results.NoContent(); });

    private static IResult PatchAssignee(int id, AssigneeInput input, ClaimsPrincipal p, DataStore s, AgentRunService runs) =>
        ForTask(s, p, id, (me, pr, t) =>
        {
            if (ValidateTaskRefs(s, pr, input.AssigneeId, null, null) is { } err) return Invalid(err);
            var previous = t.AssigneeId;
            t.AssigneeId = input.AssigneeId;
            KickAgent(s, runs, t, previous, me);
            return Results.Ok(t);
        });

    // ---------- goals ----------

    private static IResult CreateGoal(int id, GoalInput input, ClaimsPrincipal p, DataStore s) =>
        InProject(s, p, id, Level.Manage, (_, pr) =>
        {
            if (string.IsNullOrWhiteSpace(input.Title)) return Invalid("Title is required.");
            var g = new Goal { Id = s.NextGoalId(), ProjectId = pr.Id, Title = input.Title.Trim(), Description = input.Description ?? "", TargetDate = input.TargetDate };
            s.Goals.Add(g);
            return Results.Created($"/api/goals/{g.Id}", Progress.ToDto(s, g));
        });

    private static IResult UpdateGoal(int id, GoalInput input, ClaimsPrincipal p, DataStore s) =>
        ForGoal(s, p, id, (_, _, g) =>
        {
            if (string.IsNullOrWhiteSpace(input.Title)) return Invalid("Title is required.");
            g.Title = input.Title.Trim();
            g.Description = input.Description ?? "";
            g.TargetDate = input.TargetDate;
            return Results.Ok(Progress.ToDto(s, g));
        });

    private static IResult DeleteGoal(int id, ClaimsPrincipal p, DataStore s) =>
        ForGoal(s, p, id, (_, _, g) =>
        {
            foreach (var t in s.Tasks.Where(t => t.GoalId == g.Id)) t.GoalId = null;
            s.Goals.Remove(g);
            return Results.NoContent();
        });
}
