using System.Text.Json;

namespace GroupMonkey.Api.Models;

/// <summary>Tool names an agent can be allowed to use. Reading project data is always allowed.</summary>
public static class AgentTools
{
    public const string GetProjectSummary = "get_project_summary";
    public const string ListTasks = "list_tasks";
    public const string GetTask = "get_task";
    public const string AddComment = "add_comment";
    public const string UpdateTaskStatus = "update_task_status";
    public const string CreateTask = "create_task";
    public const string AssignTask = "assign_task";
    public const string RequestHumanInput = "request_human_input";

    public static readonly string[] Read = [GetProjectSummary, ListTasks, GetTask];
    public static readonly string[] Optional = [AddComment, UpdateTaskStatus, CreateTask, AssignTask, RequestHumanInput];
    public static readonly string[] All = [.. Read, .. Optional];

    // Tools that change project state beyond leaving a comment. Gated by autonomy.
    public static bool ChangesState(string tool) => tool is UpdateTaskStatus or CreateTask or AssignTask;
}

/// <summary>Configuration of an agent. The agent itself is a <see cref="User"/> with Kind = Agent.</summary>
public class AgentConfig
{
    public int UserId { get; set; }
    public string Description { get; set; } = "";
    public string Instructions { get; set; } = "";
    public string? Model { get; set; }
    public Autonomy Autonomy { get; set; } = Autonomy.AskFirst;
    public List<string> AllowedTools { get; set; } = [.. AgentTools.All];
    public bool Enabled { get; set; } = true;
    public int CreatedBy { get; set; }
    public int DailyRunLimit { get; set; } = 20;
}

public class TaskComment
{
    public int Id { get; set; }
    public int TaskId { get; set; }
    public int AuthorId { get; set; }
    public string Body { get; set; } = "";
    public DateTime CreatedAt { get; set; }
}

public class RunStep
{
    public StepType Type { get; set; }
    public string Content { get; set; } = "";
    public DateTime At { get; set; }
}

public class ProposedAction
{
    public int Id { get; set; }
    public int RunId { get; set; }
    public int AgentId { get; set; }
    public int ProjectId { get; set; }
    public int TaskId { get; set; }
    public string Tool { get; set; } = "";
    public Dictionary<string, JsonElement> Args { get; set; } = [];
    public string Summary { get; set; } = "";
    public ActionState State { get; set; }
    public int? DecidedBy { get; set; }
    public DateTime CreatedAt { get; set; }
}

public class AgentRun
{
    public int Id { get; set; }
    public int AgentId { get; set; }
    public int TaskId { get; set; }
    public int ProjectId { get; set; }
    public RunStatus Status { get; set; } = RunStatus.Queued;
    public DateTime CreatedAt { get; set; }
    public DateTime? StartedAt { get; set; }
    public DateTime? EndedAt { get; set; }
    public string Provider { get; set; } = "Mock";
    public string? Model { get; set; }
    public long InputTokens { get; set; }
    public long OutputTokens { get; set; }
    public string? Error { get; set; }
    public string? TriggeredBy { get; set; }
    public List<RunStep> Steps { get; set; } = [];
    public List<int> ActionIds { get; set; } = [];
}
