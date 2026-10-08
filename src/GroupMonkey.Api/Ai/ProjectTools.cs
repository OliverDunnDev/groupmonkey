using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using GroupMonkey.Api.Data;
using GroupMonkey.Api.Models;
using GroupMonkey.Api.Services;

namespace GroupMonkey.Api.Ai;

public record ToolResult(string Content, bool IsError = false);

public record ToolSpec(string Name, string Description, Dictionary<string, JsonElement> Properties, string[] Required);

/// <summary>Definitions of the tools offered to a model. Descriptions double as usage guidance.</summary>
public static class ToolCatalog
{
    private static JsonElement P(string type, string description) =>
        JsonSerializer.SerializeToElement(new { type, description });

    private static JsonElement Enum(string description, params string[] values) =>
        JsonSerializer.SerializeToElement(new { type = "string", description, @enum = values });

    public static readonly ToolSpec[] All =
    [
        new(AgentTools.GetProjectSummary,
            "Get an overview of the project: description, dates, overall progress, goals, groups and team members.",
            [], []),
        new(AgentTools.ListTasks,
            "List tasks in the project, optionally filtered by status or assignee.",
            new()
            {
                ["status"] = Enum("Only tasks with this status.", "Todo", "InProgress", "Review", "Done"),
                ["assignee_id"] = P("integer", "Only tasks assigned to this user id."),
            }, []),
        new(AgentTools.GetTask,
            "Get full details of one task, including its recent comments.",
            new() { ["task_id"] = P("integer", "The task id.") }, ["task_id"]),
        new(AgentTools.AddComment,
            "Post a comment on a task. Use this to deliver your work (Markdown is fine) or to report progress.",
            new() { ["task_id"] = P("integer", "The task id."), ["body"] = P("string", "The comment text.") }, ["task_id", "body"]),
        new(AgentTools.UpdateTaskStatus,
            "Change the status of a task assigned to you. Move finished work to Review so a person can check it.",
            new()
            {
                ["task_id"] = P("integer", "The task id."),
                ["status"] = Enum("The new status.", "Todo", "InProgress", "Review", "Done"),
            }, ["task_id", "status"]),
        new(AgentTools.CreateTask,
            "Create a new task in this project (for example a follow-up). Assignees must be human team members.",
            new()
            {
                ["title"] = P("string", "Short task title."),
                ["description"] = P("string", "What needs doing."),
                ["priority"] = Enum("Priority.", "Low", "Medium", "High", "Urgent"),
                ["assignee_id"] = P("integer", "Optional user id of a human project member."),
                ["due_date"] = P("string", "Optional due date, YYYY-MM-DD."),
                ["goal_id"] = P("integer", "Optional goal id."),
                ["group_id"] = P("integer", "Optional group id."),
            }, ["title"]),
        new(AgentTools.AssignTask,
            "Assign a task to a human project member, or unassign it by passing null.",
            new() { ["task_id"] = P("integer", "The task id."), ["assignee_id"] = P("integer", "User id of a human project member, or null.") },
            ["task_id", "assignee_id"]),
        new(AgentTools.RequestHumanInput,
            "Ask a person a question when you are blocked or need a decision. This posts the question on the task and pauses your work.",
            new() { ["question"] = P("string", "A specific question for the team.") }, ["question"]),
    ];

    public static IEnumerable<ToolSpec> For(AgentConfig cfg) =>
        All.Where(t => AgentTools.Read.Contains(t.Name) || cfg.AllowedTools.Contains(t.Name));
}

/// <summary>
/// The only way an agent touches project data. Every call is scoped to the run's project, requires the agent
/// to be a member, respects the allowed-tools list and the agent's autonomy level, and never lets an agent
/// delete anything, change membership or assign work to another agent.
/// </summary>
public class ProjectTools(DataStore s, User agent, AgentConfig cfg, AgentRun run)
{
    public bool NeedsInput { get; private set; }

    // Consistent camelCase keys and readable (non-escaped) text for the model.
    private static readonly JsonSerializerOptions Out = new()
    {
        Converters = { new JsonStringEnumConverter() },
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        WriteIndented = false,
    };
    private static string J(object o) => JsonSerializer.Serialize(o, Out);
    private static ToolResult Ok(string text) => new(text);
    private static ToolResult Err(string text) => new(text, true);

    public ToolResult Execute(string name, IReadOnlyDictionary<string, JsonElement> args, bool approved = false)
    {
        lock (s.Sync)
        {
            if (!AgentTools.All.Contains(name)) return Err($"Unknown tool '{name}'.");
            if (!AgentTools.Read.Contains(name) && !cfg.AllowedTools.Contains(name)) return Err($"The tool '{name}' is not enabled for you.");
            var proj = s.Projects.FirstOrDefault(p => p.Id == run.ProjectId);
            if (proj is null || !proj.MemberIds.Contains(agent.Id)) return Err("You are not a member of this project.");

            try
            {
                if (AgentTools.ChangesState(name) && !approved)
                {
                    if (cfg.Autonomy == Autonomy.Suggest)
                        return Err("Your autonomy level is Suggest: you can read and comment but not change tasks. Describe the change you recommend in a comment instead.");
                    var check = Change(name, args, proj, apply: false);
                    if (check.IsError) return check;
                    if (cfg.Autonomy == Autonomy.AskFirst) return Propose(name, args, proj, check.Content);
                }

                return name switch
                {
                    AgentTools.GetProjectSummary => Summary(proj),
                    AgentTools.ListTasks => ListTasks(args, proj),
                    AgentTools.GetTask => GetTask(args, proj),
                    AgentTools.AddComment => AddComment(args, proj),
                    AgentTools.RequestHumanInput => RequestInput(args, proj),
                    _ => Change(name, args, proj, apply: true),
                };
            }
            catch (Exception ex) when (ex is KeyNotFoundException or InvalidOperationException or FormatException)
            {
                return Err("Invalid arguments: " + ex.Message);
            }
        }
    }

