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

        // Groups: the top level. A group is a team; its projects and tasks belong to its members.
        sec.MapGet("/groups", ListGroups);
        sec.MapPost("/groups", CreateGroup);
        sec.MapGet("/groups/{id:int}", (int id, ClaimsPrincipal p, DataStore s) =>
            InGroup(s, p, id, Level.View, (me, g) => Results.Ok(Progress.ToDto(s, g, me))));
        sec.MapPut("/groups/{id:int}", UpdateGroup);
        sec.MapDelete("/groups/{id:int}", DeleteGroup);
        sec.MapPost("/groups/{id:int}/members/{userId:int}", AddGroupMember);
        sec.MapDelete("/groups/{id:int}/members/{userId:int}", RemoveGroupMember);

        // Projects live inside a group (ProjectInput.GroupId on create).
        sec.MapGet("/projects", ListProjects);
        sec.MapPost("/projects", CreateProject);
        sec.MapGet("/projects/{id:int}", (int id, ClaimsPrincipal p, DataStore s) =>
            InProject(s, p, id, Level.View, (me, pr) => Results.Ok(Progress.ToDto(s, pr, me))));
        sec.MapPut("/projects/{id:int}", UpdateProject);
        sec.MapDelete("/projects/{id:int}", DeleteProject);
        sec.MapGet("/projects/{id:int}/summary", (int id, ClaimsPrincipal p, DataStore s) =>
            InProject(s, p, id, Level.View, (_, pr) => Results.Ok(Progress.Summarise(s, pr))));

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

    /// <summary>Runs <paramref name="act"/> inside the lock for a group the caller may see (404 otherwise) at the given level (403 otherwise).</summary>
    internal static IResult InGroup(DataStore s, ClaimsPrincipal p, int groupId, Level level, Func<User, Group, IResult> act)
    {
        lock (s.Sync)
        {
            var me = s.Users.FirstOrDefault(u => u.Id == p.UserId() && u.Kind == UserKind.Human);
            if (me is null) return Results.Unauthorized();
            var g = s.Groups.FirstOrDefault(x => x.Id == groupId);
            if (g is null || !Access.CanViewGroup(me, g)) return Results.NotFound();
            if (level == Level.Manage && !Access.CanManageGroup(me, g)) return Results.Forbid();
            if (level == Level.Edit && !Access.CanEditGroup(me, g)) return Results.Forbid();
            return act(me, g);
        }
    }

    /// <summary>Access to a project is access to its group. Manage and Edit both mean "can manage the group".</summary>
    internal static IResult InProject(DataStore s, ClaimsPrincipal p, int projectId, Level level, Func<User, Project, IResult> act)
    {
        lock (s.Sync)
        {
            var me = s.Users.FirstOrDefault(u => u.Id == p.UserId());
            if (me is null) return Results.Unauthorized();
            var proj = s.Projects.FirstOrDefault(x => x.Id == projectId);
            if (proj is null || !Access.CanView(s, me, proj)) return Results.NotFound();
            if (level != Level.View && !Access.CanManage(s, me, proj)) return Results.Forbid();
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

    private static IResult ForGoal(DataStore s, ClaimsPrincipal p, int id, Func<User, Project, Goal, IResult> act)
    {
        lock (s.Sync)
        {
            var g = s.Goals.FirstOrDefault(x => x.Id == id);
            return g is null ? Results.NotFound() : InProject(s, p, g.ProjectId, Level.Manage, (me, pr) => act(me, pr, g));
        }
    }

    // Returns an error message if the task's references do not belong to the project (or its group).
    private static string? ValidateTaskRefs(DataStore s, Project pr, int? assigneeId, int? goalId)
    {
        if (assigneeId is { } a && !s.IsMember(pr, a)) return "Tasks can only be assigned to members of this project's group.";
        if (assigneeId is { } ag && !s.AiEnabled && s.IsAgent(ag)) return "AI agents are not enabled.";
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

    // ---------- groups ----------

    private static IResult ListGroups(ClaimsPrincipal p, DataStore s)
    {
        lock (s.Sync)
        {
            var me = s.Users.FirstOrDefault(u => u.Id == p.UserId());
            if (me is null) return Results.Unauthorized();
            return Results.Ok(s.Groups.Where(g => Access.CanViewGroup(me, g)).Select(g => Progress.ToDto(s, g, me)).ToList());
        }
    }

    /// <summary>Keeps only real users (and agents only while AI is on), always including the owner.</summary>
    private static List<int> CleanMembers(DataStore s, IEnumerable<int> ids, int ownerId) =>
        ids.Where(id => s.Users.Any(u => u.Id == id && (u.Kind == UserKind.Human || s.AiEnabled))).Append(ownerId).Distinct().ToList();

    /// <summary>Takes someone out of a group: their tasks in the group's projects become unassigned.</summary>
    internal static void RemoveFromGroup(DataStore s, Group g, int userId)
    {
        g.MemberIds.Remove(userId);
        var projectIds = s.Projects.Where(p => p.GroupId == g.Id).Select(p => p.Id).ToHashSet();
        foreach (var t in s.Tasks.Where(t => projectIds.Contains(t.ProjectId) && t.AssigneeId == userId)) t.AssigneeId = null;
    }

    private static IResult CreateGroup(GroupInput input, ClaimsPrincipal p, DataStore s)
    {
        lock (s.Sync)
        {
            var me = s.Users.FirstOrDefault(u => u.Id == p.UserId() && u.Kind == UserKind.Human);
            if (me is null) return Results.Unauthorized();
            if (me.Role == Role.Member) return Results.Forbid();
            var name = input.Name?.Trim() ?? "";
            if (name.Length is < 2 or > 60) return Invalid("Give the group a name of 2 to 60 characters.");
            if (s.Groups.Any(g => string.Equals(g.Name, name, StringComparison.OrdinalIgnoreCase))) return Invalid("A group with that name already exists.");

            var g = new Group
            {
                Id = s.NextGroupId(), Name = name, Description = input.Description?.Trim() ?? "", Color = input.Color ?? "#FFD400",
                OwnerId = me.Id,
            };
            g.MemberIds = CleanMembers(s, input.MemberIds ?? [], me.Id);
            s.Groups.Add(g);
            return Results.Created($"/api/groups/{g.Id}", Progress.ToDto(s, g, me));
        }
    }

    private static IResult UpdateGroup(int id, GroupInput input, ClaimsPrincipal p, DataStore s) =>
        InGroup(s, p, id, Level.Manage, (me, g) =>
        {
            var name = input.Name?.Trim() ?? "";
            if (name.Length is < 2 or > 60) return Invalid("Give the group a name of 2 to 60 characters.");
            if (s.Groups.Any(x => x.Id != g.Id && string.Equals(x.Name, name, StringComparison.OrdinalIgnoreCase))) return Invalid("A group with that name already exists.");
            g.Name = name;
            g.Description = input.Description?.Trim() ?? g.Description;
            g.Color = input.Color ?? g.Color;
            if (input.MemberIds is { } ids)
            {
                var members = CleanMembers(s, ids, g.OwnerId);
                // While AI is off, clients never see agents, so don't let an edit silently drop them.
                if (!s.AiEnabled) members.AddRange(g.MemberIds.Where(m => s.IsAgent(m) && !members.Contains(m)));
                foreach (var removed in g.MemberIds.Where(m => !members.Contains(m)).ToList()) RemoveFromGroup(s, g, removed);
                g.MemberIds = members;
            }
            return Results.Ok(Progress.ToDto(s, g, me));
        });

    private static IResult DeleteGroup(int id, ClaimsPrincipal p, DataStore s) =>
        InGroup(s, p, id, Level.Edit, (_, g) =>
        {
            foreach (var pr in s.Projects.Where(x => x.GroupId == g.Id).ToList()) s.DeleteProject(pr);
            s.Groups.Remove(g);
            return Results.NoContent();
        });

    private static IResult AddGroupMember(int id, int userId, ClaimsPrincipal p, DataStore s) =>
        InGroup(s, p, id, Level.Manage, (me, g) =>
        {
            var user = s.Users.FirstOrDefault(u => u.Id == userId && (u.Kind == UserKind.Human || s.AiEnabled));
            if (user is null) return Results.NotFound();
            if (!g.MemberIds.Contains(userId)) g.MemberIds.Add(userId);
            return Results.Ok(Progress.ToDto(s, g, me));
        });

    private static IResult RemoveGroupMember(int id, int userId, ClaimsPrincipal p, DataStore s) =>
        InGroup(s, p, id, Level.Manage, (me, g) =>
        {
            if (userId == g.OwnerId) return Invalid("The person who owns a group can't be removed from it.");
            RemoveFromGroup(s, g, userId);
            return Results.Ok(Progress.ToDto(s, g, me));
        });

    // ---------- projects ----------

    private static IResult ListProjects(ClaimsPrincipal p, DataStore s)
    {
        lock (s.Sync)
        {
            var me = s.Users.FirstOrDefault(u => u.Id == p.UserId());
            if (me is null) return Results.Unauthorized();
            return Results.Ok(s.Projects.Where(pr => Access.CanView(s, me, pr)).Select(pr => Progress.ToDto(s, pr, me)).ToList());
        }
    }

    private static IResult CreateProject(ProjectInput input, ClaimsPrincipal p, DataStore s)
    {
        lock (s.Sync)
        {
            var me = s.Users.FirstOrDefault(u => u.Id == p.UserId() && u.Kind == UserKind.Human);
            if (me is null) return Results.Unauthorized();
            if (string.IsNullOrWhiteSpace(input.Name)) return Invalid("Name is required.");
            if (input.GroupId is not { } groupId) return Invalid("Choose a group for the project.");
            var group = s.Groups.FirstOrDefault(g => g.Id == groupId);
            if (group is null || !Access.CanViewGroup(me, group)) return Invalid("Group not found.");
            if (!Access.CanManageGroup(me, group)) return Results.Forbid();

            var today = DateOnly.FromDateTime(DateTime.Today);
            var pr = new Project
            {
                Id = s.NextProjectId(), Name = input.Name.Trim(), Description = input.Description ?? "",
                Status = input.Status ?? ProjectStatus.Planning, StartDate = input.StartDate ?? today,
                DueDate = input.DueDate ?? today.AddDays(30), OwnerId = me.Id, GroupId = group.Id,
            };
            s.Projects.Add(pr);
            return Results.Created($"/api/projects/{pr.Id}", Progress.ToDto(s, pr, me));
        }
    }

    private static IResult UpdateProject(int id, ProjectInput input, ClaimsPrincipal p, DataStore s) =>
        InProject(s, p, id, Level.Edit, (me, pr) =>
        {
            if (string.IsNullOrWhiteSpace(input.Name)) return Invalid("Name is required.");
            // A project stays in the group it was created in (moving it would strand its assignees).
            pr.Name = input.Name.Trim();
            pr.Description = input.Description ?? pr.Description;
            pr.Status = input.Status ?? pr.Status;
            pr.StartDate = input.StartDate ?? pr.StartDate;
            pr.DueDate = input.DueDate ?? pr.DueDate;
            return Results.Ok(Progress.ToDto(s, pr, me));
        });

    private static IResult DeleteProject(int id, ClaimsPrincipal p, DataStore s) =>
        InProject(s, p, id, Level.Edit, (_, pr) =>
        {
            s.DeleteProject(pr);
            return Results.NoContent();
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
            if (ValidateTaskRefs(s, pr, input.AssigneeId, input.GoalId) is { } err) return Invalid(err);
            var t = new TaskItem
            {
                Id = s.NextTaskId(), ProjectId = pr.Id, Title = input.Title.Trim(), Description = input.Description ?? "",
                Status = input.Status ?? WorkStatus.Todo, Priority = input.Priority ?? Priority.Medium,
                AssigneeId = input.AssigneeId, GoalId = input.GoalId, DueDate = input.DueDate,
            };
            s.Tasks.Add(t);
            KickAgent(s, runs, t, null, me);
            return Results.Created($"/api/tasks/{t.Id}", t);
        });

    private static IResult UpdateTask(int id, TaskInput input, ClaimsPrincipal p, DataStore s, AgentRunService runs) =>
        ForTask(s, p, id, (me, pr, t) =>
        {
            if (string.IsNullOrWhiteSpace(input.Title)) return Invalid("Title is required.");
            if (ValidateTaskRefs(s, pr, input.AssigneeId, input.GoalId) is { } err) return Invalid(err);
            var previous = t.AssigneeId;
            t.Title = input.Title.Trim();
            t.Description = input.Description ?? "";
            t.Status = input.Status ?? t.Status;
            t.Priority = input.Priority ?? t.Priority;
            t.AssigneeId = input.AssigneeId;
            t.GoalId = input.GoalId;
            t.DueDate = input.DueDate;
            KickAgent(s, runs, t, previous, me);
            return Results.Ok(t);
        });

    private static IResult DeleteTask(int id, ClaimsPrincipal p, DataStore s) =>
        ForTask(s, p, id, (_, _, t) => { s.DeleteTask(t); return Results.NoContent(); });

    private static IResult PatchAssignee(int id, AssigneeInput input, ClaimsPrincipal p, DataStore s, AgentRunService runs) =>
        ForTask(s, p, id, (me, pr, t) =>
        {
            if (ValidateTaskRefs(s, pr, input.AssigneeId, null) is { } err) return Invalid(err);
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