    // ---------- argument helpers ----------

    private static int? Int(IReadOnlyDictionary<string, JsonElement> a, string key)
    {
        if (!a.TryGetValue(key, out var v)) return null;
        if (v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var i)) return i;
        if (v.ValueKind == JsonValueKind.String && int.TryParse(v.GetString(), out i)) return i;
        return null;
    }

    private static string? Str(IReadOnlyDictionary<string, JsonElement> a, string key) =>
        a.TryGetValue(key, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static string Clip(string text, int max) => text.Length <= max ? text : text[..max];

    private TaskItem? Task(IReadOnlyDictionary<string, JsonElement> a, Project p)
    {
        var id = Int(a, "task_id");
        return id is null ? null : s.Tasks.FirstOrDefault(t => t.Id == id && t.ProjectId == p.Id);
    }

    private string Name(int? userId) => userId is null ? "Unassigned" : s.Users.FirstOrDefault(u => u.Id == userId)?.Name ?? $"User {userId}";

    // ---------- read tools ----------

    private ToolResult Summary(Project p)
    {
        var sum = Progress.Summarise(s, p);
        return Ok(J(new
        {
            project = new { p.Id, p.Name, p.Description, p.Status, start = p.StartDate, due = p.DueDate },
            progress = new { sum.Total, sum.Done, sum.Percent, sum.Overdue, sum.ByStatus },
            goals = s.Goals.Where(g => g.ProjectId == p.Id).Select(g => Progress.ToDto(s, g))
                .Select(g => new { g.Id, g.Title, g.Description, target = g.TargetDate, g.TaskCount, g.DoneCount, g.Percent }),
            groups = s.Groups.Where(g => g.ProjectId == p.Id).Select(g => new { g.Id, g.Name, members = g.MemberIds.Select(m => Name(m)) }),
            team = p.MemberIds.Select(id => new { id, name = Name(id), kind = s.IsAgent(id) ? "Agent" : "Human" }),
        }));
    }

    private ToolResult ListTasks(IReadOnlyDictionary<string, JsonElement> a, Project p)
    {
        IEnumerable<TaskItem> q = s.Tasks.Where(t => t.ProjectId == p.Id);
        if (Str(a, "status") is { } st && Enum.TryParse<WorkStatus>(st, true, out var status)) q = q.Where(t => t.Status == status);
        if (Int(a, "assignee_id") is { } who) q = q.Where(t => t.AssigneeId == who);
        return Ok(J(q.Take(100).Select(t => new
        {
            t.Id, t.Title, t.Status, t.Priority, assignee = Name(t.AssigneeId), assignee_id = t.AssigneeId,
            due = t.DueDate, goal_id = t.GoalId, group_id = t.GroupId,
        })));
    }

    private ToolResult GetTask(IReadOnlyDictionary<string, JsonElement> a, Project p)
    {
        var t = Task(a, p);
        if (t is null) return Err("Task not found in this project.");
        return Ok(TaskBrief(t));
    }

    /// <summary>Task details plus recent comments, as JSON. Used for the tool and for the opening briefing.</summary>
    public string TaskBrief(TaskItem t) => J(new
    {
        t.Id, t.Title, t.Description, t.Status, t.Priority, assignee = Name(t.AssigneeId), due = t.DueDate,
        goal = s.Goals.FirstOrDefault(g => g.Id == t.GoalId)?.Title,
        group = s.Groups.FirstOrDefault(g => g.Id == t.GroupId)?.Name,
        comments = s.Comments.Where(c => c.TaskId == t.Id).OrderBy(c => c.CreatedAt).TakeLast(20)
            .Select(c => new { author = Name(c.AuthorId), kind = s.IsAgent(c.AuthorId) ? "Agent" : "Human", at = c.CreatedAt, c.Body }),
    });

    // ---------- comment tools ----------

    private ToolResult AddComment(IReadOnlyDictionary<string, JsonElement> a, Project p)
    {
        var t = Task(a, p);
        if (t is null) return Err("Task not found in this project.");
        var body = Str(a, "body")?.Trim();
        if (string.IsNullOrEmpty(body)) return Err("The comment body is empty.");
        s.Comments.Add(new TaskComment { Id = s.NextCommentId(), TaskId = t.Id, AuthorId = agent.Id, Body = Clip(body, 8000), CreatedAt = DateTime.UtcNow });
        return Ok($"Comment posted on task #{t.Id}.");
    }

    private ToolResult RequestInput(IReadOnlyDictionary<string, JsonElement> a, Project p)
    {
        var question = Str(a, "question")?.Trim();
        if (string.IsNullOrEmpty(question)) return Err("The question is empty.");
        var t = s.Tasks.FirstOrDefault(x => x.Id == run.TaskId && x.ProjectId == p.Id);
        if (t is null) return Err("Task not found.");
        s.Comments.Add(new TaskComment { Id = s.NextCommentId(), TaskId = t.Id, AuthorId = agent.Id, Body = "**I need your input:** " + Clip(question, 4000), CreatedAt = DateTime.UtcNow });
        NeedsInput = true;
        return Ok("Question posted. Stop working now; the team will reply on the task and you will be re-run.");
    }

    // ---------- state-changing tools (validated, then optionally applied) ----------

    private ToolResult Change(string name, IReadOnlyDictionary<string, JsonElement> a, Project p, bool apply)
    {
        switch (name)
        {
            case AgentTools.UpdateTaskStatus:
            {
                var t = Task(a, p);
                if (t is null) return Err("Task not found in this project.");
                if (t.AssigneeId != agent.Id) return Err("You can only change the status of tasks assigned to you.");
                if (!Enum.TryParse<WorkStatus>(Str(a, "status"), true, out var status)) return Err("Status must be Todo, InProgress, Review or Done.");
                if (status == WorkStatus.Done && cfg.Autonomy != Autonomy.Autonomous) return Err("You can move work to Review; a person marks it Done.");
                var summary = $"Move task #{t.Id} \"{t.Title}\" from {t.Status} to {status}";
                if (apply) t.Status = status;
                return Ok(apply ? $"Task #{t.Id} is now {status}." : summary);
            }
            case AgentTools.CreateTask:
            {
                var title = Str(a, "title")?.Trim();
                if (string.IsNullOrEmpty(title)) return Err("A title is required.");
                var priority = Priority.Medium;
                if (Str(a, "priority") is { } pr && !Enum.TryParse(pr, true, out priority)) return Err("Priority must be Low, Medium, High or Urgent.");
                var assignee = Int(a, "assignee_id");
                if (assignee is { } who && (!p.MemberIds.Contains(who) || s.IsAgent(who))) return Err("The assignee must be a human member of this project.");
                DateOnly? due = null;
                if (Str(a, "due_date") is { } d)
                {
                    if (!DateOnly.TryParseExact(d, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed)) return Err("due_date must be YYYY-MM-DD.");
                    due = parsed;
                }
                var goal = Int(a, "goal_id");
                if (goal is { } g && !s.Goals.Any(x => x.Id == g && x.ProjectId == p.Id)) return Err("Goal not found in this project.");
                var group = Int(a, "group_id");
                if (group is { } gr && !s.Groups.Any(x => x.Id == gr && x.ProjectId == p.Id)) return Err("Group not found in this project.");
                var summary = $"Create task \"{Clip(title, 120)}\"" + (assignee is null ? "" : $" assigned to {Name(assignee)}");
                if (!apply) return Ok(summary);
                var t = new TaskItem
                {
                    Id = s.NextTaskId(), ProjectId = p.Id, Title = Clip(title, 200), Description = Clip(Str(a, "description") ?? "", 4000),
                    Status = WorkStatus.Todo, Priority = priority, AssigneeId = assignee, GoalId = goal, GroupId = group, DueDate = due,
                };
                s.Tasks.Add(t);
                return Ok($"Created task #{t.Id}.");
            }
            case AgentTools.AssignTask:
            {
                var t = Task(a, p);
                if (t is null) return Err("Task not found in this project.");
                if (!a.ContainsKey("assignee_id")) return Err("assignee_id is required (use null to unassign).");
                var assignee = Int(a, "assignee_id");
                if (assignee is { } who && (!p.MemberIds.Contains(who) || s.IsAgent(who))) return Err("The assignee must be a human member of this project.");
                var summary = $"Assign task #{t.Id} \"{t.Title}\" to {Name(assignee)}";
                if (apply) t.AssigneeId = assignee;
                return Ok(apply ? $"Task #{t.Id} is now assigned to {Name(assignee)}." : summary);
            }
            default:
                return Err($"Unknown tool '{name}'.");
        }
    }

    private ToolResult Propose(string name, IReadOnlyDictionary<string, JsonElement> args, Project p, string summary)
    {
        var action = new ProposedAction
        {
            Id = s.NextActionId(), RunId = run.Id, AgentId = agent.Id, ProjectId = p.Id,
            TaskId = Int(args, "task_id") ?? run.TaskId, Tool = name,
            Args = args.ToDictionary(kv => kv.Key, kv => kv.Value.Clone()),
            Summary = summary, State = ActionState.Pending, CreatedAt = DateTime.UtcNow,
        };
        s.Actions.Add(action);
        run.ActionIds.Add(action.Id);
        return Ok($"Held for human approval (proposal #{action.Id}): {summary}. Do not repeat it; carry on with the rest of your work.");
    }
}
